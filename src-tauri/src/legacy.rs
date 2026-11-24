//! Carrying an existing installation over from the product's earlier name ("Lite Commander").
//!
//! The data folder is named after the app identifier, so renaming the app moves it. The first start
//! copies the old folder's saved apps, backup and editor store into the new one. The old folder is
//! never changed or deleted, so going back to an old build still works.

use std::path::Path;

pub const OLD_DIR_NAME: &str = "com.litecommander.app";
pub const OLD_CONFIG_FILE: &str = "lite-commander.json";
pub const NEW_CONFIG_FILE: &str = "tinkerdeck.json";

/// Copy the old data into `new_dir` when there is old data and no new data yet.
/// Returns whether anything was copied.
pub fn migrate(new_dir: &Path, old_dir: &Path) -> Result<bool, String> {
    if !old_dir.is_dir() {
        return Ok(false);
    }
    let mut copied = false;
    let (old_cfg, new_cfg) = (old_dir.join(OLD_CONFIG_FILE), new_dir.join(NEW_CONFIG_FILE));
    if old_cfg.is_file() && !new_cfg.exists() {
        std::fs::create_dir_all(new_dir).map_err(|e| e.to_string())?;
        std::fs::copy(&old_cfg, &new_cfg).map_err(|e| format!("Could not carry over your saved apps: {e}"))?;
        let (old_bak, new_bak) = (old_dir.join(format!("{OLD_CONFIG_FILE}.bak")), new_dir.join(format!("{NEW_CONFIG_FILE}.bak")));
        if old_bak.is_file() && !new_bak.exists() {
            let _ = std::fs::copy(&old_bak, &new_bak);
        }
        copied = true;
    }
    let (old_ed, new_ed) = (old_dir.join("editor"), new_dir.join("editor"));
    if old_ed.is_dir() && !new_ed.exists() {
        copy_dir(&old_ed, &new_ed).map_err(|e| format!("Could not carry over your editor files: {e}"))?;
        copied = true;
    }
    Ok(copied)
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// The old folder that sits next to `new_dir` (both live under the same roaming folder).
pub fn old_dir_beside(new_dir: &Path) -> Option<std::path::PathBuf> {
    new_dir.parent().map(|p| p.join(OLD_DIR_NAME))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(p: &Path, text: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn saved_apps_backup_and_editor_store_are_copied_under_the_new_names() {
        let t = TempDir::new().unwrap();
        let (old, new) = (t.path().join(OLD_DIR_NAME), t.path().join("com.tinkerdeck.app"));
        write(&old.join(OLD_CONFIG_FILE), r#"{"version":1,"apps":[{"name":"ShipRight"}]}"#);
        write(&old.join(format!("{OLD_CONFIG_FILE}.bak")), "backup");
        write(&old.join("editor").join("index.json"), "[]");
        write(&old.join("editor").join("abc.buf"), "unsaved");
        write(&old.join("lite-commander.log"), "old log");
        assert!(migrate(&new, &old).unwrap());
        assert_eq!(std::fs::read_to_string(new.join(NEW_CONFIG_FILE)).unwrap(), r#"{"version":1,"apps":[{"name":"ShipRight"}]}"#);
        assert_eq!(std::fs::read_to_string(new.join(format!("{NEW_CONFIG_FILE}.bak"))).unwrap(), "backup");
        assert_eq!(std::fs::read_to_string(new.join("editor").join("abc.buf")).unwrap(), "unsaved");
        assert!(!new.join("lite-commander.log").exists(), "logs are not carried over");
    }

    #[test]
    fn the_old_folder_is_left_exactly_as_it_was() {
        let t = TempDir::new().unwrap();
        let (old, new) = (t.path().join(OLD_DIR_NAME), t.path().join("com.tinkerdeck.app"));
        write(&old.join(OLD_CONFIG_FILE), "original");
        write(&old.join("editor").join("index.json"), "[]");
        migrate(&new, &old).unwrap();
        assert_eq!(std::fs::read_to_string(old.join(OLD_CONFIG_FILE)).unwrap(), "original");
        assert!(old.join("editor").join("index.json").exists());
        assert!(!old.join(NEW_CONFIG_FILE).exists());
    }

    #[test]
    fn nothing_is_overwritten_once_the_new_folder_has_its_own_apps() {
        let t = TempDir::new().unwrap();
        let (old, new) = (t.path().join(OLD_DIR_NAME), t.path().join("com.tinkerdeck.app"));
        write(&old.join(OLD_CONFIG_FILE), "old apps");
        write(&new.join(NEW_CONFIG_FILE), "new apps");
        assert!(!migrate(&new, &old).unwrap());
        assert_eq!(std::fs::read_to_string(new.join(NEW_CONFIG_FILE)).unwrap(), "new apps");
    }

    #[test]
    fn a_fresh_install_with_no_old_data_does_nothing() {
        let t = TempDir::new().unwrap();
        let (old, new) = (t.path().join(OLD_DIR_NAME), t.path().join("com.tinkerdeck.app"));
        assert!(!migrate(&new, &old).unwrap());
        assert!(!new.join(NEW_CONFIG_FILE).exists());
    }

    #[test]
    fn running_it_twice_is_harmless() {
        let t = TempDir::new().unwrap();
        let (old, new) = (t.path().join(OLD_DIR_NAME), t.path().join("com.tinkerdeck.app"));
        write(&old.join(OLD_CONFIG_FILE), "apps");
        assert!(migrate(&new, &old).unwrap());
        assert!(!migrate(&new, &old).unwrap());
        assert_eq!(std::fs::read_to_string(new.join(NEW_CONFIG_FILE)).unwrap(), "apps");
    }

    #[test]
    fn editor_files_are_carried_over_even_when_there_are_no_saved_apps() {
        let t = TempDir::new().unwrap();
        let (old, new) = (t.path().join(OLD_DIR_NAME), t.path().join("com.tinkerdeck.app"));
        write(&old.join("editor").join("index.json"), "[1]");
        assert!(migrate(&new, &old).unwrap());
        assert_eq!(std::fs::read_to_string(new.join("editor").join("index.json")).unwrap(), "[1]");
        assert!(!new.join(NEW_CONFIG_FILE).exists());
    }

    #[test]
    fn finds_the_old_folder_next_to_the_new_one() {
        let new = Path::new("C:\\Users\\me\\AppData\\Roaming\\com.tinkerdeck.app");
        assert_eq!(old_dir_beside(new).unwrap(), Path::new("C:\\Users\\me\\AppData\\Roaming").join(OLD_DIR_NAME));
        assert!(old_dir_beside(Path::new("C:\\")).is_none());
    }
}
