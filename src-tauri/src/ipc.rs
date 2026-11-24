//! Local control channel for `lcmd` and the MCP server (BRS 7.12).
//!
//! Newline-delimited JSON over TCP on 127.0.0.1 only. A random token, written to `engine.json` in
//! the user's own profile folder, must accompany every request, so only processes running as this
//! user can drive the app. Request:  {"id":1,"token":"…","method":"status","params":{}}
//! Response: {"id":1,"ok":true,"result":…}  or  {"id":1,"ok":false,"error":"…"}

use crate::engine::Engine;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

pub const ENGINE_FILE: &str = "engine.json";
const MAX_LINE: u64 = 1024 * 1024;

pub struct Handle {
    pub port: u16,
    /// Published in engine.json; read back by the tests.
    #[cfg_attr(not(test), allow(dead_code))]
    pub token: String,
}

/// Answer one request line. Never panics; always returns one JSON line.
pub fn handle_line(engine: &Engine, token: &str, line: &str) -> String {
    let v: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => return json!({ "id": null, "ok": false, "error": format!("Invalid JSON: {e}") }).to_string(),
    };
    let id = v.get("id").cloned().unwrap_or(Value::Null);
    if v.get("token").and_then(|t| t.as_str()) != Some(token) {
        return json!({ "id": id, "ok": false, "error": "Unauthorized." }).to_string();
    }
    let Some(method) = v.get("method").and_then(|m| m.as_str()) else {
        return json!({ "id": id, "ok": false, "error": "Missing \"method\"." }).to_string();
    };
    let params = v.get("params").cloned().unwrap_or_else(|| json!({}));
    match engine.call(method, &params) {
        Ok(r) => json!({ "id": id, "ok": true, "result": r }).to_string(),
        Err(e) => json!({ "id": id, "ok": false, "error": e }).to_string(),
    }
}

fn serve_connection(engine: Arc<Engine>, token: String, stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(900)));
    let Ok(read_half) = stream.try_clone() else { return };
    let mut reader = BufReader::new(read_half);
    let mut out = stream;
    loop {
        let mut line = String::new();
        match reader.by_ref().take(MAX_LINE).read_line(&mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if line.trim().is_empty() {
            continue;
        }
        let reply = handle_line(&engine, &token, line.trim());
        if out.write_all(reply.as_bytes()).is_err() || out.write_all(b"\n").is_err() || out.flush().is_err() {
            return;
        }
    }
}

/// Start listening and publish port, token and pid in `engine.json`.
pub fn start(engine: Arc<Engine>, config_dir: &Path) -> Result<Handle, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("Could not open the control port: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = uuid::Uuid::new_v4().simple().to_string() + &uuid::Uuid::new_v4().simple().to_string();
    write_engine_file(config_dir, port, &token)?;
    let t2 = token.clone();
    std::thread::Builder::new()
        .name("ipc-accept".into())
        .spawn(move || {
            for conn in listener.incoming().flatten() {
                let (e, t) = (engine.clone(), t2.clone());
                let _ = std::thread::Builder::new().name("ipc-conn".into()).spawn(move || serve_connection(e, t, conn));
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(Handle { port, token })
}

fn write_engine_file(dir: &Path, port: u16, token: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let body = json!({ "port": port, "token": token, "pid": std::process::id(), "version": env!("CARGO_PKG_VERSION") }).to_string();
    let tmp = dir.join(format!("{ENGINE_FILE}.tmp"));
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(ENGINE_FILE)).map_err(|e| e.to_string())
}

/// Remove the published endpoint (on a clean exit); a stale file after a crash is harmless because
/// clients treat a refused connection as "not running".
pub fn cleanup(dir: &Path) {
    let _ = std::fs::remove_file(dir.join(ENGINE_FILE));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::AppState;
    use crate::config::ConfigStore;
    use crate::runtime::Runtime;
    use parking_lot::Mutex;
    use tempfile::tempdir;

    fn engine(dir: &Path) -> Arc<Engine> {
        let store = ConfigStore::load(dir);
        let rt = Runtime::new(Arc::new(|_| {}));
        let state = Arc::new(AppState { config: Mutex::new(store), rt, config_dir: dir.to_path_buf(), job_warning: None });
        Arc::new(Engine::new(state, Arc::new(|| {})))
    }

    fn reply(line: &str, e: &Engine, token: &str) -> Value {
        serde_json::from_str(&handle_line(e, token, line)).unwrap()
    }

    #[test]
    fn requests_need_the_token_and_a_method_and_valid_json() {
        let d = tempdir().unwrap();
        let e = engine(d.path());
        let ok = reply(r#"{"id":7,"token":"t","method":"ping"}"#, &e, "t");
        assert_eq!((ok["id"].as_i64(), ok["ok"].as_bool()), (Some(7), Some(true)));
        assert_eq!(ok["result"]["version"], env!("CARGO_PKG_VERSION"));
        let bad = reply(r#"{"id":8,"token":"WRONG","method":"ping"}"#, &e, "t");
        assert_eq!((bad["ok"].as_bool(), bad["error"].as_str()), (Some(false), Some("Unauthorized.")));
        assert_eq!(bad["id"], 8);
        assert_eq!(reply(r#"{"id":9,"method":"ping"}"#, &e, "t")["error"], "Unauthorized.");
        assert!(reply(r#"{"id":1,"token":"t"}"#, &e, "t")["error"].as_str().unwrap().contains("method"));
        assert!(reply("not json", &e, "t")["error"].as_str().unwrap().contains("Invalid JSON"));
    }

    #[test]
    fn engine_errors_come_back_as_ok_false_not_a_dropped_connection() {
        let d = tempdir().unwrap();
        let e = engine(d.path());
        let r = reply(r#"{"id":1,"token":"t","method":"term.start","params":{"app":"x","terminal":"y"}}"#, &e, "t");
        assert_eq!(r["ok"], false);
        assert!(r["error"].as_str().unwrap().contains("no apps"), "{r}");
    }

    #[test]
    fn the_server_publishes_its_endpoint_and_serves_several_requests_on_one_connection() {
        let d = tempdir().unwrap();
        let h = start(engine(d.path()), d.path()).unwrap();
        let file: Value = serde_json::from_str(&std::fs::read_to_string(d.path().join(ENGINE_FILE)).unwrap()).unwrap();
        assert_eq!(file["port"], h.port);
        assert_eq!(file["token"], h.token);
        assert_eq!(file["pid"], std::process::id());
        assert!(h.token.len() >= 32);

        let mut s = TcpStream::connect(("127.0.0.1", h.port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let mut r = BufReader::new(s.try_clone().unwrap());
        for i in 0..3 {
            writeln!(s, "{}", json!({ "id": i, "token": h.token, "method": "ping" })).unwrap();
            let mut line = String::new();
            r.read_line(&mut line).unwrap();
            let v: Value = serde_json::from_str(&line).unwrap();
            assert_eq!((v["id"].as_i64(), v["ok"].as_bool()), (Some(i), Some(true)));
        }
        writeln!(s, "garbage").unwrap();
        let mut line = String::new();
        r.read_line(&mut line).unwrap();
        assert!(line.contains("Invalid JSON"));
        writeln!(s, "{}", json!({ "id": 99, "token": "nope", "method": "ping" })).unwrap();
        line.clear();
        r.read_line(&mut line).unwrap();
        assert!(line.contains("Unauthorized"));
    }

    #[test]
    fn it_only_listens_on_loopback_and_cleanup_removes_the_file() {
        let d = tempdir().unwrap();
        let h = start(engine(d.path()), d.path()).unwrap();
        let t = TcpStream::connect(("127.0.0.1", h.port)).unwrap();
        assert!(t.peer_addr().unwrap().ip().is_loopback());
        cleanup(d.path());
        assert!(!d.path().join(ENGINE_FILE).exists());
    }

    #[test]
    fn two_servers_get_different_ports_and_tokens() {
        let (a, b) = (tempdir().unwrap(), tempdir().unwrap());
        let (h1, h2) = (start(engine(a.path()), a.path()).unwrap(), start(engine(b.path()), b.path()).unwrap());
        assert_ne!(h1.port, h2.port);
        assert_ne!(h1.token, h2.token);
    }
}
