#![cfg(windows)]

mod ansi;
mod brief;
mod commands;
mod config;
mod detect;
mod editor;
mod editor_cmds;
mod engine;
mod git;
mod ipc;
mod job;
mod logger;
mod model;
mod paths;
mod ready;
mod ring;
mod runtime;
mod shells;
mod state;
mod update;

use commands::AppState;
use parking_lot::Mutex;
use runtime::Runtime;
use std::sync::Arc;
use tauri::{Emitter, Manager, WindowEvent};

#[derive(Clone, serde::Serialize)]
struct CloseRequested {
    running: usize,
}

pub fn run() {
    tauri::Builder::default()
        // Single instance first: a second launch focuses the first window (BRS 6.8).
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // `lcmd` starting the engine again with --background must not pop the window up
            if args.iter().any(|a| a == "--background") {
                return;
            }
            // "Edit with Lite Commander" from Explorer while the app is already running
            for f in editor::files_from_args(&args) {
                let _ = app.emit("editor-open", f);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            logger::init(&dir);
            let job_result = if std::env::var_os("LITE_COMMANDER_NO_JOB").is_some() {
                Err("disabled by LITE_COMMANDER_NO_JOB".to_string())
            } else {
                job::init_launcher_job()
            };
            let job_warning = match job_result {
                Ok(()) => None,
                Err(e) => {
                    logger::log(&format!("launcher job unavailable: {e}"));
                    Some("Crash cleanup is unavailable in this environment: if the launcher crashes, terminals may keep running.".to_string())
                }
            };
            let config = config::ConfigStore::load(&dir);
            let handle = app.handle().clone();
            let rt = Runtime::new(Arc::new(move |payload| {
                let _ = handle.emit("terminal-state", payload);
            }));
            rt.spawn_flusher();
            let state = Arc::new(AppState { config: Mutex::new(config), rt, config_dir: dir.clone(), job_warning });
            app.manage(state.clone());
            app.manage(editor_cmds::new_state(&dir, &std::env::args().collect::<Vec<_>>()));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_title(&model::window_title(env!("CARGO_PKG_VERSION")));
                // `lcmd` starts the app hidden when nothing is running yet (BRS 7.12)
                if std::env::args().any(|a| a == "--background") {
                    let _ = w.hide();
                }
            }
            // control channel for lcmd and the MCP server
            let exit_handle = app.handle().clone();
            let exit_state = state.clone();
            let quit: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
                commands::stop_everything(&exit_state);
                ipc::cleanup(&exit_state.config_dir);
                exit_handle.exit(0);
            });
            let engine = Arc::new(engine::Engine::new(state.clone(), quit));
            let (hook_state, hook_app) = (state, app.handle().clone());
            engine.set_update_hook(Arc::new(move |installer| commands::apply_and_exit(&hook_state, &hook_app, &installer)));
            match ipc::start(engine, &dir) {
                Ok(h) => logger::log(&format!("control channel on 127.0.0.1:{}", h.port)),
                Err(e) => logger::log(&format!("control channel unavailable: {e}")),
            }
            logger::log(&format!("launcher started, version {}", env!("CARGO_PKG_VERSION")));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let Some(state) = window.app_handle().try_state::<Arc<AppState>>() else { return };
                let running = state.rt.any_up();
                if running == 0 {
                    let _ = state.config.lock().set_last_running(vec![]);
                    return; // nothing running: close normally
                }
                api.prevent_close();
                let _ = window.emit("close-requested", CloseRequested { running });
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_apps,
            commands::set_theme,
            commands::set_shell,
            commands::set_last_running,
            commands::ack_config,
            commands::terminal_states,
            commands::start_terminal,
            commands::stop_terminal,
            commands::restart_terminal,
            commands::start_all,
            commands::stop_all,
            commands::write_input,
            commands::resize,
            commands::attach,
            commands::open_config_folder,
            commands::quit_app,
            commands::detect_project,
            commands::suggest_commands,
            commands::list_subfolders,
            commands::docker_containers,
            commands::set_favourite,
            commands::touch_app,
            commands::paths_exist,
            commands::git_info,
            commands::git_changes,
            commands::git_branches,
            commands::git_switch,
            commands::git_commit,
            commands::git_log,
            commands::git_commit_files,
            commands::git_fetch,
            commands::git_pull,
            commands::git_push,
            commands::git_sync,
            commands::list_shells,
            commands::set_update_settings,
            commands::check_update,
            commands::download_update,
            commands::apply_update,
            editor_cmds::editor_list,
            editor_cmds::editor_open,
            editor_cmds::editor_new,
            editor_cmds::editor_load,
            editor_cmds::editor_snapshot,
            editor_cmds::editor_save,
            editor_cmds::editor_close,
            editor_cmds::editor_restore,
            editor_cmds::editor_discard,
            editor_cmds::editor_take_pending,
            editor_cmds::editor_touch,
            editor_cmds::editor_open_any,
            editor_cmds::editor_load_any,
            editor_cmds::editor_save_any,
            editor_cmds::editor_read_bytes,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            logger::log(&format!("fatal: {e}"));
        });
}
