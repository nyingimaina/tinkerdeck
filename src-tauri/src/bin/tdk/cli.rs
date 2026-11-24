//! Command-line parsing and human-readable output for `tdk` (BRS 7.12).

use serde_json::{json, Value};

#[derive(Debug, PartialEq)]
pub enum Parsed {
    /// Call an engine method; `json` prints the raw result.
    Call { method: String, params: Value, json: bool, view: View },
    Help,
    Version,
    Mcp,
    /// `tdk mcp install|uninstall|status|config [clients...]`
    McpAdmin { action: String, clients: Vec<String> },
    Ui,
    Doctor,
    /// `tdk llms`: print the guide that tells an LLM how to discover and use everything.
    Llms,
}

/// How to print a result for a person.
#[derive(Debug, PartialEq, Clone, Copy)]
pub enum View {
    Status,
    States,
    Logs,
    Wait,
    Run,
    GitStatus,
    GitLog,
    Message,
    Update,
    Ready,
    Lines,
    Plain,
}

pub const HELP: &str = "tdk: control Tinkerdeck from the command line (also an MCP server for LLMs)
LLMs and agents: run `tdk llms` for a guide to everything it can do.

USAGE  tdk <command> [options]      add --json to any command for raw JSON

APPS
  status [--git] [--since REV]        every app and terminal, one compact view; with --since REV the
                                      answer is just `unchanged` when nothing moved
  up <app> [--wait] [--timeout S]     start all terminals in order; --wait returns when every terminal
                                      is READY (its ready text/URL, else 2 s of staying up) or one fails
  down <app>                          stop all of them (waits until stopped)
  add <path> [--name N]               add a project folder, terminals auto-detected
  detect <path>                       show what would be detected

TERMINALS  (<terminal> = saved name, or console / console:2)
  start|stop|restart <app> <terminal> [--shell ID]
  logs <app> <terminal> [-n LINES] [--since CURSOR] [--grep A|B] [-C N] [--errors] [--dedupe] [--brief]
  wait <app> <terminal> [--match TEXT] [--for exit|running] [--timeout S]
  send <app> <terminal> <text...> [--no-enter]
  run <app> [--cwd DIR] [--shell ID] [--timeout S] [-n LINES] [--brief] [--grep A|B] [-C N]
        [--errors] [--dedupe] -- <command...>

CHEAP OUTPUT (for LLMs)  --brief  test/build runners (vitest, jest, dotnet, cargo, pytest, go, tsc,
  msbuild, rustc) become `N failed, M passed` plus only the failures; --grep keeps matching lines
  (A|B = either), -C adds context, --errors keeps error-looking lines, --dedupe folds lines that
  differ only in numbers. Use --since CURSOR on logs to read only new output.

GIT
  git <app> status | branches | log [-n N] | switch <branch>
  git <app> commit -m <message> [--all | <paths...>]
  git <app> fetch | pull | push | sync

OTHER
  shells        installed shells        ping | doctor    check the connection
  version       print the version       help             this text
  update [check]                look for a newer signed version
  update apply --yes            download, verify and install it (stops running terminals, restarts the app)
  ui            open the window         quit             stop everything and exit
  llms          print the guide for LLMs and agents (also installed as README-LLM.md)
  mcp           run as an MCP server on stdio (for Claude and other LLM clients)
  mcp install [client...|all]   register with the LLM tools on this PC (Claude Code/Desktop,
                Cursor, Windsurf, VS Code, Gemini CLI, opencode)
  mcp status    which of them are registered       mcp uninstall    remove the registration
  mcp config    JSON snippet for any other MCP client

<app> is a name, a unique prefix, or an id. Exit codes: 0 ok, 1 error, 2 usage; `run` returns the command's own exit code.
";

fn call(method: &str, params: Value, json: bool, view: View) -> Result<Parsed, String> {
    Ok(Parsed::Call { method: method.to_string(), params, json, view })
}

fn usage(s: &str) -> Result<Parsed, String> {
    Err(format!("Usage: tdk {s}"))
}

/// Value of `--flag VALUE`, removing both from `args`.
fn take_value(args: &mut Vec<String>, names: &[&str]) -> Result<Option<String>, String> {
    if let Some(i) = args.iter().position(|a| names.contains(&a.as_str())) {
        if i + 1 >= args.len() {
            return Err(format!("{} needs a value.", args[i]));
        }
        let v = args.remove(i + 1);
        args.remove(i);
        return Ok(Some(v));
    }
    Ok(None)
}

fn take_flag(args: &mut Vec<String>, name: &str) -> bool {
    if let Some(i) = args.iter().position(|a| a == name) {
        args.remove(i);
        return true;
    }
    false
}

fn take_num(args: &mut Vec<String>, names: &[&str]) -> Result<Option<u64>, String> {
    match take_value(args, names)? {
        Some(v) => v.parse::<u64>().map(Some).map_err(|_| format!("\"{v}\" is not a number.")),
        None => Ok(None),
    }
}

/// `--grep TEXT`, `-C N`, `--errors`, `--dedupe`, `--brief`: server-side output shaping.
fn take_filters(args: &mut Vec<String>) -> Result<serde_json::Map<String, Value>, String> {
    let mut m = serde_json::Map::new();
    if let Some(g) = take_value(args, &["--grep", "-g"])? {
        m.insert("grep".into(), json!(g));
    }
    if let Some(c) = take_num(args, &["-C", "--context"])? {
        m.insert("context".into(), json!(c));
    }
    for (flag, key) in [("--errors", "errors"), ("--dedupe", "dedupe"), ("--brief", "brief")] {
        if take_flag(args, flag) {
            m.insert(key.into(), json!(true));
        }
    }
    Ok(m)
}

fn with_filters(mut base: Value, filters: serde_json::Map<String, Value>) -> Value {
    if let Some(o) = base.as_object_mut() {
        o.extend(filters);
    }
    base
}

pub fn parse(argv: &[String]) -> Result<Parsed, String> {
    let mut args: Vec<String> = argv.to_vec();
    let json = take_flag(&mut args, "--json");
    let Some(cmd) = args.first().cloned() else { return Ok(Parsed::Help) };
    args.remove(0);
    match cmd.as_str() {
        "help" | "-h" | "--help" | "/?" => Ok(Parsed::Help),
        "version" | "-V" | "--version" => Ok(Parsed::Version),
        "mcp" => match args.first().map(String::as_str) {
            None => Ok(Parsed::Mcp),
            Some(a @ ("install" | "uninstall" | "status" | "config")) => Ok(Parsed::McpAdmin { action: a.to_string(), clients: args[1..].to_vec() }),
            Some(other) => Err(format!("Unknown mcp action \"{other}\". Use: tdk mcp (serve) | install | uninstall | status | config")),
        },
        "ui" => Ok(Parsed::Ui),
        "doctor" => Ok(Parsed::Doctor),
        "llms" | "guide" => Ok(Parsed::Llms),
        "update" => match args.first().map(String::as_str) {
            None | Some("check") => call("update.check", json!({}), json, View::Update),
            Some("apply") => {
                let yes = args.iter().any(|a| a == "--yes" || a == "-y");
                call("update.apply", json!({ "yes": yes }), json, View::Update)
            }
            Some(other) => Err(format!("Unknown update action \"{other}\". Use: tdk update [check] | tdk update apply --yes")),
        },
        "ping" => call("ping", json!({}), json, View::Plain),
        "quit" => call("quit", json!({}), json, View::Plain),
        "shells" => call("shells", json!({}), json, View::Lines),
        "status" => {
            let git = take_flag(&mut args, "--git");
            let since = take_value(&mut args, &["--since"])?;
            let mut params = json!({ "git": git });
            if let Some(s) = since {
                params["since"] = json!(s);
            }
            call("status", params, json, View::Status)
        }
        "up" | "down" => {
            let wait = cmd == "up" && take_flag(&mut args, "--wait");
            let timeout = take_num(&mut args, &["--timeout", "-t"])?;
            match args.as_slice() {
                [app] => call(&format!("app.{cmd}"), json!({ "app": app, "wait": wait, "timeout_s": timeout }), json, if wait { View::Ready } else { View::States }),
                _ => usage(&format!("{cmd} <app>{}", if cmd == "up" { " [--wait] [--timeout S]" } else { "" })),
            }
        }
        "add" => {
            let name = take_value(&mut args, &["--name"])?;
            match args.as_slice() {
                [path] => call("app.add", json!({ "path": path, "name": name }), json, View::Plain),
                _ => usage("add <path> [--name N]"),
            }
        }
        "detect" => match args.as_slice() {
            [path] => call("app.detect", json!({ "path": path }), json, View::Lines),
            _ => usage("detect <path>"),
        },
        "start" | "stop" | "restart" => {
            let shell = take_value(&mut args, &["--shell"])?;
            match args.as_slice() {
                [app, term] => call(&format!("term.{cmd}"), json!({ "app": app, "terminal": term, "shell": shell }), json, View::Message),
                _ => usage(&format!("{cmd} <app> <terminal> [--shell ID]")),
            }
        }
        "logs" => {
            let lines = take_num(&mut args, &["-n", "--lines"])?;
            let since = take_num(&mut args, &["--since"])?;
            let filters = take_filters(&mut args)?;
            match args.as_slice() {
                [app, term] => call("term.logs", with_filters(json!({ "app": app, "terminal": term, "lines": lines, "since": since }), filters), json, View::Logs),
                _ => usage("logs <app> <terminal> [-n LINES] [--since CURSOR] [--grep TEXT] [-C N] [--errors] [--dedupe] [--brief]"),
            }
        }
        "wait" => {
            let pattern = take_value(&mut args, &["--match", "-m"])?;
            let until = take_value(&mut args, &["--for"])?;
            let timeout = take_num(&mut args, &["--timeout", "-t"])?;
            match args.as_slice() {
                [app, term] => call(
                    "term.wait",
                    json!({ "app": app, "terminal": term, "pattern": pattern, "until": until, "timeout_s": timeout }),
                    json,
                    View::Wait,
                ),
                _ => usage("wait <app> <terminal> [--match TEXT] [--for exit|running] [--timeout S]"),
            }
        }
        "send" => {
            let enter = !take_flag(&mut args, "--no-enter");
            if args.len() < 3 {
                return usage("send <app> <terminal> <text...> [--no-enter]");
            }
            let text = args[2..].join(" ");
            call("term.send", json!({ "app": args[0], "terminal": args[1], "text": text, "enter": enter }), json, View::Message)
        }
        "run" => {
            // everything after `--` is the command; without it, everything after the app
            let (before, command): (Vec<String>, Vec<String>) = match args.iter().position(|a| a == "--") {
                Some(i) => (args[..i].to_vec(), args[i + 1..].to_vec()),
                None => {
                    // No `--` (PowerShell can swallow it): options may still lead the command, and
                    // the command starts at the first word that is not one of our options.
                    if args.len() < 2 {
                        return usage("run <app> [options] -- <command...>");
                    }
                    let mut split = 1;
                    loop {
                        let a = args.get(split).map(String::as_str).unwrap_or("");
                        if split + 1 < args.len() && ["--cwd", "--shell", "--timeout", "-t", "-n", "--lines", "--grep", "-g", "-C", "--context"].contains(&a) {
                            split += 2;
                        } else if split + 1 < args.len() && ["--brief", "--errors", "--dedupe"].contains(&a) {
                            split += 1;
                        } else {
                            break;
                        }
                    }
                    (args[..split].to_vec(), args[split..].to_vec())
                }
            };
            let mut before = before;
            let cwd = take_value(&mut before, &["--cwd"])?;
            let shell = take_value(&mut before, &["--shell"])?;
            let timeout = take_num(&mut before, &["--timeout", "-t"])?;
            let lines = take_num(&mut before, &["-n", "--lines"])?;
            let filters = take_filters(&mut before)?;
            match before.as_slice() {
                [app] if !command.is_empty() => call(
                    "run",
                    with_filters(json!({ "app": app, "command": command.join(" "), "cwd": cwd, "shell": shell, "timeout_s": timeout, "lines": lines }), filters),
                    json,
                    View::Run,
                ),
                _ => usage("run <app> [options] -- <command...>"),
            }
        }
        "git" => {
            if args.len() < 2 {
                return usage("git <app> status|branches|log|switch|commit|fetch|pull|push|sync");
            }
            let app = args.remove(0);
            let op = args.remove(0);
            match op.as_str() {
                "status" => call("git.status", json!({ "app": app }), json, View::GitStatus),
                "branches" => call("git.branches", json!({ "app": app }), json, View::Plain),
                "log" => {
                    let n = take_num(&mut args, &["-n", "--limit"])?;
                    call("git.log", json!({ "app": app, "limit": n }), json, View::GitLog)
                }
                "switch" => match args.as_slice() {
                    [b] => call("git.switch", json!({ "app": app, "branch": b }), json, View::Plain),
                    _ => usage("git <app> switch <branch>"),
                },
                "commit" => {
                    let message = take_value(&mut args, &["-m", "--message"])?;
                    let all = take_flag(&mut args, "--all");
                    let Some(message) = message else { return usage("git <app> commit -m <message> [--all | <paths...>]") };
                    call("git.commit", json!({ "app": app, "message": message, "all": all, "paths": args }), json, View::Plain)
                }
                "fetch" | "pull" | "push" | "sync" => call(&format!("git.{op}"), json!({ "app": app }), json, View::Message),
                other => Err(format!("Unknown git operation \"{other}\". Try: status branches log switch commit fetch pull push sync")),
            }
        }
        other => Err(format!("Unknown command \"{other}\". Run `tdk help`.")),
    }
}

// ------------------------------------------------------------------ output

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}

/// Human-readable text for a result. Never fails: unknown shapes fall back to compact JSON.
pub fn render(view: View, v: &Value) -> String {
    match view {
        View::Status if v["unchanged"] == true => format!("unchanged (rev {})", s(v, "rev")),
        View::Status => v.get("apps").unwrap_or(v)
            .as_array()
            .map(|apps| {
                apps.iter()
                    .map(|a| {
                        let terms = a["terminals"]
                            .as_array()
                            .map(|t| t.iter().map(|x| format!("{}:{}", s(x, "name"), s(x, "state"))).collect::<Vec<_>>().join("  "))
                            .unwrap_or_default();
                        let git = a.get("git").map(|g| {
                            let mut t = format!("  git:{}", g["branch"].as_str().unwrap_or("?"));
                            if g["dirty"] == true {
                                t.push('*');
                            }
                            if g["ahead"].as_u64().unwrap_or(0) > 0 {
                                t.push_str(&format!(" ↑{}", g["ahead"]));
                            }
                            if g["behind"].as_u64().unwrap_or(0) > 0 {
                                t.push_str(&format!(" ↓{}", g["behind"]));
                            }
                            t
                        });
                        let cons = a["consoles"].as_array().map(|c| format!("  consoles:{}", c.len())).unwrap_or_default();
                        format!("{} [{}]  {}{}{}", s(a, "app"), s(a, "state"), terms, cons, git.unwrap_or_default())
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_else(|| v.to_string()),
        View::States => v
            .as_array()
            .map(|t| t.iter().map(|x| format!("{}: {}", s(x, "name"), s(x, "state"))).collect::<Vec<_>>().join("\n"))
            .unwrap_or_else(|| v.to_string()),
        View::Logs => s(v, "text").to_string(),
        View::Wait => format!(
            "{}\n[{}: {} after {:.1}s, state {}]",
            s(v, "text"),
            if v["ok"] == true { "ok" } else { "not ok" },
            s(v, "reason"),
            v["elapsed_ms"].as_f64().unwrap_or(0.0) / 1000.0,
            s(v, "state")
        ),
        View::Run => s(v, "text").to_string(),
        View::GitStatus => {
            if v["repo"] == false {
                return "Not a git repository.".into();
            }
            let mut head = format!("{}{}", v["branch"].as_str().unwrap_or("(detached)"), if v["dirty"] == true { " *" } else { "" });
            if v["ahead"].as_u64().unwrap_or(0) + v["behind"].as_u64().unwrap_or(0) > 0 {
                head.push_str(&format!("  ↑{} ↓{}", v["ahead"], v["behind"]));
            }
            let files: Vec<String> = v["files"].as_array().map(|f| f.iter().map(|x| format!("{:>2} {}", s(x, "status"), s(x, "path"))).collect()).unwrap_or_default();
            if files.is_empty() { head } else { format!("{head}\n{}", files.join("\n")) }
        }
        View::GitLog => v
            .as_array()
            .map(|c| c.iter().map(|x| format!("{} {}  ({})", s(x, "hash"), s(x, "subject"), s(x, "author"))).collect::<Vec<_>>().join("\n"))
            .unwrap_or_else(|| v.to_string()),
        View::Ready => {
            let secs = v["elapsed_ms"].as_f64().unwrap_or(0.0) / 1000.0;
            let terms = v["terminals"].as_array().cloned().unwrap_or_default();
            if v["ready"] == true {
                let names: Vec<String> = terms.iter().map(|t| format!("{} {}", s(t, "name"), s(t, "state"))).collect();
                return format!("READY in {secs:.1}s: {}", names.join(", "));
            }
            let why = match v.get("failed").and_then(|f| f.as_str()) {
                Some(f) => format!("NOT READY after {secs:.1}s: {f} failed"),
                None => format!("NOT READY after {secs:.1}s (timed out)"),
            };
            let mut out = why;
            for t in terms.iter().filter(|t| t["ready"] != true) {
                out.push_str(&format!("\n- {} [{}]", s(t, "name"), s(t, "state")));
                if let Some(tail) = t.get("tail").and_then(|x| x.as_str()) {
                    for l in tail.lines().take(6) {
                        out.push_str(&format!("\n    {l}"));
                    }
                }
            }
            out
        }
        View::Update => {
            if v["applying"] == true {
                format!("Installing {}: Tinkerdeck will restart in a moment.", s(v, "version"))
            } else if let Some(p) = v.get("staged").and_then(|p| p.as_str()) {
                format!("Downloaded and verified {} ({p}), not installed.", s(v, "version"))
            } else if v["available"] == true {
                let notes = s(v, "notes");
                format!("Update available: {} (you have {}).{}\nRun `tdk update apply --yes` to install it.", s(v, "version"), s(v, "current"), if notes.is_empty() { String::new() } else { format!("\n\n{notes}") })
            } else {
                format!("Up to date ({}).", s(v, "current"))
            }
        }
        View::Message => {
            if let Some(m) = v.get("message").and_then(|m| m.as_str()) {
                m.to_string()
            } else if v.get("state").is_some() {
                format!("{}: {}", v["terminal"].as_str().unwrap_or("terminal"), s(v, "state"))
            } else {
                v.to_string()
            }
        }
        View::Lines => v
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|x| match x {
                        Value::String(t) => t.clone(),
                        o if o.get("command").is_some() => format!("{}  {}  {}", s(o, "name"), s(o, "cwd"), s(o, "command")),
                        o => format!("{}  {}", s(o, "id"), s(o, "name")),
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_else(|| v.to_string()),
        View::Plain => match v {
            Value::String(t) => t.clone(),
            other => other.to_string(),
        },
    }
}

/// Process exit code for a successful call (so scripts can rely on `tdk run` and `tdk wait`).
pub fn exit_code(view: View, v: &Value) -> i32 {
    match view {
        View::Run => {
            if v["timedOut"] == true {
                124
            } else {
                v["exit"].as_i64().unwrap_or(1) as i32
            }
        }
        View::Wait => {
            if v["ok"] == true { 0 } else { 1 }
        }
        View::Ready => {
            if v["ready"] == true { 0 } else { 1 }
        }
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(a: &[&str]) -> Result<Parsed, String> {
        parse(&a.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    fn call_of(a: &[&str]) -> (String, Value, bool) {
        match p(a).unwrap() {
            Parsed::Call { method, params, json, .. } => (method, params, json),
            other => panic!("not a call: {other:?}"),
        }
    }

    #[test]
    fn no_arguments_and_help_flags_show_help() {
        for a in [&[][..], &["help"], &["--help"], &["-h"]] {
            assert_eq!(p(a).unwrap(), Parsed::Help);
        }
        assert_eq!(p(&["--version"]).unwrap(), Parsed::Version);
        assert!(HELP.contains("tdk mcp") || HELP.contains("mcp "));
    }

    #[test]
    fn status_up_logs_and_run_accept_the_token_saving_options() {
        assert_eq!(call_of(&["status", "--since", "ab12cd34"]).1, json!({ "git": false, "since": "ab12cd34" }));
        let (m, u, _) = call_of(&["up", "Shop", "--wait", "--timeout", "90"]);
        assert_eq!((m.as_str(), u["wait"].as_bool(), u["timeout_s"].as_u64()), ("app.up", Some(true), Some(90)));
        assert_eq!(call_of(&["up", "Shop"]).1["wait"], false);
        assert!(matches!(p(&["up", "Shop", "--wait"]).unwrap(), Parsed::Call { view: View::Ready, .. }));
        assert!(matches!(p(&["up", "Shop"]).unwrap(), Parsed::Call { view: View::States, .. }));
        let (_, l, _) = call_of(&["logs", "Shop", "api", "--grep", "error|warn", "-C", "2", "--errors", "--dedupe", "--brief", "-n", "30"]);
        assert_eq!((l["grep"].as_str(), l["context"].as_u64(), l["errors"].as_bool(), l["dedupe"].as_bool(), l["brief"].as_bool(), l["lines"].as_u64()), (Some("error|warn"), Some(2), Some(true), Some(true), Some(true), Some(30)));
        let (_, r, _) = call_of(&["run", "Shop", "--brief", "--", "npm", "test"]);
        assert_eq!((r["brief"].as_bool(), r["command"].as_str()), (Some(true), Some("npm test")));
        // without `--` the filter options still lead the command
        let (_, r2, _) = call_of(&["run", "Shop", "--brief", "--grep", "FAIL", "-C", "1", "npm", "test"]);
        assert_eq!((r2["brief"].as_bool(), r2["grep"].as_str(), r2["context"].as_u64(), r2["command"].as_str()), (Some(true), Some("FAIL"), Some(1), Some("npm test")));
        assert!(p(&["logs", "Shop", "api", "--grep"]).unwrap_err().contains("needs a value"));
    }

    #[test]
    fn ready_and_unchanged_results_render_for_people_and_set_exit_codes() {
        let ok = json!({ "ready": true, "elapsed_ms": 4200, "terminals": [{ "name": "api", "state": "running", "ready": true }, { "name": "db", "state": "running", "ready": true }] });
        assert_eq!(render(View::Ready, &ok), "READY in 4.2s: api running, db running");
        let bad = json!({ "ready": false, "failed": "api", "elapsed_ms": 900, "terminals": [{ "name": "api", "state": "exited:3", "ready": false, "tail": "exit 3, 1 lines.\nERROR: cannot connect" }] });
        let r = render(View::Ready, &bad);
        assert!(r.starts_with("NOT READY after 0.9s: api failed") && r.contains("cannot connect"), "{r}");
        assert!(render(View::Ready, &json!({ "ready": false, "elapsed_ms": 1000, "terminals": [] })).contains("timed out"));
        assert_eq!((exit_code(View::Ready, &ok), exit_code(View::Ready, &bad)), (0, 1));
        assert_eq!(render(View::Status, &json!({ "unchanged": true, "rev": "ab12cd34" })), "unchanged (rev ab12cd34)");
        let with_rev = json!({ "rev": "x", "apps": [{ "app": "Shop", "state": "stopped", "terminals": [] }] });
        assert!(render(View::Status, &with_rev).starts_with("Shop [stopped]"));
    }

    #[test]
    fn update_commands_check_by_default_and_apply_only_with_yes() {
        assert_eq!(call_of(&["update"]).0, "update.check");
        assert_eq!(call_of(&["update", "check"]).0, "update.check");
        assert_eq!(call_of(&["update", "apply"]), ("update.apply".into(), json!({ "yes": false }), false));
        assert_eq!(call_of(&["update", "apply", "--yes"]).1, json!({ "yes": true }));
        assert_eq!(call_of(&["update", "apply", "-y"]).1, json!({ "yes": true }));
        assert!(p(&["update", "frobnicate"]).unwrap_err().contains("Unknown update action"));
        assert!(HELP.contains("update apply --yes"));
    }

    #[test]
    fn update_results_render_for_people() {
        assert_eq!(render(View::Update, &json!({ "current": "1.2.0", "available": false })), "Up to date (1.2.0).");
        let a = render(View::Update, &json!({ "current": "1.2.0", "available": true, "version": "1.3.0", "notes": "Faster." }));
        assert!(a.starts_with("Update available: 1.3.0 (you have 1.2.0).") && a.contains("Faster.") && a.contains("tdk update apply --yes"), "{a}");
        assert!(render(View::Update, &json!({ "applying": true, "version": "1.3.0" })).contains("restart"));
        assert!(render(View::Update, &json!({ "staged": "C:\\x.exe", "version": "1.3.0" })).contains("not installed"));
    }

    #[test]
    fn special_commands() {
        assert_eq!(p(&["mcp"]).unwrap(), Parsed::Mcp);
        assert_eq!(p(&["mcp", "install"]).unwrap(), Parsed::McpAdmin { action: "install".into(), clients: vec![] });
        assert_eq!(
            p(&["mcp", "install", "cursor", "vscode"]).unwrap(),
            Parsed::McpAdmin { action: "install".into(), clients: vec!["cursor".into(), "vscode".into()] }
        );
        for a in ["uninstall", "status", "config"] {
            assert!(matches!(p(&["mcp", a]).unwrap(), Parsed::McpAdmin { .. }));
        }
        assert!(p(&["mcp", "frobnicate"]).unwrap_err().contains("Unknown mcp action"));
        assert_eq!(p(&["ui"]).unwrap(), Parsed::Ui);
        assert_eq!(p(&["doctor"]).unwrap(), Parsed::Doctor);
        assert_eq!(p(&["llms"]).unwrap(), Parsed::Llms);
        assert_eq!(p(&["guide"]).unwrap(), Parsed::Llms);
        assert!(HELP.contains("tdk llms"));
    }

    #[test]
    fn status_up_down() {
        assert_eq!(call_of(&["status"]), ("status".into(), json!({ "git": false }), false));
        assert_eq!(call_of(&["status", "--git", "--json"]), ("status".into(), json!({ "git": true }), true));
        assert_eq!(call_of(&["up", "Shop"]).0, "app.up");
        assert_eq!(call_of(&["down", "Shop"]).1["app"], "Shop");
        assert!(p(&["up"]).unwrap_err().contains("Usage"));
        assert!(p(&["up", "a", "b"]).is_err());
    }

    #[test]
    fn json_flag_works_anywhere() {
        assert!(call_of(&["--json", "status"]).2);
        assert!(call_of(&["logs", "a", "b", "--json"]).2);
    }

    #[test]
    fn terminal_commands_with_options() {
        let (m, params, _) = call_of(&["start", "Shop", "api", "--shell", "gitbash"]);
        assert_eq!((m.as_str(), &params["shell"], &params["terminal"]), ("term.start", &json!("gitbash"), &json!("api")));
        assert_eq!(call_of(&["restart", "Shop", "console:2"]).0, "term.restart");
        assert_eq!(call_of(&["stop", "Shop", "api"]).0, "term.stop");
        let (_, l, _) = call_of(&["logs", "Shop", "api", "-n", "30", "--since", "1234"]);
        assert_eq!((l["lines"].as_u64(), l["since"].as_u64()), (Some(30), Some(1234)));
        assert!(p(&["logs", "Shop"]).is_err());
        assert!(p(&["logs", "Shop", "api", "-n", "many"]).unwrap_err().contains("not a number"));
        assert!(p(&["logs", "Shop", "api", "-n"]).unwrap_err().contains("needs a value"));
    }

    #[test]
    fn wait_options() {
        let (m, w, _) = call_of(&["wait", "Shop", "web", "--match", "Local:", "--timeout", "90"]);
        assert_eq!((m.as_str(), &w["pattern"], w["timeout_s"].as_u64()), ("term.wait", &json!("Local:"), Some(90)));
        assert_eq!(call_of(&["wait", "Shop", "web", "--for", "running"]).1["until"], "running");
    }

    #[test]
    fn send_joins_words_and_can_skip_enter() {
        let (m, s, _) = call_of(&["send", "Shop", "console", "git", "status", "-s"]);
        assert_eq!((m.as_str(), s["text"].as_str(), s["enter"].as_bool()), ("term.send", Some("git status -s"), Some(true)));
        assert_eq!(call_of(&["send", "Shop", "console", "y", "--no-enter"]).1["enter"], false);
        assert!(p(&["send", "Shop", "console"]).is_err());
    }

    #[test]
    fn run_takes_everything_after_double_dash_as_the_command() {
        let (m, r, _) = call_of(&["run", "Shop", "--timeout", "30", "--cwd", "web", "--", "npm", "test", "--", "--watch=false"]);
        assert_eq!(m, "run");
        assert_eq!(r["command"], "npm test -- --watch=false");
        assert_eq!((r["timeout_s"].as_u64(), r["cwd"].as_str()), (Some(30), Some("web")));
        assert_eq!(call_of(&["run", "Shop", "dir"]).1["command"], "dir");
        // without `--` (for example PowerShell ate it) leading options are still options
        let (_, r, _) = call_of(&["run", "Shop", "--timeout", "1", "--shell", "gitbash", "ping", "-n", "30", "127.0.0.1"]);
        assert_eq!((r["timeout_s"].as_u64(), r["shell"].as_str(), r["command"].as_str()), (Some(1), Some("gitbash"), Some("ping -n 30 127.0.0.1")));
        // an option-looking word after the command starts is part of the command
        assert_eq!(call_of(&["run", "Shop", "npm", "test", "--timeout", "5"]).1["command"], "npm test --timeout 5");
        assert!(p(&["run", "Shop"]).is_err());
        assert!(p(&["run", "Shop", "--"]).is_err());
    }

    #[test]
    fn git_subcommands() {
        assert_eq!(call_of(&["git", "Shop", "status"]).0, "git.status");
        assert_eq!(call_of(&["git", "Shop", "log", "-n", "5"]).1["limit"], 5);
        assert_eq!(call_of(&["git", "Shop", "switch", "dev"]).1["branch"], "dev");
        let (m, c, _) = call_of(&["git", "Shop", "commit", "-m", "fix: thing", "a.txt", "b.txt"]);
        assert_eq!((m.as_str(), &c["message"], &c["paths"]), ("git.commit", &json!("fix: thing"), &json!(["a.txt", "b.txt"])));
        assert_eq!(call_of(&["git", "Shop", "commit", "-m", "x", "--all"]).1["all"], true);
        assert!(p(&["git", "Shop", "commit"]).unwrap_err().contains("Usage"));
        for op in ["fetch", "pull", "push", "sync"] {
            assert_eq!(call_of(&["git", "Shop", op]).0, format!("git.{op}"));
        }
        assert!(p(&["git", "Shop", "rebase"]).unwrap_err().contains("Unknown git operation"));
        assert!(p(&["git", "Shop"]).is_err());
    }

    #[test]
    fn add_detect_shells_and_unknown() {
        assert_eq!(call_of(&["add", "E:\\code\\Shop", "--name", "Shop"]).1, json!({ "path": "E:\\code\\Shop", "name": "Shop" }));
        assert_eq!(call_of(&["detect", "E:\\x"]).0, "app.detect");
        assert_eq!(call_of(&["shells"]).0, "shells");
        assert!(p(&["frobnicate"]).unwrap_err().contains("tdk help"));
    }

    #[test]
    fn status_renders_one_compact_line_per_app() {
        let v = json!([{ "app": "Shop", "state": "partial", "terminals": [{ "name": "api", "state": "running" }, { "name": "web", "state": "stopped" }],
            "git": { "branch": "main", "dirty": true, "ahead": 2, "behind": 0 } }]);
        assert_eq!(render(View::Status, &v), "Shop [partial]  api:running  web:stopped  git:main* ↑2");
    }

    #[test]
    fn other_views_render_plain_text() {
        assert_eq!(render(View::Logs, &json!({ "text": "a\nb", "cursor": 3 })), "a\nb");
        assert_eq!(render(View::States, &json!([{ "name": "api", "state": "running" }])), "api: running");
        assert_eq!(render(View::Message, &json!({ "message": "Pushed." })), "Pushed.");
        assert_eq!(render(View::Message, &json!({ "terminal": "api", "state": "stopped" })), "api: stopped");
        assert_eq!(render(View::GitStatus, &json!({ "repo": false })), "Not a git repository.");
        let gs = render(View::GitStatus, &json!({ "repo": true, "branch": "dev", "dirty": true, "ahead": 1, "behind": 0, "files": [{ "path": "a.txt", "status": "M" }] }));
        assert_eq!(gs, "dev *  ↑1 ↓0\n M a.txt");
        assert_eq!(render(View::GitLog, &json!([{ "hash": "abc1234", "subject": "init", "author": "N" }])), "abc1234 init  (N)");
        assert!(render(View::Wait, &json!({ "ok": true, "reason": "matched", "state": "running", "text": "ready", "elapsed_ms": 2100 })).contains("[ok: matched after 2.1s, state running]"));
        assert_eq!(render(View::Plain, &json!({ "a": 1 })), "{\"a\":1}");
    }

    #[test]
    fn exit_codes_let_scripts_rely_on_run_and_wait() {
        assert_eq!(exit_code(View::Run, &json!({ "exit": 3, "timedOut": false })), 3);
        assert_eq!(exit_code(View::Run, &json!({ "exit": null, "timedOut": true })), 124);
        assert_eq!(exit_code(View::Wait, &json!({ "ok": false })), 1);
        assert_eq!(exit_code(View::Wait, &json!({ "ok": true })), 0);
        assert_eq!(exit_code(View::Status, &json!([])), 0);
    }
}
