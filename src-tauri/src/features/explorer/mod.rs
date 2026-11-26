//! The Files explorer core: read exactly one directory level, hide the noisy build and VCS
//! folders unless asked, and report the top of the Windows drive hierarchy.
//!
//! Nothing here is recursive, cached or watched. A level is read once, filtered and sorted once,
//! and capped so a huge folder can never make the window render or hold an unbounded list.

pub mod commands;

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Folders hidden by default because they are big and noisy (R2). Matching is case-insensitive,
/// as it is on Windows.
pub const HIDDEN_NAMES: [&str; 4] = ["node_modules", ".git", "target", "dist"];

/// How many visible rows a level returns before it is truncated (A1).
pub const MAX_RETURNED: usize = 1000;

/// How many directory entries a level reads before it stops (A1).
pub const MAX_SCANNED: usize = 10_000;

/// One row of a directory level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// A folder that cannot be read is shown as locked instead of raising an error (R2).
    ///
    /// Listing a level never opens its child folders to learn this, so it is always `false` for
    /// listed rows; a folder's own [`Listing::locked`] reply is authoritative once it is expanded.
    pub locked: bool,
}

/// One directory level, as the window receives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub path: String,
    pub entries: Vec<Entry>,
    /// The number of visible entries found, even when more than `MAX_RETURNED`.
    pub total: usize,
    /// True when this reply does not contain the whole level.
    pub truncated: bool,
    /// True when the requested folder itself could not be read; `entries` is then empty.
    pub locked: bool,
}

struct Row {
    lower: String,
    name: String,
    path: PathBuf,
    is_dir: bool,
}

fn hidden(name: &str) -> bool {
    HIDDEN_NAMES.iter().any(|h| name.eq_ignore_ascii_case(h))
}

/// Read one directory level. Defaults to the production caps: at most [`MAX_RETURNED`] rows after
/// reading at most [`MAX_SCANNED`] entries.
pub fn list_level(dir: &Path, show_hidden: bool) -> Listing {
    list_level_with(dir, show_hidden, MAX_RETURNED, MAX_SCANNED)
}

/// The same lister with explicit caps, so the bound can be tested without a 10,000-entry fixture.
///
/// An unreadable folder is reported as `locked` and never as an error; the rest of the tree can
/// keep working. Folders come first, then files, each by name.
pub fn list_level_with(
    dir: &Path,
    show_hidden: bool,
    max_returned: usize,
    max_scanned: usize,
) -> Listing {
    let shown_path = dir.to_string_lossy().to_string();
    let read = match std::fs::read_dir(dir) {
        Ok(read) => read,
        Err(_) => {
            return Listing {
                path: shown_path,
                entries: Vec::new(),
                total: 0,
                truncated: false,
                locked: true,
            }
        }
    };

    let mut rows: Vec<Row> = Vec::new();
    let mut stopped_early = false;
    for (scanned, item) in read.enumerate() {
        if scanned >= max_scanned {
            stopped_early = true;
            break;
        }
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().to_string();
        if !show_hidden && hidden(&name) {
            continue;
        }
        let is_dir = item.file_type().map(|t| t.is_dir()).unwrap_or(false);
        rows.push(Row {
            lower: name.to_lowercase(),
            name,
            path: item.path(),
            is_dir,
        });
    }

    rows.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.lower.cmp(&b.lower))
            .then_with(|| a.name.cmp(&b.name))
    });

    let total = rows.len();
    let truncated = stopped_early || total > max_returned;
    let entries = rows
        .into_iter()
        .take(max_returned)
        .map(|row| Entry {
            name: row.name,
            path: row.path.to_string_lossy().to_string(),
            is_dir: row.is_dir,
            // Never probe a child folder while listing a level: its readability is only learned,
            // and reported as `Listing::locked`, when its own level is first requested (R2).
            locked: false,
        })
        .collect();

    Listing {
        path: shown_path,
        entries,
        total,
        truncated,
        locked: false,
    }
}

/// The user's home folder, read from `USERPROFILE` only, with no disk access (R13, A1).
///
/// Returns `None` when the environment cannot say where home is, so the window can show its
/// existing no-root hint instead of guessing a path.
pub fn home_folder() -> Option<String> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .map(|path| path.to_string_lossy().to_string())
}

/// The Windows drive roots, the level above every folder hierarchy (R5).
pub fn drives() -> Vec<Entry> {
    use windows_sys::Win32::Storage::FileSystem::GetLogicalDrives;

    let mask = unsafe { GetLogicalDrives() };
    let mut out = Vec::new();
    for i in 0..26u32 {
        if mask & (1u32 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i as u8) as char;
        out.push(Entry {
            name: format!("{letter}:"),
            path: format!("{letter}:\\"),
            is_dir: true,
            locked: false,
        });
    }
    out
}

// ---- file operations (R9) ----------------------------------------------------------------
//
// All four operations act on the real file system and share one set of checks, so a refusal
// leaves the item exactly where it was and never reports success for something that did not
// happen. They are plain functions here and thin `#[tauri::command]` shells in `commands.rs`;
// re-pointing the editor's open tabs is done afterwards by `Store::repath_prefix` and
// `Store::close_prefix` (see `commands.rs`).

/// What a create makes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemKind {
    File,
    Folder,
}

impl ItemKind {
    /// Parse the window's `kind` argument, which is `"file"` or `"folder"`.
    pub fn parse(kind: &str) -> Result<ItemKind, String> {
        match kind {
            "file" => Ok(ItemKind::File),
            "folder" | "dir" | "directory" => Ok(ItemKind::Folder),
            other => Err(format!("\"{other}\" is not a kind of item.")),
        }
    }
}

/// The longest one path component may be on Windows.
const MAX_NAME_LEN: usize = 255;

/// Windows device names that cannot be used for a file or folder.
const RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Split a path into its parts, ignoring empty ones, so comparison is by whole components and
/// never by a bare string prefix (`C:\foo` must not match `C:\foobar`).
fn components(text: &str) -> Vec<&str> {
    text.split(['\\', '/'])
        .filter(|part| !part.is_empty())
        .collect()
}

fn same_component(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// True when `child` is `parent` itself or lies under it, compared case-insensitively by whole
/// path components (Windows is case-insensitive).
pub(crate) fn within(child: &str, parent: &str) -> bool {
    let child_parts = components(child);
    let parent_parts = components(parent);
    child_parts.len() >= parent_parts.len()
        && child_parts[..parent_parts.len()]
            .iter()
            .zip(&parent_parts)
            .all(|(a, b)| same_component(a, b))
}

/// The path `child` takes once `old` becomes `new`, or `None` when `child` is not under `old`.
/// Used to re-point the editor's open tabs after a rename or a move (A3).
pub(crate) fn rebase_path(child: &str, old: &str, new: &str) -> Option<String> {
    if !within(child, old) {
        return None;
    }
    let child_parts = components(child);
    let old_parts = components(old);
    let suffix = &child_parts[old_parts.len()..];
    if suffix.is_empty() {
        return Some(new.to_string());
    }
    let mut out = new.trim_end_matches(['\\', '/']).to_string();
    for part in suffix {
        out.push('\\');
        out.push_str(part);
    }
    Some(out)
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    within(&a.to_string_lossy(), &b.to_string_lossy())
        && within(&b.to_string_lossy(), &a.to_string_lossy())
}

/// The volume a path lives on: its drive, or its `server\share` for a UNC path. Two paths can only
/// be moved between by renaming when they share one.
fn volume(path: &Path) -> Option<String> {
    let text = path.to_string_lossy();
    let parts = components(&text);
    if text.starts_with("\\\\") {
        if parts.len() >= 2 {
            return Some(format!(
                "{}\\{}",
                parts[0].to_lowercase(),
                parts[1].to_lowercase()
            ));
        }
        return None;
    }
    parts.first().map(|part| part.to_lowercase())
}

/// Whether a rename between these two paths stays on one volume. A move to another drive cannot be
/// a plain rename, so it is refused with a clear error before any file-system call (R9).
pub fn same_volume(a: &Path, b: &Path) -> bool {
    match (volume(a), volume(b)) {
        (Some(left), Some(right)) => left == right,
        _ => true,
    }
}

/// Refuse a name that Windows cannot use, before anything is created or renamed (A2).
fn check_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("A name is required.".into());
    }
    if name != name.trim() {
        return Err("A name cannot start or end with a space.".into());
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(format!("A name can be at most {MAX_NAME_LEN} characters."));
    }
    if name.chars().any(|c| {
        c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
    }) {
        return Err("A name cannot contain any of < > : \" / \\ | ? *.".into());
    }
    if name.ends_with('.') {
        return Err("A name cannot end with a dot.".into());
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or(name)
        .trim_end_matches(' ')
        .to_uppercase();
    if RESERVED_NAMES.contains(&stem.as_str()) {
        return Err(format!("The name \"{name}\" is reserved by Windows."));
    }
    Ok(())
}

fn exists(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok()
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// Create an empty file or a new folder inside `dir`, refusing a bad or clashing name and never
/// overwriting anything. Returns the new item's path.
pub fn create_item(dir: &Path, name: &str, kind: ItemKind) -> Result<String, String> {
    check_name(name)?;
    if !dir.is_dir() {
        return Err("The folder to create the item in does not exist.".into());
    }
    let dest = dir.join(name);
    if exists(&dest) {
        return Err(format!("\"{name}\" already exists in this folder."));
    }
    let made = match kind {
        ItemKind::Folder => std::fs::create_dir(&dest),
        ItemKind::File => std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
            .map(|_| ()),
    };
    made.map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!("\"{name}\" already exists in this folder."),
        _ => format!("The item could not be created: {e}"),
    })?;
    Ok(dest.to_string_lossy().to_string())
}

/// Rename an item in place, refusing a bad or clashing name. Returns the new path.
pub fn rename_item(path: &Path, name: &str) -> Result<String, String> {
    check_name(name)?;
    if !exists(path) {
        return Err("That item is already gone.".into());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "That item cannot be renamed in place.".to_string())?;
    let dest = parent.join(name);
    if paths_equal(&dest, path) {
        // The same name, or a change of letter case only: a rename to itself is a harmless no-op.
        if dest == path {
            return Ok(path.to_string_lossy().to_string());
        }
    } else if exists(&dest) {
        return Err(format!("\"{name}\" already exists here."));
    }
    std::fs::rename(path, &dest).map_err(|e| format!("The item could not be renamed: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

/// Move an item into another folder, refusing a clash, a folder moved inside itself, or a move
/// between drives. Dropping an item onto the folder it is already in changes nothing.
pub fn move_item(path: &Path, into: &Path) -> Result<String, String> {
    if !exists(path) {
        return Err("That item is already gone.".into());
    }
    if !into.is_dir() {
        return Err("The destination folder does not exist.".into());
    }
    if path.is_dir() && within(&into.to_string_lossy(), &path.to_string_lossy()) {
        return Err("A folder cannot be moved into itself or one of its folders.".into());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "That item cannot be moved.".to_string())?;
    if paths_equal(parent, into) {
        return Ok(path.to_string_lossy().to_string());
    }
    let name = name_of(path);
    let dest = into.join(&name);
    if exists(&dest) {
        return Err(format!(
            "\"{name}\" already exists in the destination folder."
        ));
    }
    if !same_volume(path, into) {
        return Err("An item cannot be moved to a different drive.".into());
    }
    std::fs::rename(path, &dest).map_err(|e| format!("The item could not be moved: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

/// Send an item to the Recycle Bin (R9). It is never permanently deleted and never falls back when
/// the Recycle Bin refuses the item.
pub fn delete_item(path: &Path) -> Result<(), String> {
    delete_item_with(path, |item| trash::delete(item).map_err(|e| e.to_string()))
}

/// The same delete with the Recycle Bin step passed in, so a refusal can be proven without
/// touching the real Recycle Bin.
pub fn delete_item_with(
    path: &Path,
    recycle: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    if !exists(path) {
        return Err("That item is already gone.".into());
    }
    recycle(path).map_err(|_| {
        "This item could not be moved to the Recycle Bin, so it was not deleted.".to_string()
    })
}
