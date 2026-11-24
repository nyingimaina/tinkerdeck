//! Tauri commands for colour themes (BRS 7.16).

use crate::commands::AppState;
use crate::gallery::{self, Entry, Package};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

type S<'a> = State<'a, Arc<AppState>>;

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default()
}

#[tauri::command]
pub fn themes_load(state: S) -> Value {
    crate::themes::load(&state.config_dir)
}

#[tauri::command]
pub fn themes_save(state: S, value: Value) -> Result<(), String> {
    crate::themes::save(&state.config_dir, &value)
}

#[tauri::command]
pub async fn themes_search_online(query: String) -> Result<Vec<Entry>, String> {
    tauri::async_runtime::spawn_blocking(move || gallery::search_online(&query, &gallery::http_get)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn themes_fetch_online(publisher: String, name: String) -> Result<Package, String> {
    tauri::async_runtime::spawn_blocking(move || gallery::fetch_online(&publisher, &name, &gallery::http_get)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn themes_scan_local() -> Vec<Entry> {
    tauri::async_runtime::spawn_blocking(|| gallery::scan_local(&gallery::local_roots(&home()))).await.unwrap_or_default()
}

#[tauri::command]
pub fn themes_read_local(dir: String) -> Result<Package, String> {
    gallery::read_local(std::path::Path::new(&dir), &gallery::local_roots(&home()))
}
