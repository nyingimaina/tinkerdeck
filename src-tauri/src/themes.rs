//! The chosen colour theme and the themes imported from VS Code (BRS 7.16), kept in `themes.json`.
//! The file is opaque to Rust beyond a shape and size check: the interface owns what a theme means.

use serde_json::{json, Value};
use std::path::Path;

pub const FILE: &str = "themes.json";
const MAX_THEMES: usize = 60;
const MAX_BYTES: usize = 3 * 1024 * 1024;

fn empty() -> Value {
    json!({ "active": null, "imported": [] })
}

fn check(v: &Value) -> Result<(), String> {
    let obj = v.as_object().ok_or("The theme settings must be an object.")?;
    match obj.get("active") {
        None | Some(Value::Null) => {}
        Some(Value::String(s)) if s.len() <= 200 => {}
        _ => return Err("The chosen theme is not valid.".into()),
    }
    let list = obj.get("imported").and_then(|i| i.as_array()).ok_or("The imported themes must be a list.")?;
    if list.len() > MAX_THEMES {
        return Err(format!("At most {MAX_THEMES} imported themes can be kept. Remove some first."));
    }
    for t in list {
        let ok = t.get("id").and_then(|x| x.as_str()).is_some_and(|s| !s.is_empty() && s.len() <= 120) && t.get("name").and_then(|x| x.as_str()).is_some();
        if !ok {
            return Err("An imported theme is missing its id or name.".into());
        }
    }
    Ok(())
}

pub fn load(dir: &Path) -> Value {
    let path = dir.join(FILE);
    let Ok(text) = std::fs::read_to_string(&path) else { return empty() };
    match serde_json::from_str::<Value>(&text) {
        Ok(v) if check(&v).is_ok() => v,
        _ => {
            let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            let _ = std::fs::rename(&path, dir.join(format!("{FILE}.corrupt-{secs}")));
            empty()
        }
    }
}

pub fn save(dir: &Path, v: &Value) -> Result<(), String> {
    check(v)?;
    let bytes = serde_json::to_vec_pretty(v).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("The theme settings are too large to save. Remove some imported themes.".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let (path, tmp) = (dir.join(FILE), dir.join(format!("{FILE}.tmp")));
    std::fs::write(&tmp, bytes).map_err(|e| format!("Could not save the theme settings: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save the theme settings: {e}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    #[test]
    fn nothing_saved_means_the_defaults() {
        let d = TempDir::new().unwrap();
        assert_eq!(load(d.path()), json!({ "active": null, "imported": [] }));
    }

    #[test]
    fn the_chosen_theme_and_imported_themes_survive_a_restart() {
        let d = TempDir::new().unwrap();
        let v = json!({ "active": "vsc-night-1234", "imported": [{ "id": "vsc-night-1234", "name": "Night", "kind": "dark", "ui": { "bg": "#000000" } }] });
        save(d.path(), &v).unwrap();
        assert_eq!(load(d.path()), v);
        assert!(!d.path().join("themes.json.tmp").exists());
    }

    #[test]
    fn a_choice_with_no_imports_is_fine() {
        let d = TempDir::new().unwrap();
        save(d.path(), &json!({ "active": "tinkerdeck-light", "imported": [] })).unwrap();
        assert_eq!(load(d.path())["active"], "tinkerdeck-light");
    }

    #[test]
    fn nonsense_is_refused_and_the_old_file_is_kept() {
        let d = TempDir::new().unwrap();
        let good = json!({ "active": "a", "imported": [] });
        save(d.path(), &good).unwrap();
        for bad in [
            json!([]),
            json!({ "active": 5, "imported": [] }),
            json!({ "active": null, "imported": {} }),
            json!({ "active": null, "imported": [1] }),
            json!({ "active": null, "imported": [{ "name": "no id" }] }),
            json!({ "active": null, "imported": [{ "id": "x" }] }),
            json!({ "active": "x".repeat(500), "imported": [] }),
        ] {
            assert!(save(d.path(), &bad).is_err(), "{bad}");
        }
        assert_eq!(load(d.path()), good);
    }

    #[test]
    fn there_is_a_limit_on_how_much_can_be_stored() {
        let d = TempDir::new().unwrap();
        let many: Vec<_> = (0..61).map(|i| json!({ "id": format!("t{i}"), "name": "n" })).collect();
        assert!(save(d.path(), &json!({ "active": null, "imported": many })).is_err());
        let big = json!({ "active": null, "imported": [{ "id": "t", "name": "n", "blob": "x".repeat(4 * 1024 * 1024) }] });
        assert!(save(d.path(), &big).unwrap_err().contains("too large"));
    }

    #[test]
    fn a_damaged_file_starts_fresh_and_is_kept_aside() {
        let d = TempDir::new().unwrap();
        std::fs::write(d.path().join("themes.json"), "{ nope").unwrap();
        assert_eq!(load(d.path()), json!({ "active": null, "imported": [] }));
        let aside = std::fs::read_dir(d.path()).unwrap().filter_map(|e| e.ok()).any(|e| e.file_name().to_string_lossy().contains("corrupt"));
        assert!(aside);
    }
}
