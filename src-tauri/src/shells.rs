//! Which shells exist and how to start each one (BRS 7.11). Pure launch rules live in `spec`
//! so they can be tested without spawning anything.

use serde::Serialize;
use std::path::{Path, PathBuf};

pub const POWERSHELL: &str = "powershell.exe";
pub const PWSH: &str = "pwsh.exe";
pub const CMD: &str = "cmd.exe";
pub const GITBASH: &str = "gitbash";
pub const WSL: &str = "wsl.exe";

const ALL: &[(&str, &str)] = &[
    (POWERSHELL, "Windows PowerShell"),
    (PWSH, "PowerShell 7"),
    (CMD, "Command Prompt"),
    (GITBASH, "Git Bash"),
    (WSL, "WSL"),
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    pub id: String,
    pub name: String,
    pub path: String,
}

/// `Some(id)` for a known shell id, `None` otherwise.
pub fn known(id: &str) -> Option<&'static str> {
    ALL.iter().find(|(i, _)| *i == id).map(|(i, _)| *i)
}

pub fn display_name(id: &str) -> &'static str {
    ALL.iter().find(|(i, _)| *i == id).map(|(_, n)| *n).unwrap_or("Shell")
}

/// How to start a shell: program, arguments, extra environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spec {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// Build the launch rules. An empty `command` means an interactive shell.
/// The command text is passed whole, never split or re-quoted by us.
pub fn spec(id: &str, program: &str, command: &str, cwd: &Path) -> Spec {
    let has_cmd = !command.trim().is_empty();
    let mut args: Vec<String> = Vec::new();
    let mut env: Vec<(String, String)> = Vec::new();
    match id {
        GITBASH => {
            args.push("--login".into());
            if has_cmd {
                args.push("-c".into());
                args.push(command.to_string());
            } else {
                args.push("-i".into());
            }
            // without this a login bash changes to the home folder
            env.push(("CHERE_INVOKING".into(), "1".into()));
        }
        WSL => {
            args.push("--cd".into());
            args.push(cwd.display().to_string());
            if has_cmd {
                args.extend(["-e", "bash", "-lc"].map(String::from));
                args.push(command.to_string());
            }
        }
        CMD => {
            args.push("/D".into());
            if has_cmd {
                args.push("/C".into());
                args.push(command.to_string());
            }
        }
        // PowerShell and pwsh (and anything unknown falls back to PowerShell rules)
        _ => {
            args.push("-NoLogo".into());
            if has_cmd {
                args.push("-Command".into());
                args.push(crate::runtime::wrap_command(command));
            }
        }
    }
    Spec { program: program.to_string(), args, env }
}

fn env_dir(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from).filter(|p| !p.as_os_str().is_empty())
}

fn system32(file: &str) -> Option<PathBuf> {
    let p = env_dir("SystemRoot")?.join("System32").join(file);
    p.is_file().then_some(p)
}

/// First `name` found on PATH.
fn on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(name)).find(|p| p.is_file())
}

fn gitbash_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Some(d) = env_dir(var) {
            candidates.push(d.join("Git").join("bin").join("bash.exe"));
        }
    }
    if let Some(d) = env_dir("LOCALAPPDATA") {
        candidates.push(d.join("Programs").join("Git").join("bin").join("bash.exe"));
    }
    // next to whichever git.exe is on PATH (…\Git\cmd\git.exe or …\Git\mingw64\bin\git.exe)
    if let Some(git) = on_path("git.exe") {
        for anc in git.ancestors().skip(1).take(3) {
            candidates.push(anc.join("bin").join("bash.exe"));
        }
    }
    // never the WSL launcher in System32
    candidates.into_iter().find(|p| p.is_file() && !p.to_string_lossy().to_lowercase().contains("\\windows\\system32"))
}

/// Full path of an installed shell, or `None` when it is not available.
pub fn resolve(id: &str) -> Option<String> {
    let p: Option<PathBuf> = match id {
        POWERSHELL => system32("WindowsPowerShell\\v1.0\\powershell.exe").or_else(|| on_path("powershell.exe")),
        PWSH => ["ProgramFiles", "ProgramW6432"]
            .iter()
            .filter_map(|v| env_dir(v))
            .map(|d| d.join("PowerShell").join("7").join("pwsh.exe"))
            .find(|p| p.is_file())
            .or_else(|| on_path("pwsh.exe")),
        CMD => system32("cmd.exe").or_else(|| on_path("cmd.exe")),
        GITBASH => gitbash_path(),
        WSL => system32("wsl.exe"),
        _ => None,
    };
    p.map(|p| p.display().to_string())
}

/// Every known shell that is installed here, in menu order.
pub fn detect() -> Vec<ShellInfo> {
    ALL.iter()
        .filter_map(|(id, name)| {
            resolve(id).map(|path| ShellInfo { id: id.to_string(), name: name.to_string(), path })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cwd() -> PathBuf {
        PathBuf::from("E:\\code\\Qonsol\\frontend")
    }

    #[test]
    fn known_ids_are_exactly_the_supported_shells() {
        for id in [POWERSHELL, PWSH, CMD, GITBASH, WSL] {
            assert_eq!(known(id), Some(id));
        }
        assert_eq!(known("fish.exe"), None);
        assert_eq!(known(""), None);
        assert_eq!(display_name(GITBASH), "Git Bash");
    }

    #[test]
    fn powershell_runs_the_command_whole_with_the_exit_code_wrapper() {
        let s = spec(POWERSHELL, "P", "echo \"hello world\"; npm run dev", &cwd());
        assert_eq!(s.program, "P");
        assert_eq!(&s.args[..2], ["-NoLogo", "-Command"]);
        assert!(s.args[2].starts_with("echo \"hello world\"; npm run dev\n"));
        assert!(s.args[2].contains("exit $LASTEXITCODE"));
        assert_eq!(s.args.len(), 3);
        assert!(s.env.is_empty());
        assert_eq!(spec(PWSH, "P", "x", &cwd()).args[0], "-NoLogo");
    }

    #[test]
    fn an_empty_command_is_an_interactive_shell_for_every_shell() {
        assert_eq!(spec(POWERSHELL, "P", "  ", &cwd()).args, ["-NoLogo"]);
        assert_eq!(spec(CMD, "C", "", &cwd()).args, ["/D"]);
        assert_eq!(spec(GITBASH, "B", "", &cwd()).args, ["--login", "-i"]);
        assert_eq!(spec(WSL, "W", "", &cwd()).args, ["--cd", "E:\\code\\Qonsol\\frontend"]);
    }

    #[test]
    fn cmd_passes_the_command_after_slash_c() {
        assert_eq!(spec(CMD, "C", "dir /b & echo done", &cwd()).args, ["/D", "/C", "dir /b & echo done"]);
    }

    #[test]
    fn git_bash_uses_a_login_shell_and_stays_in_the_project_folder() {
        let s = spec(GITBASH, "B", "npm test && echo ok", &cwd());
        assert_eq!(s.args, ["--login", "-c", "npm test && echo ok"]);
        assert!(s.env.contains(&("CHERE_INVOKING".to_string(), "1".to_string())));
    }

    #[test]
    fn wsl_changes_directory_with_the_windows_path_and_runs_through_bash() {
        let s = spec(WSL, "W", "ls -la | head", &cwd());
        assert_eq!(s.args, ["--cd", "E:\\code\\Qonsol\\frontend", "-e", "bash", "-lc", "ls -la | head"]);
    }

    #[test]
    fn unknown_ids_fall_back_to_powershell_rules() {
        assert_eq!(spec("whatever", "P", "", &cwd()).args, ["-NoLogo"]);
    }

    #[test]
    fn resolve_rejects_unknown_ids() {
        assert_eq!(resolve("fish.exe"), None);
        assert_eq!(resolve(""), None);
    }

    #[test]
    fn this_machine_has_powershell_and_cmd_and_they_are_real_files() {
        let found = detect();
        for id in [POWERSHELL, CMD] {
            let s = found.iter().find(|s| s.id == id).unwrap_or_else(|| panic!("{id} missing: {found:?}"));
            assert!(Path::new(&s.path).is_file(), "{}", s.path);
        }
        // detection order follows the menu order
        let ids: Vec<&str> = found.iter().map(|s| s.id.as_str()).collect();
        let mut sorted = ids.clone();
        sorted.sort_by_key(|i| ALL.iter().position(|(a, _)| a == i));
        assert_eq!(ids, sorted);
    }

    #[test]
    fn git_bash_is_never_the_wsl_launcher() {
        if let Some(p) = resolve(GITBASH) {
            assert!(!p.to_lowercase().contains("\\windows\\system32"), "{p}");
            assert!(p.to_lowercase().ends_with("bash.exe"), "{p}");
        }
    }
}
