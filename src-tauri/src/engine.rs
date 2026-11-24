//! The engine behind `tdk` and the MCP server (BRS 7.12): small, cheap, LLM-friendly methods over
//! the same runtime the window uses. Every method takes and returns JSON, never panics, and caps
//! its output so a model never pays for megabytes of log.

use crate::ansi;
use crate::brief;
use crate::ready;
use crate::commands::AppState;
use crate::detect;
use crate::git;
use crate::job;
use crate::model::{console_def_with_id, console_id, AppDef, TerminalDef};
use crate::paths;
use crate::shells;
use crate::state::TermState;
use serde_json::{json, Value};
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::sync::Arc;
use std::time::{Duration, Instant};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_CHARS: usize = 12_000;
const DEFAULT_LINES: usize = 60;
const MAX_LINES: usize = 1000;
const MAX_WAIT_S: u64 = 600;

type UpdateHook = Arc<dyn Fn(std::path::PathBuf) + Send + Sync>;
type UpdateSource = (String, String, Vec<String>);

pub struct Engine {
    state: Arc<AppState>,
    quit: Arc<dyn Fn() + Send + Sync>,
    /// Called with the verified installer once an update is confirmed (stops terminals, starts it, exits).
    update_hook: parking_lot::Mutex<Option<UpdateHook>>,
    /// Where to look for updates; `None` = the official release (tests point it at a local server).
    update_source: parking_lot::Mutex<Option<UpdateSource>>,
}

pub fn state_str(s: &TermState) -> String {
    match s {
        TermState::Stopped => "stopped".into(),
        TermState::Starting => "starting".into(),
        TermState::Running => "running".into(),
        TermState::Detached => "detached".into(),
        TermState::Stopping => "stopping".into(),
        TermState::Exited { code } => format!("exited:{code}"),
        TermState::FailedToStart { reason } => format!("failed:{reason}"),
    }
}

fn param<'a>(p: &'a Value, key: &str) -> Option<&'a str> {
    p.get(key).and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty())
}

fn need<'a>(p: &'a Value, key: &str) -> Result<&'a str, String> {
    param(p, key).ok_or_else(|| format!("Missing \"{key}\"."))
}

fn num(p: &Value, key: &str, default: u64) -> u64 {
    p.get(key).and_then(|v| v.as_u64()).unwrap_or(default)
}

fn flag(p: &Value, key: &str, default: bool) -> bool {
    p.get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

/// Exact id, exact name (any case), or a unique name prefix.
fn pick<'a, T>(items: &'a [T], q: &str, id: impl Fn(&T) -> &str, name: impl Fn(&T) -> &str) -> Result<&'a T, Vec<String>> {
    if let Some(i) = items.iter().find(|i| id(i) == q) {
        return Ok(i);
    }
    let ql = q.to_lowercase();
    let exact: Vec<&T> = items.iter().filter(|i| name(i).to_lowercase() == ql).collect();
    if exact.len() == 1 {
        return Ok(exact[0]);
    }
    let pre: Vec<&T> = items.iter().filter(|i| name(i).to_lowercase().starts_with(&ql)).collect();
    if exact.is_empty() && pre.len() == 1 {
        return Ok(pre[0]);
    }
    Err(items.iter().map(|i| name(i).to_string()).collect())
}

impl Engine {
    pub fn new(state: Arc<AppState>, quit: Arc<dyn Fn() + Send + Sync>) -> Engine {
        Engine { state, quit, update_hook: parking_lot::Mutex::new(None), update_source: parking_lot::Mutex::new(None) }
    }

    pub fn set_update_hook(&self, hook: UpdateHook) {
        *self.update_hook.lock() = Some(hook);
    }

    #[cfg(test)]
    pub(crate) fn set_update_source(&self, base: &str, pubkey: &str, prefixes: Vec<String>) {
        *self.update_source.lock() = Some((base.to_string(), pubkey.to_string(), prefixes));
    }

    fn source(&self) -> UpdateSource {
        self.update_source.lock().clone().unwrap_or_else(|| (crate::update::base_url(), crate::update::PUBLIC_KEY_B64.to_string(), crate::update::allowed_prefixes()))
    }

    // ------------------------------------------------------------ resolution

    fn apps(&self) -> (Vec<AppDef>, String) {
        let c = self.state.config.lock();
        (c.config().apps.clone(), c.config().shell.clone())
    }

    fn app(&self, p: &Value) -> Result<(AppDef, String), String> {
        let q = need(p, "app")?;
        let (apps, shell) = self.apps();
        match pick(&apps, q, |a| a.id.as_str(), |a| a.name.as_str()) {
            Ok(a) => Ok((a.clone(), shell)),
            Err(names) if names.is_empty() => Err("There are no apps yet. Add one with app.add.".into()),
            Err(names) => Err(format!("No single app matches \"{q}\". Apps: {}.", names.join(", "))),
        }
    }

    /// A saved terminal by id/name, or a console: `console`, `console:2`, optionally with a `shell` param.
    fn terminal(&self, app: &AppDef, p: &Value) -> Result<TerminalDef, String> {
        let q = need(p, "terminal")?;
        let ql = q.to_lowercase();
        if ql == "console" || ql.starts_with("console:") {
            let n: u32 = ql.strip_prefix("console:").and_then(|n| n.parse().ok()).unwrap_or(1);
            let id = match param(p, "shell").filter(|s| shells::known(s).is_some()) {
                Some(sh) => format!("{}:{n}:{sh}", console_id(&app.id)),
                None => format!("{}:{n}", console_id(&app.id)),
            };
            return Ok(console_def_with_id(&id));
        }
        match pick(&app.terminals, q, |t| t.id.as_str(), |t| t.name.as_str()) {
            Ok(t) => Ok(t.clone()),
            Err(names) if names.is_empty() => Err(format!("{} has no terminals. Use \"console\" for a shell.", app.name)),
            Err(names) => Err(format!("No single terminal matches \"{q}\" in {}. Terminals: {}, console.", app.name, names.join(", "))),
        }
    }

    fn root(&self, app: &AppDef) -> Result<std::path::PathBuf, String> {
        let root = std::path::PathBuf::from(paths::normalize_slashes(&app.root));
        if root.is_dir() {
            Ok(root)
        } else {
            Err(paths::missing_folder_message(&root))
        }
    }

    // ---------------------------------------------------------------- dispatch

    pub fn call(&self, method: &str, p: &Value) -> Result<Value, String> {
        match method {
            "ping" => Ok(json!({ "ok": true, "version": env!("CARGO_PKG_VERSION"), "pid": std::process::id() })),
            "status" => self.status(p),
            "shells" => Ok(json!(shells::detect().into_iter().map(|s| json!({ "id": s.id, "name": s.name })).collect::<Vec<_>>())),
            "app.up" => self.up(p),
            "app.down" => self.down(p),
            "app.add" => self.add(p),
            "app.detect" => self.detect(p),
            "term.start" => self.term_start(p, false),
            "term.restart" => self.term_start(p, true),
            "term.stop" => self.term_stop(p),
            "term.logs" => self.logs(p),
            "term.wait" => self.wait(p),
            "term.send" => self.send(p),
            "update.check" => self.update_check(),
            "update.apply" => self.update_apply(p),
            "run" => self.run(p),
            m if m.starts_with("git.") => self.git(&m[4..], p),
            "quit" => {
                let q = self.quit.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(200)); // let the reply go out first
                    q();
                });
                Ok(json!({ "ok": true }))
            }
            other => Err(format!("Unknown method \"{other}\".")),
        }
    }

    // ------------------------------------------------------------------ status

    fn status(&self, p: &Value) -> Result<Value, String> {
        let with_git = flag(p, "git", false);
        let (apps, _) = self.apps();
        let rt = &self.state.rt;
        let out: Vec<Value> = apps
            .iter()
            .map(|a| {
                let states: Vec<TermState> = a.terminals.iter().map(|t| rt.get(&t.id).map(|x| x.state()).unwrap_or(TermState::Stopped)).collect();
                let up = states.iter().filter(|s| s.is_up()).count();
                let failed = states.iter().any(|s| matches!(s, TermState::FailedToStart { .. }) || matches!(s, TermState::Exited { code } if *code != 0));
                let overall = if failed {
                    "failed"
                } else if !states.is_empty() && up == states.len() {
                    "running"
                } else if up > 0 {
                    "partial"
                } else {
                    "stopped"
                };
                let terms: Vec<Value> = a.terminals.iter().zip(&states).map(|(t, s)| json!({ "name": t.name, "state": state_str(s) })).collect();
                let consoles: Vec<Value> = rt
                    .all()
                    .iter()
                    .filter(|t| t.app_id == a.id && crate::model::console_app_id(&t.id) == Some(a.id.as_str()) && t.state().is_up())
                    .map(|t| json!({ "id": t.id, "state": state_str(&t.state()) }))
                    .collect();
                let mut v = json!({ "app": a.name, "state": overall, "terminals": terms });
                if !consoles.is_empty() {
                    v["consoles"] = json!(consoles);
                }
                if with_git {
                    if let Ok(Some(i)) = git::repo_info(std::path::Path::new(&paths::normalize_slashes(&a.root))) {
                        v["git"] = json!({ "branch": i.branch.or_else(|| i.head.map(|h| format!("detached@{h}"))), "dirty": i.dirty, "ahead": i.ahead, "behind": i.behind });
                    }
                }
                v
            })
            .collect();
        let apps = json!(out);
        // with `since` present the reply carries a revision; the same revision means "nothing changed"
        let Some(since) = p.get("since") else { return Ok(apps) };
        let rev = revision(&apps);
        if since.as_str() == Some(rev.as_str()) {
            return Ok(json!({ "unchanged": true, "rev": rev }));
        }
        Ok(json!({ "rev": rev, "apps": apps }))
    }

    // ------------------------------------------------------------ app actions

    fn up(&self, p: &Value) -> Result<Value, String> {
        let (app, shell) = self.app(p)?;
        self.root(&app)?;
        let began = Instant::now();
        for t in &app.terminals {
            self.state.rt.start(&app.id, &app.root, t, &shell); // in listed order, back to back
        }
        let _ = self.state.config.lock().touch_app(&app.id, now());
        if !flag(p, "wait", false) {
            return Ok(self.terminal_states(&app));
        }
        let timeout = Duration::from_secs(num(p, "timeout_s", 120).clamp(1, MAX_WAIT_S));
        self.wait_until_ready(&app, began, timeout)
    }

    /// Wait until every terminal is ready: its pattern appeared, its local URL answers, or (with no
    /// check configured) it has stayed running for two seconds. A terminal that fails ends the wait at once.
    fn wait_until_ready(&self, app: &AppDef, began: Instant, timeout: Duration) -> Result<Value, String> {
        const SETTLE: Duration = Duration::from_secs(2);
        let rt = &self.state.rt;
        let report = |ready: bool, failed: Option<&str>| {
            let terms: Vec<Value> = app
                .terminals
                .iter()
                .map(|t| {
                    let term = rt.get(&t.id);
                    let st = term.as_ref().map(|x| x.state()).unwrap_or(TermState::Stopped);
                    let text = term.as_ref().map(|x| ansi::strip_ansi(&x.output_since(0).0)).unwrap_or_default();
                    let ok = self.is_ready(t, &st, &text, began, SETTLE).0;
                    let mut v = json!({ "name": t.name, "state": state_str(&st), "ready": ok });
                    if !ok && !text.trim().is_empty() {
                        v["tail"] = json!(brief::brief(&text, match st { TermState::Exited { code } => Some(code), _ => None }, false));
                    }
                    v
                })
                .collect();
            let mut out = json!({ "ready": ready, "elapsed_ms": began.elapsed().as_millis() as u64, "terminals": terms });
            if let Some(f) = failed {
                out["failed"] = json!(f);
            }
            out
        };
        loop {
            let mut all = true;
            for t in &app.terminals {
                let term = rt.get(&t.id);
                let st = term.as_ref().map(|x| x.state()).unwrap_or(TermState::Stopped);
                let text = term.as_ref().map(|x| ansi::strip_ansi(&x.output_since(0).0)).unwrap_or_default();
                let (ok, failed) = self.is_ready(t, &st, &text, began, SETTLE);
                if failed {
                    return Ok(report(false, Some(&t.name)));
                }
                all &= ok;
            }
            if all {
                return Ok(report(true, None));
            }
            if began.elapsed() >= timeout {
                return Ok(report(false, None));
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }

    /// (ready, failed) for one terminal.
    fn is_ready(&self, t: &TerminalDef, st: &TermState, text: &str, began: Instant, settle: Duration) -> (bool, bool) {
        match st {
            TermState::FailedToStart { .. } => (false, true),
            TermState::Exited { code } if *code != 0 => (false, true),
            TermState::Exited { .. } | TermState::Detached => (true, false), // a one-shot that finished well
            TermState::Running => {
                let ok = if let Some(u) = t.ready_url.as_deref().filter(|u| !u.trim().is_empty()) {
                    ready::http_answers(u.trim())
                } else if let Some(pat) = t.ready_pattern.as_deref().filter(|x| !x.trim().is_empty()) {
                    ready::output_has(text, pat)
                } else {
                    began.elapsed() >= settle
                };
                (ok, false)
            }
            _ => (false, false),
        }
    }

    fn down(&self, p: &Value) -> Result<Value, String> {
        let (app, _) = self.app(p)?;
        let rt = &self.state.rt;
        let handles: Vec<_> = rt
            .all()
            .into_iter()
            .filter(|t| t.app_id == app.id && t.state().can_stop())
            .map(|t| {
                let rt = rt.clone();
                std::thread::spawn(move || rt.stop(&t))
            })
            .collect();
        for h in handles {
            let _ = h.join();
        }
        Ok(self.terminal_states(&app))
    }

    fn terminal_states(&self, app: &AppDef) -> Value {
        json!(app
            .terminals
            .iter()
            .map(|t| json!({ "name": t.name, "state": state_str(&self.state.rt.get(&t.id).map(|x| x.state()).unwrap_or(TermState::Stopped)) }))
            .collect::<Vec<_>>())
    }

    fn detect(&self, p: &Value) -> Result<Value, String> {
        let path = std::path::PathBuf::from(paths::normalize_slashes(need(p, "path")?));
        if !path.is_dir() {
            return Err(paths::missing_folder_message(&path));
        }
        Ok(json!(detect::detect_project(&path)
            .into_iter()
            .map(|s| json!({ "name": s.name, "cwd": s.cwd, "command": s.command, "stop": s.stop_command, "kind": s.kind }))
            .collect::<Vec<_>>()))
    }

    fn add(&self, p: &Value) -> Result<Value, String> {
        let folder = paths::normalize_slashes(need(p, "path")?);
        let path = std::path::PathBuf::from(&folder);
        if !path.is_dir() {
            return Err(paths::missing_folder_message(&path));
        }
        let (apps, _) = self.apps();
        if let Some(a) = apps.iter().find(|a| paths::normalize_slashes(&a.root).eq_ignore_ascii_case(&folder)) {
            return Ok(json!({ "app": a.name, "existing": true, "terminals": a.terminals.iter().map(|t| &t.name).collect::<Vec<_>>() }));
        }
        let mut terminals: Vec<TerminalDef> = detect::detect_project(&path)
            .into_iter()
            .map(|s| TerminalDef {
                id: uuid::Uuid::new_v4().to_string(),
                name: s.name,
                cwd: s.cwd,
                command: s.command,
                stop_command: s.stop_command,
                ready_pattern: s.ready_pattern,
                ..Default::default()
            })
            .collect();
        let mut seen: Vec<String> = Vec::new();
        for t in &mut terminals {
            let base = t.name.clone();
            let mut n = 2;
            while seen.iter().any(|x| x.eq_ignore_ascii_case(&t.name)) {
                t.name = format!("{base} {n}");
                n += 1;
            }
            seen.push(t.name.clone());
        }
        let name = param(p, "name")
            .map(String::from)
            .or_else(|| path.file_name().map(|n| n.to_string_lossy().to_string()))
            .unwrap_or_else(|| "App".into());
        let app = AppDef { id: uuid::Uuid::new_v4().to_string(), name: name.clone(), root: folder, terminals, ..Default::default() };
        let names: Vec<String> = app.terminals.iter().map(|t| t.name.clone()).collect();
        let mut all = apps;
        all.push(app);
        self.state.config.lock().set_apps(all)?;
        Ok(json!({ "app": name, "existing": false, "terminals": names }))
    }

    // --------------------------------------------------------------- terminals

    fn term_start(&self, p: &Value, restart: bool) -> Result<Value, String> {
        let (app, shell) = self.app(p)?;
        let def = self.terminal(&app, p)?;
        let rt = &self.state.rt;
        if restart {
            if let Some(t) = rt.get(&def.id) {
                rt.stop(&t);
            }
        }
        rt.start(&app.id, &app.root, &def, &shell);
        let s = rt.get(&def.id).map(|t| t.state()).unwrap_or(TermState::Stopped);
        Ok(json!({ "terminal": def.name, "id": def.id, "state": state_str(&s) }))
    }

    fn term_stop(&self, p: &Value) -> Result<Value, String> {
        let (app, _) = self.app(p)?;
        let def = self.terminal(&app, p)?;
        if let Some(t) = self.state.rt.get(&def.id) {
            self.state.rt.stop(&t);
        }
        let s = self.state.rt.get(&def.id).map(|t| t.state()).unwrap_or(TermState::Stopped);
        Ok(json!({ "terminal": def.name, "state": state_str(&s) }))
    }

    fn logs(&self, p: &Value) -> Result<Value, String> {
        let (app, _) = self.app(p)?;
        let def = self.terminal(&app, p)?;
        let lines = (num(p, "lines", DEFAULT_LINES as u64) as usize).clamp(1, MAX_LINES);
        let since = num(p, "since", 0);
        let Some(t) = self.state.rt.get(&def.id) else {
            return Ok(json!({ "text": "", "cursor": 0, "truncated": false, "state": "stopped" }));
        };
        let (bytes, cursor, dropped) = t.output_since(since);
        let exit = match t.state() {
            TermState::Exited { code } => Some(code),
            _ => None,
        };
        let (text, cut) = shape_output(&ansi::strip_ansi(&bytes), p, lines, exit, false);
        Ok(json!({ "text": text, "cursor": cursor, "truncated": cut || dropped, "state": state_str(&t.state()) }))
    }

    /// Wait for exit, for "running", or for text to appear (ready detection): the call an LLM needs
    /// instead of polling logs.
    fn wait(&self, p: &Value) -> Result<Value, String> {
        let (app, _) = self.app(p)?;
        let def = self.terminal(&app, p)?;
        let timeout = Duration::from_secs(num(p, "timeout_s", 60).clamp(1, MAX_WAIT_S));
        let pattern = param(p, "pattern").map(|s| s.to_lowercase());
        let until = param(p, "until").unwrap_or(if pattern.is_some() { "match" } else { "exit" });
        let start = Instant::now();
        let finish = |ok: bool, reason: &str, text: String, cursor: u64, state: &str| {
            json!({ "ok": ok, "reason": reason, "state": state, "text": text, "cursor": cursor, "elapsed_ms": start.elapsed().as_millis() as u64 })
        };
        loop {
            let term = self.state.rt.get(&def.id);
            let state = term.as_ref().map(|t| t.state()).unwrap_or(TermState::Stopped);
            let (bytes, cursor) = term.as_ref().map(|t| { let (b, c, _) = t.output_since(0); (b, c) }).unwrap_or((Vec::new(), 0));
            let text = ansi::strip_ansi(&bytes);
            let tail = || ansi::tail(&text, 15, 3000).0;
            let done = matches!(state, TermState::Exited { .. } | TermState::FailedToStart { .. } | TermState::Detached)
                || (matches!(state, TermState::Stopped) && term.is_some());
            if let (Some(pat), "match") = (&pattern, until) {
                if text.to_lowercase().contains(pat.as_str()) {
                    return Ok(finish(true, "matched", tail(), cursor, &state_str(&state)));
                }
                if done {
                    return Ok(finish(false, "ended-before-match", tail(), cursor, &state_str(&state)));
                }
            } else if until == "running" {
                if matches!(state, TermState::Running | TermState::Detached) {
                    return Ok(finish(true, "running", tail(), cursor, &state_str(&state)));
                }
                if done {
                    return Ok(finish(false, "ended", tail(), cursor, &state_str(&state)));
                }
            } else if done {
                let ok = matches!(state, TermState::Exited { code: 0 } | TermState::Detached | TermState::Stopped);
                return Ok(finish(ok, "exited", tail(), cursor, &state_str(&state)));
            }
            if start.elapsed() >= timeout {
                return Ok(finish(false, "timeout", tail(), cursor, &state_str(&state)));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn send(&self, p: &Value) -> Result<Value, String> {
        let (app, _) = self.app(p)?;
        let def = self.terminal(&app, p)?;
        let text = p.get("text").and_then(|v| v.as_str()).ok_or("Missing \"text\".")?;
        let running = self.state.rt.get(&def.id).map(|t| t.state().can_stop()).unwrap_or(false);
        if !running {
            return Err(format!("{} is not running. Start it first (term.start).", def.name));
        }
        let mut data = text.as_bytes().to_vec();
        if flag(p, "enter", true) {
            data.push(b'\r');
        }
        self.state.rt.write_input(&def.id, &data)?;
        Ok(json!({ "sent": data.len() }))
    }

    // ------------------------------------------------------------------ updates

    fn update_check(&self) -> Result<Value, String> {
        let (base, key, prefixes) = self.source();
        let current = env!("CARGO_PKG_VERSION");
        let found = crate::update::check(current, &base, &key, &prefixes)?;
        crate::update::set_cached(found.clone());
        let _ = self.state.config.lock().set_update(|u| u.last_checked = now());
        Ok(match found {
            Some(i) => json!({ "current": current, "available": true, "version": i.version, "notes": i.notes, "size": i.size }),
            None => json!({ "current": current, "available": false }),
        })
    }

    /// Download, verify and (after the caller's explicit `yes`) install. Installing stops every
    /// running terminal and restarts Tinkerdeck, so it is never done unasked.
    fn update_apply(&self, p: &Value) -> Result<Value, String> {
        if !flag(p, "yes", false) {
            return Err("Pass yes=true to confirm: updating stops every running terminal and restarts Tinkerdeck.".into());
        }
        let (base, key, prefixes) = self.source();
        let info = match crate::update::cached() {
            Some(i) => i,
            None => crate::update::check(env!("CARGO_PKG_VERSION"), &base, &key, &prefixes)?.ok_or("Already up to date.")?,
        };
        if !crate::update::is_newer(env!("CARGO_PKG_VERSION"), &info.version) {
            return Err("Already up to date.".into());
        }
        let dir = self.state.config_dir.join("updates");
        let path = crate::update::download(&info, &dir, &prefixes, |_, _| {})?;
        crate::update::verify_file(&path, &info)?;
        let hook = self.update_hook.lock().clone();
        match hook {
            Some(h) => {
                let p2 = path.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(300)); // let the reply go out first
                    h(p2);
                });
                Ok(json!({ "applying": true, "version": info.version }))
            }
            None => Ok(json!({ "staged": path.display().to_string(), "version": info.version })),
        }
    }

    // ---------------------------------------------------------------- one-shot

    /// Run one command in the app's folder and return its exit code and tail of output.
    fn run(&self, p: &Value) -> Result<Value, String> {
        let (app, default_shell) = self.app(p)?;
        let command = need(p, "command")?;
        let root = self.root(&app)?;
        let cwd = match param(p, "cwd") {
            Some(c) => paths::resolve_cwd(&app.root, c),
            None => root,
        };
        if !cwd.is_dir() {
            return Err(paths::missing_folder_message(&cwd));
        }
        let shell = param(p, "shell").and_then(shells::known).map(String::from).unwrap_or(default_shell);
        let program = shells::resolve(&shell).ok_or_else(|| format!("{} is not installed.", shells::display_name(&shell)))?;
        let spec = shells::spec(&shell, &program, command, &cwd);
        let timeout = Duration::from_secs(num(p, "timeout_s", 60).clamp(1, MAX_WAIT_S));
        let lines = (num(p, "lines", 100) as usize).clamp(1, MAX_LINES);

        let mut cmd = std::process::Command::new(&spec.program);
        cmd.args(&spec.args)
            .envs(spec.env.iter().map(|(k, v)| (k, v)))
            .current_dir(&cwd)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| format!("Could not start {}: {e}", shells::display_name(&shell)))?;
        let _ = job::assign_to_launcher(child.id()); // dies with the launcher, like every terminal
        let buf = Arc::new(parking_lot::Mutex::new(Vec::<u8>::new()));
        let mut readers = Vec::new();
        for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)]
            .into_iter()
            .flatten()
        {
            let b = buf.clone();
            readers.push(std::thread::spawn(move || {
                let mut s = stream;
                let mut chunk = [0u8; 4096];
                while let Ok(n) = s.read(&mut chunk) {
                    if n == 0 {
                        break;
                    }
                    b.lock().extend_from_slice(&chunk[..n]);
                }
            }));
        }
        let start = Instant::now();
        let mut timed_out = false;
        let code = loop {
            match child.try_wait() {
                Ok(Some(s)) => break s.code(),
                Ok(None) if start.elapsed() > timeout => {
                    job::taskkill_tree(child.id());
                    let _ = child.wait();
                    timed_out = true;
                    break None;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(e) => return Err(e.to_string()),
            }
        };
        for r in readers {
            let _ = r.join();
        }
        let raw = buf.lock().clone();
        let (text, cut) = shape_output(&ansi::strip_ansi(&raw), p, lines, code, timed_out);
        Ok(json!({ "exit": code, "timedOut": timed_out, "text": text, "truncated": cut, "elapsed_ms": start.elapsed().as_millis() as u64 }))
    }

    // --------------------------------------------------------------------- git

    fn git(&self, op: &str, p: &Value) -> Result<Value, String> {
        let (app, _) = self.app(p)?;
        let root = self.root(&app)?;
        match op {
            "status" => {
                let Some(i) = git::repo_info(&root)? else { return Ok(json!({ "repo": false })) };
                let files: Vec<Value> = git::changes(&root)?.into_iter().take(200).map(|c| json!({ "path": c.path, "status": c.status, "staged": c.staged })).collect();
                Ok(json!({ "repo": true, "branch": i.branch, "head": i.head, "detached": i.detached, "dirty": i.dirty, "ahead": i.ahead, "behind": i.behind, "upstream": i.has_upstream, "files": files }))
            }
            "branches" => {
                let b = git::branches(&root)?;
                Ok(json!({ "current": b.current, "local": b.local, "remote": b.remote }))
            }
            "log" => {
                let n = (num(p, "limit", 20) as usize).clamp(1, 200);
                Ok(json!(git::log(&root, n)?.into_iter().map(|c| json!({ "hash": c.short, "subject": c.subject, "author": c.author, "date": c.date, "refs": c.refs })).collect::<Vec<_>>()))
            }
            "switch" => {
                git::switch_branch(&root, need(p, "branch")?)?;
                Ok(json!({ "ok": true, "branch": need(p, "branch")? }))
            }
            "commit" => {
                let message = need(p, "message")?;
                let mut paths: Vec<String> = p.get("paths").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
                if paths.is_empty() && flag(p, "all", false) {
                    paths = git::changes(&root)?.into_iter().filter(|c| !c.conflict).map(|c| c.path).collect();
                }
                Ok(json!({ "commit": git::commit(&root, &paths, message)? }))
            }
            "fetch" => Ok(json!({ "message": git::fetch(&root)? })),
            "pull" => Ok(json!({ "message": git::pull(&root)? })),
            "push" => Ok(json!({ "message": git::push(&root)? })),
            "sync" => Ok(json!({ "message": git::sync(&root)? })),
            other => Err(format!("Unknown git operation \"{other}\".")),
        }
    }
}

/// Filters and summaries a model can ask for, so it never pays for output it does not need.
fn shape_output(plain: &str, p: &Value, lines: usize, exit: Option<i32>, timed_out: bool) -> (String, bool) {
    if flag(p, "brief", false) || param(p, "format") == Some("brief") {
        return (brief::brief(plain, exit, timed_out), false);
    }
    let opts = brief::FilterOpts {
        grep: param(p, "grep").map(String::from),
        context: num(p, "context", 0).min(20) as usize,
        errors: flag(p, "errors", false),
        dedupe: flag(p, "dedupe", false),
    };
    if opts.is_empty() {
        return ansi::tail(plain, lines, MAX_CHARS);
    }
    ansi::tail(&brief::filter(plain, &opts), lines, MAX_CHARS)
}

/// A short fingerprint of a JSON value (FNV-1a), used so `status` can answer "unchanged".
fn revision(v: &Value) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in v.to_string().bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{:08x}", h & 0xffff_ffff)
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ConfigStore;
    use crate::model::TerminalDef;
    use crate::runtime::Runtime;
    use parking_lot::Mutex;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tempfile::{tempdir, TempDir};

    struct H {
        engine: Engine,
        root: TempDir,
        _cfg: TempDir,
        quit: Arc<AtomicBool>,
    }

    fn term(name: &str, command: &str) -> TerminalDef {
        TerminalDef { id: format!("id-{name}"), name: name.into(), cwd: ".".into(), command: command.into(), ..Default::default() }
    }

    fn harness(terms: Vec<TerminalDef>) -> H {
        let cfg = tempdir().unwrap();
        let root = tempdir().unwrap();
        let mut store = ConfigStore::load(cfg.path());
        store
            .set_apps(vec![
                AppDef { id: "app-1".into(), name: "Shop".into(), root: root.path().display().to_string(), terminals: terms, ..Default::default() },
                AppDef { id: "app-2".into(), name: "Shipping".into(), root: root.path().display().to_string(), ..Default::default() },
            ])
            .unwrap();
        let rt = Runtime::new(Arc::new(|_| {}));
        let state = Arc::new(AppState { config: Mutex::new(store), rt, config_dir: cfg.path().to_path_buf(), job_warning: None });
        let quit = Arc::new(AtomicBool::new(false));
        let q2 = quit.clone();
        H { engine: Engine::new(state, Arc::new(move || q2.store(true, Ordering::SeqCst))), root, _cfg: cfg, quit }
    }

    fn call(h: &H, m: &str, p: Value) -> Result<Value, String> {
        h.engine.call(m, &p)
    }

    #[test]
    fn ping_reports_the_version() {
        let h = harness(vec![]);
        let r = call(&h, "ping", json!({})).unwrap();
        assert_eq!(r["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(r["ok"], true);
    }

    #[test]
    fn unknown_methods_and_missing_params_are_clear_errors() {
        let h = harness(vec![term("api", "echo x")]);
        assert!(call(&h, "nope", json!({})).unwrap_err().contains("Unknown method"));
        assert!(call(&h, "term.start", json!({ "app": "Shop" })).unwrap_err().contains("\"terminal\""));
        assert!(call(&h, "term.start", json!({})).unwrap_err().contains("\"app\""));
    }

    #[test]
    fn apps_resolve_by_id_name_or_unique_prefix_with_helpful_misses() {
        let h = harness(vec![term("api", "echo x")]);
        for q in ["app-1", "Shop", "shop", "sho"] {
            assert!(call(&h, "term.logs", json!({ "app": q, "terminal": "api" })).is_ok(), "{q}");
        }
        let amb = call(&h, "term.logs", json!({ "app": "sh", "terminal": "api" })).unwrap_err();
        assert!(amb.contains("Shop") && amb.contains("Shipping"), "{amb}");
        let none = call(&h, "term.logs", json!({ "app": "zzz", "terminal": "api" })).unwrap_err();
        assert!(none.contains("Apps: Shop, Shipping"), "{none}");
    }

    #[test]
    fn terminals_resolve_by_name_prefix_and_list_choices_on_a_miss() {
        let h = harness(vec![term("api", "echo x"), term("frontend", "echo y")]);
        assert!(call(&h, "term.logs", json!({ "app": "Shop", "terminal": "front" })).is_ok());
        let e = call(&h, "term.logs", json!({ "app": "Shop", "terminal": "db" })).unwrap_err();
        assert!(e.contains("api, frontend, console"), "{e}");
        let e = call(&h, "term.logs", json!({ "app": "Shipping", "terminal": "x" })).unwrap_err();
        assert!(e.contains("console"), "{e}");
    }

    #[test]
    fn status_is_compact_and_reflects_state() {
        let h = harness(vec![term("api", "echo hi"), term("web", "echo ho")]);
        let s = call(&h, "status", json!({})).unwrap();
        assert_eq!(s[0]["app"], "Shop");
        assert_eq!(s[0]["state"], "stopped");
        assert_eq!(s[0]["terminals"][0], json!({ "name": "api", "state": "stopped" }));
        assert!(s[0].get("git").is_none());
        let compact = serde_json::to_string(&s).unwrap();
        assert!(compact.len() < 400, "status must stay cheap: {}", compact.len());
    }

    #[test]
    fn start_wait_and_logs_give_clean_text_and_an_incremental_cursor() {
        let h = harness(vec![term("hello", "echo hello-from-engine")]);
        call(&h, "term.start", json!({ "app": "Shop", "terminal": "hello" })).unwrap();
        let w = call(&h, "term.wait", json!({ "app": "Shop", "terminal": "hello", "timeout_s": 30 })).unwrap();
        assert_eq!((w["ok"].as_bool(), w["reason"].as_str(), w["state"].as_str()), (Some(true), Some("exited"), Some("exited:0")));
        let l = call(&h, "term.logs", json!({ "app": "Shop", "terminal": "hello" })).unwrap();
        let text = l["text"].as_str().unwrap();
        assert!(text.contains("hello-from-engine"), "{text}");
        assert!(!text.contains('\u{1b}'), "no escape codes");
        let cursor = l["cursor"].as_u64().unwrap();
        assert!(cursor > 0);
        let again = call(&h, "term.logs", json!({ "app": "Shop", "terminal": "hello", "since": cursor })).unwrap();
        assert_eq!(again["text"], "", "nothing new since the cursor");
    }

    #[test]
    fn wait_for_a_pattern_detects_readiness_without_the_process_ending() {
        let h = harness(vec![term("server", "echo Local: http://localhost:5173; ping -n 30 127.0.0.1")]);
        call(&h, "term.start", json!({ "app": "Shop", "terminal": "server" })).unwrap();
        let w = call(&h, "term.wait", json!({ "app": "Shop", "terminal": "server", "pattern": "localhost:5173", "timeout_s": 30 })).unwrap();
        assert_eq!((w["ok"].as_bool(), w["reason"].as_str()), (Some(true), Some("matched")));
        assert_eq!(w["state"], "running");
        let s = call(&h, "term.stop", json!({ "app": "Shop", "terminal": "server" })).unwrap();
        assert_eq!(s["state"], "stopped");
    }

    #[test]
    fn wait_reports_timeout_and_ended_before_match() {
        let h = harness(vec![term("slow", "ping -n 30 127.0.0.1"), term("quick", "echo nothing-useful")]);
        call(&h, "term.start", json!({ "app": "Shop", "terminal": "slow" })).unwrap();
        let t = call(&h, "term.wait", json!({ "app": "Shop", "terminal": "slow", "timeout_s": 1 })).unwrap();
        assert_eq!((t["ok"].as_bool(), t["reason"].as_str()), (Some(false), Some("timeout")));
        assert!(t["elapsed_ms"].as_u64().unwrap() < 5000);
        call(&h, "term.stop", json!({ "app": "Shop", "terminal": "slow" })).unwrap();
        call(&h, "term.start", json!({ "app": "Shop", "terminal": "quick" })).unwrap();
        let e = call(&h, "term.wait", json!({ "app": "Shop", "terminal": "quick", "pattern": "ready", "timeout_s": 30 })).unwrap();
        assert_eq!((e["ok"].as_bool(), e["reason"].as_str()), (Some(false), Some("ended-before-match")));
    }

    #[test]
    fn a_failing_command_waits_to_ok_false_with_its_exit_code() {
        let h = harness(vec![term("bad", "exit 3")]);
        call(&h, "term.start", json!({ "app": "Shop", "terminal": "bad" })).unwrap();
        let w = call(&h, "term.wait", json!({ "app": "Shop", "terminal": "bad", "timeout_s": 30 })).unwrap();
        assert_eq!((w["ok"].as_bool(), w["state"].as_str()), (Some(false), Some("exited:3")));
    }

    #[test]
    fn logs_can_grep_filter_errors_dedupe_and_summarise_on_the_server() {
        let h = harness(vec![term("noisy", "1..3 | % { \"GET /item/$_ 200\" }; \"ERROR db down\"; \"after the error\"; 1..4 | % { \"retry $_\" }")]);
        call(&h, "term.start", json!({ "app": "Shop", "terminal": "noisy" })).unwrap();
        call(&h, "term.wait", json!({ "app": "Shop", "terminal": "noisy", "timeout_s": 30 })).unwrap();
        let get = |extra: Value| {
            let mut p = json!({ "app": "Shop", "terminal": "noisy" });
            for (k, v) in extra.as_object().unwrap() {
                p[k] = v.clone();
            }
            call(&h, "term.logs", p).unwrap()["text"].as_str().unwrap().to_string()
        };
        assert_eq!(get(json!({ "grep": "error db" })), "ERROR db down");
        let errors = get(json!({ "errors": true }));
        assert!(errors.contains("ERROR db down") && errors.contains("after the error") && !errors.contains("item/1"), "{errors}");
        let ctx = get(json!({ "grep": "ERROR", "context": 1 }));
        assert!(ctx.contains("item/3") && ctx.contains("after the error"), "{ctx}");
        let dd = get(json!({ "dedupe": true }));
        assert!(dd.contains("(×3 similar)") && dd.contains("(×4 similar)"), "{dd}");
        let full = get(json!({}));
        assert!(full.lines().count() > dd.lines().count());
        let b = get(json!({ "brief": true }));
        assert!(b.starts_with("exit 0") || b.contains("lines"), "{b}");
    }

    #[test]
    fn run_brief_turns_a_failing_test_run_into_counts_and_the_failures_only() {
        let h = harness(vec![]);
        let script = "1..300 | % { \"  ✓ case $_ passes 1ms\" }; \" FAIL  src/b.test.ts > b > adds numbers\"; \"AssertionError: expected 3 to be 4\"; \"      Tests  1 failed | 299 passed (300)\"; exit 1";
        let full = call(&h, "run", json!({ "app": "Shop", "command": script, "lines": 1000 })).unwrap();
        let brief_r = call(&h, "run", json!({ "app": "Shop", "command": script, "format": "brief" })).unwrap();
        assert_eq!(brief_r["exit"], 1);
        let text = brief_r["text"].as_str().unwrap();
        assert!(text.starts_with("vitest FAILED: 1 failed, 299 passed"), "{text}");
        assert!(text.contains("b > adds numbers") && text.contains("AssertionError"), "{text}");
        assert!(text.len() * 20 < full["text"].as_str().unwrap().len(), "brief {} vs full {}", text.len(), full["text"].as_str().unwrap().len());
        let g = call(&h, "run", json!({ "app": "Shop", "command": script, "grep": "AssertionError", "lines": 5 })).unwrap();
        assert_eq!(g["text"], "AssertionError: expected 3 to be 4");
    }

    #[test]
    fn status_with_since_answers_unchanged_until_something_changes() {
        let h = harness(vec![term("api", "ping -n 30 127.0.0.1")]);
        let plain = call(&h, "status", json!({})).unwrap();
        assert!(plain.is_array(), "without since the shape is unchanged");
        let first = call(&h, "status", json!({ "since": "" })).unwrap();
        let rev = first["rev"].as_str().unwrap().to_string();
        assert_eq!(rev.len(), 8);
        assert_eq!(first["apps"][0]["app"], "Shop");
        assert_eq!(call(&h, "status", json!({ "since": rev })).unwrap(), json!({ "unchanged": true, "rev": rev }));
        call(&h, "term.start", json!({ "app": "Shop", "terminal": "api" })).unwrap();
        let after = call(&h, "status", json!({ "since": rev })).unwrap();
        assert!(after.get("unchanged").is_none() && after["rev"] != json!(rev), "{after}");
        assert_eq!(after["apps"][0]["state"], "running");
        call(&h, "term.stop", json!({ "app": "Shop", "terminal": "api" })).unwrap();
    }

    #[test]
    fn up_with_wait_returns_when_every_terminal_is_ready() {
        let mut a = term("api", "echo listening-now; ping -n 30 127.0.0.1");
        a.ready_pattern = Some("LISTENING-NOW".into());
        let b = term("worker", "ping -n 30 127.0.0.1"); // no check: ready once it has stayed up for 2 s
        let h = harness(vec![a, b]);
        let r = call(&h, "app.up", json!({ "app": "Shop", "wait": true, "timeout_s": 60 })).unwrap();
        assert_eq!(r["ready"], true, "{r}");
        assert!(r["terminals"].as_array().unwrap().iter().all(|t| t["ready"] == true && t["state"] == "running"), "{r}");
        assert!(r["elapsed_ms"].as_u64().unwrap() >= 1900, "the no-check terminal needs its settle time: {r}");
        call(&h, "app.down", json!({ "app": "Shop" })).unwrap();
    }

    #[test]
    fn up_with_wait_stops_early_and_explains_when_a_terminal_fails() {
        let h = harness(vec![term("db", "ping -n 30 127.0.0.1"), term("api", "Write-Output 'ERROR: cannot connect to db'; exit 3")]);
        let start = Instant::now();
        let r = call(&h, "app.up", json!({ "app": "Shop", "wait": true, "timeout_s": 60 })).unwrap();
        assert_eq!((r["ready"].as_bool(), r["failed"].as_str()), (Some(false), Some("api")), "{r}");
        let api = r["terminals"].as_array().unwrap().iter().find(|t| t["name"] == "api").unwrap();
        assert_eq!(api["state"], "exited:3");
        assert!(api["tail"].as_str().unwrap().contains("cannot connect to db"), "{api}");
        assert!(start.elapsed() < Duration::from_secs(30), "must not wait out the timeout");
        call(&h, "app.down", json!({ "app": "Shop" })).unwrap();
    }

    #[test]
    fn a_terminal_that_has_printed_nothing_has_no_tail_in_the_not_ready_report() {
        let mut quiet = term("quiet", "ping -n 30 127.0.0.1 > $null");
        quiet.ready_pattern = Some("never".into());
        let h = harness(vec![quiet]);
        let r = call(&h, "app.up", json!({ "app": "Shop", "wait": true, "timeout_s": 2 })).unwrap();
        assert_eq!(r["ready"], false);
        assert!(r["terminals"][0].get("tail").is_none(), "no empty noise: {r}");
        call(&h, "app.down", json!({ "app": "Shop" })).unwrap();
    }

    #[test]
    fn up_with_wait_times_out_and_names_who_is_not_ready() {
        let mut a = term("api", "echo starting; ping -n 30 127.0.0.1");
        a.ready_pattern = Some("never printed".into());
        let h = harness(vec![a]);
        let r = call(&h, "app.up", json!({ "app": "Shop", "wait": true, "timeout_s": 2 })).unwrap();
        assert_eq!((r["ready"].as_bool(), r["terminals"][0]["ready"].as_bool()), (Some(false), Some(false)), "{r}");
        assert!(r.get("failed").is_none());
        assert!(r["terminals"][0]["tail"].as_str().unwrap().contains("starting"), "{r}");
        call(&h, "app.down", json!({ "app": "Shop" })).unwrap();
    }

    #[test]
    fn up_with_wait_honours_a_local_ready_url_and_never_calls_other_hosts() {
        use crate::update::tests::{ok, serve_with};
        let s = serve_with(|_| {
            let mut r = std::collections::HashMap::new();
            r.insert("/health".to_string(), ok(b"ok".to_vec()));
            r
        });
        let mut a = term("api", "ping -n 30 127.0.0.1");
        a.ready_url = Some(format!("{}/health", s.base));
        let h = harness(vec![a]);
        let r = call(&h, "app.up", json!({ "app": "Shop", "wait": true, "timeout_s": 30 })).unwrap();
        assert_eq!(r["ready"], true, "{r}");
        call(&h, "app.down", json!({ "app": "Shop" })).unwrap();
        let mut outside = term("api", "ping -n 30 127.0.0.1");
        outside.ready_url = Some("http://example.com/".into());
        let h2 = harness(vec![outside]);
        let r2 = call(&h2, "app.up", json!({ "app": "Shop", "wait": true, "timeout_s": 2 })).unwrap();
        assert_eq!(r2["ready"], false, "a non-local URL is never requested, so it is never ready: {r2}");
        call(&h2, "app.down", json!({ "app": "Shop" })).unwrap();
    }

    #[test]
    fn app_up_without_wait_is_unchanged() {
        let h = harness(vec![term("a", "ping -n 30 127.0.0.1")]);
        let up = call(&h, "app.up", json!({ "app": "Shop" })).unwrap();
        assert!(up.is_array() && up[0]["state"] == "running");
        call(&h, "app.down", json!({ "app": "Shop" })).unwrap();
    }

    #[test]
    fn the_console_takes_input_through_send() {
        let h = harness(vec![]);
        assert!(call(&h, "term.send", json!({ "app": "Shop", "terminal": "console", "text": "echo x" })).unwrap_err().contains("not running"));
        let r = call(&h, "term.start", json!({ "app": "Shop", "terminal": "console" })).unwrap();
        assert_eq!(r["id"], "console-app-1:1");
        call(&h, "term.wait", json!({ "app": "Shop", "terminal": "console", "until": "running", "timeout_s": 15 })).unwrap();
        std::thread::sleep(Duration::from_millis(2500));
        call(&h, "term.send", json!({ "app": "Shop", "terminal": "console", "text": "echo sent-via-engine" })).unwrap();
        let w = call(&h, "term.wait", json!({ "app": "Shop", "terminal": "console", "pattern": "sent-via-engine", "timeout_s": 20 })).unwrap();
        assert_eq!(w["reason"], "matched", "{w}");
        let s = call(&h, "status", json!({})).unwrap();
        assert_eq!(s[0]["consoles"][0]["id"], "console-app-1:1");
        call(&h, "term.stop", json!({ "app": "Shop", "terminal": "console" })).unwrap();
    }

    #[test]
    fn a_console_can_use_another_shell_by_name() {
        let h = harness(vec![]);
        let r = call(&h, "term.start", json!({ "app": "Shop", "terminal": "console:2", "shell": "cmd.exe" })).unwrap();
        assert_eq!(r["id"], "console-app-1:2:cmd.exe");
        call(&h, "term.stop", json!({ "app": "Shop", "terminal": "console:2" })).unwrap();
    }

    #[test]
    fn app_up_starts_everything_in_order_and_down_stops_it_all() {
        let h = harness(vec![term("a", "ping -n 30 127.0.0.1"), term("b", "ping -n 30 127.0.0.1")]);
        let up = call(&h, "app.up", json!({ "app": "Shop" })).unwrap();
        assert_eq!(up[0]["state"], "running");
        assert_eq!(call(&h, "status", json!({})).unwrap()[0]["state"], "running");
        let down = call(&h, "app.down", json!({ "app": "Shop" })).unwrap();
        assert!(down.as_array().unwrap().iter().all(|t| t["state"] == "stopped"), "{down}");
        assert_eq!(call(&h, "status", json!({})).unwrap()[0]["state"], "stopped");
    }

    #[test]
    fn run_returns_exit_code_and_output_without_a_terminal() {
        let h = harness(vec![]);
        let ok = call(&h, "run", json!({ "app": "Shop", "command": "echo one-shot-ok" })).unwrap();
        assert_eq!((ok["exit"].as_i64(), ok["timedOut"].as_bool()), (Some(0), Some(false)));
        assert!(ok["text"].as_str().unwrap().contains("one-shot-ok"));
        let bad = call(&h, "run", json!({ "app": "Shop", "command": "exit 3" })).unwrap();
        assert_eq!(bad["exit"], 3);
        let missing = call(&h, "run", json!({ "app": "Shop", "command": "thiscommanddoesnotexist" })).unwrap();
        assert_ne!(missing["exit"], 0);
        assert!(missing["text"].as_str().unwrap().contains("thiscommanddoesnotexist"));
    }

    #[test]
    fn run_uses_the_project_folder_a_subfolder_and_other_shells() {
        let h = harness(vec![]);
        std::fs::create_dir_all(h.root.path().join("sub")).unwrap();
        let in_sub = call(&h, "run", json!({ "app": "Shop", "command": "(Get-Location).Path", "cwd": "sub" })).unwrap();
        assert!(in_sub["text"].as_str().unwrap().to_lowercase().ends_with("sub"), "{in_sub}");
        let cmd = call(&h, "run", json!({ "app": "Shop", "command": "echo from-cmd", "shell": "cmd.exe" })).unwrap();
        assert!(cmd["text"].as_str().unwrap().contains("from-cmd"));
        assert!(call(&h, "run", json!({ "app": "Shop", "command": "echo x", "cwd": "no\\such" })).unwrap_err().contains("does not exist"));
    }

    #[test]
    fn run_kills_the_whole_tree_on_timeout_and_reports_it() {
        let h = harness(vec![]);
        let start = Instant::now();
        let r = call(&h, "run", json!({ "app": "Shop", "command": "ping -n 60 127.0.0.1", "timeout_s": 1 })).unwrap();
        assert_eq!(r["timedOut"], true);
        assert!(r["exit"].is_null());
        assert!(start.elapsed() < Duration::from_secs(15));
    }

    #[test]
    fn run_output_is_capped_so_a_model_never_pays_for_a_flood() {
        let h = harness(vec![]);
        let r = call(&h, "run", json!({ "app": "Shop", "command": "1..5000 | % { \"line $_ padding padding padding\" }", "lines": 20 })).unwrap();
        let text = r["text"].as_str().unwrap();
        assert!(text.lines().count() <= 20, "{}", text.lines().count());
        assert!(text.contains("line 5000"), "the end of the output is kept");
        assert_eq!(r["truncated"], true);
    }

    #[test]
    fn git_methods_work_through_the_engine() {
        let h = harness(vec![]);
        let root = h.root.path();
        let g = |args: &[&str]| {
            let o = std::process::Command::new("git").args(["-c", "user.name=T", "-c", "user.email=t@e.x", "-c", "commit.gpgsign=false"]).args(args).current_dir(root).creation_flags(CREATE_NO_WINDOW).output().unwrap();
            assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
        };
        assert_eq!(call(&h, "git.status", json!({ "app": "Shop" })).unwrap()["repo"], false);
        g(&["init", "-q", "-b", "main"]);
        std::fs::write(root.join("a.txt"), "a").unwrap();
        let st = call(&h, "git.status", json!({ "app": "Shop" })).unwrap();
        assert_eq!((st["repo"].as_bool(), st["dirty"].as_bool(), st["branch"].as_str()), (Some(true), Some(true), Some("main")));
        assert_eq!(st["files"][0]["path"], "a.txt");
        std::fs::write(root.join("b.txt"), "b").unwrap();
        let c = call(&h, "git.commit", json!({ "app": "Shop", "message": "first", "paths": ["a.txt"] })).unwrap();
        assert!(c["commit"].as_str().unwrap().len() >= 7);
        let all = call(&h, "git.commit", json!({ "app": "Shop", "message": "second", "all": true })).unwrap();
        assert!(all["commit"].is_string());
        let log = call(&h, "git.log", json!({ "app": "Shop", "limit": 5 })).unwrap();
        assert_eq!(log[0]["subject"], "second");
        assert_eq!(log[1]["subject"], "first");
        g(&["branch", "dev"]);
        call(&h, "git.switch", json!({ "app": "Shop", "branch": "dev" })).unwrap();
        assert_eq!(call(&h, "git.branches", json!({ "app": "Shop" })).unwrap()["current"], "dev");
        assert!(call(&h, "git.switch", json!({ "app": "Shop", "branch": "--evil" })).is_err());
        assert!(call(&h, "git.nope", json!({ "app": "Shop" })).unwrap_err().contains("Unknown git operation"));
        let s = call(&h, "status", json!({ "git": true })).unwrap();
        assert_eq!(s[0]["git"]["branch"], "dev");
    }

    #[test]
    fn app_add_detects_the_project_saves_it_and_is_idempotent() {
        let h = harness(vec![]);
        let proj = tempdir().unwrap();
        std::fs::write(proj.path().join("package.json"), r#"{"scripts":{"dev":"vite","build":"vite build"}}"#).unwrap();
        let p = proj.path().display().to_string();
        let d = call(&h, "app.detect", json!({ "path": p })).unwrap();
        assert_eq!(d[0]["command"], "npm run dev");
        let a = call(&h, "app.add", json!({ "path": p, "name": "Vite App" })).unwrap();
        assert_eq!((a["app"].as_str(), a["existing"].as_bool()), (Some("Vite App"), Some(false)));
        assert_eq!(a["terminals"][0], proj.path().file_name().unwrap().to_string_lossy().to_string());
        let again = call(&h, "app.add", json!({ "path": p })).unwrap();
        assert_eq!(again["existing"], true);
        assert_eq!(call(&h, "status", json!({})).unwrap().as_array().unwrap().len(), 3);
        assert!(call(&h, "app.add", json!({ "path": "Z:\\nope" })).unwrap_err().contains("does not exist"));
    }

    #[test]
    fn update_check_finds_a_signed_newer_release_and_reports_none_when_current() {
        let _g = crate::update::tests::cache_lock();
        use crate::update::tests::{key, prefixes, serve_release};
        let (sk, pk) = key(21);
        let installer = vec![4u8; 120_000];
        let newer = serve_release("99.0.0", &installer, &sk, false);
        let h = harness(vec![]);
        h.engine.set_update_source(&newer.base, &pk, prefixes(&newer.base));
        let r = call(&h, "update.check", json!({})).unwrap();
        assert_eq!((r["available"].as_bool(), r["version"].as_str(), r["current"].as_str()), (Some(true), Some("99.0.0"), Some(env!("CARGO_PKG_VERSION"))));
        assert_eq!(r["notes"], "Faster. Fixes.");
        let same = serve_release(env!("CARGO_PKG_VERSION"), &installer, &sk, false);
        h.engine.set_update_source(&same.base, &pk, prefixes(&same.base));
        assert_eq!(call(&h, "update.check", json!({})).unwrap()["available"], false);
        crate::update::set_cached(None);
    }

    #[test]
    fn update_check_refuses_a_tampered_manifest_and_remembers_when_it_looked() {
        let _g = crate::update::tests::cache_lock();
        use crate::update::tests::{key, prefixes, serve_release};
        let (sk, pk) = key(22);
        let s = serve_release("99.0.0", &[1u8; 5000], &sk, true);
        let h = harness(vec![]);
        h.engine.set_update_source(&s.base, &pk, prefixes(&s.base));
        assert!(call(&h, "update.check", json!({})).unwrap_err().contains("signature"));
        let ok = serve_release("99.0.0", &[1u8; 5000], &sk, false);
        h.engine.set_update_source(&ok.base, &pk, prefixes(&ok.base));
        call(&h, "update.check", json!({})).unwrap();
        assert!(h.engine.state.config.lock().config().update.last_checked > 0);
        crate::update::set_cached(None);
    }

    #[test]
    fn update_apply_needs_an_explicit_yes_then_downloads_verifies_and_hands_over() {
        let _g = crate::update::tests::cache_lock();
        use crate::update::tests::{key, prefixes, serve_release};
        let (sk, pk) = key(23);
        let installer: Vec<u8> = (0..150_000u32).map(|i| (i % 253) as u8).collect();
        let s = serve_release("99.1.0", &installer, &sk, false);
        let h = harness(vec![]);
        h.engine.set_update_source(&s.base, &pk, prefixes(&s.base));
        crate::update::set_cached(None);
        // without a hook (as in tests) the verified installer is only staged
        assert!(call(&h, "update.apply", json!({})).unwrap_err().contains("yes=true"));
        let staged = call(&h, "update.apply", json!({ "yes": true })).unwrap();
        let path = std::path::PathBuf::from(staged["staged"].as_str().unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), installer);
        assert!(path.starts_with(h.engine.state.config_dir.join("updates")));
        // with a hook, it is handed over after the reply
        let got = Arc::new(Mutex::new(None));
        let g2 = got.clone();
        h.engine.set_update_hook(Arc::new(move |p| *g2.lock() = Some(p)));
        let r = call(&h, "update.apply", json!({ "yes": true })).unwrap();
        assert_eq!((r["applying"].as_bool(), r["version"].as_str()), (Some(true), Some("99.1.0")));
        let start = Instant::now();
        while got.lock().is_none() {
            assert!(start.elapsed() < Duration::from_secs(5), "hook was never called");
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(got.lock().clone().unwrap(), path);
        crate::update::set_cached(None);
    }

    #[test]
    fn update_apply_when_already_current_says_so() {
        let _g = crate::update::tests::cache_lock();
        use crate::update::tests::{key, prefixes, serve_release};
        let (sk, pk) = key(24);
        let s = serve_release(env!("CARGO_PKG_VERSION"), &[1u8; 2000], &sk, false);
        let h = harness(vec![]);
        h.engine.set_update_source(&s.base, &pk, prefixes(&s.base));
        crate::update::set_cached(None);
        assert!(call(&h, "update.apply", json!({ "yes": true })).unwrap_err().contains("up to date"));
    }

    #[test]
    fn shells_lists_what_is_installed() {
        let h = harness(vec![]);
        let s = call(&h, "shells", json!({})).unwrap();
        assert!(s.as_array().unwrap().iter().any(|x| x["id"] == "powershell.exe"));
    }

    #[test]
    fn quit_calls_the_hook_after_replying() {
        let h = harness(vec![]);
        assert_eq!(call(&h, "quit", json!({})).unwrap()["ok"], true);
        let start = Instant::now();
        while !h.quit.load(Ordering::SeqCst) {
            assert!(start.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn state_strings_are_stable_and_short() {
        assert_eq!(state_str(&TermState::Exited { code: 2 }), "exited:2");
        assert_eq!(state_str(&TermState::FailedToStart { reason: "x".into() }), "failed:x");
        assert_eq!(state_str(&TermState::Detached), "detached");
    }
}
