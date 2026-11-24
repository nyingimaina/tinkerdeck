//! Tauri commands for the text editor (BRS 7.14). The store lives in its own managed state so the
//! launcher's state is untouched.

use crate::editor::{files_from_args, Doc, Listing, Store};
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::State;

pub struct EditorState {
    pub store: Mutex<Store>,
    /// Files named on the command line of the first launch ("Edit with Tinkerdeck"), until the UI takes them.
    pub pending: Mutex<Vec<String>>,
}

pub type E<'a> = State<'a, Arc<EditorState>>;

pub fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub fn new_state(dir: &std::path::Path, args: &[String]) -> Arc<EditorState> {
    Arc::new(EditorState { store: Mutex::new(Store::load(&dir.join("editor"))), pending: Mutex::new(files_from_args(args)) })
}

#[tauri::command]
pub fn editor_list(s: E) -> Listing {
    s.store.lock().list(now())
}
#[tauri::command]
pub fn editor_open(s: E, path: String) -> Result<Doc, String> {
    s.store.lock().open_path(&path, now())
}
#[tauri::command]
pub fn editor_new(s: E) -> Result<Doc, String> {
    s.store.lock().new_untitled(now())
}
#[tauri::command]
pub fn editor_load(s: E, id: String) -> Result<Doc, String> {
    s.store.lock().load_doc(&id, now())
}
#[tauri::command]
pub fn editor_snapshot(s: E, id: String, content: String) -> Result<(), String> {
    s.store.lock().snapshot(&id, &content, now())
}
#[tauri::command]
pub fn editor_save(s: E, id: String, content: String, path: Option<String>) -> Result<Doc, String> {
    s.store.lock().save(&id, &content, path.as_deref(), now())
}
#[tauri::command]
pub fn editor_close(s: E, id: String) -> Result<(), String> {
    s.store.lock().close(&id, now())
}
#[tauri::command]
pub fn editor_restore(s: E, id: String) -> Result<Doc, String> {
    s.store.lock().restore(&id, now())
}
#[tauri::command]
pub fn editor_discard(s: E, id: String) -> Result<(), String> {
    s.store.lock().discard(&id)
}
#[tauri::command]
pub fn editor_take_pending(s: E) -> Vec<String> {
    std::mem::take(&mut *s.pending.lock())
}
#[tauri::command]
pub fn editor_touch(s: E, id: String) {
    s.store.lock().touch(&id, now());
}

// Preview-aware commands: images and PDFs open as preview-only editors; everything else is as before.
#[tauri::command]
pub fn editor_open_any(s: E, path: String) -> Result<Doc, String> {
    s.store.lock().open_any(&path, now())
}
#[tauri::command]
pub fn editor_load_any(s: E, id: String) -> Result<Doc, String> {
    s.store.lock().load_any(&id, now())
}
#[tauri::command]
pub fn editor_save_any(s: E, id: String, content: String, path: Option<String>) -> Result<Doc, String> {
    s.store.lock().save_any(&id, &content, path.as_deref(), now())
}
/// The raw bytes of an image or PDF, for the preview pane. Refuses anything else.
#[tauri::command]
pub fn editor_read_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    crate::editor::read_preview_bytes(std::path::Path::new(&path)).map(tauri::ipc::Response::new)
}
