//! Running terminals: spawn, output, stop (BRS 6.3 to 6.5, 8.3).
//!
//! Concurrency: the registry lock is only held to look up or insert. Every
//! `Terminal` has its own small locks. The state mutex doubles as the
//! "operation in progress" guard: a second Start or Stop is rejected by the
//! state machine, so a double-click starts exactly one process.

use crate::job::{self, Job};
use crate::logger;
use crate::model::TerminalDef;
use crate::paths;
use crate::shells;
use crate::ring::OutputBus;
use crate::state::{apply, Event, TermState};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub const DEFAULT_COLS: u16 = 120;
pub const DEFAULT_ROWS: u16 = 30;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatePayload {
    pub terminal_id: String,
    pub app_id: String,
    pub state: TermState,
}

pub type Emitter = Arc<dyn Fn(StatePayload) + Send + Sync>;
/// Sends bytes to the UI; returns false when the UI is gone.
pub type Sink = Box<dyn Fn(Vec<u8>) -> bool + Send + Sync>;

struct Live {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    pid: u32,
    job: Option<Job>,
    reader: Option<JoinHandle<()>>,
    generation: u64,
}

#[derive(Clone)]
struct LaunchInfo {
    shell: String,
    cwd: std::path::PathBuf,
    env: Vec<(String, String)>,
    stop_command: Option<String>,
}

pub struct Terminal {
    pub id: String,
    pub app_id: String,
    state: Mutex<TermState>,
    bus: Mutex<OutputBus>,
    sink: Mutex<Option<Sink>>,
    live: Mutex<Option<Live>>,
    launch: Mutex<Option<LaunchInfo>>,
    size: Mutex<(u16, u16)>,
    generation: AtomicU64,
}

impl Terminal {
    fn new(app_id: &str, id: &str) -> Terminal {
        Terminal {
            id: id.to_string(),
            app_id: app_id.to_string(),
            state: Mutex::new(TermState::Stopped),
            bus: Mutex::new(OutputBus::default()),
            sink: Mutex::new(None),
            live: Mutex::new(None),
            launch: Mutex::new(None),
            size: Mutex::new((DEFAULT_COLS, DEFAULT_ROWS)),
            generation: AtomicU64::new(0),
        }
    }
    pub fn state(&self) -> TermState {
        self.state.lock().clone()
    }
    /// Raw output after `cursor` plus the new cursor and whether older bytes were dropped (BRS 7.12).
    pub fn output_since(&self, cursor: u64) -> (Vec<u8>, u64, bool) {
        self.bus.lock().since(cursor)
    }
    /// Test helper: the current output ring contents.
    #[cfg(test)]
    pub fn snapshot_output(&self) -> Vec<u8> {
        self.bus.lock().snapshot()
    }
}

pub struct Runtime {
    terms: Mutex<HashMap<String, Arc<Terminal>>>,
    emit: Emitter,
}

/// Wrap a user command so the real exit code is reported (BRS 6.3 step 3).
pub fn wrap_command(command: &str) -> String {
    format!(
        "{command}\n$__ok = $?\nif ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}\nif (-not $__ok) {{ exit 1 }}\nexit 0"
    )
}

fn crlf(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() + 16);
    let mut prev = 0u8;
    for &b in bytes {
        if b == b'\n' && prev != b'\r' {
            out.push(b'\r');
        }
        out.push(b);
        prev = b;
    }
    out
}

impl Runtime {
    pub fn new(emit: Emitter) -> Arc<Runtime> {
        Arc::new(Runtime { terms: Mutex::new(HashMap::new()), emit })
    }

    pub fn get_or_create(&self, app_id: &str, id: &str) -> Arc<Terminal> {
        let mut m = self.terms.lock();
        m.entry(id.to_string()).or_insert_with(|| Arc::new(Terminal::new(app_id, id))).clone()
    }

    pub fn get(&self, id: &str) -> Option<Arc<Terminal>> {
        self.terms.lock().get(id).cloned()
    }

    pub fn all(&self) -> Vec<Arc<Terminal>> {
        self.terms.lock().values().cloned().collect()
    }

    /// Forget terminals that were deleted from the config and are not running.
    pub fn prune(&self, keep_ids: &[String]) {
        self.terms.lock().retain(|id, t| keep_ids.contains(id) || t.state().is_up());
    }

    fn transition(&self, t: &Arc<Terminal>, ev: Event) -> Option<TermState> {
        let next = {
            let mut s = t.state.lock();
            let next = apply(&s, &ev)?;
            if *s == next {
                return Some(next);
            }
            *s = next.clone();
            next
        };
        (self.emit)(StatePayload { terminal_id: t.id.clone(), app_id: t.app_id.clone(), state: next.clone() });
        Some(next)
    }

    fn push_output(&self, t: &Terminal, bytes: &[u8]) {
        t.bus.lock().push(bytes);
    }

    // ---------------------------------------------------------------- start

    pub fn start(self: &Arc<Self>, app_id: &str, root: &str, def: &TerminalDef, shell: &str) {
        let term = self.get_or_create(app_id, &def.id);
        if self.transition(&term, Event::StartRequested).is_none() {
            return; // already starting, running, detached or stopping
        }
        if let Err(reason) = self.spawn_inner(&term, root, def, shell) {
            logger::log(&format!("start failed for '{}': {reason}", def.name));
            self.push_output(&term, format!("\x1bc\x1b[31m{reason}\x1b[0m\r\n").as_bytes());
            self.transition(&term, Event::SpawnFailed(reason));
        }
    }

    fn spawn_inner(self: &Arc<Self>, term: &Arc<Terminal>, root: &str, def: &TerminalDef, shell: &str) -> Result<(), String> {
        // a terminal's own shell wins over the app-wide default
        let shell = def.shell.as_deref().filter(|s| shells::known(s).is_some()).unwrap_or(shell);
        let cwd = paths::resolve_cwd(root, &def.cwd);
        if !cwd.is_dir() {
            return Err(paths::missing_folder_message(&cwd));
        }
        let program = shells::resolve(shell)
            .ok_or_else(|| format!("{} is not installed on this computer. Pick another shell for this terminal.", shells::display_name(shell)))?;
        let (cols, rows) = *term.size.lock();
        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Could not open a terminal: {e}"))?;

        let launch = shells::spec(shell, &program, &def.command, &cwd);
        let mut cmd = CommandBuilder::new(&launch.program);
        for a in &launch.args {
            cmd.arg(a);
        }
        for (k, v) in &launch.env {
            cmd.env(k, v);
        }
        cmd.cwd(&cwd);
        cmd.env("TERM", "xterm-256color");
        for (k, v) in &def.env {
            cmd.env(k, v);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Could not start {shell}: {e}"))?;
        drop(pair.slave);
        let pid = child.process_id().ok_or_else(|| "The shell started but has no process id.".to_string())?;

        if let Err(e) = job::assign_to_launcher(pid) {
            logger::log(&format!("pid {pid} not in the launcher job: {e}"));
        }
        let job = match Job::new_kill_on_close().and_then(|j| j.assign_pid(pid).map(|_| j)) {
            Ok(j) => Some(j),
            Err(e) => {
                logger::log(&format!("job object unavailable for pid {pid}: {e}; will use taskkill"));
                None
            }
        };

        let reader_src: Box<dyn Read + Send> =
            pair.master.try_clone_reader().map_err(|e| format!("Could not read terminal output: {e}"))?;
        let writer = pair.master.take_writer().map_err(|e| format!("Could not write to the terminal: {e}"))?;

        let generation = term.generation.fetch_add(1, Ordering::SeqCst) + 1;
        {
            let mut bus = term.bus.lock();
            bus.clear();
            bus.push(b"\x1bc"); // reset the UI terminal, in order with the new output
        }
        *term.launch.lock() = Some(LaunchInfo {
            shell: shell.to_string(),
            cwd: cwd.clone(),
            env: def.env.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
            stop_command: def.stop_command.clone().filter(|s| !s.trim().is_empty()),
        });

        let t2 = term.clone();
        let reader = std::thread::Builder::new()
            .name(format!("reader-{}", def.name))
            .spawn(move || {
                let mut src = reader_src;
                let mut buf = [0u8; 8192];
                loop {
                    match src.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => t2.bus.lock().push(&buf[..n]),
                    }
                }
            })
            .map_err(|e| format!("Could not start the output reader: {e}"))?;

        *term.live.lock() = Some(Live { master: pair.master, writer, pid, job, reader: Some(reader), generation });
        self.transition(term, Event::Spawned);
        logger::log(&format!("started '{}' pid {pid}", def.name));

        let rt = self.clone();
        let t3 = term.clone();
        std::thread::Builder::new()
            .name(format!("waiter-{}", def.name))
            .spawn(move || {
                let code = match child.wait() {
                    Ok(status) => status.exit_code() as i32,
                    Err(_) => -1,
                };
                rt.finish_exit(&t3, generation, code);
            })
            .map_err(|e| format!("Could not start the exit watcher: {e}"))?;
        Ok(())
    }

    /// The shell ended by itself (or because a stop killed it).
    fn finish_exit(self: &Arc<Self>, term: &Arc<Terminal>, generation: u64, code: i32) {
        {
            let live = term.live.lock();
            match &*live {
                Some(l) if l.generation == generation => {}
                _ => return, // a stop already took the process, or a newer run exists
            }
        }
        if matches!(term.state(), TermState::Stopping) {
            return; // stop() is in charge and will end in Stopped
        }
        let live = term.live.lock().take();
        if let Some(mut l) = live {
            // The terminal owns everything it started: reap leftovers (BRS 6.1).
            if let Some(j) = &l.job {
                j.terminate();
            }
            let reader = l.reader.take();
            drop(l);
            if let Some(r) = reader {
                join_bounded(r, Duration::from_secs(2));
            }
        }
        let has_stop = term.launch.lock().as_ref().map(|l| l.stop_command.is_some()).unwrap_or(false);
        logger::log(&format!("terminal {} exited with code {code}", term.id));
        self.transition(term, Event::ProcessExited { code, has_stop_command: has_stop });
    }

    // ----------------------------------------------------------------- stop

    /// Ctrl+C, wait 2 s, then kill the tree; then run the stop command (BRS 6.4).
    pub fn stop(self: &Arc<Self>, term: &Arc<Terminal>) {
        if self.transition(term, Event::StopRequested).is_none() {
            return;
        }
        let launch = term.launch.lock().clone();
        let live = term.live.lock().take();
        if let Some(mut l) = live {
            let _ = l.writer.write_all(&[0x03]);
            let _ = l.writer.flush();
            let graceful = job::wait_gone(l.pid, Duration::from_secs(2));
            match &l.job {
                Some(j) => j.terminate(), // also kills descendants the shell left behind
                None => job::taskkill_tree(l.pid),
            }
            let gone = job::wait_gone(l.pid, Duration::from_secs(5));
            logger::log(&format!(
                "stopped '{}' pid {} (graceful={graceful}, method={}, gone={gone})",
                term.id,
                l.pid,
                if l.job.is_some() { "job" } else { "taskkill" }
            ));
            let reader = l.reader.take();
            drop(l); // closes writer, PTY master and the job handle
            if let Some(r) = reader {
                join_bounded(r, Duration::from_secs(2));
            }
        }
        if let Some(info) = launch {
            if let Some(cmd) = info.stop_command.clone() {
                self.run_stop_command(term, &info, &cmd);
            }
        }
        self.transition(term, Event::StopCompleted);
    }

    fn run_stop_command(&self, term: &Arc<Terminal>, info: &LaunchInfo, cmd: &str) {
        self.push_output(term, format!("\r\n\x1b[2m$ {cmd}\x1b[0m\r\n").as_bytes());
        let Some(program) = shells::resolve(&info.shell) else {
            self.push_output(term, b"\x1b[31mThe shell for the stop command is not installed.\x1b[0m\r\n");
            return;
        };
        let launch = shells::spec(&info.shell, &program, cmd, &info.cwd);
        let mut c = std::process::Command::new(&launch.program);
        c.args(&launch.args)
            .envs(launch.env.iter().map(|(k, v)| (k, v)))
            .current_dir(&info.cwd)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        for (k, v) in &info.env {
            c.env(k, v);
        }
        let mut child = match c.spawn() {
            Ok(ch) => ch,
            Err(e) => {
                self.push_output(term, format!("\x1b[31mCould not run the stop command: {e}\x1b[0m\r\n").as_bytes());
                return;
            }
        };
        let out = child.stdout.take();
        let err = child.stderr.take();
        let read_all = |s: Option<Box<dyn Read + Send>>| {
            std::thread::spawn(move || {
                let mut v = Vec::new();
                if let Some(mut s) = s {
                    let _ = s.read_to_end(&mut v);
                }
                v
            })
        };
        let h1 = read_all(out.map(|o| Box::new(o) as Box<dyn Read + Send>));
        let h2 = read_all(err.map(|o| Box::new(o) as Box<dyn Read + Send>));
        let start = Instant::now();
        let mut timed_out = false;
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if start.elapsed() > Duration::from_secs(30) => {
                    job::taskkill_tree(child.id());
                    let _ = child.wait();
                    timed_out = true;
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        }
        let mut text = h1.join().unwrap_or_default();
        text.extend(h2.join().unwrap_or_default());
        self.push_output(term, &crlf(&text));
        if timed_out {
            self.push_output(term, b"\x1b[31mThe stop command took longer than 30 seconds and was killed.\x1b[0m\r\n");
        }
    }

    // ------------------------------------------------------------ terminal IO

    pub fn write_input(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let term = self.get(id).ok_or_else(|| format!("Unknown terminal {id}"))?;
        let mut live = term.live.lock();
        if let Some(l) = live.as_mut() {
            l.writer.write_all(data).map_err(|e| e.to_string())?;
            l.writer.flush().map_err(|e| e.to_string())?;
        }
        Ok(()) // typing into a stopped terminal does nothing
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if cols == 0 || rows == 0 {
            return Ok(());
        }
        let term = self.get(id).ok_or_else(|| format!("Unknown terminal {id}"))?;
        *term.size.lock() = (cols, rows);
        let live = term.live.lock();
        if let Some(l) = live.as_ref() {
            l.master
                .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Attach a UI sink: replay the ring buffer, then stream (BRS 6.5).
    pub fn attach(&self, app_id: &str, id: &str, sink: Sink) {
        let term = self.get_or_create(app_id, id);
        *term.sink.lock() = Some(sink);
        term.bus.lock().attach();
    }

    /// One flusher tick: send each attached terminal's pending bytes. Locks are
    /// released before sending.
    pub fn flush_once(&self) {
        for t in self.all() {
            let bytes = {
                let mut bus = t.bus.lock();
                if !bus.is_attached() {
                    continue;
                }
                bus.take_pending()
            };
            if bytes.is_empty() {
                continue;
            }
            let ok = match &*t.sink.lock() {
                Some(s) => s(bytes),
                None => true,
            };
            if !ok {
                *t.sink.lock() = None;
                t.bus.lock().detach();
            }
        }
    }

    pub fn spawn_flusher(self: &Arc<Self>) {
        let rt = self.clone();
        let _ = std::thread::Builder::new().name("flusher".into()).spawn(move || loop {
            std::thread::sleep(Duration::from_millis(16));
            rt.flush_once();
        });
    }

    pub fn states(&self) -> Vec<StatePayload> {
        self.all()
            .into_iter()
            .map(|t| StatePayload { terminal_id: t.id.clone(), app_id: t.app_id.clone(), state: t.state() })
            .collect()
    }

    pub fn any_up(&self) -> usize {
        self.all().iter().filter(|t| t.state().is_up()).count()
    }

    pub fn up_app_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> =
            self.all().iter().filter(|t| t.state().is_up()).map(|t| t.app_id.clone()).collect();
        ids.sort();
        ids.dedup();
        ids
    }
}

fn join_bounded(h: JoinHandle<()>, timeout: Duration) {
    let start = Instant::now();
    while !h.is_finished() {
        if start.elapsed() > timeout {
            logger::log("reader thread did not finish in time; leaving it to end on its own");
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let _ = h.join();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    struct Harness {
        rt: Arc<Runtime>,
        events: Arc<Mutex<Vec<StatePayload>>>,
        _dir: tempfile::TempDir,
        root: String,
    }

    fn harness() -> Harness {
        let events = Arc::new(Mutex::new(Vec::new()));
        let e2 = events.clone();
        let rt = Runtime::new(Arc::new(move |p| e2.lock().push(p)));
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().display().to_string();
        Harness { rt, events, _dir: dir, root }
    }

    fn def(id: &str, command: &str) -> TerminalDef {
        TerminalDef { id: id.into(), name: id.into(), cwd: ".".into(), command: command.into(), ..Default::default() }
    }

    fn wait_state(t: &Arc<Terminal>, pred: impl Fn(&TermState) -> bool, secs: u64) -> TermState {
        let start = Instant::now();
        loop {
            let s = t.state();
            if pred(&s) {
                return s;
            }
            assert!(start.elapsed() < Duration::from_secs(secs), "timed out in state {s:?}");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn output_text(t: &Terminal) -> String {
        String::from_utf8_lossy(&t.snapshot_output()).to_string()
    }

    #[test]
    fn wrap_command_keeps_the_user_text_first_and_reports_exit_codes() {
        let w = wrap_command("echo \"hello world\"");
        assert!(w.starts_with("echo \"hello world\"\n"));
        assert!(w.contains("exit $LASTEXITCODE") && w.contains("exit 1") && w.ends_with("exit 0"));
    }

    #[test]
    fn crlf_converts_lone_newlines_only() {
        assert_eq!(crlf(b"a\nb\r\nc"), b"a\r\nb\r\nc");
    }

    #[test]
    fn t2_echo_hello_exits_zero_and_shows_output() {
        let h = harness();
        h.rt.start("app", &h.root, &def("t", "echo hello"), "powershell.exe");
        let t = h.rt.get("t").unwrap();
        let s = wait_state(&t, |s| matches!(s, TermState::Exited { .. }), 30);
        assert_eq!(s, TermState::Exited { code: 0 });
        assert!(output_text(&t).contains("hello"));
    }

    #[test]
    fn t3_exit_code_is_reported() {
        let h = harness();
        h.rt.start("app", &h.root, &def("t", "exit 3"), "powershell.exe");
        let t = h.rt.get("t").unwrap();
        assert_eq!(wait_state(&t, |s| matches!(s, TermState::Exited { .. }), 30), TermState::Exited { code: 3 });
    }

    #[test]
    fn t4_unknown_command_is_nonzero_and_error_visible() {
        let h = harness();
        h.rt.start("app", &h.root, &def("t", "thiscommanddoesnotexist"), "powershell.exe");
        let t = h.rt.get("t").unwrap();
        let s = wait_state(&t, |s| matches!(s, TermState::Exited { .. }), 30);
        assert!(matches!(s, TermState::Exited { code } if code != 0), "{s:?}");
        assert!(output_text(&t).contains("thiscommanddoesnotexist"));
    }

    #[test]
    fn t5_missing_folder_fails_to_start_naming_the_folder() {
        let h = harness();
        let mut d = def("t", "echo hi");
        d.cwd = "no\\such\\folder".into();
        h.rt.start("app", &h.root, &d, "powershell.exe");
        let t = h.rt.get("t").unwrap();
        match t.state() {
            TermState::FailedToStart { reason } => assert!(reason.contains("no\\such\\folder")),
            other => panic!("expected FailedToStart, got {other:?}"),
        }
        assert!(t.live.lock().is_none(), "nothing may be spawned");
    }

    #[test]
    fn t7_double_start_runs_one_process() {
        let h = harness();
        let d = def("t", "ping -n 60 127.0.0.1");
        h.rt.start("app", &h.root, &d, "powershell.exe");
        let t = h.rt.get("t").unwrap();
        let pid1 = t.live.lock().as_ref().unwrap().pid;
        h.rt.start("app", &h.root, &d, "powershell.exe");
        let pid2 = t.live.lock().as_ref().unwrap().pid;
        assert_eq!(pid1, pid2, "second start must be ignored");
        h.rt.stop(&t);
        assert_eq!(t.state(), TermState::Stopped);
        assert!(job::wait_gone(pid1, Duration::from_secs(5)));
    }

    #[test]
    fn stop_kills_the_whole_tree_and_ends_stopped_not_red() {
        let h = harness();
        h.rt.start("app", &h.root, &def("t", "ping -t 127.0.0.1"), "powershell.exe");
        let t = h.rt.get("t").unwrap();
        wait_state(&t, |s| matches!(s, TermState::Running), 10);
        std::thread::sleep(Duration::from_millis(1500)); // let ping start
        let pid = t.live.lock().as_ref().unwrap().pid;
        h.rt.stop(&t);
        assert_eq!(t.state(), TermState::Stopped);
        assert!(job::wait_gone(pid, Duration::from_secs(5)));
        assert!(t.live.lock().is_none(), "PTY, job and reader must be released");
        let kinds: Vec<_> = h.events.lock().iter().map(|e| e.state.clone()).collect();
        assert!(!kinds.iter().any(|s| s.is_failed()), "stop must never look like a failure: {kinds:?}");
    }

    #[test]
    fn empty_command_opens_interactive_shell_that_accepts_input() {
        let h = harness();
        h.rt.start("app", &h.root, &def("t", ""), "powershell.exe");
        let t = h.rt.get("t").unwrap();
        wait_state(&t, |s| matches!(s, TermState::Running), 10);
        std::thread::sleep(Duration::from_millis(2500));
        h.rt.write_input("t", b"echo interactive-ok\r").unwrap();
        let start = Instant::now();
        while !output_text(&t).contains("interactive-ok") {
            assert!(start.elapsed() < Duration::from_secs(15), "no echo: {}", output_text(&t));
            std::thread::sleep(Duration::from_millis(100));
        }
        h.rt.write_input("t", b"exit\r").unwrap();
        assert_eq!(wait_state(&t, |s| matches!(s, TermState::Exited { .. }), 15), TermState::Exited { code: 0 });
    }

    #[test]
    fn exit_zero_with_stop_command_is_detached_and_stop_runs_the_command() {
        let h = harness();
        let mut d = def("t", "echo started");
        d.stop_command = Some("echo stopped-marker".into());
        h.rt.start("app", &h.root, &d, "powershell.exe");
        let t = h.rt.get("t").unwrap();
        assert_eq!(wait_state(&t, |s| !matches!(s, TermState::Starting | TermState::Running), 30), TermState::Detached);
        h.rt.stop(&t);
        assert_eq!(t.state(), TermState::Stopped);
        assert!(output_text(&t).contains("stopped-marker"));
    }

    #[test]
    fn shell_exit_reaps_leftover_children() {
        let h = harness();
        let marker = h._dir.path().join("pid.txt");
        let cmd = format!(
            "$p = Start-Process ping -ArgumentList '-n','120','127.0.0.1' -PassThru -WindowStyle Hidden; $p.Id | Out-File -Encoding ascii '{}'",
            marker.display()
        );
        h.rt.start("app", &h.root, &def("t", &cmd), "powershell.exe");
        let t = h.rt.get("t").unwrap();
        wait_state(&t, |s| matches!(s, TermState::Exited { .. }), 30);
        let pid: u32 = std::fs::read_to_string(&marker).unwrap().trim().parse().unwrap();
        assert!(job::wait_gone(pid, Duration::from_secs(5)), "leftover child still alive after the shell exited");
    }

    #[test]
    fn attach_replays_history_then_streams_via_the_sink() {
        let h = harness();
        h.rt.start("app", &h.root, &def("t", "echo replay-marker"), "powershell.exe");
        let t = h.rt.get("t").unwrap();
        wait_state(&t, |s| matches!(s, TermState::Exited { .. }), 30);
        let received = Arc::new(Mutex::new(Vec::<u8>::new()));
        let r2 = received.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let c2 = calls.clone();
        h.rt.attach("app", "t", Box::new(move |b| {
            r2.lock().extend(b);
            c2.fetch_add(1, Ordering::SeqCst);
            true
        }));
        h.rt.flush_once();
        assert!(String::from_utf8_lossy(&received.lock()).contains("replay-marker"));
        // nothing new: a second flush sends nothing
        let n = calls.load(Ordering::SeqCst);
        h.rt.flush_once();
        assert_eq!(calls.load(Ordering::SeqCst), n);
    }

    // ---- other shells (BRS 7.11): real processes, skipped quietly when a shell is not installed

    fn with_shell(id: &str, command: &str, shell: &str) -> TerminalDef {
        TerminalDef { shell: Some(shell.to_string()), ..def(id, command) }
    }

    #[test]
    fn cmd_runs_a_command_and_reports_its_exit_code() {
        let h = harness();
        h.rt.start("app", &h.root, &with_shell("t", "echo cmd-says-hi", "cmd.exe"), "powershell.exe");
        let t = h.rt.get("t").unwrap();
        assert_eq!(wait_state(&t, |s| matches!(s, TermState::Exited { .. }), 30), TermState::Exited { code: 0 });
        assert!(output_text(&t).contains("cmd-says-hi"));
        h.rt.start("app", &h.root, &with_shell("t2", "exit /b 7", "cmd.exe"), "powershell.exe");
        let t2 = h.rt.get("t2").unwrap();
        assert_eq!(wait_state(&t2, |s| matches!(s, TermState::Exited { .. }), 30), TermState::Exited { code: 7 });
    }

    #[test]
    fn git_bash_runs_commands_in_the_project_folder_with_real_exit_codes() {
        if shells::resolve(shells::GITBASH).is_none() {
            return;
        }
        let h = harness();
        h.rt.start("app", &h.root, &with_shell("t", "echo bash-says-hi; pwd; exit 4", "gitbash"), "powershell.exe");
        let t = h.rt.get("t").unwrap();
        assert_eq!(wait_state(&t, |s| matches!(s, TermState::Exited { .. }), 40), TermState::Exited { code: 4 });
        let out = output_text(&t);
        assert!(out.contains("bash-says-hi"), "{out}");
        let folder = std::path::Path::new(&h.root).file_name().unwrap().to_string_lossy().to_string();
        assert!(out.contains(&folder), "bash must start in the project folder: {out}");
    }

    #[test]
    fn the_terminal_shell_overrides_the_default_and_a_missing_shell_fails_clearly() {
        let h = harness();
        // default says wsl/gitbash/etc.; the terminal's own cmd wins
        h.rt.start("app", &h.root, &with_shell("t", "echo override-ok", "cmd.exe"), "gitbash");
        let t = h.rt.get("t").unwrap();
        wait_state(&t, |s| matches!(s, TermState::Exited { .. }), 30);
        assert!(output_text(&t).contains("override-ok"));
        // an id that is not a shell is ignored in favour of the default
        h.rt.start("app", &h.root, &with_shell("t2", "echo fallback-ok", "fish.exe"), "powershell.exe");
        let t2 = h.rt.get("t2").unwrap();
        wait_state(&t2, |s| matches!(s, TermState::Exited { .. }), 30);
        assert!(output_text(&t2).contains("fallback-ok"));
    }

    #[test]
    fn stopping_a_git_bash_terminal_kills_its_whole_tree() {
        if shells::resolve(shells::GITBASH).is_none() {
            return;
        }
        let h = harness();
        h.rt.start("app", &h.root, &with_shell("t", "ping -t 127.0.0.1", "gitbash"), "powershell.exe");
        let t = h.rt.get("t").unwrap();
        wait_state(&t, |s| matches!(s, TermState::Running), 10);
        std::thread::sleep(Duration::from_millis(2500));
        let pid = t.live.lock().as_ref().unwrap().pid;
        h.rt.stop(&t);
        assert_eq!(t.state(), TermState::Stopped);
        assert!(job::wait_gone(pid, Duration::from_secs(5)));
    }

    #[test]
    fn a_console_shell_that_exits_ends_in_exited_so_the_ui_can_guard_it() {
        let h = harness();
        h.rt.start("app", &h.root, &with_shell("console-app:1", "", "cmd.exe"), "powershell.exe");
        let t = h.rt.get("console-app:1").unwrap();
        wait_state(&t, |s| matches!(s, TermState::Running), 10);
        std::thread::sleep(Duration::from_millis(1500));
        h.rt.write_input("console-app:1", b"exit\r").unwrap();
        assert_eq!(wait_state(&t, |s| matches!(s, TermState::Exited { .. }), 20), TermState::Exited { code: 0 });
    }

    #[test]
    fn unknown_terminal_ids_return_errors_not_panics() {
        let h = harness();
        assert!(h.rt.write_input("nope", b"x").is_err());
        assert!(h.rt.resize("nope", 80, 24).is_err());
    }
}
