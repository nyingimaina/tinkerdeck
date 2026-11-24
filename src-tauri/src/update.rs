//! Self-update (BRS 7.13). A signed `latest.json` is fetched from the GitHub release, its ed25519
//! signature is checked against the public key built into this app, the installer's SHA-256 and size
//! are checked after download, and only then is the Inno Setup installer started silently.
//! Nothing here installs anything by itself: the caller decides (and stops running terminals first).

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// Where the signed manifest lives (`latest` skips drafts and pre-releases).
pub const OFFICIAL_BASE: &str = "https://github.com/nyingimaina/lite-commander/releases/latest/download";
/// Installers must come from this project's release downloads.
pub const OFFICIAL_RELEASES_PREFIX: &str = "https://github.com/nyingimaina/lite-commander/releases/download/";
/// Raw ed25519 public key (base64). The matching private key never leaves the maintainer's profile.
pub const PUBLIC_KEY_B64: &str = "SUAQs55am0l03CpZ+VuFU+9k9Q38+mkvajCcL4iFTDc=";

const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_INSTALLER_BYTES: u64 = 300 * 1024 * 1024;
const AUTO_CHECK_EVERY_SECS: i64 = 3600;
const DETACHED_PROCESS: u32 = 0x0000_0008;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    #[serde(default)]
    pub notes: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

// ------------------------------------------------------------------ versions

/// (major, minor, patch, is_prerelease)
pub fn parse_version(s: &str) -> Option<(u32, u32, u32, bool)> {
    let s = s.trim().trim_start_matches('v');
    let (core, pre) = match s.split_once('-') {
        Some((c, _)) => (c, true),
        None => (s, false),
    };
    let mut it = core.split('.');
    let major = it.next()?.parse().ok()?;
    let minor = it.next()?.parse().ok()?;
    let patch = it.next().map(|p| p.parse().ok()).unwrap_or(Some(0))?;
    if it.next().is_some() {
        return None;
    }
    Some((major, minor, patch, pre))
}

/// Is `candidate` strictly newer than `current`? A pre-release is never newer than the same stable number.
pub fn is_newer(current: &str, candidate: &str) -> bool {
    let (Some(c), Some(n)) = (parse_version(current), parse_version(candidate)) else { return false };
    if (n.0, n.1, n.2) != (c.0, c.1, c.2) {
        return (n.0, n.1, n.2) > (c.0, c.1, c.2);
    }
    c.3 && !n.3 // current is a pre-release of the same number, candidate is the final
}

// ------------------------------------------------------------------ manifest

/// Prefixes an installer URL may start with. `LITE_COMMANDER_UPDATE_BASE` (testing against a local
/// server) adds its own; the signature still has to verify, so this cannot be used to inject code.
pub fn base_url() -> String {
    std::env::var("LITE_COMMANDER_UPDATE_BASE").ok().filter(|s| !s.trim().is_empty()).map(|s| s.trim_end_matches('/').to_string()).unwrap_or_else(|| OFFICIAL_BASE.to_string())
}

pub fn allowed_prefixes() -> Vec<String> {
    let mut v = vec![OFFICIAL_RELEASES_PREFIX.to_string()];
    let b = base_url();
    if b != OFFICIAL_BASE {
        v.push(format!("{b}/"));
    }
    v
}

fn url_allowed(url: &str, prefixes: &[String]) -> bool {
    let has_prefix = prefixes.iter().any(|p| url.starts_with(p.as_str()));
    let no_tricks = !url.contains("..") && !url.contains('@') && !url.contains(char::is_whitespace);
    let official_https = url.starts_with("https://");
    has_prefix && no_tricks && (official_https || prefixes.iter().skip(1).any(|p| url.starts_with(p.as_str()))) && url.to_lowercase().ends_with(".exe")
}

pub fn parse_manifest(bytes: &[u8], prefixes: &[String]) -> Result<UpdateInfo, String> {
    let info: UpdateInfo = serde_json::from_slice(bytes).map_err(|e| format!("The update information is not valid ({e})."))?;
    if parse_version(&info.version).is_none() {
        return Err(format!("The update has an invalid version \"{}\".", info.version));
    }
    if info.sha256.len() != 64 || !info.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("The update has an invalid checksum.".into());
    }
    if info.size == 0 || info.size > MAX_INSTALLER_BYTES {
        return Err("The update has an invalid size.".into());
    }
    if info.notes.chars().count() > 8000 {
        return Err("The update notes are too long.".into());
    }
    if !url_allowed(&info.url, prefixes) {
        return Err("The update points outside this project's releases and was refused.".into());
    }
    Ok(UpdateInfo { sha256: info.sha256.to_lowercase(), ..info })
}

pub fn verify_signature(data: &[u8], sig_b64: &str, pubkey_b64: &str) -> Result<(), String> {
    let bad = || "The update signature is not valid, so the update was refused.".to_string();
    let key: [u8; 32] = B64.decode(pubkey_b64.trim()).map_err(|_| bad())?.try_into().map_err(|_| bad())?;
    let sig: [u8; 64] = B64.decode(sig_b64.trim()).map_err(|_| bad())?.try_into().map_err(|_| bad())?;
    let vk = VerifyingKey::from_bytes(&key).map_err(|_| bad())?;
    vk.verify_strict(data, &Signature::from_bytes(&sig)).map_err(|_| bad())
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(30))
        .user_agent(concat!("LiteCommander/", env!("CARGO_PKG_VERSION")))
        .build()
}

fn get(url: &str, max: u64) -> Result<Vec<u8>, String> {
    let resp = agent().get(url).call().map_err(|e| match e {
        ureq::Error::Status(404, _) => "No update information was found.".to_string(),
        ureq::Error::Status(code, _) => format!("The update server answered {code}."),
        ureq::Error::Transport(_) => "Could not reach the update server.".to_string(),
    })?;
    let mut out = Vec::new();
    resp.into_reader().take(max + 1).read_to_end(&mut out).map_err(|_| "The update download was interrupted.".to_string())?;
    if out.len() as u64 > max {
        return Err("The update information is unexpectedly large and was refused.".into());
    }
    Ok(out)
}

/// Fetch, verify and parse the signed manifest.
pub fn fetch_manifest(base: &str, pubkey_b64: &str, prefixes: &[String]) -> Result<UpdateInfo, String> {
    let base = base.trim_end_matches('/');
    let json = get(&format!("{base}/latest.json"), MAX_MANIFEST_BYTES)?;
    let sig = get(&format!("{base}/latest.json.sig"), 1024)?;
    verify_signature(&json, &String::from_utf8_lossy(&sig), pubkey_b64)?;
    parse_manifest(&json, prefixes)
}

/// `Some(info)` only when the published version is newer than `current`.
pub fn check(current: &str, base: &str, pubkey_b64: &str, prefixes: &[String]) -> Result<Option<UpdateInfo>, String> {
    let info = fetch_manifest(base, pubkey_b64, prefixes)?;
    Ok(is_newer(current, &info.version).then_some(info))
}

pub fn should_auto_check(auto: bool, last_checked: i64, now: i64) -> bool {
    auto && (last_checked <= 0 || now - last_checked >= AUTO_CHECK_EVERY_SECS)
}

// ------------------------------------------------------------------ download

pub fn installer_path(dir: &Path, version: &str) -> PathBuf {
    dir.join(format!("LiteCommander-Setup-{version}.exe"))
}

/// Check a file against the manifest's size and SHA-256.
pub fn verify_file(path: &Path, info: &UpdateInfo) -> Result<(), String> {
    let meta = std::fs::metadata(path).map_err(|_| "The downloaded update is missing.".to_string())?;
    if meta.len() != info.size {
        return Err("The downloaded update has the wrong size and was discarded.".into());
    }
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    if format!("{:x}", h.finalize()) != info.sha256 {
        return Err("The downloaded update does not match its checksum and was discarded.".into());
    }
    Ok(())
}

/// Download the installer into `dir`, verifying size and SHA-256 while it arrives. An already
/// verified copy is reused. `progress(done, total)` is called as bytes arrive.
pub fn download(info: &UpdateInfo, dir: &Path, prefixes: &[String], mut progress: impl FnMut(u64, u64)) -> Result<PathBuf, String> {
    if !url_allowed(&info.url, prefixes) {
        return Err("The update points outside this project's releases and was refused.".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create the update folder: {e}"))?;
    let target = installer_path(dir, &info.version);
    if target.exists() && verify_file(&target, info).is_ok() {
        progress(info.size, info.size);
        return Ok(target);
    }
    let part = target.with_extension("exe.part");
    let result = (|| -> Result<(), String> {
        let resp = agent().get(&info.url).call().map_err(|e| match e {
            ureq::Error::Status(code, _) => format!("The update server answered {code}."),
            ureq::Error::Transport(_) => "Could not reach the update server.".to_string(),
        })?;
        let mut reader = resp.into_reader();
        let mut file = std::fs::File::create(&part).map_err(|e| format!("Could not write the update: {e}"))?;
        let mut hasher = Sha256::new();
        let mut done = 0u64;
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = reader.read(&mut buf).map_err(|_| "The update download was interrupted.".to_string())?;
            if n == 0 {
                break;
            }
            done += n as u64;
            if done > info.size {
                return Err("The update is larger than announced and was discarded.".into());
            }
            hasher.update(&buf[..n]);
            file.write_all(&buf[..n]).map_err(|e| format!("Could not write the update: {e}"))?;
            progress(done, info.size);
        }
        file.flush().map_err(|e| e.to_string())?;
        if done != info.size {
            return Err("The update download was incomplete and was discarded.".into());
        }
        if format!("{:x}", hasher.finalize()) != info.sha256 {
            return Err("The downloaded update does not match its checksum and was discarded.".into());
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            let _ = std::fs::remove_file(&target);
            std::fs::rename(&part, &target).map_err(|e| format!("Could not finish the update download: {e}"))?;
            Ok(target)
        }
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            Err(e)
        }
    }
}

// ------------------------------------------------------------------- install

pub fn installer_args() -> Vec<&'static str> {
    // /update=1 makes the installer start the app again when it is done (see lite-commander.iss)
    vec!["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/update=1"]
}

/// Start the (already verified) installer detached, so it outlives this process.
pub fn launch_installer(path: &Path) -> Result<(), String> {
    std::process::Command::new(path)
        .args(installer_args())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(DETACHED_PROCESS)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not start the installer: {e}"))
}

// --------------------------------------------------------------------- cache

fn cache() -> &'static Mutex<Option<UpdateInfo>> {
    static C: OnceLock<Mutex<Option<UpdateInfo>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

pub fn set_cached(info: Option<UpdateInfo>) {
    if let Ok(mut c) = cache().lock() {
        *c = info;
    }
}

pub fn cached() -> Option<UpdateInfo> {
    cache().lock().ok().and_then(|c| c.clone())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::collections::HashMap;
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use tempfile::tempdir;

    /// Tests share one process-wide cache; hold this while touching it.
    pub(crate) fn cache_lock() -> std::sync::MutexGuard<'static, ()> {
        static L: Mutex<()> = Mutex::new(());
        L.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn key(seed: u8) -> (SigningKey, String) {
        let sk = SigningKey::from_bytes(&[seed; 32]);
        let pk = B64.encode(sk.verifying_key().to_bytes());
        (sk, pk)
    }
    pub(crate) fn sign(sk: &SigningKey, data: &[u8]) -> String {
        B64.encode(sk.sign(data).to_bytes())
    }

    // ---- a tiny local HTTP server for the network tests
    pub(crate) struct Server {
        pub(crate) base: String,
        stop: Arc<AtomicBool>,
    }
    impl Drop for Server {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
        }
    }
    pub(crate) type Route = (u16, Vec<(String, String)>, Vec<u8>);

    /// Bind first, then let `build` create the routes from the server's real address.
    pub(crate) fn serve_with(build: impl FnOnce(&str) -> HashMap<String, Route>) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let routes = build(&base);
        let stop = Arc::new(AtomicBool::new(false));
        let s2 = stop.clone();
        std::thread::spawn(move || {
            while !s2.load(Ordering::SeqCst) {
                let Ok((mut c, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(5));
                    continue;
                };
                c.set_nonblocking(false).ok();
                let mut req = Vec::new();
                let mut b = [0u8; 1024];
                while !req.windows(4).any(|w| w == b"\r\n\r\n") {
                    match c.read(&mut b) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => req.extend_from_slice(&b[..n]),
                    }
                }
                let line = String::from_utf8_lossy(&req).lines().next().unwrap_or("").to_string();
                let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
                let (code, headers, body) = routes.get(&path).cloned().unwrap_or((404, vec![], b"not found".to_vec()));
                let mut head = format!("HTTP/1.1 {code} X\r\nContent-Length: {}\r\nConnection: close\r\n", body.len());
                for (k, v) in headers {
                    head.push_str(&format!("{k}: {v}\r\n"));
                }
                head.push_str("\r\n");
                let _ = c.write_all(head.as_bytes());
                let _ = c.write_all(&body);
            }
        });
        Server { base, stop }
    }
    pub(crate) fn ok(body: Vec<u8>) -> Route {
        (200, vec![], body)
    }

    pub(crate) fn manifest(base: &str, version: &str, installer: &[u8]) -> Vec<u8> {
        serde_json::to_vec_pretty(&serde_json::json!({
            "version": version, "notes": "Faster. Fixes.", "url": format!("{base}/installer.exe"),
            "sha256": format!("{:x}", Sha256::digest(installer)), "size": installer.len()
        }))
        .unwrap()
    }
    pub(crate) fn prefixes(base: &str) -> Vec<String> {
        vec![OFFICIAL_RELEASES_PREFIX.to_string(), format!("{base}/")]
    }

    // ---- versions

    #[test]
    fn versions_parse_and_compare() {
        assert_eq!(parse_version("1.2.3"), Some((1, 2, 3, false)));
        assert_eq!(parse_version("v1.10"), Some((1, 10, 0, false)));
        assert_eq!(parse_version("2.0.0-beta.1"), Some((2, 0, 0, true)));
        for bad in ["", "x", "1", "1.2.3.4", "1.a.3", "-1.2.3"] {
            assert_eq!(parse_version(bad), None, "{bad:?}");
        }
        assert!(is_newer("1.2.0", "1.2.1") && is_newer("1.9.9", "1.10.0") && is_newer("1.2.0", "2.0.0"));
        assert!(!is_newer("1.2.0", "1.2.0") && !is_newer("1.2.1", "1.2.0") && !is_newer("2.0.0", "1.99.99"));
        assert!(!is_newer("1.2.0", "1.2.0-beta") && is_newer("1.3.0-beta", "1.3.0"));
        assert!(!is_newer("junk", "1.0.0") && !is_newer("1.0.0", "junk"));
    }

    #[test]
    fn auto_checks_are_rate_limited_and_respect_the_setting() {
        let now = 1_000_000_000;
        assert!(should_auto_check(true, 0, now));
        assert!(!should_auto_check(true, now - 600, now));
        assert!(should_auto_check(true, now - 3 * 3600, now));
        assert!(!should_auto_check(false, 0, now));
    }

    #[test]
    fn a_release_published_hours_after_the_last_check_is_found_without_a_restart() {
        // regression: a 20 h limit hid a release published an hour after the previous check
        let now = 1_000_000_000;
        assert!(should_auto_check(true, now - 2 * 3600, now));
    }

    // ---- manifest and signature

    #[test]
    fn a_valid_manifest_is_accepted_and_the_checksum_normalised() {
        let p = prefixes("http://127.0.0.1:1");
        let m = format!(r#"{{"version":"1.3.0","notes":"n","url":"{OFFICIAL_RELEASES_PREFIX}v1.3.0/LiteCommander-Setup-1.3.0.exe","sha256":"{}","size":123}}"#, "AB".repeat(32));
        let i = parse_manifest(m.as_bytes(), &p).unwrap();
        assert_eq!((i.version.as_str(), i.size), ("1.3.0", 123));
        assert_eq!(i.sha256, "ab".repeat(32));
    }

    #[test]
    fn manifests_that_could_lead_somewhere_else_are_refused() {
        let p = vec![OFFICIAL_RELEASES_PREFIX.to_string()];
        let good = |url: &str, sha: &str, size: u64, ver: &str| {
            parse_manifest(serde_json::json!({ "version": ver, "url": url, "sha256": sha, "size": size }).to_string().as_bytes(), &p)
        };
        let sha = "a".repeat(64);
        let u = format!("{OFFICIAL_RELEASES_PREFIX}v1/x.exe");
        assert!(good(&u, &sha, 10, "1.0.0").is_ok());
        assert!(good("http://github.com/nyingimaina/lite-commander/releases/download/v1/x.exe", &sha, 10, "1.0.0").is_err(), "plain http");
        assert!(good("https://evil.example/nyingimaina/lite-commander/releases/download/x.exe", &sha, 10, "1.0.0").is_err(), "other host");
        assert!(good("https://github.com/someoneelse/lite-commander/releases/download/v1/x.exe", &sha, 10, "1.0.0").is_err(), "other repo");
        assert!(good(&format!("{OFFICIAL_RELEASES_PREFIX}v1/x.msi"), &sha, 10, "1.0.0").is_err(), "not an exe");
        assert!(good(&format!("{OFFICIAL_RELEASES_PREFIX}../../evil/x.exe"), &sha, 10, "1.0.0").is_err(), "path escape");
        assert!(good(&format!("{OFFICIAL_RELEASES_PREFIX}v1@evil.com/x.exe"), &sha, 10, "1.0.0").is_err(), "credentials trick");
        assert!(good(&u, "abc", 10, "1.0.0").is_err(), "short checksum");
        assert!(good(&u, &"z".repeat(64), 10, "1.0.0").is_err(), "non-hex checksum");
        assert!(good(&u, &sha, 0, "1.0.0").is_err() && good(&u, &sha, 400 * 1024 * 1024, "1.0.0").is_err());
        assert!(good(&u, &sha, 10, "banana").is_err());
        assert!(parse_manifest(b"not json", &p).is_err());
        assert!(parse_manifest(b"{}", &p).is_err());
    }

    #[test]
    fn signatures_verify_only_for_the_right_key_and_the_exact_bytes() {
        let (sk, pk) = key(1);
        let (_, other_pk) = key(2);
        let data = b"{\"version\":\"1.3.0\"}";
        let sig = sign(&sk, data);
        assert!(verify_signature(data, &sig, &pk).is_ok());
        assert!(verify_signature(data, &format!("{sig}\n"), &pk).is_ok(), "trailing newline from the file is fine");
        assert!(verify_signature(data, &sig, &other_pk).is_err(), "wrong key");
        assert!(verify_signature(b"{\"version\":\"9.9.9\"}", &sig, &pk).is_err(), "tampered data");
        assert!(verify_signature(data, "!!!notbase64", &pk).is_err());
        assert!(verify_signature(data, &B64.encode([0u8; 10]), &pk).is_err(), "wrong length");
        assert!(verify_signature(data, &sig, "short").is_err());
    }

    #[test]
    fn the_embedded_public_key_is_a_valid_ed25519_key() {
        let raw = B64.decode(PUBLIC_KEY_B64).unwrap();
        assert_eq!(raw.len(), 32);
        assert!(VerifyingKey::from_bytes(&raw.try_into().unwrap()).is_ok());
    }

    // ---- fetching

    /// Serve manifest + signature + installer from one server.
    pub(crate) fn serve_release(version: &str, installer: &[u8], sk: &SigningKey, tamper: bool) -> Server {
        serve_with(|base| {
            let m = manifest(base, version, installer);
            let sig = sign(sk, &m);
            let served = if tamper { String::from_utf8(m.clone()).unwrap().replace(version, "9.9.9").into_bytes() } else { m };
            let mut routes = HashMap::new();
            routes.insert("/latest.json".to_string(), ok(served));
            routes.insert("/latest.json.sig".to_string(), ok(sig.into_bytes()));
            routes.insert("/installer.exe".to_string(), ok(installer.to_vec()));
            routes
        })
    }

    #[test]
    fn a_newer_signed_release_is_found() {
        let (sk, pk) = key(3);
        let installer = vec![7u8; 200_000];
        let s = serve_release("1.3.0", &installer, &sk, false);
        let found = check("1.2.0", &s.base, &pk, &prefixes(&s.base)).unwrap().expect("an update");
        assert_eq!((found.version.as_str(), found.size, found.notes.as_str()), ("1.3.0", 200_000, "Faster. Fixes."));
        assert!(check("1.3.0", &s.base, &pk, &prefixes(&s.base)).unwrap().is_none(), "same version");
        assert!(check("2.0.0", &s.base, &pk, &prefixes(&s.base)).unwrap().is_none(), "never downgrade");
    }

    #[test]
    fn a_manifest_changed_after_signing_or_signed_by_someone_else_is_refused() {
        let (sk, pk) = key(4);
        let s = serve_release("1.3.0", &[1u8; 1000], &sk, true);
        let e = check("1.2.0", &s.base, &pk, &prefixes(&s.base)).unwrap_err();
        assert!(e.contains("signature"), "{e}");
        let (_, other) = key(5);
        let s2 = serve_release("1.3.0", &[1u8; 1000], &sk, false);
        assert!(check("1.2.0", &s2.base, &other, &prefixes(&s2.base)).unwrap_err().contains("signature"));
    }

    #[test]
    fn missing_and_unreachable_servers_give_plain_messages() {
        let (_, pk) = key(6);
        let s = serve_with(|_| HashMap::new());
        assert!(check("1.0.0", &s.base, &pk, &prefixes(&s.base)).unwrap_err().contains("No update information"));
        let dead = format!("http://127.0.0.1:{}", free_port());
        assert!(check("1.0.0", &dead, &pk, &prefixes(&dead)).unwrap_err().contains("Could not reach"));
    }

    fn free_port() -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    }

    #[test]
    fn an_oversized_manifest_is_refused() {
        let (sk, pk) = key(8);
        let big = vec![b'x'; 200_000];
        let s = serve_with(|_| {
            let mut routes = HashMap::new();
            routes.insert("/latest.json".to_string(), ok(big.clone()));
            routes.insert("/latest.json.sig".to_string(), ok(sign(&sk, &big).into_bytes()));
            routes
        });
        assert!(check("1.0.0", &s.base, &pk, &prefixes(&s.base)).unwrap_err().contains("unexpectedly large"));
    }

    // ---- downloading

    fn info_for(base: &str, version: &str, installer: &[u8]) -> UpdateInfo {
        UpdateInfo {
            version: version.into(),
            notes: String::new(),
            url: format!("{base}/installer.exe"),
            sha256: format!("{:x}", Sha256::digest(installer)),
            size: installer.len() as u64,
        }
    }

    #[test]
    fn download_verifies_reports_progress_and_leaves_one_clean_file() {
        let (sk, _) = key(9);
        let installer: Vec<u8> = (0..400_000u32).map(|i| (i % 251) as u8).collect();
        let s = serve_release("1.3.0", &installer, &sk, false);
        let dir = tempdir().unwrap();
        let mut seen = Vec::new();
        let path = download(&info_for(&s.base, "1.3.0", &installer), dir.path(), &prefixes(&s.base), |d, t| seen.push((d, t))).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), installer);
        assert!(path.ends_with("LiteCommander-Setup-1.3.0.exe"));
        assert!(seen.windows(2).all(|w| w[0].0 <= w[1].0), "progress only moves forward");
        assert_eq!(seen.last(), Some(&(400_000, 400_000)));
        let leftovers: Vec<_> = std::fs::read_dir(dir.path()).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().ends_with(".part")).collect();
        assert!(leftovers.is_empty());
        // a verified copy is reused without downloading again
        let again = download(&info_for("http://127.0.0.1:1", "1.3.0", &installer), dir.path(), &prefixes("http://127.0.0.1:1"), |_, _| {}).unwrap();
        assert_eq!(again, path);
    }

    #[test]
    fn a_download_that_does_not_match_is_discarded_and_nothing_is_kept() {
        let (sk, _) = key(10);
        let installer = vec![5u8; 50_000];
        let s = serve_release("1.3.0", &installer, &sk, false);
        let dir = tempdir().unwrap();
        let p = prefixes(&s.base);
        let mut bad_hash = info_for(&s.base, "1.3.0", &installer);
        bad_hash.sha256 = "0".repeat(64);
        assert!(download(&bad_hash, dir.path(), &p, |_, _| {}).unwrap_err().contains("checksum"));
        let mut too_small = info_for(&s.base, "1.3.0", &installer);
        too_small.size = 10_000;
        assert!(download(&too_small, dir.path(), &p, |_, _| {}).unwrap_err().contains("larger than announced"));
        let mut too_big = info_for(&s.base, "1.3.0", &installer);
        too_big.size = 99_999;
        assert!(download(&too_big, dir.path(), &p, |_, _| {}).unwrap_err().contains("incomplete"));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0, "no partial or bad file may remain");
    }

    #[test]
    fn download_refuses_urls_outside_the_allowed_prefixes_before_any_request() {
        let dir = tempdir().unwrap();
        let mut i = info_for("https://example.com/x", "1.3.0", b"abc");
        i.url = "https://example.com/LiteCommander-Setup-1.3.0.exe".into();
        assert!(download(&i, dir.path(), &[OFFICIAL_RELEASES_PREFIX.to_string()], |_, _| {}).unwrap_err().contains("outside"));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn redirects_are_followed_like_github_release_downloads() {
        let installer = vec![3u8; 30_000];
        let s = serve_with(|base| {
            let mut routes = HashMap::new();
            routes.insert("/installer.exe".to_string(), (302, vec![("Location".to_string(), format!("{base}/real.bin"))], vec![]));
            routes.insert("/real.bin".to_string(), ok(installer.clone()));
            routes
        });
        let dir = tempdir().unwrap();
        let p = download(&info_for(&s.base, "1.3.0", &installer), dir.path(), &prefixes(&s.base), |_, _| {}).unwrap();
        assert_eq!(std::fs::read(p).unwrap(), installer);
    }

    #[test]
    fn verify_file_catches_truncation_and_corruption() {
        let dir = tempdir().unwrap();
        let data = vec![9u8; 1000];
        let f = dir.path().join("a.exe");
        std::fs::write(&f, &data).unwrap();
        let i = info_for("http://x", "1.0.0", &data);
        assert!(verify_file(&f, &i).is_ok());
        std::fs::write(&f, &data[..999]).unwrap();
        assert!(verify_file(&f, &i).unwrap_err().contains("wrong size"));
        let mut corrupt = data.clone();
        corrupt[500] ^= 1;
        std::fs::write(&f, &corrupt).unwrap();
        assert!(verify_file(&f, &i).unwrap_err().contains("checksum"));
        assert!(verify_file(&dir.path().join("missing.exe"), &i).is_err());
    }

    // ---- install and cache

    #[test]
    fn the_installer_runs_silently_closes_the_app_and_asks_to_relaunch() {
        let a = installer_args();
        for flag in ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/update=1"] {
            assert!(a.contains(&flag), "{flag}");
        }
    }

    #[test]
    fn the_official_base_and_prefix_point_at_this_projects_releases() {
        assert!(OFFICIAL_BASE.starts_with("https://github.com/nyingimaina/lite-commander/releases/"));
        assert!(OFFICIAL_RELEASES_PREFIX.starts_with("https://github.com/nyingimaina/lite-commander/releases/download/"));
    }

    #[test]
    fn the_cache_holds_the_latest_found_update() {
        let _g = cache_lock();
        set_cached(None);
        assert!(cached().is_none());
        let i = info_for("http://x", "1.9.0", b"x");
        set_cached(Some(i.clone()));
        assert_eq!(cached(), Some(i));
        set_cached(None);
    }
}
