//! A small, mostly read-only git slice (BRS 7.7). Calls the user's own `git`
//! executable (hidden window, timeout, no prompts) so credentials, hooks and
//! `.gitignore` behave exactly as in their terminal.

use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashSet;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const TIMEOUT: Duration = Duration::from_secs(15);
/// Hooks (pre-commit) can legitimately take a while.
const COMMIT_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub toplevel: String,
    pub branch: Option<String>,
    pub detached: bool,
    /// Short hash of HEAD (None in a repository without commits).
    pub head: Option<String>,
    pub dirty: bool,
    pub has_upstream: bool,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// One letter: M modified, A added, D deleted, R renamed, ? untracked, U conflicted.
    pub status: String,
    pub staged: bool,
    pub conflict: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Branches {
    pub current: Option<String>,
    pub local: Vec<String>,
    /// Remote-only branches (no local branch of the same name), without the remote prefix.
    pub remote: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub hash: String,
    pub short: String,
    pub parents: Vec<String>,
    pub subject: String,
    pub author: String,
    pub date: i64,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub status: String,
    pub path: String,
}

struct Output {
    ok: bool,
    stdout: Vec<u8>,
    stderr: String,
}

fn run(dir: &Path, args: &[&str], stdin: Option<&[u8]>, timeout: Duration) -> Result<Output, String> {
    let mut cmd = Command::new("git");
    cmd.arg("--no-optional-locks")
        .args(["-c", "core.quotepath=false", "-c", "core.safecrlf=false"])
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Git is not installed or not on your PATH.".to_string()
        } else {
            format!("Could not run git: {e}")
        }
    })?;
    if let (Some(data), Some(mut si)) = (stdin, child.stdin.take()) {
        let _ = si.write_all(data);
    }
    let mut out = child.stdout.take();
    let mut err = child.stderr.take();
    let h1 = std::thread::spawn(move || {
        let mut v = Vec::new();
        if let Some(o) = out.as_mut() {
            let _ = o.read_to_end(&mut v);
        }
        v
    });
    let h2 = std::thread::spawn(move || {
        let mut v = Vec::new();
        if let Some(o) = err.as_mut() {
            let _ = o.read_to_end(&mut v);
        }
        v
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if start.elapsed() > timeout => {
                crate::job::taskkill_tree(child.id());
                let _ = child.wait();
                return Err(format!("git took longer than {} seconds and was stopped.", timeout.as_secs()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(15)),
            Err(e) => return Err(e.to_string()),
        }
    };
    Ok(Output {
        ok: status.success(),
        stdout: h1.join().unwrap_or_default(),
        stderr: String::from_utf8_lossy(&h2.join().unwrap_or_default()).trim().to_string(),
    })
}

fn text(o: &Output) -> String {
    String::from_utf8_lossy(&o.stdout).to_string()
}

fn git_error(o: &Output) -> String {
    let t = if o.stderr.is_empty() { text(o).trim().to_string() } else { o.stderr.clone() };
    if t.is_empty() {
        "git failed without a message.".into()
    } else {
        t
    }
}

// ---------------------------------------------------------------- operation lock

fn locks() -> &'static Mutex<HashSet<String>> {
    static L: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(HashSet::new()))
}

/// One writing git operation per repository at a time.
#[derive(Debug)]
pub struct OpGuard(String);
impl OpGuard {
    pub fn acquire(toplevel: &str) -> Result<OpGuard, String> {
        if locks().lock().insert(toplevel.to_string()) {
            Ok(OpGuard(toplevel.to_string()))
        } else {
            Err("Another git operation is already running in this repository.".into())
        }
    }
}
impl Drop for OpGuard {
    fn drop(&mut self) {
        locks().lock().remove(&self.0);
    }
}

// ---------------------------------------------------------------------- status

struct Parsed {
    info: RepoInfo,
    changes: Vec<FileChange>,
}

fn parse_status(raw: &[u8]) -> Parsed {
    let mut info = RepoInfo::default();
    let mut changes = Vec::new();
    let s = String::from_utf8_lossy(raw);
    let mut it = s.split('\0').peekable();
    while let Some(entry) = it.next() {
        if entry.is_empty() {
            continue;
        }
        if let Some(h) = entry.strip_prefix("# ") {
            if let Some(v) = h.strip_prefix("branch.head ") {
                if v == "(detached)" {
                    info.detached = true;
                } else {
                    info.branch = Some(v.to_string());
                }
            } else if let Some(v) = h.strip_prefix("branch.oid ") {
                if v != "(initial)" {
                    info.head = Some(v.chars().take(7).collect());
                }
            } else if h.starts_with("branch.upstream ") {
                info.has_upstream = true;
            } else if let Some(v) = h.strip_prefix("branch.ab ") {
                for part in v.split(' ') {
                    if let Some(a) = part.strip_prefix('+') {
                        info.ahead = a.parse().unwrap_or(0);
                    } else if let Some(b) = part.strip_prefix('-') {
                        info.behind = b.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        let kind = entry.as_bytes()[0];
        match kind {
            b'1' | b'2' | b'u' => {
                let n = match kind {
                    b'1' => 9,
                    b'2' => 10,
                    _ => 11,
                };
                let parts: Vec<&str> = entry.splitn(n, ' ').collect();
                if parts.len() < n {
                    continue;
                }
                let xy: Vec<char> = parts[1].chars().collect();
                let (x, y) = (xy.first().copied().unwrap_or('.'), xy.get(1).copied().unwrap_or('.'));
                let path = parts[n - 1].to_string();
                if kind == b'2' {
                    let _orig = it.next(); // the old path of a rename
                }
                let conflict = kind == b'u';
                let letter = if conflict {
                    'U'
                } else if x != '.' {
                    x
                } else {
                    y
                };
                changes.push(FileChange { path, status: letter.to_string(), staged: x != '.' && !conflict, conflict });
            }
            b'?' => changes.push(FileChange {
                path: entry[2..].to_string(),
                status: "?".into(),
                staged: false,
                conflict: false,
            }),
            _ => {}
        }
    }
    info.dirty = !changes.is_empty();
    Parsed { info, changes }
}

fn status(dir: &Path) -> Result<Option<Parsed>, String> {
    let top = run(dir, &["rev-parse", "--show-toplevel"], None, TIMEOUT)?;
    if !top.ok {
        return Ok(None); // not a repository
    }
    let toplevel = text(&top).trim().replace('/', "\\");
    let st = run(dir, &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], None, TIMEOUT)?;
    if !st.ok {
        return Err(git_error(&st));
    }
    let mut p = parse_status(&st.stdout);
    p.info.toplevel = toplevel;
    Ok(Some(p))
}

/// `None` when the folder is not inside a git repository.
pub fn repo_info(dir: &Path) -> Result<Option<RepoInfo>, String> {
    Ok(status(dir)?.map(|p| p.info))
}

pub fn changes(dir: &Path) -> Result<Vec<FileChange>, String> {
    Ok(status(dir)?.map(|p| p.changes).unwrap_or_default())
}

// -------------------------------------------------------------------- branches

pub fn branches(dir: &Path) -> Result<Branches, String> {
    let o = run(
        dir,
        &["for-each-ref", "--format=%(refname)%09%(HEAD)", "refs/heads", "refs/remotes"],
        None,
        TIMEOUT,
    )?;
    if !o.ok {
        return Err(git_error(&o));
    }
    let mut b = Branches::default();
    let mut remote: Vec<String> = Vec::new();
    for line in text(&o).lines() {
        let (name, head) = line.split_once('\t').unwrap_or((line, ""));
        if let Some(l) = name.strip_prefix("refs/heads/") {
            b.local.push(l.to_string());
            if head.trim() == "*" {
                b.current = Some(l.to_string());
            }
        } else if let Some(r) = name.strip_prefix("refs/remotes/") {
            if let Some((_, short)) = r.split_once('/') {
                if short != "HEAD" {
                    remote.push(short.to_string());
                }
            }
        }
    }
    remote.sort();
    remote.dedup();
    b.remote = remote.into_iter().filter(|r| !b.local.contains(r)).collect();
    b.local.sort();
    Ok(b)
}

/// Reject anything that could be read as an option or is not a plausible branch name.
pub fn valid_branch_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && !name.contains("..")
        && !name.ends_with('/')
        && !name.ends_with(".lock")
        && !name.chars().any(|c| c.is_control() || " ~^:?*[\\".contains(c))
}

pub fn switch_branch(dir: &Path, name: &str) -> Result<(), String> {
    if !valid_branch_name(name) {
        return Err(format!("\"{name}\" is not a valid branch name."));
    }
    let info = repo_info(dir)?.ok_or("This folder is not a git repository.")?;
    let _g = OpGuard::acquire(&info.toplevel)?;
    // `git switch <name>` also creates a tracking branch for a unique remote branch.
    let o = run(dir, &["switch", name], None, TIMEOUT)?;
    if o.ok {
        Ok(())
    } else {
        Err(git_error(&o))
    }
}

// ---------------------------------------------------------------------- commit

pub fn commit(dir: &Path, paths: &[String], message: &str) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Write a commit message first.".into());
    }
    if paths.is_empty() {
        return Err("Select at least one file to commit.".into());
    }
    let info = repo_info(dir)?.ok_or("This folder is not a git repository.")?;
    let _g = OpGuard::acquire(&info.toplevel)?;
    let top = Path::new(&info.toplevel);

    let mut add: Vec<&str> = vec!["add", "-A", "--"];
    add.extend(paths.iter().map(|p| p.as_str()));
    let a = run(top, &add, None, TIMEOUT)?;
    if !a.ok {
        return Err(git_error(&a));
    }
    // `-F -` reads the message from stdin (no shell, no quoting problems); paths limit
    // the commit to the selected files even if others are staged.
    let mut args: Vec<&str> = vec!["commit", "-F", "-", "--"];
    args.extend(paths.iter().map(|p| p.as_str()));
    let c = run(top, &args, Some(message.as_bytes()), COMMIT_TIMEOUT)?;
    if !c.ok {
        let mut msg = git_error(&c);
        let out = text(&c);
        if !out.trim().is_empty() && !msg.contains(out.trim()) {
            msg = format!("{}\n{}", out.trim(), msg);
        }
        return Err(msg);
    }
    let h = run(top, &["rev-parse", "--short", "HEAD"], None, TIMEOUT)?;
    Ok(text(&h).trim().to_string())
}

// -------------------------------------------------------------- fetch / pull / push

const NET_TIMEOUT: Duration = Duration::from_secs(120);

fn net_error(o: &Output) -> String {
    let e = git_error(o);
    let l = e.to_lowercase();
    if l.contains("terminal prompts disabled")
        || l.contains("could not read username")
        || l.contains("could not read password")
        || l.contains("authentication failed")
        || l.contains("permission denied (publickey")
        || l.contains("enter passphrase")
    {
        format!("{e}\n\nRun the command once in the Console tab to sign in, then try again.")
    } else {
        e
    }
}

/// `origin` if present, otherwise the first remote.
fn remote_name(dir: &Path) -> Result<Option<String>, String> {
    let o = run(dir, &["remote"], None, TIMEOUT)?;
    if !o.ok {
        return Err(git_error(&o));
    }
    let names: Vec<String> = text(&o).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
    Ok(if names.iter().any(|n| n == "origin") { Some("origin".to_string()) } else { names.into_iter().next() })
}

fn current_repo(dir: &Path) -> Result<RepoInfo, String> {
    repo_info(dir)?.ok_or_else(|| "This folder is not a git repository.".to_string())
}

pub fn fetch(dir: &Path) -> Result<String, String> {
    let info = current_repo(dir)?;
    if remote_name(Path::new(&info.toplevel))?.is_none() {
        return Err("This repository has no remote to fetch from.".into());
    }
    let _g = OpGuard::acquire(&info.toplevel)?;
    let o = run(Path::new(&info.toplevel), &["fetch", "--prune", "--quiet"], None, NET_TIMEOUT)?;
    if o.ok {
        Ok("Fetched.".into())
    } else {
        Err(net_error(&o))
    }
}

/// Fast-forward only: a pull can never create a merge or rewrite history.
pub fn pull(dir: &Path) -> Result<String, String> {
    let info = current_repo(dir)?;
    if info.detached || info.branch.is_none() {
        return Err("You are not on a branch, so there is nothing to pull into.".into());
    }
    if !info.has_upstream {
        return Err("This branch has no upstream yet. Push it first, or use Sync.".into());
    }
    let _g = OpGuard::acquire(&info.toplevel)?;
    let o = run(Path::new(&info.toplevel), &["pull", "--ff-only"], None, NET_TIMEOUT)?;
    if o.ok {
        let t = text(&o);
        return Ok(if t.contains("Already up to date") { "Already up to date.".into() } else { "Pulled the latest changes.".into() });
    }
    let e = net_error(&o);
    let l = e.to_lowercase();
    if l.contains("fast-forward") || l.contains("diverge") {
        Err(format!(
            "Your branch and the remote have both changed, so a fast-forward is not possible. Nothing was changed. Use the Console tab to merge or rebase.\n\n{e}"
        ))
    } else {
        Err(e)
    }
}

/// Plain `git push`; a branch without upstream is pushed with `-u <remote> <branch>`. Never forces.
pub fn push(dir: &Path) -> Result<String, String> {
    let info = current_repo(dir)?;
    let Some(branch) = info.branch.clone() else {
        return Err("You are not on a branch, so there is nothing to push.".into());
    };
    let top = Path::new(&info.toplevel);
    let Some(remote) = remote_name(top)? else {
        return Err("This repository has no remote to push to. Add one in the Console tab (git remote add origin <url>).".into());
    };
    let _g = OpGuard::acquire(&info.toplevel)?;
    let o = if info.has_upstream {
        run(top, &["push"], None, NET_TIMEOUT)?
    } else {
        run(top, &["push", "-u", &remote, &branch], None, NET_TIMEOUT)?
    };
    if o.ok {
        return Ok(if info.has_upstream { "Pushed.".into() } else { format!("Pushed and now tracking {branch}.") });
    }
    let e = net_error(&o);
    let l = e.to_lowercase();
    if l.contains("rejected") || l.contains("fetch first") || l.contains("non-fast-forward") {
        Err(format!("The remote has changes you do not have. Pull first, or use the Console tab.\n\n{e}"))
    } else {
        Err(e)
    }
}

/// Pull (when the branch has an upstream) then push. Stops at the first failure.
pub fn sync(dir: &Path) -> Result<String, String> {
    let info = current_repo(dir)?;
    let mut done = Vec::new();
    if info.has_upstream {
        pull(dir).map_err(|e| format!("Sync stopped while pulling.\n{e}"))?;
        done.push("pulled");
    }
    push(dir).map_err(|e| {
        format!("Sync stopped while pushing{}.\n{e}", if done.is_empty() { "" } else { " (the pull worked)" })
    })?;
    done.push("pushed");
    Ok(format!("Synced: {}.", done.join(" and ")))
}

// ------------------------------------------------------------------------ log

const FS: char = '\u{1f}';
const RS: char = '\u{1e}';

pub fn log(dir: &Path, limit: usize) -> Result<Vec<CommitInfo>, String> {
    let n = limit.clamp(1, 1000).to_string();
    let fmt = format!("--format=%H{FS}%P{FS}%an{FS}%at{FS}%D{FS}%s{RS}");
    let o = run(dir, &["log", "--all", "--date-order", "-n", &n, &fmt], None, TIMEOUT)?;
    if !o.ok {
        let e = git_error(&o);
        // a repository with no commits yet
        if e.contains("does not have any commits") || e.contains("bad default revision") {
            return Ok(vec![]);
        }
        return Err(e);
    }
    let t = text(&o);
    let mut out = Vec::new();
    for rec in t.split(RS) {
        let rec = rec.trim_start_matches('\n');
        if rec.is_empty() {
            continue;
        }
        let f: Vec<&str> = rec.split(FS).collect();
        if f.len() < 6 {
            continue;
        }
        out.push(CommitInfo {
            hash: f[0].to_string(),
            short: f[0].chars().take(7).collect(),
            parents: f[1].split_whitespace().map(String::from).collect(),
            author: f[2].to_string(),
            date: f[3].parse().unwrap_or(0),
            refs: f[4].split(", ").filter(|r| !r.is_empty()).map(|r| r.replace("HEAD -> ", "")).collect(),
            subject: f[5].to_string(),
        });
    }
    Ok(out)
}

pub fn commit_files(dir: &Path, hash: &str) -> Result<Vec<CommitFile>, String> {
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Not a valid commit id.".into());
    }
    let o = run(dir, &["diff-tree", "--no-commit-id", "--name-status", "-r", "-m", "--root", "-z", hash], None, TIMEOUT)?;
    if !o.ok {
        return Err(git_error(&o));
    }
    let t = text(&o);
    let mut parts = t.split('\0').filter(|p| !p.is_empty());
    let mut files = Vec::new();
    while let Some(st) = parts.next() {
        let letter = st.chars().next().unwrap_or('M');
        let path = if letter == 'R' || letter == 'C' {
            let _old = parts.next();
            parts.next()
        } else {
            parts.next()
        };
        if let Some(p) = path {
            files.push(CommitFile { status: letter.to_string(), path: p.to_string() });
        }
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::{tempdir, TempDir};

    fn git(dir: &Path, args: &[&str]) {
        let o = Command::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"])
            .args(args)
            .current_dir(dir)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .expect("git runs");
        assert!(o.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&o.stderr));
    }

    fn write(dir: &Path, rel: &str, text: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    /// A repository with one commit on `main`, local identity configured.
    fn repo() -> TempDir {
        let d = tempdir().unwrap();
        git(d.path(), &["init", "-q", "-b", "main"]);
        git(d.path(), &["config", "user.name", "Test"]);
        git(d.path(), &["config", "user.email", "test@example.com"]);
        git(d.path(), &["config", "commit.gpgsign", "false"]);
        write(d.path(), "a.txt", "one\n");
        git(d.path(), &["add", "."]);
        git(d.path(), &["commit", "-q", "-m", "first"]);
        d
    }

    #[test]
    fn a_plain_folder_is_not_a_repository() {
        let d = tempdir().unwrap();
        assert_eq!(repo_info(d.path()).unwrap(), None);
        assert!(changes(d.path()).unwrap().is_empty());
    }

    #[test]
    fn clean_repository_reports_branch_head_and_not_dirty() {
        let d = repo();
        let i = repo_info(d.path()).unwrap().unwrap();
        assert_eq!(i.branch.as_deref(), Some("main"));
        assert!(!i.detached && !i.dirty && !i.has_upstream);
        assert_eq!(i.head.as_ref().map(|h| h.len()), Some(7));
        assert_eq!((i.ahead, i.behind), (0, 0));
        assert!(i.toplevel.to_lowercase().ends_with(&d.path().file_name().unwrap().to_string_lossy().to_lowercase()));
    }

    #[test]
    fn repository_without_commits_is_handled() {
        let d = tempdir().unwrap();
        git(d.path(), &["init", "-q", "-b", "main"]);
        write(d.path(), "x.txt", "x");
        let i = repo_info(d.path()).unwrap().unwrap();
        assert_eq!(i.branch.as_deref(), Some("main"));
        assert_eq!(i.head, None);
        assert!(i.dirty);
        assert!(log(d.path(), 50).unwrap().is_empty());
        assert_eq!(branches(d.path()).unwrap().local, Vec::<String>::new());
    }

    #[test]
    fn changes_list_modified_untracked_deleted_and_staged() {
        let d = repo();
        write(d.path(), "b.txt", "two\n");
        git(d.path(), &["add", "b.txt"]);
        git(d.path(), &["commit", "-q", "-m", "second"]);
        write(d.path(), "a.txt", "changed\n"); // modified
        write(d.path(), "new file ü.txt", "n"); // untracked, space + unicode
        std::fs::remove_file(d.path().join("b.txt")).unwrap(); // deleted
        write(d.path(), "staged.txt", "s");
        git(d.path(), &["add", "staged.txt"]); // added + staged
        let c = changes(d.path()).unwrap();
        let get = |p: &str| c.iter().find(|x| x.path == p).unwrap_or_else(|| panic!("{p} missing in {c:?}"));
        assert_eq!((get("a.txt").status.as_str(), get("a.txt").staged), ("M", false));
        assert_eq!((get("new file ü.txt").status.as_str(), get("new file ü.txt").staged), ("?", false));
        assert_eq!(get("b.txt").status, "D");
        assert_eq!((get("staged.txt").status.as_str(), get("staged.txt").staged), ("A", true));
        assert!(repo_info(d.path()).unwrap().unwrap().dirty);
    }

    #[test]
    fn untracked_files_are_listed_individually_inside_folders() {
        let d = repo();
        write(d.path(), "dir/one.txt", "1");
        write(d.path(), "dir/two.txt", "2");
        let paths: Vec<String> = changes(d.path()).unwrap().into_iter().map(|c| c.path).collect();
        assert!(paths.contains(&"dir/one.txt".to_string()) && paths.contains(&"dir/two.txt".to_string()), "{paths:?}");
    }

    #[test]
    fn renames_are_one_entry_with_the_new_path() {
        let d = repo();
        git(d.path(), &["mv", "a.txt", "renamed.txt"]);
        let c = changes(d.path()).unwrap();
        assert_eq!(c.len(), 1, "{c:?}");
        assert_eq!((c[0].path.as_str(), c[0].status.as_str()), ("renamed.txt", "R"));
    }

    #[test]
    fn branches_lists_local_sorted_and_marks_current() {
        let d = repo();
        git(d.path(), &["branch", "feature/x"]);
        git(d.path(), &["branch", "alpha"]);
        let b = branches(d.path()).unwrap();
        assert_eq!(b.current.as_deref(), Some("main"));
        assert_eq!(b.local, vec!["alpha", "feature/x", "main"]);
        assert!(b.remote.is_empty());
    }

    #[test]
    fn switching_branches_works_and_updates_the_pill() {
        let d = repo();
        git(d.path(), &["branch", "feature"]);
        switch_branch(d.path(), "feature").unwrap();
        assert_eq!(repo_info(d.path()).unwrap().unwrap().branch.as_deref(), Some("feature"));
        switch_branch(d.path(), "main").unwrap();
        assert_eq!(repo_info(d.path()).unwrap().unwrap().branch.as_deref(), Some("main"));
    }

    #[test]
    fn switching_to_a_missing_branch_returns_gits_message() {
        let d = repo();
        let e = switch_branch(d.path(), "nope").unwrap_err();
        assert!(e.to_lowercase().contains("nope") || e.to_lowercase().contains("invalid"), "{e}");
    }

    #[test]
    fn dangerous_or_invalid_branch_names_are_rejected_before_git_runs() {
        let d = repo();
        for bad in ["--orphan", "-f", "a b", "a..b", "", "x~1", "x^", "feature/", "a:b", "ref.lock", "a\\b", "a*"] {
            assert!(switch_branch(d.path(), bad).is_err(), "{bad:?} should be rejected");
            assert!(!valid_branch_name(bad), "{bad:?}");
        }
        assert!(valid_branch_name("feature/ok-1_2"));
        assert_eq!(repo_info(d.path()).unwrap().unwrap().branch.as_deref(), Some("main"));
    }

    #[test]
    fn switch_is_refused_by_git_when_local_changes_would_be_lost_and_nothing_is_lost() {
        let d = repo();
        git(d.path(), &["checkout", "-q", "-b", "other"]);
        write(d.path(), "a.txt", "other version\n");
        git(d.path(), &["commit", "-q", "-am", "other"]);
        git(d.path(), &["checkout", "-q", "main"]);
        write(d.path(), "a.txt", "my uncommitted work\n");
        let e = switch_branch(d.path(), "other").unwrap_err();
        assert!(e.contains("a.txt"), "git's own message should name the file: {e}");
        assert_eq!(std::fs::read_to_string(d.path().join("a.txt")).unwrap(), "my uncommitted work\n");
        assert_eq!(repo_info(d.path()).unwrap().unwrap().branch.as_deref(), Some("main"));
    }

    #[test]
    fn detached_head_shows_the_short_hash() {
        let d = repo();
        git(d.path(), &["checkout", "-q", "--detach"]);
        let i = repo_info(d.path()).unwrap().unwrap();
        assert!(i.detached && i.branch.is_none() && i.head.is_some());
    }

    #[test]
    fn commit_only_the_selected_files_and_keep_the_rest_changed() {
        let d = repo();
        write(d.path(), "one.txt", "1");
        write(d.path(), "two.txt", "2");
        write(d.path(), "three.txt", "3");
        let short = commit(d.path(), &["one.txt".into(), "two.txt".into()], "add two files").unwrap();
        assert_eq!(short.len().min(7), short.len());
        let files = commit_files(d.path(), &log(d.path(), 1).unwrap()[0].hash).unwrap();
        let mut names: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();
        names.sort();
        assert_eq!(names, vec!["one.txt", "two.txt"]);
        let left = changes(d.path()).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].path, "three.txt");
    }

    #[test]
    fn commit_ignores_other_already_staged_files() {
        let d = repo();
        write(d.path(), "staged.txt", "s");
        git(d.path(), &["add", "staged.txt"]);
        write(d.path(), "picked.txt", "p");
        commit(d.path(), &["picked.txt".into()], "only picked").unwrap();
        let files = commit_files(d.path(), &log(d.path(), 1).unwrap()[0].hash).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "picked.txt");
        assert!(changes(d.path()).unwrap().iter().any(|c| c.path == "staged.txt" && c.staged));
    }

    #[test]
    fn commit_message_keeps_quotes_unicode_and_multiple_lines() {
        let d = repo();
        write(d.path(), "m.txt", "m");
        let msg = "fix \"quoted\" & $(not run) 日本\n\nbody line 2 `tick`";
        commit(d.path(), &["m.txt".into()], msg).unwrap();
        let o = run(d.path(), &["log", "-1", "--format=%B"], None, TIMEOUT).unwrap();
        assert_eq!(text(&o).trim(), msg);
    }

    #[test]
    fn commit_handles_deleted_and_space_and_unicode_paths() {
        let d = repo();
        write(d.path(), "sub dir/ü file.txt", "u");
        std::fs::remove_file(d.path().join("a.txt")).unwrap();
        commit(d.path(), &["sub dir/ü file.txt".into(), "a.txt".into()], "mixed").unwrap();
        let files = commit_files(d.path(), &log(d.path(), 1).unwrap()[0].hash).unwrap();
        assert!(files.iter().any(|f| f.path == "sub dir/ü file.txt" && f.status == "A"), "{files:?}");
        assert!(files.iter().any(|f| f.path == "a.txt" && f.status == "D"), "{files:?}");
        assert!(changes(d.path()).unwrap().is_empty());
    }

    #[test]
    fn commit_needs_a_message_and_files_and_a_repository() {
        let d = repo();
        write(d.path(), "x.txt", "x");
        assert!(commit(d.path(), &["x.txt".into()], "   ").unwrap_err().contains("message"));
        assert!(commit(d.path(), &[], "msg").unwrap_err().contains("at least one file"));
        let plain = tempdir().unwrap();
        assert!(commit(plain.path(), &["x".into()], "m").unwrap_err().contains("not a git repository"));
        assert_eq!(log(d.path(), 10).unwrap().len(), 1, "nothing was committed");
    }

    #[test]
    fn a_failing_pre_commit_hook_is_reported_with_its_output_and_nothing_is_committed() {
        let d = repo();
        let hook = d.path().join(".git").join("hooks").join("pre-commit");
        std::fs::write(&hook, "#!/bin/sh\necho 'lint failed: no tabs allowed' >&2\nexit 1\n").unwrap();
        write(d.path(), "h.txt", "h");
        let e = commit(d.path(), &["h.txt".into()], "will fail").unwrap_err();
        assert!(e.contains("lint failed"), "{e}");
        assert_eq!(log(d.path(), 10).unwrap().len(), 1);
    }

    #[test]
    fn log_is_newest_first_with_parents_refs_and_subjects() {
        let d = repo();
        git(d.path(), &["tag", "v1"]);
        git(d.path(), &["branch", "side"]);
        write(d.path(), "b.txt", "b");
        git(d.path(), &["add", "."]);
        git(d.path(), &["commit", "-q", "-m", "second: with, comma"]);
        let l = log(d.path(), 50).unwrap();
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].subject, "second: with, comma");
        assert_eq!(l[0].parents, vec![l[1].hash.clone()]);
        assert!(l[0].refs.contains(&"main".to_string()), "{:?}", l[0].refs);
        assert!(l[1].refs.iter().any(|r| r == "tag: v1") && l[1].refs.contains(&"side".to_string()), "{:?}", l[1].refs);
        assert_eq!(l[1].parents.len(), 0);
        assert_eq!(l[0].author, "Test");
        assert!(l[0].date > 1_600_000_000);
    }

    #[test]
    fn log_includes_other_branches_and_respects_the_limit() {
        let d = repo();
        git(d.path(), &["checkout", "-q", "-b", "feature"]);
        for i in 0..5 {
            write(d.path(), &format!("f{i}.txt"), "f");
            git(d.path(), &["add", "."]);
            git(d.path(), &["commit", "-q", "-m", &format!("f{i}")]);
        }
        git(d.path(), &["checkout", "-q", "main"]);
        assert_eq!(log(d.path(), 50).unwrap().len(), 6);
        assert_eq!(log(d.path(), 3).unwrap().len(), 3);
    }

    #[test]
    fn commit_files_rejects_non_hex_ids() {
        let d = repo();
        assert!(commit_files(d.path(), "--output=x").is_err());
        assert!(commit_files(d.path(), "").is_err());
    }

    #[test]
    fn merge_commits_list_their_files_once_per_parent_without_failing() {
        let d = repo();
        git(d.path(), &["checkout", "-q", "-b", "f"]);
        write(d.path(), "f.txt", "f");
        git(d.path(), &["add", "."]);
        git(d.path(), &["commit", "-q", "-m", "f"]);
        git(d.path(), &["checkout", "-q", "main"]);
        write(d.path(), "m.txt", "m");
        git(d.path(), &["add", "."]);
        git(d.path(), &["commit", "-q", "-m", "m"]);
        git(d.path(), &["merge", "-q", "--no-ff", "f", "-m", "merge f"]);
        let top = &log(d.path(), 1).unwrap()[0];
        assert_eq!(top.parents.len(), 2);
        assert!(commit_files(d.path(), &top.hash).is_ok());
    }

    #[test]
    fn ahead_behind_and_remote_only_branches_with_a_real_remote() {
        let remote = tempdir().unwrap();
        git(remote.path(), &["init", "-q", "--bare", "-b", "main"]);
        let d = repo();
        let url = remote.path().display().to_string();
        git(d.path(), &["remote", "add", "origin", &url]);
        git(d.path(), &["push", "-q", "-u", "origin", "main"]);
        git(d.path(), &["push", "-q", "origin", "main:release"]);
        git(d.path(), &["fetch", "-q"]);
        write(d.path(), "ahead.txt", "a");
        git(d.path(), &["add", "."]);
        git(d.path(), &["commit", "-q", "-m", "local only"]);
        let i = repo_info(d.path()).unwrap().unwrap();
        assert!(i.has_upstream);
        assert_eq!((i.ahead, i.behind), (1, 0));
        let b = branches(d.path()).unwrap();
        assert_eq!(b.remote, vec!["release"]);
        // switching to a remote-only branch creates a tracking branch
        switch_branch(d.path(), "release").unwrap();
        let i = repo_info(d.path()).unwrap().unwrap();
        assert_eq!(i.branch.as_deref(), Some("release"));
        assert!(i.has_upstream);
    }

    #[test]
    fn only_one_writing_operation_per_repository() {
        let g = OpGuard::acquire("C:\\repo-a").unwrap();
        assert!(OpGuard::acquire("C:\\repo-a").unwrap_err().contains("already running"));
        assert!(OpGuard::acquire("C:\\repo-b").is_ok());
        drop(g);
        assert!(OpGuard::acquire("C:\\repo-a").is_ok());
    }

    #[test]
    fn works_from_a_subfolder_of_the_repository() {
        let d = repo();
        write(d.path(), "deep/er/f.txt", "x");
        let i = repo_info(&d.path().join("deep").join("er")).unwrap().unwrap();
        assert_eq!(i.branch.as_deref(), Some("main"));
        assert!(i.dirty);
    }

    /// A bare "remote" with `main` already pushed from a fresh local repo, plus the local repo.
    fn with_remote() -> (TempDir, TempDir) {
        let remote = tempdir().unwrap();
        git(remote.path(), &["init", "-q", "--bare", "-b", "main"]);
        let d = repo();
        git(d.path(), &["remote", "add", "origin", &remote.path().display().to_string()]);
        git(d.path(), &["push", "-q", "-u", "origin", "main"]);
        (remote, d)
    }

    /// A second working copy of the same remote, to play "a teammate".
    fn teammate(remote: &TempDir) -> TempDir {
        let t = tempdir().unwrap();
        let o = Command::new("git")
            .args(["clone", "-q", &remote.path().display().to_string(), "."])
            .current_dir(t.path())
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .unwrap();
        assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
        git(t.path(), &["config", "user.name", "Mate"]);
        git(t.path(), &["config", "user.email", "mate@example.com"]);
        t
    }

    fn teammate_commit(t: &TempDir, file: &str) {
        write(t.path(), file, "from teammate");
        git(t.path(), &["add", "."]);
        git(t.path(), &["commit", "-q", "-m", &format!("teammate {file}")]);
        git(t.path(), &["push", "-q"]);
    }

    fn local_commit(d: &TempDir, file: &str) {
        write(d.path(), file, "mine");
        git(d.path(), &["add", "."]);
        git(d.path(), &["commit", "-q", "-m", &format!("mine {file}")]);
    }

    #[test]
    fn push_sets_upstream_for_a_new_branch_and_the_remote_receives_it() {
        let (remote, d) = with_remote();
        git(d.path(), &["checkout", "-q", "-b", "feature"]);
        local_commit(&d, "f.txt");
        assert!(!repo_info(d.path()).unwrap().unwrap().has_upstream);
        let msg = push(d.path()).unwrap();
        assert!(msg.contains("tracking"), "{msg}");
        let i = repo_info(d.path()).unwrap().unwrap();
        assert!(i.has_upstream && (i.ahead, i.behind) == (0, 0));
        let o = Command::new("git")
            .args(["branch", "--list", "feature"])
            .current_dir(remote.path())
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&o.stdout).contains("feature"));
    }

    #[test]
    fn plain_push_sends_new_commits() {
        let (remote, d) = with_remote();
        local_commit(&d, "n.txt");
        assert_eq!(repo_info(d.path()).unwrap().unwrap().ahead, 1);
        assert_eq!(push(d.path()).unwrap(), "Pushed.");
        assert_eq!(repo_info(d.path()).unwrap().unwrap().ahead, 0);
        assert!(teammate(&remote).path().join("n.txt").exists());
    }

    #[test]
    fn fetch_then_pull_brings_a_teammates_commit() {
        let (remote, d) = with_remote();
        let t = teammate(&remote);
        teammate_commit(&t, "t.txt");
        fetch(d.path()).unwrap();
        assert_eq!(repo_info(d.path()).unwrap().unwrap().behind, 1);
        assert!(!d.path().join("t.txt").exists(), "fetch must not touch the working tree");
        assert!(pull(d.path()).unwrap().contains("Pulled"));
        assert!(d.path().join("t.txt").exists());
        assert_eq!(repo_info(d.path()).unwrap().unwrap().behind, 0);
        assert_eq!(pull(d.path()).unwrap(), "Already up to date.");
    }

    #[test]
    fn pull_never_merges_when_branches_diverged_and_changes_nothing() {
        let (remote, d) = with_remote();
        let t = teammate(&remote);
        teammate_commit(&t, "theirs.txt");
        local_commit(&d, "mine.txt");
        let tip = |d: &TempDir| text(&run(d.path(), &["rev-parse", "HEAD"], None, TIMEOUT).unwrap());
        let before = tip(&d);
        let e = pull(d.path()).unwrap_err();
        assert!(e.to_lowercase().contains("fast-forward") && e.contains("Console"), "{e}");
        assert_eq!(tip(&d), before, "the local branch must not move");
        assert!(!log(d.path(), 10).unwrap().iter().any(|c| c.parents.len() > 1), "no merge commit");
        assert!(!d.path().join("theirs.txt").exists());
    }

    #[test]
    fn push_is_rejected_when_behind_with_a_helpful_message_and_never_forces() {
        let (remote, d) = with_remote();
        let t = teammate(&remote);
        teammate_commit(&t, "theirs.txt");
        local_commit(&d, "mine.txt");
        let e = push(d.path()).unwrap_err();
        assert!(e.contains("Pull first"), "{e}");
        let t2 = teammate(&remote);
        assert!(t2.path().join("theirs.txt").exists() && !t2.path().join("mine.txt").exists());
    }

    #[test]
    fn sync_stops_at_the_pull_when_diverged() {
        let (remote, d) = with_remote();
        let t = teammate(&remote);
        teammate_commit(&t, "theirs.txt");
        local_commit(&d, "mine.txt");
        let e = sync(d.path()).unwrap_err();
        assert!(e.contains("while pulling"), "{e}");
    }

    #[test]
    fn sync_pulls_then_pushes() {
        let (remote, d) = with_remote();
        let t = teammate(&remote);
        teammate_commit(&t, "x.txt");
        assert_eq!(sync(d.path()).unwrap(), "Synced: pulled and pushed.");
        assert!(d.path().join("x.txt").exists());
    }

    #[test]
    fn sync_on_a_branch_without_upstream_just_pushes_it() {
        let (_remote, d) = with_remote();
        git(d.path(), &["checkout", "-q", "-b", "solo"]);
        local_commit(&d, "s.txt");
        assert_eq!(sync(d.path()).unwrap(), "Synced: pushed.");
        assert!(repo_info(d.path()).unwrap().unwrap().has_upstream);
    }

    #[test]
    fn network_operations_explain_missing_remote_upstream_and_branch() {
        let d = repo();
        assert!(push(d.path()).unwrap_err().contains("no remote"));
        assert!(fetch(d.path()).unwrap_err().contains("no remote"));
        assert!(pull(d.path()).unwrap_err().contains("no upstream"));
        git(d.path(), &["checkout", "-q", "--detach"]);
        assert!(push(d.path()).unwrap_err().contains("not on a branch"));
        assert!(pull(d.path()).unwrap_err().contains("not on a branch"));
        let plain = tempdir().unwrap();
        assert!(push(plain.path()).unwrap_err().contains("not a git repository"));
    }

    #[test]
    fn push_prefers_origin_when_there_are_several_remotes() {
        let (_r, d) = with_remote();
        let other = tempdir().unwrap();
        git(other.path(), &["init", "-q", "--bare", "-b", "main"]);
        git(d.path(), &["remote", "add", "aaa", &other.path().display().to_string()]);
        assert_eq!(remote_name(d.path()).unwrap().as_deref(), Some("origin"));
    }

    #[test]
    fn authentication_failures_point_to_the_console() {
        let o = Output {
            ok: false,
            stdout: vec![],
            stderr: "fatal: could not read Username for 'https://x': terminal prompts disabled".into(),
        };
        assert!(net_error(&o).contains("Console tab"));
        let o = Output { ok: false, stdout: vec![], stderr: "fatal: something else".into() };
        assert!(!net_error(&o).contains("Console tab"));
    }

    #[test]
    fn parse_status_handles_headers_and_conflicts() {
        let raw = b"# branch.oid abcdef1234567\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -3\0u UU N... 100644 100644 100644 100644 h1 h2 h3 conflicted.txt\0";
        let p = parse_status(raw);
        assert_eq!((p.info.ahead, p.info.behind), (2, 3));
        assert_eq!(p.info.head.as_deref(), Some("abcdef1"));
        assert!(p.changes[0].conflict && p.changes[0].status == "U");
    }
}
