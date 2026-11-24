//! Saved data: apps, terminals and the config file shape (BRS 5.1, 5.2).

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

pub const CONFIG_VERSION: u32 = 1;
pub const MAX_NAME: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDef {
    pub id: String,
    pub name: String,
    #[serde(default = "dot")]
    pub cwd: String,
    #[serde(default)]
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_command: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Shell id for this terminal only (see `shells`); `None` uses the global default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    /// Ready when the output contains this text (case-insensitive), used by `up` with `wait`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ready_pattern: Option<String>,
    /// Ready when this local (loopback) URL answers with anything below 500.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ready_url: Option<String>,
}

fn dot() -> String {
    ".".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub root: String,
    #[serde(default)]
    pub terminals: Vec<TerminalDef>,
    /// Shown as a card on the Home screen (order = order in the file).
    #[serde(default)]
    pub favourite: bool,
    /// Unix seconds of the last time the app was opened or started.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened: Option<i64>,
}

/// Update preferences (BRS 7.13). Additive fields: the config version stays 1.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettings {
    /// Look for a new version now and then (once an hour at most).
    #[serde(default = "yes")]
    pub auto_check: bool,
    /// A version the user chose to ignore.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped_version: Option<String>,
    /// Unix seconds of the last check.
    #[serde(default)]
    pub last_checked: i64,
}

fn yes() -> bool {
    true
}

impl Default for UpdateSettings {
    fn default() -> Self {
        UpdateSettings { auto_check: true, skipped_version: None, last_checked: 0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub version: u32,
    #[serde(default = "dark")]
    pub theme: String,
    #[serde(default = "default_shell")]
    pub shell: String,
    #[serde(default)]
    pub last_running: Vec<String>,
    #[serde(default)]
    pub apps: Vec<AppDef>,
    #[serde(default)]
    pub update: UpdateSettings,
}

fn dark() -> String {
    "dark".to_string()
}
fn default_shell() -> String {
    "powershell.exe".to_string()
}

impl Default for Config {
    fn default() -> Self {
        Config {
            version: CONFIG_VERSION,
            theme: dark(),
            shell: default_shell(),
            last_running: vec![],
            apps: vec![],
            update: UpdateSettings::default(),
        }
    }
}

impl Config {
    /// Replace unknown theme/shell values by the defaults and drop stale ids (BRS 5.2).
    pub fn normalize(&mut self) {
        if self.theme != "light" && self.theme != "dark" {
            self.theme = dark();
        }
        if crate::shells::known(&self.shell).is_none() {
            self.shell = default_shell();
        }
        // an unknown per-terminal shell means "use the default"
        for t in self.apps.iter_mut().flat_map(|a| a.terminals.iter_mut()) {
            if t.shell.as_deref().map(|s| crate::shells::known(s).is_none()).unwrap_or(false) {
                t.shell = None;
            }
        }
        let ids: HashSet<&str> = self.apps.iter().map(|a| a.id.as_str()).collect();
        let keep: Vec<String> = self
            .last_running
            .iter()
            .filter(|i| ids.contains(i.as_str()))
            .cloned()
            .collect();
        self.last_running = keep;
    }
}

/// Validate apps before saving: names 1..=40 chars after trimming, ids unique.
pub fn validate_apps(apps: &[AppDef]) -> Result<(), String> {
    let mut seen: HashSet<&str> = HashSet::new();
    for app in apps {
        check_name(&app.name, "App")?;
        if app.id.trim().is_empty() || !seen.insert(app.id.as_str()) {
            return Err("Every app needs a unique id.".into());
        }
        for t in &app.terminals {
            check_name(&t.name, "Terminal")?;
            if t.id.trim().is_empty() || !seen.insert(t.id.as_str()) {
                return Err("Every terminal needs a unique id.".into());
            }
            for k in t.env.keys() {
                if k.trim().is_empty() || k.contains('=') {
                    return Err(format!("Invalid environment variable name \"{k}\"."));
                }
            }
        }
    }
    Ok(())
}

/// Title bar text, always carrying the running version.
pub fn window_title(version: &str) -> String {
    format!("Lite Commander {version}")
}

// ---- the built-in Console tab: unsaved interactive shells per app (BRS 7.8, 7.10, 7.11)
//
// Ids: `console-<appId>` is the Console tab group (never started itself);
// instances are `console-<appId>:<n>` or `console-<appId>:<n>:<shellId>`.

const CONSOLE_PREFIX: &str = "console-";

pub fn console_id(app_id: &str) -> String {
    format!("{CONSOLE_PREFIX}{app_id}")
}

/// The app id a console terminal id belongs to, or `None` for an ordinary terminal id.
pub fn console_app_id(terminal_id: &str) -> Option<&str> {
    terminal_id
        .strip_prefix(CONSOLE_PREFIX)
        .and_then(|rest| rest.split(':').next())
        .filter(|a| !a.is_empty())
}

fn console_parts(terminal_id: &str) -> (Option<u32>, Option<&str>) {
    let mut it = terminal_id.strip_prefix(CONSOLE_PREFIX).unwrap_or("").split(':');
    let _app = it.next();
    let n = it.next().and_then(|n| n.parse().ok());
    let shell = it.next().filter(|s| !s.is_empty());
    (n, shell)
}

/// A console instance as a terminal: an empty command opens a plain interactive shell in the
/// app's root folder, in the shell encoded in its id (if any).
pub fn console_def_with_id(terminal_id: &str) -> TerminalDef {
    let (n, shell) = console_parts(terminal_id);
    TerminalDef {
        id: terminal_id.to_string(),
        name: format!("Console {}", n.unwrap_or(1)),
        cwd: ".".to_string(),
        command: String::new(),
        stop_command: None,
        env: BTreeMap::new(),
        shell: shell.filter(|s| crate::shells::known(s).is_some()).map(String::from),
        ready_pattern: None,
        ready_url: None,
    }
}

fn check_name(name: &str, what: &str) -> Result<(), String> {
    let n = name.trim().chars().count();
    if n == 0 {
        return Err(format!("{what} name is required."));
    }
    if n > MAX_NAME {
        return Err(format!("{what} name must be at most {MAX_NAME} characters."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(id: &str, name: &str, terms: Vec<TerminalDef>) -> AppDef {
        AppDef { id: id.into(), name: name.into(), root: "C:\\".into(), terminals: terms, ..Default::default() }
    }
    fn term(id: &str, name: &str) -> TerminalDef {
        TerminalDef { id: id.into(), name: name.into(), cwd: ".".into(), ..Default::default() }
    }

    #[test]
    fn default_config_is_dark_powershell_empty() {
        let c = Config::default();
        assert_eq!((c.version, c.theme.as_str(), c.shell.as_str()), (1, "dark", "powershell.exe"));
        assert!(c.apps.is_empty());
    }

    #[test]
    fn missing_fields_get_defaults() {
        let c: Config = serde_json::from_str(
            r#"{"version":1,"apps":[{"id":"a","name":"A","terminals":[{"id":"t","name":"x"}]}]}"#,
        )
        .unwrap();
        assert_eq!(c.theme, "dark");
        assert_eq!(c.apps[0].terminals[0].cwd, ".");
        assert_eq!(c.apps[0].terminals[0].command, "");
    }

    #[test]
    fn normalize_fixes_unknown_theme_shell_and_stale_last_running() {
        let mut c = Config {
            theme: "blue".into(),
            shell: "fish.exe".into(),
            last_running: vec!["a".into(), "gone".into()],
            apps: vec![app("a", "A", vec![])],
            ..Default::default()
        };
        c.normalize();
        assert_eq!(c.theme, "dark");
        assert_eq!(c.shell, "powershell.exe");
        assert_eq!(c.last_running, vec!["a".to_string()]);
    }

    #[test]
    fn update_settings_default_to_checking_and_are_additive() {
        let c: Config = serde_json::from_str(r#"{"version":1,"apps":[]}"#).unwrap();
        assert_eq!(c.update, UpdateSettings { auto_check: true, skipped_version: None, last_checked: 0 });
        let c: Config = serde_json::from_str(r#"{"version":1,"update":{"autoCheck":false,"skippedVersion":"1.3.0","lastChecked":55}}"#).unwrap();
        assert_eq!((c.update.auto_check, c.update.skipped_version.as_deref(), c.update.last_checked), (false, Some("1.3.0"), 55));
        let none = serde_json::to_string(&UpdateSettings::default()).unwrap();
        assert!(!none.contains("skippedVersion"));
    }

    #[test]
    fn favourite_and_last_opened_are_optional_additive_fields() {
        let c: Config = serde_json::from_str(r#"{"version":1,"apps":[{"id":"a","name":"A"}]}"#).unwrap();
        assert!(!c.apps[0].favourite);
        assert_eq!(c.apps[0].last_opened, None);
        let a = AppDef { id: "a".into(), name: "A".into(), favourite: true, last_opened: Some(1_700_000_000), ..Default::default() };
        let text = serde_json::to_string(&a).unwrap();
        assert!(text.contains("\"favourite\":true") && text.contains("\"lastOpened\":1700000000"));
        let none = serde_json::to_string(&AppDef { id: "b".into(), name: "B".into(), ..Default::default() }).unwrap();
        assert!(!none.contains("lastOpened"));
    }

    #[test]
    fn window_title_carries_the_version_and_the_build_version_is_semver() {
        assert_eq!(window_title("1.1.0"), "Lite Commander 1.1.0");
        let v = env!("CARGO_PKG_VERSION");
        assert_eq!(v.split('.').count(), 3, "{v}");
        assert!(v.split('.').all(|p| p.parse::<u32>().is_ok()), "{v}");
        assert_eq!(window_title(v), format!("Lite Commander {v}"));
    }

    #[test]
    fn console_ids_round_trip_and_never_collide_with_uuid_terminal_ids() {
        let app = "7b1f0c0e-4c0a-4c53-a2b5-0d3f2d6c9a11";
        assert_eq!(console_app_id(&console_id(app)), Some(app));
        assert_eq!(console_app_id(&format!("console-{app}:2:gitbash")), Some(app));
        assert_eq!(console_app_id(&format!("console-{app}:1")), Some(app));
        assert_eq!(console_app_id("2a8e1f4c-0b57-4d0e-9c1d-3e5f7a9b0c11"), None);
        assert_eq!(console_app_id("console-"), None);
        assert_eq!(console_app_id("console-:1"), None);
        assert_eq!(console_app_id(""), None);
    }

    #[test]
    fn console_defs_carry_their_number_and_shell() {
        let d = console_def_with_id("console-a1:3:gitbash");
        assert_eq!((d.id.as_str(), d.name.as_str(), d.command.as_str(), d.cwd.as_str()), ("console-a1:3:gitbash", "Console 3", "", "."));
        assert_eq!(d.shell.as_deref(), Some("gitbash"));
        assert!(d.stop_command.is_none());
        assert_eq!(console_def_with_id("console-a1:2").shell, None);
        assert_eq!(console_def_with_id("console-a1").name, "Console 1");
        assert_eq!(console_def_with_id("console-a1:2:fish.exe").shell, None, "unknown shells are ignored");
    }

    #[test]
    fn unknown_terminal_shells_fall_back_to_the_default_and_known_ones_stay() {
        let mut c = Config {
            shell: "gitbash".into(),
            apps: vec![AppDef {
                id: "a".into(),
                name: "A".into(),
                terminals: vec![
                    TerminalDef { id: "1".into(), name: "x".into(), shell: Some("wsl.exe".into()), ..Default::default() },
                    TerminalDef { id: "2".into(), name: "y".into(), shell: Some("fish".into()), ..Default::default() },
                ],
                ..Default::default()
            }],
            ..Default::default()
        };
        c.normalize();
        assert_eq!(c.shell, "gitbash");
        assert_eq!(c.apps[0].terminals[0].shell.as_deref(), Some("wsl.exe"));
        assert_eq!(c.apps[0].terminals[1].shell, None);
    }

    #[test]
    fn validate_accepts_good_apps() {
        assert!(validate_apps(&[app("a", "Qonsol", vec![term("t", "db")])]).is_ok());
    }

    #[test]
    fn validate_rejects_empty_and_long_names() {
        assert!(validate_apps(&[app("a", "   ", vec![])]).is_err());
        assert!(validate_apps(&[app("a", &"x".repeat(41), vec![])]).is_err());
        assert!(validate_apps(&[app("a", "A", vec![term("t", "")])]).is_err());
        assert!(validate_apps(&[app("a", &"x".repeat(40), vec![])]).is_ok());
    }

    #[test]
    fn validate_rejects_duplicate_ids_but_allows_duplicate_names() {
        assert!(validate_apps(&[app("a", "A", vec![]), app("a", "B", vec![])]).is_err());
        assert!(validate_apps(&[app("a", "A", vec![term("t", "x"), term("t", "y")])]).is_err());
        assert!(validate_apps(&[app("a", "A", vec![term("t1", "x"), term("t2", "x")])]).is_ok());
    }

    #[test]
    fn validate_rejects_bad_env_names() {
        let mut t = term("t", "x");
        t.env.insert("A=B".into(), "1".into());
        assert!(validate_apps(&[app("a", "A", vec![t])]).is_err());
    }
}
