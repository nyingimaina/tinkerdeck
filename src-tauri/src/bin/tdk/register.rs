//! Make the MCP server discoverable: register `tdk mcp` in the config files of the LLM clients
//! installed on this machine (BRS 7.12). MCP has no network broadcast; clients find servers in
//! their own config, so this writes one entry per client, safely: merged, never clobbering, backed
//! up once, and refusing to touch a file it cannot parse.

use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

pub const SERVER_NAME: &str = "tinkerdeck";
/// The name this server had before the rename. Entries under it point at a program that is gone.
pub const LEGACY_SERVER_NAME: &str = "lite-commander";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shape {
    /// `{ "mcpServers": { name: { command, args } } }`
    McpServers,
    /// VS Code: `{ "servers": { name: { type: "stdio", command, args } } }`
    VsCode,
    /// opencode: `{ "mcp": { name: { type: "local", command: [exe, "mcp"], enabled: true } } }`
    OpenCode,
}

#[derive(Debug, Clone)]
pub struct Client {
    pub id: &'static str,
    pub name: &'static str,
    pub file: PathBuf,
    pub shape: Shape,
}

impl Client {
    /// The client counts as installed when the folder that holds its config exists (or the file does).
    pub fn present(&self) -> bool {
        self.file.exists() || self.file.parent().map(|p| p.is_dir()).unwrap_or(false)
    }
}

pub fn clients_for(home: &Path, appdata: &Path) -> Vec<Client> {
    vec![
        Client { id: "claude-code", name: "Claude Code", file: home.join(".claude.json"), shape: Shape::McpServers },
        Client { id: "claude-desktop", name: "Claude Desktop", file: appdata.join("Claude").join("claude_desktop_config.json"), shape: Shape::McpServers },
        Client { id: "cursor", name: "Cursor", file: home.join(".cursor").join("mcp.json"), shape: Shape::McpServers },
        Client { id: "windsurf", name: "Windsurf", file: home.join(".codeium").join("windsurf").join("mcp_config.json"), shape: Shape::McpServers },
        Client { id: "vscode", name: "VS Code (Copilot)", file: appdata.join("Code").join("User").join("mcp.json"), shape: Shape::VsCode },
        Client { id: "gemini", name: "Gemini CLI", file: home.join(".gemini").join("settings.json"), shape: Shape::McpServers },
        Client { id: "opencode", name: "opencode", file: opencode_file(home), shape: Shape::OpenCode },
    ]
}

/// opencode keeps its global config in `~/.config/opencode/` on every platform; an existing
/// `opencode.jsonc` is the one the user already edits, otherwise `opencode.json`.
fn opencode_file(home: &Path) -> PathBuf {
    let dir = home.join(".config").join("opencode");
    let jsonc = dir.join("opencode.jsonc");
    if jsonc.exists() && !dir.join("opencode.json").exists() {
        jsonc
    } else {
        dir.join("opencode.json")
    }
}

pub fn clients() -> Vec<Client> {
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default();
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default();
    clients_for(&home, &appdata)
}

fn key(shape: Shape) -> &'static str {
    match shape {
        Shape::McpServers => "mcpServers",
        Shape::VsCode => "servers",
        Shape::OpenCode => "mcp",
    }
}

/// The entry that launches the server. Uses the full path so it works without PATH.
pub fn entry(shape: Shape, exe: &str) -> Value {
    match shape {
        Shape::McpServers => json!({ "command": exe, "args": ["mcp"] }),
        Shape::VsCode => json!({ "type": "stdio", "command": exe, "args": ["mcp"] }),
        Shape::OpenCode => json!({ "type": "local", "command": [exe, "mcp"], "enabled": true }),
    }
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Change {
    Added,
    Updated,
    Unchanged,
    Removed,
    NotPresent,
}

/// Insert or update our entry, leaving everything else in the document alone.
pub fn add_entry(root: &mut Value, shape: Shape, exe: &str) -> Result<Change, String> {
    let obj = root.as_object_mut().ok_or("The config file is not a JSON object.")?;
    let servers = obj.entry(key(shape)).or_insert_with(|| Value::Object(Map::new()));
    let servers = servers.as_object_mut().ok_or_else(|| format!("\"{}\" in the config file is not an object.", key(shape)))?;
    let want = entry(shape, exe);
    match servers.get(SERVER_NAME) {
        Some(existing) if *existing == want => Ok(Change::Unchanged),
        Some(_) => {
            servers.insert(SERVER_NAME.into(), want);
            Ok(Change::Updated)
        }
        None => {
            servers.insert(SERVER_NAME.into(), want);
            Ok(Change::Added)
        }
    }
}

pub fn remove_entry(root: &mut Value, shape: Shape) -> Change {
    let removed = root.get_mut(key(shape)).and_then(|s| s.as_object_mut()).and_then(|s| s.remove(SERVER_NAME));
    if removed.is_some() {
        Change::Removed
    } else {
        Change::NotPresent
    }
}

pub fn remove_legacy_entry(root: &mut Value, shape: Shape) -> Change {
    let removed = root.get_mut(key(shape)).and_then(|s| s.as_object_mut()).and_then(|s| s.remove(LEGACY_SERVER_NAME));
    if removed.is_some() {
        Change::Removed
    } else {
        Change::NotPresent
    }
}

/// Like `install`, and also removes the entry the old name left behind.
pub fn install_and_migrate(c: &Client, exe: &str) -> Result<Change, String> {
    let mut root = read_json(&c.file)?;
    let legacy = remove_legacy_entry(&mut root, c.shape);
    let change = add_entry(&mut root, c.shape, exe)?;
    if change != Change::Unchanged || legacy == Change::Removed {
        write_json(&c.file, &root)?;
    }
    Ok(change)
}

/// Like `uninstall`, and also clears an entry left by the old name.
pub fn uninstall_all(c: &Client) -> Result<Change, String> {
    if !c.file.exists() {
        return Ok(Change::NotPresent);
    }
    let mut root = read_json(&c.file)?;
    let (a, b) = (remove_entry(&mut root, c.shape), remove_legacy_entry(&mut root, c.shape));
    if a == Change::Removed || b == Change::Removed {
        write_json(&c.file, &root)?;
        return Ok(Change::Removed);
    }
    Ok(Change::NotPresent)
}

pub fn has_entry(root: &Value, shape: Shape) -> bool {
    root.get(key(shape)).and_then(|s| s.get(SERVER_NAME)).is_some()
}

fn read_json(path: &Path) -> Result<Value, String> {
    match std::fs::read_to_string(path) {
        Ok(t) if t.trim().is_empty() => Ok(json!({})),
        Ok(t) => serde_json::from_str(t.trim_start_matches('\u{feff}')).map_err(|e| {
            format!("{} is not plain JSON ({e}); left untouched. Add the server by hand with `tdk mcp config`.", path.display())
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(format!("Could not read {}: {e}", path.display())),
    }
}

/// Atomic write; the original is copied to `<file>.tdk-backup` the first time only.
fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if path.exists() {
        let backup = PathBuf::from(format!("{}.tdk-backup", path.display()));
        if !backup.exists() {
            std::fs::copy(path, &backup).map_err(|e| format!("Could not back up {}: {e}", path.display()))?;
        }
    }
    let tmp = PathBuf::from(format!("{}.tdk-tmp", path.display()));
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not update {}: {e}", path.display())
    })
}

/// The plain variants are superseded by `install_and_migrate` and `uninstall_all` and kept for tests.
#[cfg(test)]
pub fn install(c: &Client, exe: &str) -> Result<Change, String> {
    let mut root = read_json(&c.file)?;
    let change = add_entry(&mut root, c.shape, exe)?;
    if change != Change::Unchanged {
        write_json(&c.file, &root)?;
    }
    Ok(change)
}

#[cfg(test)]
pub fn uninstall(c: &Client) -> Result<Change, String> {
    if !c.file.exists() {
        return Ok(Change::NotPresent);
    }
    let mut root = read_json(&c.file)?;
    let change = remove_entry(&mut root, c.shape);
    if change == Change::Removed {
        write_json(&c.file, &root)?;
    }
    Ok(change)
}

pub fn is_registered(c: &Client) -> bool {
    read_json(&c.file).map(|r| has_entry(&r, c.shape)).unwrap_or(false)
}

/// Pick clients by id (`all` = every installed one; an explicit id is used even if not detected).
pub fn select(all: Vec<Client>, wanted: &[String]) -> Result<Vec<Client>, String> {
    if wanted.is_empty() || wanted.iter().any(|w| w == "all") {
        return Ok(all.into_iter().filter(|c| c.present()).collect());
    }
    let mut out = Vec::new();
    for w in wanted {
        match all.iter().find(|c| c.id == w) {
            Some(c) => out.push(c.clone()),
            None => {
                let ids: Vec<&str> = all.iter().map(|c| c.id).collect();
                return Err(format!("Unknown client \"{w}\". Known: {}, all.", ids.join(", ")));
            }
        }
    }
    Ok(out)
}

/// What to paste into any other MCP client.
pub fn snippet(exe: &str) -> String {
    serde_json::to_string_pretty(&json!({ "mcpServers": { SERVER_NAME: entry(Shape::McpServers, exe) } })).unwrap_or_default()
}

pub fn describe(c: Change) -> &'static str {
    match c {
        Change::Added => "registered",
        Change::Updated => "updated",
        Change::Unchanged => "already registered",
        Change::Removed => "removed",
        Change::NotPresent => "was not registered",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const EXE: &str = "C:\\Users\\me\\AppData\\Local\\Programs\\Tinkerdeck\\tdk.exe";

    #[test]
    fn adds_the_entry_with_the_full_path_and_keeps_everything_else() {
        let mut root = json!({ "theme": "dark", "mcpServers": { "other": { "command": "x", "args": [] } } });
        assert_eq!(add_entry(&mut root, Shape::McpServers, EXE).unwrap(), Change::Added);
        assert_eq!(root["theme"], "dark");
        assert_eq!(root["mcpServers"]["other"]["command"], "x");
        assert_eq!(root["mcpServers"][SERVER_NAME], json!({ "command": EXE, "args": ["mcp"] }));
    }

    #[test]
    fn creates_the_servers_object_when_missing_and_is_idempotent() {
        let mut root = json!({});
        assert_eq!(add_entry(&mut root, Shape::McpServers, EXE).unwrap(), Change::Added);
        assert_eq!(add_entry(&mut root, Shape::McpServers, EXE).unwrap(), Change::Unchanged);
        assert_eq!(add_entry(&mut root, Shape::McpServers, "D:\\moved\\tdk.exe").unwrap(), Change::Updated);
        assert_eq!(root["mcpServers"][SERVER_NAME]["command"], "D:\\moved\\tdk.exe");
    }

    #[test]
    fn vs_code_uses_servers_with_a_stdio_type() {
        let mut root = json!({ "inputs": [] });
        add_entry(&mut root, Shape::VsCode, EXE).unwrap();
        assert_eq!(root["servers"][SERVER_NAME]["type"], "stdio");
        assert_eq!(root["inputs"], json!([]));
        assert!(root.get("mcpServers").is_none());
    }

    #[test]
    fn opencode_gets_a_local_command_array_under_mcp_and_keeps_its_other_settings() {
        let mut root = json!({ "$schema": "https://opencode.ai/config.json", "model": "x", "mcp": { "other": { "type": "remote", "url": "u" } } });
        assert_eq!(add_entry(&mut root, Shape::OpenCode, EXE).unwrap(), Change::Added);
        assert_eq!(root["mcp"][SERVER_NAME], json!({ "type": "local", "command": [EXE, "mcp"], "enabled": true }));
        assert_eq!(root["mcp"]["other"]["url"], "u");
        assert_eq!(root["model"], "x");
        assert!(root.get("mcpServers").is_none());
        assert_eq!(add_entry(&mut root, Shape::OpenCode, EXE).unwrap(), Change::Unchanged);
        assert!(has_entry(&root, Shape::OpenCode));
        assert_eq!(remove_entry(&mut root, Shape::OpenCode), Change::Removed);
        assert!(root["mcp"].get("other").is_some());
    }

    #[test]
    fn opencode_location_prefers_an_existing_jsonc_file() {
        let d = tempdir().unwrap();
        let dir = d.path().join(".config").join("opencode");
        std::fs::create_dir_all(&dir).unwrap();
        let find = |home: &Path| clients_for(home, &home.join("AppData")).into_iter().find(|c| c.id == "opencode").unwrap();
        assert!(find(d.path()).file.ends_with("opencode.json"));
        assert!(find(d.path()).present(), "the opencode folder means opencode is installed");
        std::fs::write(dir.join("opencode.jsonc"), "{}").unwrap();
        assert!(find(d.path()).file.ends_with("opencode.jsonc"));
        std::fs::write(dir.join("opencode.json"), "{}").unwrap();
        assert!(find(d.path()).file.ends_with("opencode.json"));
    }

    #[test]
    fn opencode_installs_into_a_real_file() {
        let d = tempdir().unwrap();
        let c = Client { id: "opencode", name: "opencode", file: d.path().join(".config").join("opencode").join("opencode.json"), shape: Shape::OpenCode };
        assert_eq!(install(&c, EXE).unwrap(), Change::Added);
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&c.file).unwrap()).unwrap();
        assert_eq!(v["mcp"][SERVER_NAME]["command"], json!([EXE, "mcp"]));
        assert!(is_registered(&c));
    }

    #[test]
    fn rejects_documents_it_cannot_safely_extend() {
        assert!(add_entry(&mut json!([]), Shape::McpServers, EXE).is_err());
        assert!(add_entry(&mut json!({ "mcpServers": [] }), Shape::McpServers, EXE).is_err());
    }

    #[test]
    fn removal_touches_only_our_entry() {
        let mut root = json!({ "mcpServers": { "other": { "command": "x" }, SERVER_NAME: { "command": EXE } } });
        assert_eq!(remove_entry(&mut root, Shape::McpServers), Change::Removed);
        assert!(root["mcpServers"].get("other").is_some());
        assert_eq!(remove_entry(&mut root, Shape::McpServers), Change::NotPresent);
        assert_eq!(remove_entry(&mut json!({}), Shape::McpServers), Change::NotPresent);
    }

    #[test]
    fn install_writes_a_new_file_and_a_second_run_changes_nothing() {
        let d = tempdir().unwrap();
        let c = Client { id: "t", name: "T", file: d.path().join("sub").join("mcp.json"), shape: Shape::McpServers };
        assert!(!c.present());
        assert_eq!(install(&c, EXE).unwrap(), Change::Added);
        assert!(c.present() && is_registered(&c));
        let first = std::fs::read_to_string(&c.file).unwrap();
        assert_eq!(install(&c, EXE).unwrap(), Change::Unchanged);
        assert_eq!(std::fs::read_to_string(&c.file).unwrap(), first);
    }

    #[test]
    fn install_backs_up_the_original_once_and_preserves_other_settings() {
        let d = tempdir().unwrap();
        let file = d.path().join("settings.json");
        let original = r#"{ "projects": { "a": 1 }, "mcpServers": { "keep": { "command": "k" } } }"#;
        std::fs::write(&file, original).unwrap();
        let c = Client { id: "t", name: "T", file: file.clone(), shape: Shape::McpServers };
        install(&c, EXE).unwrap();
        let backup = d.path().join("settings.json.tdk-backup");
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);
        install(&c, "D:\\other\\tdk.exe").unwrap(); // update: the backup must stay the original
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);
        let now: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(now["projects"]["a"], 1);
        assert_eq!(now["mcpServers"]["keep"]["command"], "k");
        assert_eq!(now["mcpServers"][SERVER_NAME]["command"], "D:\\other\\tdk.exe");
        assert!(!d.path().join("settings.json.tdk-tmp").exists());
    }

    #[test]
    fn a_file_it_cannot_parse_is_left_exactly_as_it_was() {
        let d = tempdir().unwrap();
        let file = d.path().join("mcp.json");
        let jsonc = "{\n  // my servers\n  \"servers\": {}\n}";
        std::fs::write(&file, jsonc).unwrap();
        let c = Client { id: "t", name: "T", file: file.clone(), shape: Shape::VsCode };
        let e = install(&c, EXE).unwrap_err();
        assert!(e.contains("left untouched") && e.contains("tdk mcp config"), "{e}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), jsonc);
        assert!(!d.path().join("mcp.json.tdk-backup").exists());
    }

    #[test]
    fn a_byte_order_mark_and_an_empty_file_are_fine() {
        let d = tempdir().unwrap();
        let bom = d.path().join("a.json");
        std::fs::write(&bom, "\u{feff}{\"mcpServers\":{}}").unwrap();
        assert_eq!(install(&Client { id: "a", name: "A", file: bom, shape: Shape::McpServers }, EXE).unwrap(), Change::Added);
        let empty = d.path().join("b.json");
        std::fs::write(&empty, "  ").unwrap();
        assert_eq!(install(&Client { id: "b", name: "B", file: empty, shape: Shape::McpServers }, EXE).unwrap(), Change::Added);
    }

    #[test]
    fn uninstall_removes_only_ours_and_ignores_missing_files() {
        let d = tempdir().unwrap();
        let file = d.path().join("c.json");
        let c = Client { id: "c", name: "C", file: file.clone(), shape: Shape::McpServers };
        assert_eq!(uninstall(&c).unwrap(), Change::NotPresent);
        std::fs::write(&file, r#"{"mcpServers":{"keep":{"command":"k"}}}"#).unwrap();
        install(&c, EXE).unwrap();
        assert_eq!(uninstall(&c).unwrap(), Change::Removed);
        let now: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert!(now["mcpServers"].get("keep").is_some() && now["mcpServers"].get(SERVER_NAME).is_none());
        assert!(!is_registered(&c));
    }

    #[test]
    fn known_clients_have_their_documented_locations() {
        let cs = clients_for(Path::new("C:\\Users\\me"), Path::new("C:\\Users\\me\\AppData\\Roaming"));
        let get = |id: &str| cs.iter().find(|c| c.id == id).unwrap().file.display().to_string();
        assert!(get("claude-desktop").ends_with("Claude\\claude_desktop_config.json"));
        assert!(get("claude-code").ends_with(".claude.json"));
        assert!(get("cursor").ends_with(".cursor\\mcp.json"));
        assert!(get("windsurf").ends_with("windsurf\\mcp_config.json"));
        assert!(get("vscode").ends_with("Code\\User\\mcp.json"));
        assert!(get("gemini").ends_with(".gemini\\settings.json"));
        assert_eq!(cs.iter().find(|c| c.id == "vscode").unwrap().shape, Shape::VsCode);
        assert!(get("opencode").ends_with(".config\\opencode\\opencode.json"));
    }

    #[test]
    fn selection_defaults_to_the_detected_clients_and_names_unknown_ones() {
        let d = tempdir().unwrap();
        std::fs::create_dir_all(d.path().join(".cursor")).unwrap();
        let all = clients_for(d.path(), &d.path().join("AppData"));
        let found: Vec<&str> = select(all.clone(), &[]).unwrap().iter().map(|c| c.id).collect();
        assert!(found.contains(&"cursor"));
        assert!(!found.contains(&"claude-desktop"));
        assert_eq!(select(all.clone(), &["vscode".into()]).unwrap()[0].id, "vscode"); // explicit: even if not detected
        assert!(select(all, &["nope".into()]).unwrap_err().contains("Known:"));
    }

    #[test]
    fn the_paste_snippet_is_valid_json_with_the_full_path() {
        let v: Value = serde_json::from_str(&snippet(EXE)).unwrap();
        assert_eq!(v["mcpServers"][SERVER_NAME]["args"], json!(["mcp"]));
        assert_eq!(v["mcpServers"][SERVER_NAME]["command"], EXE);
    }

    #[test]
    fn the_old_lite_commander_entry_is_removed_and_everything_else_is_kept() {
        let mut root = json!({ "mcpServers": { "other": { "command": "x" }, LEGACY_SERVER_NAME: { "command": "C:\\old\\lcmd.exe", "args": ["mcp"] } } });
        assert_eq!(remove_legacy_entry(&mut root, Shape::McpServers), Change::Removed);
        assert!(root["mcpServers"].get(LEGACY_SERVER_NAME).is_none());
        assert!(root["mcpServers"].get("other").is_some());
        assert_eq!(remove_legacy_entry(&mut root, Shape::McpServers), Change::NotPresent);
    }

    #[test]
    fn installing_replaces_the_old_entry_with_the_new_one_in_a_real_file() {
        let d = tempdir().unwrap();
        let file = d.path().join("mcp.json");
        std::fs::write(&file, r#"{"mcpServers":{"keep":{"command":"k"},"lite-commander":{"command":"C:\\old\\lcmd.exe","args":["mcp"]}}}"#).unwrap();
        let c = Client { id: "t", name: "T", file: file.clone(), shape: Shape::McpServers };
        assert_eq!(install_and_migrate(&c, EXE).unwrap(), Change::Added);
        let now: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert!(now["mcpServers"].get("lite-commander").is_none(), "the dead entry is gone");
        assert_eq!(now["mcpServers"][SERVER_NAME]["command"], EXE);
        assert_eq!(now["mcpServers"]["keep"]["command"], "k");
    }

    #[test]
    fn uninstall_also_clears_a_leftover_old_entry() {
        let d = tempdir().unwrap();
        let file = d.path().join("mcp.json");
        std::fs::write(&file, r#"{"mcpServers":{"lite-commander":{"command":"x"}}}"#).unwrap();
        let c = Client { id: "t", name: "T", file: file.clone(), shape: Shape::McpServers };
        assert_eq!(uninstall_all(&c).unwrap(), Change::Removed);
        let now: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert!(now["mcpServers"].get("lite-commander").is_none());
    }
}
