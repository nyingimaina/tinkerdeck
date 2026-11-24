//! Functions the UI may call (BRS 8.2). No `unwrap`/`expect` here: every
//! problem is returned as a readable error string.

use crate::config::{ConfigStatus, ConfigStore};
use crate::model::{console_app_id, console_def_with_id, AppDef, Config, TerminalDef};
use crate::runtime::{Runtime, StatePayload};
use parking_lot::Mutex;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};

pub struct AppState {
    pub config: Mutex<ConfigStore>,
    pub rt: Arc<Runtime>,
    pub config_dir: PathBuf,
    pub job_warning: Option<String>,
}

type S<'a> = State<'a, Arc<AppState>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView {
    pub config: Config,
    pub status: ConfigStatus,
    pub job_warning: Option<String>,
}

fn find(state: &AppState, app_id: &str, terminal_id: &str) -> Result<(String, TerminalDef, String), String> {
    let cfg = state.config.lock();
    let c = cfg.config();
    let app = c.apps.iter().find(|a| a.id == app_id).ok_or_else(|| "That app no longer exists.".to_string())?;
    let t = app
        .terminals
        .iter()
        .find(|t| t.id == terminal_id)
        .ok_or_else(|| "That terminal no longer exists.".to_string())?;
    Ok((app.root.clone(), t.clone(), c.shell.clone()))
}

fn find_app(state: &AppState, app_id: &str) -> Result<(AppDef, String), String> {
    let cfg = state.config.lock();
    let c = cfg.config();
    let app = c.apps.iter().find(|a| a.id == app_id).ok_or_else(|| "That app no longer exists.".to_string())?;
    Ok((app.clone(), c.shell.clone()))
}

/// Like `find`, but also resolves the built-in Console of an existing app.
fn find_terminal(state: &AppState, app_id: &str, terminal_id: &str) -> Result<(String, TerminalDef, String), String> {
    if console_app_id(terminal_id) == Some(app_id) {
        let (app, shell) = find_app(state, app_id)?;
        return Ok((app.root, console_def_with_id(terminal_id), shell));
    }
    find(state, app_id, terminal_id)
}

#[tauri::command]
pub fn get_config(state: S) -> ConfigView {
    let cfg = state.config.lock();
    ConfigView { config: cfg.config().clone(), status: cfg.status(), job_warning: state.job_warning.clone() }
}

#[tauri::command]
pub fn save_apps(state: S, apps: Vec<AppDef>) -> Result<(), String> {
    let ids: Vec<String> = apps.iter().flat_map(|a| a.terminals.iter().map(|t| t.id.clone())).collect();
    state.config.lock().set_apps(apps)?;
    state.rt.prune(&ids);
    Ok(())
}

#[tauri::command]
pub fn set_theme(state: S, theme: String) -> Result<(), String> {
    state.config.lock().set_theme(&theme)
}

#[tauri::command]
pub fn set_shell(state: S, shell: String) -> Result<(), String> {
    state.config.lock().set_shell(&shell)
}

#[tauri::command]
pub fn set_last_running(state: S, ids: Vec<String>) -> Result<(), String> {
    state.config.lock().set_last_running(ids)
}

#[tauri::command]
pub fn ack_config(state: S) -> Result<(), String> {
    state.config.lock().acknowledge()
}

#[tauri::command]
pub fn terminal_states(state: S) -> Vec<StatePayload> {
    state.rt.states()
}

#[tauri::command]
pub fn start_terminal(state: S, app_id: String, terminal_id: String) -> Result<(), String> {
    let (root, def, shell) = find_terminal(&state, &app_id, &terminal_id)?;
    let rt = state.rt.clone();
    std::thread::spawn(move || rt.start(&app_id, &root, &def, &shell));
    Ok(())
}

#[tauri::command]
pub fn stop_terminal(state: S, app_id: String, terminal_id: String) -> Result<(), String> {
    find_terminal(&state, &app_id, &terminal_id)?;
    if let Some(t) = state.rt.get(&terminal_id) {
        let rt = state.rt.clone();
        std::thread::spawn(move || rt.stop(&t));
    }
    Ok(())
}

#[tauri::command]
pub fn restart_terminal(state: S, app_id: String, terminal_id: String) -> Result<(), String> {
    let (root, def, shell) = find_terminal(&state, &app_id, &terminal_id)?;
    let rt = state.rt.clone();
    std::thread::spawn(move || {
        if let Some(t) = rt.get(&def.id) {
            rt.stop(&t);
        }
        rt.start(&app_id, &root, &def, &shell);
    });
    Ok(())
}

#[tauri::command]
pub fn start_all(state: S, app_id: String) -> Result<(), String> {
    let (app, shell) = find_app(&state, &app_id)?;
    let rt = state.rt.clone();
    // In listed order, back to back, no waiting for output (BRS 15.1).
    std::thread::spawn(move || {
        for t in &app.terminals {
            rt.start(&app.id, &app.root, t, &shell);
        }
    });
    Ok(())
}

fn stop_many(rt: &Arc<Runtime>, ids: Vec<String>) -> Vec<std::thread::JoinHandle<()>> {
    ids.into_iter()
        .filter_map(|id| rt.get(&id))
        .filter(|t| t.state().can_stop())
        .map(|t| {
            let rt = rt.clone();
            std::thread::spawn(move || rt.stop(&t))
        })
        .collect()
}

#[tauri::command]
pub fn stop_all(state: S, app_id: String) -> Result<(), String> {
    let (app, _) = find_app(&state, &app_id)?;
    let rt = state.rt.clone();
    let ids: Vec<String> = app.terminals.iter().map(|t| t.id.clone()).collect();
    std::thread::spawn(move || {
        for h in stop_many(&rt, ids) {
            let _ = h.join();
        }
    });
    Ok(())
}

#[tauri::command]
pub fn write_input(state: S, terminal_id: String, data: Vec<u8>) -> Result<(), String> {
    state.rt.write_input(&terminal_id, &data)
}

#[tauri::command]
pub fn resize(state: S, terminal_id: String, cols: u16, rows: u16) -> Result<(), String> {
    state.rt.resize(&terminal_id, cols, rows)
}

#[tauri::command]
pub fn attach(
    state: S,
    app_id: String,
    terminal_id: String,
    on_output: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    find_terminal(&state, &app_id, &terminal_id)?;
    state
        .rt
        .attach(&app_id, &terminal_id, Box::new(move |bytes| on_output.send(InvokeResponseBody::Raw(bytes)).is_ok()));
    Ok(())
}

#[tauri::command]
pub fn open_config_folder(state: S) -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(&state.config_dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open the folder: {e}"))
}

/// Stop everything (optionally) and exit. Runs on its own thread so the UI stays alive.
#[tauri::command]
pub fn quit_app(app: AppHandle, state: S, stop: bool) -> Result<(), String> {
    let rt = state.rt.clone();
    let st = state.inner().clone();
    std::thread::spawn(move || {
        if stop {
            let up = rt.up_app_ids();
            let _ = st.config.lock().set_last_running(up);
            let ids: Vec<String> = rt.all().iter().map(|t| t.id.clone()).collect();
            let handles = stop_many(&rt, ids);
            let (tx, rx) = std::sync::mpsc::channel::<()>();
            std::thread::spawn(move || {
                for h in handles {
                    let _ = h.join();
                }
                let _ = tx.send(());
            });
            let _ = rx.recv_timeout(Duration::from_secs(10));
        } else {
            let _ = st.config.lock().set_last_running(vec![]);
        }
        app.exit(0);
    });
    Ok(())
}

// ---- helpers for the add-app flow (pickers and autocomplete). Async so a slow
// disk or Docker never freezes the window.

#[tauri::command]
pub async fn detect_project(root: String) -> Vec<crate::detect::Suggestion> {
    let root = crate::paths::normalize_slashes(&root);
    tauri::async_runtime::spawn_blocking(move || crate::detect::detect_project(std::path::Path::new(&root)))
        .await
        .unwrap_or_default()
}

/// Every suggestion for one folder (all npm scripts, dotnet, compose, ...).
#[tauri::command]
pub async fn suggest_commands(folder: String) -> Vec<crate::detect::Suggestion> {
    let folder = crate::paths::normalize_slashes(&folder);
    tauri::async_runtime::spawn_blocking(move || crate::detect::folder_suggestions(std::path::Path::new(&folder), "."))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn list_subfolders(root: String) -> Vec<String> {
    let root = crate::paths::normalize_slashes(&root);
    tauri::async_runtime::spawn_blocking(move || crate::detect::list_subfolders(std::path::Path::new(&root)))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn docker_containers() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(crate::detect::docker_containers).await.unwrap_or_default()
}

// ---- home screen helpers

#[tauri::command]
pub fn set_favourite(state: S, app_id: String, favourite: bool) -> Result<(), String> {
    state.config.lock().set_favourite(&app_id, favourite)
}

/// Record that an app was opened or started (Recent list on the Home screen).
#[tauri::command]
pub fn touch_app(state: S, app_id: String) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    state.config.lock().touch_app(&app_id, now)
}

/// Which of these folders exist (for greying out recents whose folder is gone).
#[tauri::command]
pub async fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        paths.iter().map(|p| std::path::Path::new(&crate::paths::normalize_slashes(p)).is_dir()).collect()
    })
    .await
    .unwrap_or_default()
}

// ---- git (BRS 7.7). Every call runs on a worker thread; the folder is the app's root.

fn app_root(state: &AppState, app_id: &str) -> Result<PathBuf, String> {
    let (app, _) = find_app(state, app_id)?;
    let root = PathBuf::from(crate::paths::normalize_slashes(&app.root));
    if !root.is_dir() {
        return Err(crate::paths::missing_folder_message(&root));
    }
    Ok(root)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| format!("Git task failed: {e}"))?
}

#[tauri::command]
pub async fn git_info(state: S<'_>, app_id: String) -> Result<Option<crate::git::RepoInfo>, String> {
    let root = app_root(&state, &app_id)?;
    blocking(move || crate::git::repo_info(&root)).await
}

#[tauri::command]
pub async fn git_changes(state: S<'_>, app_id: String) -> Result<Vec<crate::git::FileChange>, String> {
    let root = app_root(&state, &app_id)?;
    blocking(move || crate::git::changes(&root)).await
}

#[tauri::command]
pub async fn git_branches(state: S<'_>, app_id: String) -> Result<crate::git::Branches, String> {
    let root = app_root(&state, &app_id)?;
    blocking(move || crate::git::branches(&root)).await
}

#[tauri::command]
pub async fn git_switch(state: S<'_>, app_id: String, branch: String) -> Result<(), String> {
    let root = app_root(&state, &app_id)?;
    blocking(move || crate::git::switch_branch(&root, &branch)).await
}

#[tauri::command]
pub async fn git_commit(state: S<'_>, app_id: String, paths: Vec<String>, message: String) -> Result<String, String> {
    let root = app_root(&state, &app_id)?;
    blocking(move || crate::git::commit(&root, &paths, &message)).await
}

#[tauri::command]
pub async fn git_log(state: S<'_>, app_id: String, limit: usize) -> Result<Vec<crate::git::CommitInfo>, String> {
    let root = app_root(&state, &app_id)?;
    blocking(move || crate::git::log(&root, limit)).await
}

#[tauri::command]
pub async fn git_commit_files(state: S<'_>, app_id: String, hash: String) -> Result<Vec<crate::git::CommitFile>, String> {
    let root = app_root(&state, &app_id)?;
    blocking(move || crate::git::commit_files(&root, &hash)).await
}

#[tauri::command]
pub async fn git_fetch(state: S<'_>, app_id: String) -> Result<String, String> {
    let root = app_root(&state, &app_id)?;
    blocking(move || crate::git::fetch(&root)).await
}

#[tauri::command]
pub async fn git_pull(state: S<'_>, app_id: String) -> Result<String, String> {
    let root = app_root(&state, &app_id)?;
    blocking(move || crate::git::pull(&root)).await
}

#[tauri::command]
pub async fn git_push(state: S<'_>, app_id: String) -> Result<String, String> {
    let root = app_root(&state, &app_id)?;
    blocking(move || crate::git::push(&root)).await
}

#[tauri::command]
pub async fn git_sync(state: S<'_>, app_id: String) -> Result<String, String> {
    let root = app_root(&state, &app_id)?;
    blocking(move || crate::git::sync(&root)).await
}

/// The shells installed on this machine (for the pickers).
#[tauri::command]
pub async fn list_shells() -> Vec<crate::shells::ShellInfo> {
    tauri::async_runtime::spawn_blocking(crate::shells::detect).await.unwrap_or_default()
}

/// Stop every running terminal (parallel, up to 10 s) after remembering which apps were up.
pub fn stop_everything(state: &Arc<AppState>) {
    let rt = state.rt.clone();
    let up = rt.up_app_ids();
    let _ = state.config.lock().set_last_running(up);
    let ids: Vec<String> = rt.all().iter().map(|t| t.id.clone()).collect();
    let handles = stop_many(&rt, ids);
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        for h in handles {
            let _ = h.join();
        }
        let _ = tx.send(());
    });
    let _ = rx.recv_timeout(Duration::from_secs(10));
}
