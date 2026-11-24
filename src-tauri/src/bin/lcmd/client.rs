//! Talks to the running Lite Commander engine over its local control channel (BRS 7.12).

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::time::{Duration, Instant};

const DETACHED_PROCESS: u32 = 0x0000_0008;

pub fn config_dir() -> PathBuf {
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    appdata.join("com.litecommander.app")
}

#[derive(Debug, PartialEq, Eq)]
pub struct Endpoint {
    pub port: u16,
    pub token: String,
}

pub fn parse_endpoint(text: &str) -> Option<Endpoint> {
    let v: Value = serde_json::from_str(text).ok()?;
    Some(Endpoint { port: u16::try_from(v.get("port")?.as_u64()?).ok()?, token: v.get("token")?.as_str()?.to_string() })
}

fn read_endpoint() -> Option<Endpoint> {
    parse_endpoint(&std::fs::read_to_string(config_dir().join("engine.json")).ok()?)
}

pub struct Client {
    reader: BufReader<TcpStream>,
    writer: TcpStream,
    token: String,
    next_id: u64,
}

impl Client {
    fn try_connect() -> Option<Client> {
        let ep = read_endpoint()?;
        let s = TcpStream::connect_timeout(&format!("127.0.0.1:{}", ep.port).parse().ok()?, Duration::from_millis(800)).ok()?;
        s.set_read_timeout(Some(Duration::from_secs(900))).ok()?;
        let writer = s.try_clone().ok()?;
        Some(Client { reader: BufReader::new(s), writer, token: ep.token, next_id: 1 })
    }

    /// Connect to the running app; if it is not running and `autostart` is set, start it hidden.
    pub fn connect(autostart: bool) -> Result<Client, String> {
        if let Some(c) = Client::try_connect() {
            return Ok(c);
        }
        if !autostart {
            return Err("Lite Commander is not running. Start it with `lcmd ui`, or run any other lcmd command to start it in the background.".into());
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let app = exe.parent().map(|d| d.join("lite-commander.exe")).filter(|p| p.is_file()).ok_or("Could not find lite-commander.exe next to lcmd.exe.")?;
        spawn_detached(&app, &["--background"]).map_err(|e| format!("Could not start Lite Commander: {e}"))?;
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(25) {
            if let Some(c) = Client::try_connect() {
                return Ok(c);
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        Err("Started Lite Commander but it did not become ready in 25 seconds.".into())
    }

    /// One request, one reply. Engine errors come back as `Err(message)`.
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let req = json!({ "id": id, "token": self.token, "method": method, "params": params });
        writeln!(self.writer, "{req}").map_err(|e| format!("Lost the connection: {e}"))?;
        self.writer.flush().map_err(|e| e.to_string())?;
        let mut line = String::new();
        let n = self.reader.read_line(&mut line).map_err(|e| format!("Lost the connection: {e}"))?;
        if n == 0 {
            return Err("Lite Commander closed the connection.".into());
        }
        parse_reply(&line)
    }
}

pub fn parse_reply(line: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(line.trim()).map_err(|e| format!("Bad reply from Lite Commander: {e}"))?;
    if v.get("ok").and_then(|o| o.as_bool()) == Some(true) {
        Ok(v.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(v.get("error").and_then(|e| e.as_str()).unwrap_or("Unknown error.").to_string())
    }
}

/// Start the window (not hidden) and return.
pub fn open_ui() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let app = exe.parent().map(|d| d.join("lite-commander.exe")).filter(|p| p.is_file()).ok_or("Could not find lite-commander.exe next to lcmd.exe.")?;
    spawn_detached(&app, &[]).map_err(|e| e.to_string())
}

/// Windows hands a child *every* inheritable handle, even when its own stdio is redirected to NUL.
/// Our stdout/stderr may be a pipe owned by a script or an LLM client; if the background app kept a
/// copy of it, that client would never see end-of-file. Our own handles keep working: this only
/// stops them being passed on.
fn uninherit_std_handles() {
    use windows_sys::Win32::Foundation::{SetHandleInformation, HANDLE_FLAG_INHERIT};
    use windows_sys::Win32::System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
    for which in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        // SAFETY: plain Win32 calls on the process's own standard handles; failures are ignored.
        unsafe {
            let h = GetStdHandle(which);
            if !h.is_null() && h as isize != -1 {
                SetHandleInformation(h, HANDLE_FLAG_INHERIT, 0);
            }
        }
    }
}

/// Start the window app so that it shares nothing with this process. In particular it must not
/// inherit our stdout/stderr pipes: a caller capturing our output (a script, an LLM client) would
/// otherwise wait for the app to exit before it sees end-of-file.
fn spawn_detached(app: &std::path::Path, args: &[&str]) -> std::io::Result<()> {
    uninherit_std_handles();
    std::process::Command::new(app)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(DETACHED_PROCESS)
        .spawn()
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_file_parses_and_rejects_junk() {
        assert_eq!(parse_endpoint(r#"{"port":51234,"token":"abc","pid":1}"#), Some(Endpoint { port: 51234, token: "abc".into() }));
        assert_eq!(parse_endpoint(r#"{"port":99999999,"token":"abc"}"#), None);
        assert_eq!(parse_endpoint(r#"{"port":1}"#), None);
        assert_eq!(parse_endpoint("nope"), None);
    }

    #[test]
    fn replies_map_to_ok_or_the_engine_message() {
        assert_eq!(parse_reply(r#"{"id":1,"ok":true,"result":{"a":1}}"#).unwrap()["a"], 1);
        assert_eq!(parse_reply(r#"{"id":1,"ok":false,"error":"No app."}"#).unwrap_err(), "No app.");
        assert!(parse_reply("garbage").unwrap_err().contains("Bad reply"));
        assert_eq!(parse_reply(r#"{"id":1,"ok":true}"#).unwrap(), Value::Null);
    }

    #[test]
    fn the_config_folder_matches_the_app() {
        assert!(config_dir().ends_with("com.litecommander.app"));
    }
}
