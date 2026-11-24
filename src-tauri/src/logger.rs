//! Tiny rolling log file in the config folder (BRS 6.9). Never logs the environment.

use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
const MAX_BYTES: u64 = 1024 * 1024;

pub fn init(dir: &std::path::Path) {
    let _ = std::fs::create_dir_all(dir);
    let path = dir.join("lite-commander.log");
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            let _ = std::fs::rename(&path, dir.join("lite-commander.log.old"));
        }
    }
    let _ = LOG_PATH.set(path);
    std::panic::set_hook(Box::new(|info| {
        log(&format!("PANIC: {info}"));
    }));
}

pub fn log(msg: &str) {
    let Some(path) = LOG_PATH.get() else { return };
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[{secs}] {msg}");
    }
}
