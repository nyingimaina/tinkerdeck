//! Thin command shells for the Files explorer. The filesystem work runs on a blocking worker so a
//! slow or large folder never holds up the window.

use super::{drives, home_folder, list_level, Entry, Listing};
use std::path::PathBuf;

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
