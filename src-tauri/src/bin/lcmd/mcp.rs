//! `lcmd mcp`: a Model Context Protocol server on stdio (BRS 7.12). Few tools with short
//! descriptions and compact results, so the tool list and every call cost an LLM very little.

use serde_json::{json, Value};
use std::io::{BufRead, Write};

/// The guide for LLMs: printed by `lcmd llms` and installed next to the exe as README-LLM.md.
pub const LLM_GUIDE: &str = include_str!("../../../../installer/llm-readme.md");

const PROTOCOL: &str = "2024-11-05";

const INSTRUCTIONS: &str = "Controls the user's local dev apps (Lite Commander). Apps are referred to by name; terminals by name (or \"console\"). \
Cheap workflow: lc_status, then lc_up/lc_start, then lc_wait with a pattern like \"Local:\" to know when a server is ready, \
lc_logs (use the returned cursor as `since` to read only new output), lc_run for one-off commands, lc_git for git.";

fn tool(name: &str, description: &str, props: Value, required: &[&str]) -> Value {
    json!({ "name": name, "description": description, "inputSchema": { "type": "object", "properties": props, "required": required } })
}

pub fn tools() -> Value {
    let app = json!({ "type": "string", "description": "App name, unique prefix or id" });
    let term = json!({ "type": "string", "description": "Terminal name, or \"console\" / \"console:2\"" });
    json!([
        tool("lc_status", "All apps with their terminals' states (and git branch if git=true). Start here.", json!({ "git": { "type": "boolean" } }), &[]),
        tool("lc_up", "Start every terminal of an app, in order.", json!({ "app": app }), &["app"]),
        tool("lc_down", "Stop every terminal of an app; returns when they are stopped.", json!({ "app": app }), &["app"]),
        tool("lc_start", "Start one terminal (or a console).", json!({ "app": app, "terminal": term, "shell": { "type": "string", "description": "Console only: powershell.exe, pwsh.exe, cmd.exe, gitbash, wsl.exe" } }), &["app", "terminal"]),
        tool("lc_stop", "Stop one terminal and everything it started.", json!({ "app": app, "terminal": term }), &["app", "terminal"]),
        tool("lc_restart", "Stop then start one terminal.", json!({ "app": app, "terminal": term }), &["app", "terminal"]),
        tool("lc_logs", "Recent plain-text output (no colour codes). Pass the returned cursor as `since` to get only new output.", json!({ "app": app, "terminal": term, "lines": { "type": "integer", "description": "default 60, max 1000" }, "since": { "type": "integer" } }), &["app", "terminal"]),
        tool("lc_wait", "Wait until a terminal prints `pattern` (ready detection), exits, or is running. Prefer this over polling logs.", json!({ "app": app, "terminal": term, "pattern": { "type": "string" }, "until": { "type": "string", "enum": ["exit", "running", "match"] }, "timeout_s": { "type": "integer", "description": "default 60, max 600" } }), &["app", "terminal"]),
        tool("lc_send", "Type text into a running terminal (Enter is added unless enter=false).", json!({ "app": app, "terminal": term, "text": { "type": "string" }, "enter": { "type": "boolean" } }), &["app", "terminal", "text"]),
        tool("lc_run", "Run one command in the app's folder and get exit code plus the end of its output. No terminal is kept.", json!({ "app": app, "command": { "type": "string" }, "cwd": { "type": "string", "description": "Subfolder, relative to the app root" }, "shell": { "type": "string" }, "timeout_s": { "type": "integer" }, "lines": { "type": "integer" } }), &["app", "command"]),
        tool("lc_git", "Git for an app. op: status | branches | log | switch | commit | fetch | pull | push | sync. Pull is fast-forward only; push never forces.", json!({ "app": app, "op": { "type": "string", "enum": ["status", "branches", "log", "switch", "commit", "fetch", "pull", "push", "sync"] }, "branch": { "type": "string" }, "message": { "type": "string" }, "paths": { "type": "array", "items": { "type": "string" } }, "all": { "type": "boolean" }, "limit": { "type": "integer" } }), &["app", "op"]),
        tool("lc_add", "Add a project folder as an app; terminals (npm scripts, dotnet, docker compose...) are detected automatically.", json!({ "path": { "type": "string" }, "name": { "type": "string" } }), &["path"]),
        tool("lc_detect", "Preview what lc_add would detect in a folder.", json!({ "path": { "type": "string" } }), &["path"]),
        tool("lc_shells", "Shells installed on this machine.", json!({}), &[])
    ])
}

/// Engine method and params for a tool call.
pub fn route(name: &str, args: &Value) -> Result<(String, Value), String> {
    let direct = |m: &str| Ok((m.to_string(), args.clone()));
    match name {
        "lc_status" => direct("status"),
        "lc_up" => direct("app.up"),
        "lc_down" => direct("app.down"),
        "lc_start" => direct("term.start"),
        "lc_stop" => direct("term.stop"),
        "lc_restart" => direct("term.restart"),
        "lc_logs" => direct("term.logs"),
        "lc_wait" => direct("term.wait"),
        "lc_send" => direct("term.send"),
        "lc_run" => direct("run"),
        "lc_add" => direct("app.add"),
        "lc_detect" => direct("app.detect"),
        "lc_shells" => direct("shells"),
        "lc_git" => {
            let op = args.get("op").and_then(|o| o.as_str()).ok_or("Missing \"op\".")?;
            let mut a = args.clone();
            if let Some(o) = a.as_object_mut() {
                o.remove("op");
            }
            Ok((format!("git.{op}"), a))
        }
        other => Err(format!("Unknown tool \"{other}\".")),
    }
}

/// Short text for the model; compact JSON unless a plain form is cheaper and clearer.
pub fn format_result(name: &str, v: &Value) -> String {
    let str_of = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("");
    match name {
        "lc_logs" => {
            let mut foot = format!("-- cursor {}, {}", v["cursor"], str_of("state"));
            if v["truncated"] == true {
                foot.push_str(", earlier output cut");
            }
            format!("{}\n{foot}", str_of("text"))
        }
        "lc_wait" => format!(
            "{}: {} ({}) {:.1}s\n{}",
            if v["ok"] == true { "ok" } else { "not ok" },
            str_of("reason"),
            str_of("state"),
            v["elapsed_ms"].as_f64().unwrap_or(0.0) / 1000.0,
            str_of("text")
        ),
        "lc_run" => {
            let head = if v["timedOut"] == true { "timed out".to_string() } else { format!("exit {}", v["exit"]) };
            format!("{head}{}\n{}", if v["truncated"] == true { " (output cut)" } else { "" }, str_of("text"))
        }
        _ => v.to_string(),
    }
}

fn error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Handle one JSON-RPC message; `call` runs an engine method. Notifications return `None`.
pub fn handle(msg: &Value, call: &mut dyn FnMut(&str, Value) -> Result<Value, String>) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = id?; // a notification has no id and gets no reply
    match method {
        "initialize" => {
            let want = msg["params"]["protocolVersion"].as_str().unwrap_or(PROTOCOL);
            Some(json!({ "jsonrpc": "2.0", "id": id, "result": {
                "protocolVersion": want,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "lite-commander", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS
            }}))
        }
        "ping" => Some(json!({ "jsonrpc": "2.0", "id": id, "result": {} })),
        "tools/list" => Some(json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": tools() } })),
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or("");
            let args = msg["params"].get("arguments").cloned().unwrap_or_else(|| json!({}));
            let (m, params) = match route(name, &args) {
                Ok(r) => r,
                Err(e) => return Some(error(&id, -32602, &e)),
            };
            let (text, is_error) = match call(&m, params) {
                Ok(v) => (format_result(name, &v), false),
                Err(e) => (e, true),
            };
            Some(json!({ "jsonrpc": "2.0", "id": id, "result": { "content": [{ "type": "text", "text": text }], "isError": is_error } }))
        }
        other => Some(error(&id, -32601, &format!("Method not found: {other}"))),
    }
}

/// Serve MCP on stdin/stdout. The engine connection is made lazily, on the first tool call.
pub fn run_stdio() -> i32 {
    let mut client: Option<crate::client::Client> = None;
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Err(e) => Some(error(&Value::Null, -32700, &format!("Parse error: {e}"))),
            Ok(msg) => handle(&msg, &mut |method, params| {
                if client.is_none() {
                    client = Some(crate::client::Client::connect(true)?);
                }
                match client.as_mut().map(|c| c.call(method, params.clone())) {
                    Some(Err(e)) if e.starts_with("Lost the connection") || e.contains("closed the connection") => {
                        // the app restarted: reconnect once
                        client = Some(crate::client::Client::connect(true)?);
                        client.as_mut().ok_or("not connected")?.call(method, params)
                    }
                    Some(r) => r,
                    None => Err("not connected".into()),
                }
            }),
        };
        if let Some(r) = reply {
            if writeln!(out, "{r}").is_err() || out.flush().is_err() {
                break;
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(msg: Value, reply: Result<Value, String>) -> (Option<Value>, Vec<(String, Value)>) {
        let mut seen = Vec::new();
        let r = handle(&msg, &mut |m, p| {
            seen.push((m.to_string(), p));
            reply.clone()
        });
        (r, seen)
    }

    #[test]
    fn initialize_announces_tools_and_cheap_usage_instructions() {
        let (r, _) = run(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } }), Ok(json!(null)));
        let r = r.unwrap();
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert!(r["result"]["capabilities"]["tools"].is_object());
        assert_eq!(r["result"]["serverInfo"]["name"], "lite-commander");
        assert!(r["result"]["instructions"].as_str().unwrap().contains("lc_wait"));
    }

    #[test]
    fn notifications_get_no_reply_and_ping_works() {
        assert!(run(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }), Ok(json!(null))).0.is_none());
        assert_eq!(run(json!({ "jsonrpc": "2.0", "id": 5, "method": "ping" }), Ok(json!(null))).0.unwrap()["result"], json!({}));
    }

    #[test]
    fn the_tool_list_is_small_valid_and_cheap() {
        let (r, _) = run(json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }), Ok(json!(null)));
        let list = r.unwrap()["result"]["tools"].clone();
        let names: Vec<&str> = list.as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        for n in ["lc_status", "lc_up", "lc_down", "lc_start", "lc_stop", "lc_restart", "lc_logs", "lc_wait", "lc_send", "lc_run", "lc_git", "lc_add", "lc_detect", "lc_shells"] {
            assert!(names.contains(&n), "missing {n}");
        }
        for t in list.as_array().unwrap() {
            assert_eq!(t["inputSchema"]["type"], "object");
            assert!(t["description"].as_str().unwrap().len() < 260, "{}", t["name"]);
            let props = t["inputSchema"]["properties"].as_object().unwrap();
            for req in t["inputSchema"]["required"].as_array().unwrap() {
                assert!(props.contains_key(req.as_str().unwrap()), "{} requires an undeclared property", t["name"]);
            }
        }
        let size = serde_json::to_string(&list).unwrap().len();
        assert!(size < 9000, "the tool list must stay cheap, got {size} bytes");
    }

    #[test]
    fn tool_calls_map_to_engine_methods() {
        let cases = [
            ("lc_status", json!({ "git": true }), "status"),
            ("lc_up", json!({ "app": "Shop" }), "app.up"),
            ("lc_start", json!({ "app": "Shop", "terminal": "api" }), "term.start"),
            ("lc_logs", json!({ "app": "Shop", "terminal": "api", "since": 5 }), "term.logs"),
            ("lc_wait", json!({ "app": "Shop", "terminal": "web", "pattern": "Local:" }), "term.wait"),
            ("lc_send", json!({ "app": "Shop", "terminal": "console", "text": "ls" }), "term.send"),
            ("lc_run", json!({ "app": "Shop", "command": "npm test" }), "run"),
            ("lc_add", json!({ "path": "E:\\x" }), "app.add"),
        ];
        for (tool, args, method) in cases {
            let (_, seen) = run(json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": tool, "arguments": args } }), Ok(json!({})));
            assert_eq!(seen[0].0, method, "{tool}");
            assert_eq!(seen[0].1, args, "{tool}");
        }
    }

    #[test]
    fn lc_git_routes_by_op_and_drops_it_from_the_params() {
        let (_, seen) = run(
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "lc_git", "arguments": { "app": "Shop", "op": "commit", "message": "m", "all": true } } }),
            Ok(json!({ "commit": "abc1234" })),
        );
        assert_eq!(seen[0].0, "git.commit");
        assert_eq!(seen[0].1, json!({ "app": "Shop", "message": "m", "all": true }));
        let (r, seen) = run(json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "lc_git", "arguments": { "app": "Shop" } } }), Ok(json!({})));
        assert!(seen.is_empty());
        assert_eq!(r.unwrap()["error"]["code"], -32602);
    }

    #[test]
    fn results_are_compact_text_and_engine_errors_are_tool_errors_not_protocol_errors() {
        let (r, _) = run(json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "lc_status", "arguments": {} } }), Ok(json!([{ "app": "Shop", "state": "running" }])));
        let r = r.unwrap();
        assert_eq!(r["result"]["isError"], false);
        assert_eq!(r["result"]["content"][0]["text"], "[{\"app\":\"Shop\",\"state\":\"running\"}]");
        let (e, _) = run(json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "lc_up", "arguments": { "app": "zz" } } }), Err("No single app matches \"zz\".".into()));
        let e = e.unwrap();
        assert_eq!(e["result"]["isError"], true);
        assert!(e["result"]["content"][0]["text"].as_str().unwrap().contains("No single app"));
        assert!(e.get("error").is_none());
    }

    #[test]
    fn logs_wait_and_run_have_short_plain_forms() {
        assert_eq!(format_result("lc_logs", &json!({ "text": "a\nb", "cursor": 42, "state": "running", "truncated": false })), "a\nb\n-- cursor 42, running");
        assert!(format_result("lc_logs", &json!({ "text": "x", "cursor": 1, "state": "running", "truncated": true })).ends_with("earlier output cut"));
        assert_eq!(
            format_result("lc_wait", &json!({ "ok": true, "reason": "matched", "state": "running", "text": "Local: http://x", "elapsed_ms": 1500 })),
            "ok: matched (running) 1.5s\nLocal: http://x"
        );
        assert_eq!(format_result("lc_run", &json!({ "exit": 0, "timedOut": false, "text": "done", "truncated": false })), "exit 0\ndone");
        assert!(format_result("lc_run", &json!({ "exit": null, "timedOut": true, "text": "", "truncated": false })).starts_with("timed out"));
    }

    #[test]
    fn the_llm_guide_documents_every_tool_and_the_discovery_commands() {
        for t in tools().as_array().unwrap() {
            let name = t["name"].as_str().unwrap();
            assert!(LLM_GUIDE.contains(&format!("`{name}`")), "README-LLM.md does not mention {name}");
        }
        for needle in ["lcmd help", "lcmd status", "lcmd mcp install", "lcmd mcp config", "lcmd doctor", "opencode", "README-LLM.md"] {
            assert!(LLM_GUIDE.contains(needle), "guide is missing {needle}");
        }
        assert!(LLM_GUIDE.len() < 8000, "keep the guide short enough to be cheap to read");
    }

    #[test]
    fn unknown_tools_and_methods_are_protocol_errors() {
        let (r, _) = run(json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "lc_nope" } }), Ok(json!({})));
        assert_eq!(r.unwrap()["error"]["code"], -32602);
        let (r, _) = run(json!({ "jsonrpc": "2.0", "id": 4, "method": "resources/list" }), Ok(json!({})));
        assert_eq!(r.unwrap()["error"]["code"], -32601);
    }
}
