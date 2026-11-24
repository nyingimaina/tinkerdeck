//! Loading and saving `tinkerdeck.json` safely (BRS 5.3).
//!
//! Rules: never overwrite a file we could not parse; never let a corrupt main
//! file replace the good `.bak`; saving is locked until the user acknowledges.

use crate::model::{validate_apps, AppDef, Config, CONFIG_VERSION};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const FILE_NAME: &str = "tinkerdeck.json";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigStatus {
    /// Saving is refused until acknowledged (or forever when `permanent`).
    pub locked: bool,
    pub permanent: bool,
    pub message: Option<String>,
    pub path: String,
}

pub struct ConfigStore {
    dir: PathBuf,
    config: Config,
    locked: bool,
    permanent: bool,
    message: Option<String>,
    /// A broken main file that must be copied aside on acknowledge.
    corrupt_main: bool,
}

fn main_path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}
fn bak_path(dir: &Path) -> PathBuf {
    dir.join(format!("{FILE_NAME}.bak"))
}
fn tmp_path(dir: &Path) -> PathBuf {
    dir.join(format!("{FILE_NAME}.tmp"))
}

enum Parsed {
    Ok(Config),
    TooNew(u32),
    Bad(String),
}

fn parse(text: &str) -> Parsed {
    // Check the version first so a newer file with unknown shape is reported as "too new".
    match serde_json::from_str::<serde_json::Value>(text) {
        Err(e) => return Parsed::Bad(e.to_string()),
        Ok(v) => {
            if let Some(ver) = v.get("version").and_then(|x| x.as_u64()) {
                if ver > CONFIG_VERSION as u64 {
                    return Parsed::TooNew(ver as u32);
                }
            }
        }
    }
    match serde_json::from_str::<Config>(text) {
        Ok(mut c) => {
            c.normalize();
            Parsed::Ok(c)
        }
        Err(e) => Parsed::Bad(e.to_string()),
    }
}

impl ConfigStore {
    pub fn load(dir: &Path) -> ConfigStore {
        let mut store = ConfigStore {
            dir: dir.to_path_buf(),
            config: Config::default(),
            locked: false,
            permanent: false,
            message: None,
            corrupt_main: false,
        };
        let main = main_path(dir);
        if !main.exists() {
            return store;
        }
        let text = match std::fs::read_to_string(&main) {
            Ok(t) => t,
            Err(e) => {
                store.fail(format!("Your saved apps could not be read ({e})."), None);
                return store;
            }
        };
        match parse(&text) {
            Parsed::Ok(c) => store.config = c,
            Parsed::TooNew(v) => {
                store.locked = true;
                store.permanent = true;
                store.message = Some(format!(
                    "Your saved apps were written by a newer version of Tinkerdeck (file version {v}). Update the app; nothing will be saved this session."
                ));
            }
            Parsed::Bad(reason) => {
                let bak = bak_path(dir);
                let from_bak = std::fs::read_to_string(&bak).ok().and_then(|t| match parse(&t) {
                    Parsed::Ok(c) => Some(c),
                    _ => None,
                });
                store.corrupt_main = true;
                store.fail(
                    format!("Your saved apps could not be read ({reason})."),
                    from_bak.as_ref().map(|_| bak.display().to_string()),
                );
                if let Some(c) = from_bak {
                    store.config = c;
                }
            }
        }
        store
    }

    fn fail(&mut self, base: String, bak: Option<String>) {
        self.locked = true;
        self.message = Some(match bak {
            Some(b) => format!("{base} The last good backup was loaded from {b}."),
            None => format!("{base} No usable backup was found, so the list is empty. Your file has not been touched."),
        });
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    pub fn status(&self) -> ConfigStatus {
        ConfigStatus {
            locked: self.locked,
            permanent: self.permanent,
            message: self.message.clone(),
            path: main_path(&self.dir).display().to_string(),
        }
    }

    /// The user pressed Continue. Preserves a broken file, then allows saving.
    pub fn acknowledge(&mut self) -> Result<(), String> {
        if self.permanent {
            return Err("This file was written by a newer version and cannot be saved over.".into());
        }
        if self.corrupt_main {
            let main = main_path(&self.dir);
            if main.exists() {
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let dest = self.dir.join(format!("{FILE_NAME}.corrupt-{stamp}"));
                std::fs::copy(&main, &dest).map_err(|e| format!("Could not keep a copy of the broken file: {e}"))?;
            }
            self.corrupt_main = false;
            // Replace the broken main file with what we loaded (the good .bak, or empty),
            // WITHOUT rotating, so the good .bak is never overwritten by the broken file.
            write_file(&self.dir, &self.config, false)?;
        }
        self.locked = false;
        self.message = None;
        Ok(())
    }

    pub fn set_apps(&mut self, apps: Vec<AppDef>) -> Result<(), String> {
        validate_apps(&apps)?;
        let mut next = self.config.clone();
        next.apps = apps;
        next.normalize();
        self.commit(next)
    }

    pub fn set_favourite(&mut self, app_id: &str, favourite: bool) -> Result<(), String> {
        let mut next = self.config.clone();
        let app = next.apps.iter_mut().find(|a| a.id == app_id).ok_or("That app no longer exists.")?;
        app.favourite = favourite;
        self.commit(next)
    }

    /// Record that the app was opened or started. Only moves forward in time.
    pub fn touch_app(&mut self, app_id: &str, unix_seconds: i64) -> Result<(), String> {
        let mut next = self.config.clone();
        let app = next.apps.iter_mut().find(|a| a.id == app_id).ok_or("That app no longer exists.")?;
        if app.last_opened.map(|t| t >= unix_seconds).unwrap_or(false) {
            return Ok(());
        }
        app.last_opened = Some(unix_seconds);
        self.commit(next)
    }

    /// Change the update preferences (auto-check, skipped version, last check time).
    pub fn set_update(&mut self, change: impl FnOnce(&mut crate::model::UpdateSettings)) -> Result<(), String> {
        let mut next = self.config.clone();
        change(&mut next.update);
        self.commit(next)
    }

    pub fn set_theme(&mut self, theme: &str) -> Result<(), String> {
        let mut next = self.config.clone();
        next.theme = theme.to_string();
        next.normalize();
        self.commit(next)
    }

    pub fn set_shell(&mut self, shell: &str) -> Result<(), String> {
        let mut next = self.config.clone();
        next.shell = shell.to_string();
        next.normalize();
        self.commit(next)
    }

    pub fn set_last_running(&mut self, ids: Vec<String>) -> Result<(), String> {
        let mut next = self.config.clone();
        next.last_running = ids;
        next.normalize();
        self.commit(next)
    }

    fn commit(&mut self, next: Config) -> Result<(), String> {
        if self.locked {
            return Err("Saving is locked because your saved apps could not be read. Press Continue first.".into());
        }
        write_atomic(&self.dir, &next)?;
        self.config = next;
        Ok(())
    }
}

/// Serialize first, write a temp file, keep `.bak`, then rename over the real file.
pub fn write_atomic(dir: &Path, config: &Config) -> Result<(), String> {
    write_file(dir, config, true)
}

fn write_file(dir: &Path, config: &Config, rotate_bak: bool) -> Result<(), String> {
    let text = serde_json::to_string_pretty(config).map_err(|e| format!("Could not serialize the config: {e}"))?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let main = main_path(dir);
    let tmp = tmp_path(dir);
    std::fs::write(&tmp, text).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    if rotate_bak && main.exists() {
        let _ = std::fs::copy(&main, bak_path(dir));
    }
    std::fs::rename(&tmp, &main).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not replace {}: {e}", main.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::TerminalDef;
    use tempfile::tempdir;

    fn sample_apps() -> Vec<AppDef> {
        vec![AppDef {
            id: "a1".into(),
            name: "Qonsol".into(),
            root: "C:\\code".into(),
            terminals: vec![TerminalDef { id: "t1".into(), name: "db".into(), cwd: ".".into(), command: "docker start db".into(), ..Default::default() }],
            ..Default::default()
        }]
    }

    #[test]
    fn favourite_and_touch_update_only_that_app_and_persist() {
        let d = tempdir().unwrap();
        let mut s = ConfigStore::load(d.path());
        let mut apps = sample_apps();
        apps.push(AppDef { id: "a2".into(), name: "Other".into(), root: "C:\\o".into(), ..Default::default() });
        s.set_apps(apps).unwrap();
        s.set_favourite("a2", true).unwrap();
        s.touch_app("a1", 1_700_000_100).unwrap();
        let s2 = ConfigStore::load(d.path());
        let by = |id: &str| s2.config().apps.iter().find(|a| a.id == id).unwrap().clone();
        assert!(by("a2").favourite && !by("a1").favourite);
        assert_eq!(by("a1").last_opened, Some(1_700_000_100));
        assert_eq!(by("a2").last_opened, None);
        assert_eq!(by("a1").terminals.len(), 1, "terminals untouched");
    }

    #[test]
    fn favourite_and_touch_reject_unknown_apps_and_respect_the_lock() {
        let d = tempdir().unwrap();
        let mut s = ConfigStore::load(d.path());
        s.set_apps(sample_apps()).unwrap();
        assert!(s.set_favourite("nope", true).is_err());
        assert!(s.touch_app("nope", 1).is_err());
        write(d.path(), FILE_NAME, "broken");
        let mut locked = ConfigStore::load(d.path());
        assert!(locked.set_favourite("a1", true).is_err());
        assert!(locked.touch_app("a1", 5).is_err());
        assert_eq!(read(d.path(), FILE_NAME), "broken");
    }

    #[test]
    fn update_settings_persist_without_touching_anything_else() {
        let d = tempdir().unwrap();
        let mut s = ConfigStore::load(d.path());
        s.set_apps(sample_apps()).unwrap();
        s.set_update(|u| {
            u.auto_check = false;
            u.skipped_version = Some("1.4.0".into());
            u.last_checked = 1234;
        })
        .unwrap();
        let s2 = ConfigStore::load(d.path());
        assert_eq!((s2.config().update.auto_check, s2.config().update.skipped_version.as_deref(), s2.config().update.last_checked), (false, Some("1.4.0"), 1234));
        assert_eq!(s2.config().apps, sample_apps());
    }

    #[test]
    fn update_settings_respect_the_lock() {
        let d = tempdir().unwrap();
        write(d.path(), FILE_NAME, "broken");
        let mut s = ConfigStore::load(d.path());
        assert!(s.set_update(|u| u.last_checked = 5).is_err());
        assert_eq!(read(d.path(), FILE_NAME), "broken");
    }

    #[test]
    fn touching_an_app_only_moves_forward_in_time() {
        let d = tempdir().unwrap();
        let mut s = ConfigStore::load(d.path());
        s.set_apps(sample_apps()).unwrap();
        s.touch_app("a1", 200).unwrap();
        s.touch_app("a1", 100).unwrap(); // older stamp: ignored
        assert_eq!(s.config().apps[0].last_opened, Some(200));
    }

    fn write(dir: &Path, name: &str, text: &str) {
        std::fs::write(dir.join(name), text).unwrap();
    }
    fn read(dir: &Path, name: &str) -> String {
        std::fs::read_to_string(dir.join(name)).unwrap()
    }

    #[test]
    fn missing_file_starts_empty_and_unlocked() {
        let d = tempdir().unwrap();
        let s = ConfigStore::load(d.path());
        assert!(s.config().apps.is_empty());
        assert!(!s.status().locked);
    }

    #[test]
    fn save_then_load_round_trips() {
        let d = tempdir().unwrap();
        let mut s = ConfigStore::load(d.path());
        s.set_apps(sample_apps()).unwrap();
        s.set_theme("light").unwrap();
        let s2 = ConfigStore::load(d.path());
        assert_eq!(s2.config().apps, sample_apps());
        assert_eq!(s2.config().theme, "light");
    }

    #[test]
    fn second_save_keeps_previous_version_as_bak_and_leaves_no_tmp() {
        let d = tempdir().unwrap();
        let mut s = ConfigStore::load(d.path());
        s.set_apps(sample_apps()).unwrap();
        let first = read(d.path(), FILE_NAME);
        s.set_theme("light").unwrap();
        assert_eq!(read(d.path(), &format!("{FILE_NAME}.bak")), first);
        assert!(!d.path().join(format!("{FILE_NAME}.tmp")).exists());
    }

    #[test]
    fn setters_do_not_clobber_other_fields() {
        let d = tempdir().unwrap();
        let mut s = ConfigStore::load(d.path());
        s.set_apps(sample_apps()).unwrap();
        s.set_last_running(vec!["a1".into()]).unwrap();
        s.set_theme("light").unwrap();
        s.set_shell("pwsh.exe").unwrap();
        let c = s.config();
        assert_eq!((c.theme.as_str(), c.shell.as_str()), ("light", "pwsh.exe"));
        assert_eq!(c.last_running, vec!["a1".to_string()]);
        assert_eq!(c.apps.len(), 1);
    }

    #[test]
    fn invalid_apps_are_rejected_and_file_untouched() {
        let d = tempdir().unwrap();
        let mut s = ConfigStore::load(d.path());
        s.set_apps(sample_apps()).unwrap();
        let before = read(d.path(), FILE_NAME);
        let mut bad = sample_apps();
        bad[0].name = "  ".into();
        assert!(s.set_apps(bad).is_err());
        assert_eq!(read(d.path(), FILE_NAME), before);
    }

    #[test]
    fn invalid_json_without_bak_starts_empty_locked_and_untouched() {
        let d = tempdir().unwrap();
        write(d.path(), FILE_NAME, "{ \"version\": 1, \"apps\": [ , ] }");
        let mut s = ConfigStore::load(d.path());
        assert!(s.config().apps.is_empty());
        assert!(s.status().locked);
        assert!(s.status().message.unwrap().contains("could not be read"));
        assert!(s.set_apps(sample_apps()).is_err(), "saving must be refused");
        assert_eq!(read(d.path(), FILE_NAME), "{ \"version\": 1, \"apps\": [ , ] }");
    }

    #[test]
    fn invalid_json_with_valid_bak_loads_bak_but_stays_locked() {
        let d = tempdir().unwrap();
        let mut s = ConfigStore::load(d.path());
        s.set_apps(sample_apps()).unwrap();
        s.set_theme("light").unwrap(); // now .bak holds a valid file
        write(d.path(), FILE_NAME, "not json at all");
        let s2 = ConfigStore::load(d.path());
        assert_eq!(s2.config().apps, sample_apps());
        assert!(s2.status().locked);
        assert!(s2.status().message.unwrap().contains(".bak"));
    }

    #[test]
    fn acknowledge_keeps_corrupt_copy_and_protects_good_bak() {
        let d = tempdir().unwrap();
        let mut s = ConfigStore::load(d.path());
        s.set_apps(sample_apps()).unwrap();
        s.set_theme("light").unwrap();
        let good_bak = read(d.path(), &format!("{FILE_NAME}.bak"));
        write(d.path(), FILE_NAME, "garbage");
        let mut s2 = ConfigStore::load(d.path());
        s2.acknowledge().unwrap();
        // corrupt copy exists
        let found = std::fs::read_dir(d.path()).unwrap().filter_map(|e| e.ok()).any(|e| {
            e.file_name().to_string_lossy().contains(".corrupt-") && std::fs::read_to_string(e.path()).unwrap() == "garbage"
        });
        assert!(found, "the broken file must be preserved");
        // main is now a valid file again and the good bak was not replaced by "garbage"
        assert_eq!(read(d.path(), &format!("{FILE_NAME}.bak")), good_bak);
        s2.set_theme("dark").unwrap();
        let s3 = ConfigStore::load(d.path());
        assert!(!s3.status().locked);
        assert_eq!(s3.config().apps, sample_apps());
        assert_ne!(read(d.path(), &format!("{FILE_NAME}.bak")), "garbage");
    }

    #[test]
    fn newer_version_is_refused_forever() {
        let d = tempdir().unwrap();
        write(d.path(), FILE_NAME, r#"{"version": 99, "somethingNew": true}"#);
        let mut s = ConfigStore::load(d.path());
        let st = s.status();
        assert!(st.locked && st.permanent);
        assert!(s.acknowledge().is_err());
        assert!(s.set_theme("light").is_err());
        assert_eq!(read(d.path(), FILE_NAME), r#"{"version": 99, "somethingNew": true}"#);
    }

    #[test]
    fn unknown_theme_in_file_loads_as_dark() {
        let d = tempdir().unwrap();
        write(d.path(), FILE_NAME, r#"{"version":1,"theme":"neon","apps":[]}"#);
        assert_eq!(ConfigStore::load(d.path()).config().theme, "dark");
    }

    #[test]
    fn missing_theme_in_file_loads_as_dark() {
        let d = tempdir().unwrap();
        write(d.path(), FILE_NAME, r#"{"version":1,"apps":[]}"#);
        assert_eq!(ConfigStore::load(d.path()).config().theme, "dark");
    }
}
