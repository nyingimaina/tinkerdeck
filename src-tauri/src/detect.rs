//! Project detection so a novice never has to type a command: looks at a
//! folder and suggests terminals (npm scripts, dotnet, docker compose, ...).

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub name: String,
    /// Folder relative to the scanned root ("." for the root itself).
    pub cwd: String,
    pub command: String,
    pub stop_command: Option<String>,
    pub kind: String,
    /// The single best suggestion for its folder (used by whole-project detection).
    pub primary: bool,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "bin", "obj", "target", "dist", "build", ".venv", "venv", "__pycache__", ".idea", ".vs",
    ".next", ".nuxt", "out", "coverage", "packages",
];
const MAX_DEPTH: usize = 3;
const MAX_DIRS: usize = 300;
const MAX_SUGGESTIONS: usize = 40;

fn skip(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name.to_ascii_lowercase().as_str())
}

fn folder_label(dir: &Path) -> String {
    dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "app".into())
}

fn exists(dir: &Path, f: &str) -> bool {
    dir.join(f).is_file()
}

fn first_with_ext(dir: &Path, ext: &str) -> Option<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().map(|x| x.eq_ignore_ascii_case(ext)).unwrap_or(false))
        .collect();
    found.sort();
    found.into_iter().next()
}

/// "npm", "yarn", "pnpm" or "bun" from lock files.
pub fn package_manager(dir: &Path) -> &'static str {
    if exists(dir, "pnpm-lock.yaml") {
        "pnpm"
    } else if exists(dir, "yarn.lock") {
        "yarn"
    } else if exists(dir, "bun.lockb") || exists(dir, "bun.lock") {
        "bun"
    } else {
        "npm"
    }
}

fn script_command(pm: &str, script: &str) -> String {
    match (pm, script) {
        ("npm", "start") => "npm start".into(),
        ("npm", s) => format!("npm run {s}"),
        (pm, s) => format!("{pm} {s}"),
    }
}

const SCRIPT_PRIORITY: &[&str] = &["dev", "start", "serve", "watch", "preview", "storybook"];

/// All suggestions for one folder (primary first).
pub fn folder_suggestions(dir: &Path, rel: &str) -> Vec<Suggestion> {
    let name = folder_label(dir);
    let mut out: Vec<Suggestion> = Vec::new();
    let mk = |name: &str, command: String, stop: Option<String>, kind: &str| Suggestion {
        name: name.to_string(),
        cwd: rel.to_string(),
        command,
        stop_command: stop,
        kind: kind.to_string(),
        primary: false,
    };

    // Node: package.json scripts
    if let Ok(text) = std::fs::read_to_string(dir.join("package.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(scripts) = v.get("scripts").and_then(|s| s.as_object()) {
                let pm = package_manager(dir);
                let mut names: Vec<&String> = scripts.keys().collect();
                names.sort_by_key(|k| {
                    SCRIPT_PRIORITY.iter().position(|p| p == &k.as_str()).unwrap_or(SCRIPT_PRIORITY.len())
                });
                for s in names {
                    let label = if SCRIPT_PRIORITY.contains(&s.as_str()) { name.clone() } else { format!("{name}-{s}") };
                    out.push(mk(&label, script_command(pm, s), None, "node"));
                }
            }
        }
    }

    // .NET
    if let Some(proj) = first_with_ext(dir, "csproj") {
        let text = std::fs::read_to_string(&proj).unwrap_or_default();
        if text.contains("Microsoft.NET.Sdk.Web") {
            out.push(mk(&name, "dotnet watch run".into(), None, "dotnet"));
            out.push(mk(&format!("{name}-run"), "dotnet run".into(), None, "dotnet"));
        } else if text.contains("<OutputType>Exe</OutputType>") || text.contains("<OutputType>WinExe</OutputType>") {
            out.push(mk(&name, "dotnet run".into(), None, "dotnet"));
        }
    }

    // Docker Compose
    if ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].iter().any(|f| exists(dir, f)) {
        out.push(mk(
            &format!("{name}-compose"),
            "docker compose up".into(),
            Some("docker compose down".into()),
            "docker",
        ));
    }

    // Rust / Go / Python
    if exists(dir, "Cargo.toml") {
        out.push(mk(&name, "cargo run".into(), None, "rust"));
    }
    if exists(dir, "go.mod") {
        out.push(mk(&name, "go run .".into(), None, "go"));
    }
    if exists(dir, "manage.py") {
        out.push(mk(&name, "python manage.py runserver".into(), None, "python"));
    } else if exists(dir, "main.py") {
        out.push(mk(&name, "python main.py".into(), None, "python"));
    } else if exists(dir, "app.py") {
        out.push(mk(&name, "python app.py".into(), None, "python"));
    }

    if let Some(first) = out.first_mut() {
        first.primary = true;
    }
    out
}

/// Scan a project root (a few levels deep) and return the best suggestion per folder.
pub fn detect_project(root: &Path) -> Vec<Suggestion> {
    let mut out = Vec::new();
    let mut visited = 0usize;
    let mut stack: Vec<(PathBuf, String, usize)> = vec![(root.to_path_buf(), ".".to_string(), 0)];
    while let Some((dir, rel, depth)) = stack.pop() {
        visited += 1;
        if visited > MAX_DIRS || out.len() >= MAX_SUGGESTIONS {
            break;
        }
        // for the root itself use the root folder's name; for children the folder name
        let mut sugg = folder_suggestions(&dir, &rel);
        if let Some(p) = sugg.iter().position(|s| s.primary) {
            out.push(sugg.swap_remove(p));
        }
        if depth < MAX_DEPTH {
            if let Ok(rd) = std::fs::read_dir(&dir) {
                let mut kids: Vec<_> = rd
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().is_dir())
                    .filter(|e| !skip(&e.file_name().to_string_lossy()))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect();
                kids.sort_by(|a, b| b.cmp(a)); // reversed: the stack pops in alphabetical order
                for k in kids {
                    let child_rel = if rel == "." { k.clone() } else { format!("{rel}\\{k}") };
                    stack.push((dir.join(&k), child_rel, depth + 1));
                }
            }
        }
    }
    out.sort_by(|a, b| a.cwd.cmp(&b.cwd));
    out
}

/// Sub-folders of the root (relative, backslash separated), a couple of levels deep.
pub fn list_subfolders(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack: Vec<(PathBuf, String, usize)> = vec![(root.to_path_buf(), String::new(), 0)];
    while let Some((dir, rel, depth)) = stack.pop() {
        if out.len() >= 200 {
            break;
        }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        let mut kids: Vec<String> = rd
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| !skip(n))
            .collect();
        kids.sort_by(|a, b| b.cmp(a));
        for k in kids {
            let r = if rel.is_empty() { k.clone() } else { format!("{rel}\\{k}") };
            out.push(r.clone());
            if depth + 1 < 3 {
                stack.push((dir.join(&k), r, depth + 1));
            }
        }
    }
    out.sort();
    out
}

/// Names of Docker containers (empty when Docker is missing or not running).
pub fn docker_containers() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let Ok(mut child) = Command::new("docker")
        .args(["ps", "-a", "--format", "{{.Names}}"])
        .creation_flags(0x0800_0000)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return vec![];
    };
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > Duration::from_secs(3) => {
                let _ = child.kill();
                return vec![];
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(30)),
            Err(_) => return vec![],
        }
    }
    let mut text = String::new();
    if let Some(mut o) = child.stdout.take() {
        use std::io::Read;
        let _ = o.read_to_string(&mut text);
    }
    let mut names: Vec<String> = text.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
    names.sort();
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write(dir: &Path, rel: &str, text: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn node_scripts_dev_first_and_package_manager_from_lock_file() {
        let d = tempdir().unwrap();
        write(d.path(), "package.json", r#"{"scripts":{"build":"x","dev":"vite","test":"y"}}"#);
        let s = folder_suggestions(d.path(), ".");
        assert_eq!(s[0].command, "npm run dev");
        assert!(s[0].primary && !s[1].primary);
        assert!(s.iter().any(|x| x.command == "npm run build"));
        write(d.path(), "pnpm-lock.yaml", "");
        assert_eq!(folder_suggestions(d.path(), ".")[0].command, "pnpm dev");
        assert_eq!(package_manager(d.path()), "pnpm");
    }

    #[test]
    fn npm_start_has_no_run() {
        let d = tempdir().unwrap();
        write(d.path(), "package.json", r#"{"scripts":{"start":"node ."}}"#);
        assert_eq!(folder_suggestions(d.path(), ".")[0].command, "npm start");
    }

    #[test]
    fn dotnet_web_project_suggests_watch_run() {
        let d = tempdir().unwrap();
        write(d.path(), "Api.csproj", r#"<Project Sdk="Microsoft.NET.Sdk.Web"></Project>"#);
        let s = folder_suggestions(d.path(), "backend\\Api");
        assert_eq!(s[0].command, "dotnet watch run");
        assert_eq!(s[0].cwd, "backend\\Api");
        assert_eq!(s[0].kind, "dotnet");
    }

    #[test]
    fn dotnet_library_is_not_suggested() {
        let d = tempdir().unwrap();
        write(d.path(), "Lib.csproj", r#"<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup/></Project>"#);
        assert!(folder_suggestions(d.path(), ".").is_empty());
    }

    #[test]
    fn docker_compose_gets_a_stop_command() {
        let d = tempdir().unwrap();
        write(d.path(), "docker-compose.yml", "services: {}");
        let s = folder_suggestions(d.path(), ".");
        assert_eq!(s[0].command, "docker compose up");
        assert_eq!(s[0].stop_command.as_deref(), Some("docker compose down"));
    }

    #[test]
    fn rust_go_python_are_recognised() {
        let d = tempdir().unwrap();
        write(d.path(), "Cargo.toml", "");
        write(d.path(), "go.mod", "");
        write(d.path(), "manage.py", "");
        let cmds: Vec<String> = folder_suggestions(d.path(), ".").into_iter().map(|s| s.command).collect();
        assert!(cmds.contains(&"cargo run".to_string()));
        assert!(cmds.contains(&"go run .".to_string()));
        assert!(cmds.contains(&"python manage.py runserver".to_string()));
    }

    #[test]
    fn broken_package_json_is_ignored_not_fatal() {
        let d = tempdir().unwrap();
        write(d.path(), "package.json", "{ not json");
        assert!(folder_suggestions(d.path(), ".").is_empty());
    }

    #[test]
    fn detect_project_finds_the_qonsol_layout_and_skips_noise() {
        let d = tempdir().unwrap();
        write(d.path(), "docker-compose.yml", "services: {}");
        write(d.path(), "backend/Qonsol.Api/Qonsol.Api.csproj", r#"<Project Sdk="Microsoft.NET.Sdk.Web"/>"#);
        write(d.path(), "frontend/package.json", r#"{"scripts":{"dev":"vite"}}"#);
        write(d.path(), "frontend/node_modules/leftpad/package.json", r#"{"scripts":{"start":"x"}}"#);
        write(d.path(), ".git/config", "");
        let s = detect_project(d.path());
        let by_cwd: Vec<(&str, &str)> = s.iter().map(|x| (x.cwd.as_str(), x.command.as_str())).collect();
        assert!(by_cwd.contains(&(".", "docker compose up")), "{by_cwd:?}");
        assert!(by_cwd.contains(&("backend\\Qonsol.Api", "dotnet watch run")), "{by_cwd:?}");
        assert!(by_cwd.contains(&("frontend", "npm run dev")), "{by_cwd:?}");
        assert_eq!(s.len(), 3, "node_modules must be skipped: {by_cwd:?}");
        assert!(s.iter().all(|x| x.primary));
    }

    #[test]
    fn detect_respects_depth_limit() {
        let d = tempdir().unwrap();
        write(d.path(), "a/b/c/d/e/package.json", r#"{"scripts":{"dev":"x"}}"#);
        assert!(detect_project(d.path()).is_empty());
    }

    #[test]
    fn subfolders_are_relative_sorted_and_skip_noise() {
        let d = tempdir().unwrap();
        write(d.path(), "frontend/src/x.txt", "");
        write(d.path(), "backend/Api/x.txt", "");
        write(d.path(), "node_modules/x/y.txt", "");
        write(d.path(), ".git/z", "");
        let s = list_subfolders(d.path());
        assert_eq!(s, vec!["backend", "backend\\Api", "frontend", "frontend\\src"]);
    }

    #[test]
    fn missing_root_gives_empty_results() {
        let p = Path::new("Z:\\definitely\\not\\here");
        assert!(detect_project(p).is_empty());
        assert!(list_subfolders(p).is_empty());
    }
}
