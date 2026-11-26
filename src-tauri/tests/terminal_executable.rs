//! R11: every terminal carries an executable flag, on by default, and the window's bulk actions
//! only include the executable ones. The bulk actions (start_all / stop_all) filter through the
//! same `AppDef::executable_terminals` set proven here.

use parking_lot::Mutex;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tinkerdeck_lib::commands::{self, AppState};
use tinkerdeck_lib::config::ConfigStore;
use tinkerdeck_lib::model::{AppDef, Config, TerminalDef};
use tinkerdeck_lib::runtime::Runtime;

fn terminal(id: &str, executable: Option<bool>) -> String {
    match executable {
        Some(value) => format!(r#"{{"id":"{id}","name":"{id}","executable":{value}}}"#),
        None => format!(r#"{{"id":"{id}","name":"{id}"}}"#),
    }
}

#[test]
fn r11_a_saved_terminal_without_the_flag_loads_as_executable() {
    let config: Config = serde_json::from_str(&format!(
        r#"{{"version":1,"apps":[{{"id":"a","name":"A","terminals":[{}]}}]}}"#,
        terminal("t", None)
    ))
    .expect("config parses");
    assert!(config.apps[0].terminals[0].executable);
    assert!(TerminalDef::default().executable);
}

#[test]
fn r11_start_all_and_stop_all_skip_non_executable_terminals() {
    let config: Config = serde_json::from_str(&format!(
        r#"{{"version":1,"apps":[{{"id":"a","name":"A","terminals":[{},{},{}]}}]}}"#,
        terminal("one", None),
        terminal("skipped", Some(false)),
        terminal("three", Some(true))
    ))
    .expect("config parses");
    let included: Vec<&str> = config.apps[0]
        .executable_terminals()
        .map(|t| t.id.as_str())
        .collect();
    assert_eq!(included, vec!["one", "three"]);
}

#[test]
fn r11_when_every_terminal_is_non_executable_the_bulk_action_has_nothing_to_do() {
    let app = AppDef {
        id: "a".into(),
        name: "A".into(),
        terminals: vec![
            TerminalDef {
                id: "one".into(),
                executable: false,
                ..Default::default()
            },
            TerminalDef {
                id: "two".into(),
                executable: false,
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    assert_eq!(app.executable_terminals().count(), 0);
}

#[test]
fn r11_the_flag_is_saved_so_it_survives_a_restart() {
    let mut terminal = TerminalDef {
        id: "one".into(),
        name: "One".into(),
        ..Default::default()
    };
    terminal.executable = false;
    let saved = serde_json::to_string(&terminal).expect("terminal serialises");
    assert!(saved.contains(r#""executable":false"#));
    let read: TerminalDef = serde_json::from_str(&saved).expect("terminal parses");
    assert!(!read.executable);
}

// ---------------------------------------------------------------------------------------------
// R11 at the command level. `commands::start_all` and `commands::stop_all` are thin wrappers over
// `start_all_in` / `stop_all_in`; the executable filter lives in those two functions, so these
// tests drive the real bulk loops with a real `AppState` and `Runtime`. Reverting either loop to
// `app.terminals` makes them fail. The launch-time restore calls the same `start_all`, so it is
// covered too.

struct BulkHarness {
    state: Arc<AppState>,
    rt: Arc<Runtime>,
    _cfg: tempfile::TempDir,
    _root: tempfile::TempDir,
}

fn bulk_terminal(id: &str, executable: bool, command: &str) -> TerminalDef {
    TerminalDef {
        id: id.into(),
        name: id.into(),
        cwd: ".".into(),
        command: command.into(),
        shell: Some("powershell.exe".into()),
        executable,
        ..Default::default()
    }
}

fn bulk_harness(terminals: Vec<TerminalDef>) -> BulkHarness {
    let cfg = tempfile::tempdir().expect("config temp dir");
    let root = tempfile::tempdir().expect("root temp dir");
    let mut store = ConfigStore::load(cfg.path());
    store
        .set_apps(vec![AppDef {
            id: "app-1".into(),
            name: "Shop".into(),
            root: root.path().display().to_string(),
            terminals,
            ..Default::default()
        }])
        .expect("save the app");
    let rt = Runtime::new(Arc::new(|_| {}));
    let state = Arc::new(AppState {
        config: Mutex::new(store),
        rt: rt.clone(),
        config_dir: cfg.path().to_path_buf(),
        job_warning: None,
    });
    BulkHarness {
        state,
        rt,
        _cfg: cfg,
        _root: root,
    }
}

fn wait_until(mut pred: impl FnMut() -> bool, secs: u64, what: &str) {
    let start = Instant::now();
    while !pred() {
        assert!(
            start.elapsed() < Duration::from_secs(secs),
            "timed out waiting for {what}"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn r11_start_all_command_starts_executable_terminals_and_skips_non_executable_ones() {
    let h = bulk_harness(vec![
        bulk_terminal("run", true, "exit 0"),
        bulk_terminal("skipped", false, "exit 0"),
    ]);

    commands::start_all_in(&h.state, "app-1").expect("start_all is accepted");

    // The executable terminal is created and started by the bulk loop.
    wait_until(
        || h.rt.get("run").is_some(),
        30,
        "the executable terminal to start",
    );
    // A non-executable terminal is never created or started, even after the executable one runs
    // to completion (the loop has already moved past it by then).
    let deadline = Instant::now() + Duration::from_millis(750);
    while Instant::now() < deadline {
        assert!(
            h.rt.get("skipped").is_none(),
            "start_all must not start a non-executable terminal"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn r11_stop_all_command_stops_executable_terminals_and_leaves_a_hand_started_non_executable_one_running(
) {
    let h = bulk_harness(vec![
        bulk_terminal("run", true, "ping -n 60 127.0.0.1"),
        bulk_terminal("manual", false, "ping -n 60 127.0.0.1"),
    ]);
    let (app, shell) = {
        let cfg = h.state.config.lock();
        let c = cfg.config();
        let app = c
            .apps
            .iter()
            .find(|a| a.id == "app-1")
            .expect("the app is saved")
            .clone();
        (app, c.shell.clone())
    };
    // Both are started on their own, as their own Start buttons would.
    for t in &app.terminals {
        h.rt.start(&app.id, &app.root, t, &shell);
    }
    wait_until(|| h.rt.any_up() == 2, 30, "both terminals to be running");

    commands::stop_all_in(&h.state, "app-1").expect("stop_all is accepted");

    // The executable terminal is stopped; the hand-started non-executable one keeps running.
    wait_until(
        || h.rt.get("run").map(|t| !t.state().is_up()).unwrap_or(false),
        30,
        "the executable terminal to stop",
    );
    assert!(
        h.rt.get("manual")
            .expect("the manual terminal exists")
            .state()
            .is_up(),
        "a hand-started non-executable terminal must survive Stop all"
    );

    // Tidy up the terminal the test started by hand.
    if let Some(t) = h.rt.get("manual") {
        h.rt.stop(&t);
    }
}
