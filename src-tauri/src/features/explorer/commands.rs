//! Thin command shells for the Files explorer. The filesystem work runs on a blocking worker so a
//! slow or large folder never holds up the window.

use super::{
    create_item, delete_item_with, drives, home_folder, list_level, move_item, rename_item, Entry,
    ItemKind, Listing,
};
use crate::editor::{Entry as EditorEntry, Store};
use crate::editor_cmds::{now, E};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// What a rename, move or delete changed in the editor's open tabs (A3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repath {
    pub id: String,
    pub path: String,
    pub title: String,
}

/// The result of a rename, move or delete: the item's new path (unchanged for a delete), the open
/// tabs re-pointed at the new path, and the tabs closed because the item went away.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerOp {
    pub path: String,
    pub repaths: Vec<Repath>,
    pub closed: Vec<String>,
}

fn repath_of(entry: EditorEntry) -> Repath {
    Repath {
        id: entry.id,
        path: entry.path.unwrap_or_default(),
        title: entry.title,
    }
}

/// Create an empty file or a folder inside `path`; returns the new item's path.
#[tauri::command]
pub async fn explorer_create(path: String, name: String, kind: String) -> Result<String, String> {
    let kind = ItemKind::parse(&kind)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        create_item(&PathBuf::from(path), &name, kind)
    })
    .await;
    match result {
        Ok(created) => created,
        Err(e) => Err(format!("The item could not be created: {e}")),
    }
}

/// Rename an item on disk and re-point any open editor tab at its new path as one operation. If the
/// tabs cannot be saved, the rename is undone so no tab is left pointing at a path that is gone.
pub fn rename_and_repath(store: &mut Store, path: &Path, name: &str) -> Result<ExplorerOp, String> {
    let new_path = rename_item(path, name)?;
    if new_path == path.to_string_lossy() {
        return Ok(ExplorerOp {
            path: new_path,
            repaths: Vec::new(),
            closed: Vec::new(),
        });
    }
    match store.repath_prefix(path, Path::new(&new_path)) {
        Ok(changed) => Ok(ExplorerOp {
            path: new_path,
            repaths: changed.into_iter().map(repath_of).collect(),
            closed: Vec::new(),
        }),
        Err(e) => {
            let _ = std::fs::rename(Path::new(&new_path), path);
            Err(e)
        }
    }
}

/// Move an item into another folder and re-point the open editor tabs under it as one operation. If
/// the tabs cannot be saved, the move is undone so no tab is left pointing at a path that is gone.
pub fn move_and_repath(store: &mut Store, path: &Path, into: &Path) -> Result<ExplorerOp, String> {
    let new_path = move_item(path, into)?;
    if new_path == path.to_string_lossy() {
        return Ok(ExplorerOp {
            path: new_path,
            repaths: Vec::new(),
            closed: Vec::new(),
        });
    }
    match store.repath_prefix(path, Path::new(&new_path)) {
        Ok(changed) => Ok(ExplorerOp {
            path: new_path,
            repaths: changed.into_iter().map(repath_of).collect(),
            closed: Vec::new(),
        }),
        Err(e) => {
            let _ = std::fs::rename(Path::new(&new_path), path);
            Err(e)
        }
    }
}

/// Send an item to the Recycle Bin and close its open tabs as one operation. The tabs are saved
/// first, so a failed save deletes nothing; if the Recycle Bin refuses the item, the tabs are put
/// back so they keep pointing at the item that is still on disk.
pub fn delete_and_close(store: &mut Store, path: &Path, now: i64) -> Result<ExplorerOp, String> {
    delete_and_close_with(store, path, now, |item| {
        trash::delete(item).map_err(|e| e.to_string())
    })
}

/// The same delete with the Recycle Bin step passed in, so a refusal can be proven without touching
/// the real Recycle Bin.
pub fn delete_and_close_with(
    store: &mut Store,
    path: &Path,
    now: i64,
    recycle: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<ExplorerOp, String> {
    let before = store.snapshot_entries();
    let closed = store.close_prefix(path, now)?;
    if let Err(e) = delete_item_with(path, recycle) {
        let _ = store.restore_entries(before);
        return Err(e);
    }
    Ok(ExplorerOp {
        path: path.to_string_lossy().to_string(),
        repaths: Vec::new(),
        closed,
    })
}

/// Rename an item and re-point any open editor tab at its new path.
#[tauri::command]
pub async fn explorer_rename(s: E<'_>, path: String, name: String) -> Result<ExplorerOp, String> {
    let editor = s.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut store = editor.store.lock();
        rename_and_repath(&mut store, &PathBuf::from(&path), &name)
    })
    .await;
    match result {
        Ok(op) => op,
        Err(e) => Err(format!("The item could not be renamed: {e}")),
    }
}

/// Move an item into another folder and re-point the open editor tabs under it.
#[tauri::command]
pub async fn explorer_move(s: E<'_>, path: String, into: String) -> Result<ExplorerOp, String> {
    let editor = s.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut store = editor.store.lock();
        move_and_repath(&mut store, &PathBuf::from(&path), &PathBuf::from(&into))
    })
    .await;
    match result {
        Ok(op) => op,
        Err(e) => Err(format!("The item could not be moved: {e}")),
    }
}

/// Send an item to the Recycle Bin and close any open editor tabs for it or for files inside it.
#[tauri::command]
pub async fn explorer_delete(s: E<'_>, path: String) -> Result<ExplorerOp, String> {
    let editor = s.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut store = editor.store.lock();
        delete_and_close(&mut store, &PathBuf::from(&path), now())
    })
    .await;
    match result {
        Ok(op) => op,
        Err(e) => Err(format!("The item could not be deleted: {e}")),
    }
}

#[tauri::command]
pub async fn explorer_list(path: String, show_hidden: bool) -> Result<Listing, String> {
    tauri::async_runtime::spawn_blocking(move || list_level(&PathBuf::from(path), show_hidden))
        .await
        .map_err(|e| format!("The folder could not be read: {e}"))
}

#[tauri::command]
pub async fn explorer_drives() -> Result<Vec<Entry>, String> {
    tauri::async_runtime::spawn_blocking(drives)
        .await
        .map_err(|e| format!("The drives could not be listed: {e}"))
}

#[tauri::command]
pub fn explorer_home() -> Option<String> {
    home_folder()
}
