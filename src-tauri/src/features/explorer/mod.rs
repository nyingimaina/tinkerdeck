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
