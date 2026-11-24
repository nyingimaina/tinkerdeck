//! Finding colour themes (BRS 7.16): the public Open VSX registry, and the VS Code themes already on
//! this PC. Theme files are read out of an extension package in memory (nothing is unpacked to disk),
//! and the registry is the only server ever contacted.

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

pub const REGISTRY: &str = "https://open-vsx.org";
const MAX_VSIX: u64 = 25 * 1024 * 1024;
const MAX_JSON_RESPONSE: u64 = 2 * 1024 * 1024;
const MAX_MANIFEST: u64 = 512 * 1024;
const MAX_THEME_FILE: u64 = 2 * 1024 * 1024;
const MAX_FILES: usize = 40;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub description: String,
    pub downloads: u64,
    pub version: String,
    pub icon: Option<String>,
    /// "online" or "local"
    pub source: String,
    /// online: `publisher/name`; local: the extension's folder
    pub location: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeRef {
    pub label: String,
    pub ui_theme: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Package {
    pub themes: Vec<ThemeRef>,
    /// Theme files (and the JSON files beside them, which an `include` may name), by relative path.
    pub files: BTreeMap<String, String>,
}

pub type Getter<'a> = &'a dyn Fn(&str, u64) -> Result<Vec<u8>, String>;

// ------------------------------------------------------------------ helpers

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

pub fn valid_ref(namespace: &str, name: &str) -> bool {
    let ok = |s: &str| !s.is_empty() && s.len() <= 100 && !s.starts_with('.') && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    ok(namespace) && ok(name)
}

/// A path inside a package: no climbing out, no drive letters.
fn clean_rel(p: &str) -> Option<String> {
    let p = p.replace('\\', "/");
    let p = p.trim_start_matches("./").to_string();
    if p.is_empty() || p.starts_with('/') || p.contains(':') || p.split('/').any(|s| s == ".." || s.is_empty()) {
        return None;
    }
    Some(p)
}

fn dir_of(rel: &str) -> String {
    rel.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default()
}

fn parse_manifest(text: &str) -> Result<Value, String> {
    serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| "The extension's package.json could not be read.".to_string())
}

fn package_themes(pkg: &Value) -> Vec<ThemeRef> {
    pkg.get("contributes")
        .and_then(|c| c.get("themes"))
        .and_then(|t| t.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|t| {
                    let path = clean_rel(t.get("path")?.as_str()?)?;
                    let label = t.get("label").and_then(|l| l.as_str()).filter(|l| !l.starts_with('%')).map(|l| l.to_string()).unwrap_or_else(|| path.clone());
                    let ui = t.get("uiTheme").and_then(|l| l.as_str()).unwrap_or("vs-dark").to_string();
                    Some(ThemeRef { label, ui_theme: ui, path })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn text_of(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim_start_matches('\u{feff}').to_string()
}

// ------------------------------------------------------------------ search

pub fn search_url(query: &str) -> String {
    let q = query.trim();
    let query_part = if q.is_empty() { String::new() } else { format!("query={}&", encode(q)) };
    format!("{REGISTRY}/api/-/search?{query_part}category=Themes&size=30&sortBy=downloadCount&sortOrder=desc")
}

pub fn parse_search(json: &str) -> Result<Vec<Entry>, String> {
    let v: Value = serde_json::from_str(json).map_err(|_| "The theme registry sent something unexpected.".to_string())?;
    Ok(v.get("extensions")
        .and_then(|e| e.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|e| {
                    let name = e.get("name")?.as_str()?;
                    let ns = e.get("namespace")?.as_str()?;
                    if !valid_ref(ns, name) {
                        return None;
                    }
                    let s = |k: &str| e.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
                    Some(Entry {
                        id: format!("{ns}.{name}"),
                        name: e.get("displayName").and_then(|x| x.as_str()).filter(|x| !x.is_empty()).unwrap_or(name).to_string(),
                        publisher: ns.to_string(),
                        description: s("description"),
                        downloads: e.get("downloadCount").and_then(|x| x.as_u64()).unwrap_or(0),
                        version: s("version"),
                        icon: e.get("files").and_then(|f| f.get("icon")).and_then(|i| i.as_str()).map(|i| i.to_string()),
                        source: "online".into(),
                        location: format!("{ns}/{name}"),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

pub fn search_online(query: &str, get: Getter) -> Result<Vec<Entry>, String> {
    let body = get(&search_url(query), MAX_JSON_RESPONSE)?;
    parse_search(&text_of(&body))
}

// ------------------------------------------------------------------ packages

/// The themes inside a `.vsix` (a zip file), read in memory.
pub fn read_package(bytes: &[u8]) -> Result<Package, String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| "That is not a valid extension package.".to_string())?;
    let manifest = {
        let mut f = zip.by_name("extension/package.json").map_err(|_| "The extension package has no package.json.".to_string())?;
        if f.size() > MAX_MANIFEST {
            return Err("The extension's package.json is too large.".into());
        }
        let mut buf = Vec::new();
        f.by_ref().take(MAX_MANIFEST).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        parse_manifest(&text_of(&buf))?
    };
    let refs = package_themes(&manifest);
    let dirs: Vec<String> = refs.iter().map(|t| dir_of(&t.path)).collect();
    let mut files = BTreeMap::new();
    for i in 0..zip.len() {
        if files.len() >= MAX_FILES {
            break;
        }
        let mut f = match zip.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let Some(rel) = f.name().strip_prefix("extension/").and_then(clean_rel) else { continue };
        if !rel.to_lowercase().ends_with(".json") || !dirs.contains(&dir_of(&rel)) || f.size() > MAX_THEME_FILE {
            continue;
        }
        let mut buf = Vec::new();
        if f.by_ref().take(MAX_THEME_FILE).read_to_end(&mut buf).is_ok() {
            files.insert(rel, text_of(&buf));
        }
    }
    let themes: Vec<ThemeRef> = refs.into_iter().filter(|t| files.contains_key(&t.path)).collect();
    if themes.is_empty() {
        return Err("This extension has no colour themes.".into());
    }
    Ok(Package { themes, files })
}

pub fn fetch_online(namespace: &str, name: &str, get: Getter) -> Result<Package, String> {
    if !valid_ref(namespace, name) {
        return Err("That is not a valid extension name.".into());
    }
    let meta: Value = serde_json::from_str(&text_of(&get(&format!("{REGISTRY}/api/{namespace}/{name}"), MAX_JSON_RESPONSE)?))
        .map_err(|_| "The theme registry sent something unexpected.".to_string())?;
    let files = meta.get("files").ok_or("The registry has no download for this extension.")?;
    let download = files.get("download").and_then(|d| d.as_str()).ok_or("The registry has no download for this extension.")?;
    let bytes = get(download, MAX_VSIX)?;
    if let Some(sha_url) = files.get("sha256").and_then(|d| d.as_str()) {
        let expected = text_of(&get(sha_url, 1024)?).split_whitespace().next().unwrap_or("").to_lowercase();
        let actual = format!("{:x}", Sha256::digest(&bytes));
        if expected != actual {
            return Err("The download did not match its checksum, so it was not used.".into());
        }
    }
    read_package(&bytes)
}

/// The only network access: the theme registry, over https. (Redirects to its file storage are followed.)
pub fn http_get(url: &str, cap: u64) -> Result<Vec<u8>, String> {
    if !url.starts_with(&format!("{REGISTRY}/")) || url.contains('@') {
        return Err("That address is not allowed.".into());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(40))
        .user_agent(concat!("Tinkerdeck/", env!("CARGO_PKG_VERSION")))
        .build();
    let resp = agent.get(url).call().map_err(|e| match e {
        ureq::Error::Status(c, _) => format!("The theme registry answered with an error ({c})."),
        _ => "Could not reach the theme registry. Check your internet connection.".to_string(),
    })?;
    let mut buf = Vec::new();
    resp.into_reader().take(cap + 1).read_to_end(&mut buf).map_err(|_| "The download was interrupted.".to_string())?;
    if buf.len() as u64 > cap {
        return Err("The download is too large.".into());
    }
    Ok(buf)
}

// ------------------------------------------------------------------ themes already on this PC

/// Where VS Code and its relatives keep installed extensions.
pub fn local_roots(home: &Path) -> Vec<PathBuf> {
    [".vscode", ".vscode-insiders", ".vscode-oss", ".cursor", ".windsurf"].iter().map(|d| home.join(d).join("extensions")).collect()
}

pub fn scan_local(roots: &[PathBuf]) -> Vec<Entry> {
    let mut out = Vec::new();
    for root in roots {
        let Ok(rd) = std::fs::read_dir(root) else { continue };
        let mut dirs: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        for dir in dirs {
            let Ok(text) = std::fs::read_to_string(dir.join("package.json")) else { continue };
            let Ok(pkg) = parse_manifest(&text) else { continue };
            if package_themes(&pkg).is_empty() {
                continue;
            }
            let s = |k: &str| pkg.get(k).and_then(|x| x.as_str()).filter(|x| !x.starts_with('%')).unwrap_or("").to_string();
            let short = s("name");
            let folder = dir.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
            out.push(Entry {
                id: folder.clone(),
                name: if !s("displayName").is_empty() { s("displayName") } else if !short.is_empty() { short } else { folder },
                publisher: s("publisher"),
                description: s("description"),
                downloads: 0,
                version: s("version"),
                icon: None,
                source: "local".into(),
                location: dir.to_string_lossy().to_string(),
            });
        }
    }
    out
}

/// Read an installed extension's themes. The folder must be one of the known extension folders.
pub fn read_local(dir: &Path, roots: &[PathBuf]) -> Result<Package, String> {
    let canon = std::fs::canonicalize(dir).map_err(|_| "That extension is not an installed extension.".to_string())?;
    let inside = roots.iter().filter_map(|r| std::fs::canonicalize(r).ok()).any(|r| canon.starts_with(&r) && canon != r);
    if !inside {
        return Err("That folder is not an installed extension.".into());
    }
    let pkg = parse_manifest(&std::fs::read_to_string(canon.join("package.json")).map_err(|_| "The extension has no package.json.".to_string())?)?;
    let refs = package_themes(&pkg);
    let dirs: Vec<String> = refs.iter().map(|t| dir_of(&t.path)).collect();
    let mut files = BTreeMap::new();
    for d in dirs.iter().collect::<std::collections::BTreeSet<_>>() {
        let folder = if d.is_empty() { canon.clone() } else { canon.join(d) };
        let Ok(rd) = std::fs::read_dir(&folder) else { continue };
        for e in rd.filter_map(|e| e.ok()) {
            let p = e.path();
            if files.len() >= MAX_FILES || !p.is_file() || p.extension().map(|x| x.to_string_lossy().to_lowercase()) != Some("json".into()) {
                continue;
            }
            let rel = if d.is_empty() { e.file_name().to_string_lossy().to_string() } else { format!("{d}/{}", e.file_name().to_string_lossy()) };
            let ok_size = std::fs::metadata(&p).map(|m| m.len() <= MAX_THEME_FILE).unwrap_or(false);
            let inside_dir = std::fs::canonicalize(&p).map(|c| c.starts_with(&canon)).unwrap_or(false);
            if ok_size && inside_dir {
                if let Ok(bytes) = std::fs::read(&p) {
                    files.insert(rel, text_of(&bytes));
                }
            }
        }
    }
    let themes: Vec<ThemeRef> = refs.into_iter().filter(|t| files.contains_key(&t.path)).collect();
    if themes.is_empty() {
        return Err("This extension has no colour themes.".into());
    }
    Ok(Package { themes, files })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::collections::HashMap;
    use std::io::Write;
    use tempfile::TempDir;

    fn vsix(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, content) in entries {
            w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(content.as_bytes()).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    const PKG: &str = r#"{ "name": "x", "publisher": "p", "contributes": { "themes": [
        { "label": "Night", "uiTheme": "vs-dark", "path": "./themes/night.json" },
        { "label": "Day", "uiTheme": "vs", "path": "themes/day.json" }
    ] } }"#;

    fn standard() -> Vec<u8> {
        vsix(&[
            ("extension/package.json", PKG),
            ("extension/themes/night.json", r#"{"colors":{}}"#),
            ("extension/themes/day.json", r#"{"include":"./base.json"}"#),
            ("extension/themes/base.json", r#"{"tokenColors":[]}"#),
            ("extension/README.md", "# hi"),
            ("extension/node_modules/x.json", "{}"),
        ])
    }

    // ---- search results

    #[test]
    fn search_results_become_entries() {
        let json = r##"{"offset":0,"totalSize":2,"extensions":[
          {"name":"theme-dracula","namespace":"dracula-theme","displayName":"Dracula Theme Official","description":"A dark theme","downloadCount":473359,"version":"2.25.1",
           "files":{"download":"https://open-vsx.org/api/dracula-theme/theme-dracula/2.25.1/file/a.vsix","icon":"https://open-vsx.org/api/x/icon.png"}},
          {"name":"plain","namespace":"someone","downloadCount":5,"version":"1.0.0","files":{"download":"https://open-vsx.org/api/someone/plain/1.0.0/file/b.vsix"}}]}"##;
        let e = parse_search(json).unwrap();
        assert_eq!(e.len(), 2);
        assert_eq!((e[0].id.as_str(), e[0].name.as_str(), e[0].publisher.as_str()), ("dracula-theme.theme-dracula", "Dracula Theme Official", "dracula-theme"));
        assert_eq!((e[0].downloads, e[0].location.as_str(), e[0].source.as_str()), (473359, "dracula-theme/theme-dracula", "online"));
        assert!(e[0].icon.as_deref().unwrap().ends_with("icon.png"));
        assert_eq!(e[1].name, "plain", "no display name: use the short name");
        assert_eq!(e[1].icon, None);
        assert!(parse_search("not json").is_err());
        assert!(parse_search("{}").unwrap().is_empty());
    }

    #[test]
    fn the_search_asks_for_themes_and_escapes_what_was_typed() {
        let u = search_url("one dark & more");
        assert!(u.starts_with("https://open-vsx.org/api/-/search?"));
        assert!(u.contains("category=Themes"));
        assert!(u.contains("query=one%20dark%20%26%20more"), "{u}");
        assert!(search_url("").contains("sortBy=downloadCount"), "an empty search lists the popular ones");
    }

    #[test]
    fn only_plain_publisher_and_extension_names_are_accepted() {
        assert!(valid_ref("dracula-theme", "theme-dracula"));
        assert!(valid_ref("Dracula-2", "dracula.2_x"));
        for (a, b) in [("", "x"), ("x", ""), ("a/b", "c"), ("a", "../c"), ("a b", "c"), ("a", "c?x=1"), ("a", "c#d")] {
            assert!(!valid_ref(a, b), "{a} {b}");
        }
    }

    // ---- reading a package

    #[test]
    fn a_vsix_yields_its_themes_and_the_theme_files_beside_them() {
        let p = read_package(&standard()).unwrap();
        assert_eq!(p.themes.iter().map(|t| (t.label.as_str(), t.ui_theme.as_str(), t.path.as_str())).collect::<Vec<_>>(), vec![("Night", "vs-dark", "themes/night.json"), ("Day", "vs", "themes/day.json")]);
        assert!(p.files.contains_key("themes/night.json"));
        assert!(p.files.contains_key("themes/base.json"), "files an include may refer to");
        assert!(!p.files.contains_key("README.md") && !p.files.keys().any(|k| k.contains("node_modules")));
    }

    #[test]
    fn theme_paths_that_climb_out_of_the_package_are_dropped() {
        let pkg = r#"{"contributes":{"themes":[{"label":"Bad","uiTheme":"vs-dark","path":"../../evil.json"},{"label":"Good","uiTheme":"vs-dark","path":"./t.json"}]}}"#;
        let p = read_package(&vsix(&[("extension/package.json", pkg), ("extension/t.json", "{}"), ("evil.json", "{}")])).unwrap();
        assert_eq!(p.themes.len(), 1);
        assert_eq!(p.themes[0].label, "Good");
    }

    #[test]
    fn a_package_without_themes_or_without_a_manifest_is_refused_plainly() {
        assert!(read_package(&vsix(&[("extension/package.json", r#"{"name":"x"}"#)])).unwrap_err().contains("no colour themes"));
        assert!(read_package(&vsix(&[("extension/readme.md", "x")])).unwrap_err().contains("package.json"));
        assert!(read_package(b"this is not a zip").unwrap_err().contains("package"));
    }

    #[test]
    fn a_byte_order_mark_in_the_manifest_is_fine() {
        let pkg = format!("\u{feff}{PKG}");
        let p = read_package(&vsix(&[("extension/package.json", pkg.as_str()), ("extension/themes/night.json", "{}"), ("extension/themes/day.json", "{}")])).unwrap();
        assert_eq!(p.themes.len(), 2);
    }

    // ---- themes already installed in VS Code and friends

    fn ext(root: &std::path::Path, folder: &str, pkg: &str, files: &[(&str, &str)]) {
        let d = root.join(folder);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("package.json"), pkg).unwrap();
        for (n, c) in files {
            let f = d.join(n);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, c).unwrap();
        }
    }

    #[test]
    fn installed_extensions_with_themes_are_listed_and_the_rest_ignored() {
        let t = TempDir::new().unwrap();
        let root = t.path().join("extensions");
        ext(&root, "azemoh.one-monokai-0.5.2", r#"{"name":"one-monokai","publisher":"azemoh","displayName":"One Monokai Theme","description":"d","version":"0.5.2","contributes":{"themes":[{"label":"One Monokai","uiTheme":"vs-dark","path":"./themes/m.json"}]}}"#, &[("themes/m.json", "{}")]);
        ext(&root, "ms.nothemes-1.0.0", r#"{"name":"x","publisher":"ms","contributes":{"commands":[]}}"#, &[]);
        ext(&root, "broken-1.0.0", "{ not json", &[]);
        ext(&root, "pub.localized-1.0.0", r#"{"name":"localized","publisher":"pub","displayName":"%ext.name%","contributes":{"themes":[{"label":"L","uiTheme":"vs","path":"t.json"}]}}"#, &[("t.json", "{}")]);
        let found = scan_local(&[root.clone(), t.path().join("missing")]);
        assert_eq!(found.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), vec!["One Monokai Theme", "localized"]);
        assert_eq!((found[0].publisher.as_str(), found[0].source.as_str(), found[0].version.as_str()), ("azemoh", "local", "0.5.2"));
        assert!(found[0].location.ends_with("azemoh.one-monokai-0.5.2"));
    }

    #[test]
    fn a_local_extension_is_read_from_disk_but_only_inside_the_known_folders() {
        let t = TempDir::new().unwrap();
        let root = t.path().join("extensions");
        ext(&root, "a.b-1", PKG, &[("themes/night.json", r#"{"colors":{}}"#), ("themes/day.json", "{}"), ("secret.txt", "no")]);
        let dir = root.join("a.b-1");
        let p = read_local(&dir, std::slice::from_ref(&root)).unwrap();
        assert_eq!(p.themes.len(), 2);
        assert!(p.files["themes/night.json"].contains("colors"));
        assert!(!p.files.contains_key("secret.txt"));
        let outside = t.path().join("elsewhere");
        ext(&t.path().join("elsewhere"), "x-1", PKG, &[("themes/night.json", "{}")]);
        assert!(read_local(&outside.join("x-1"), std::slice::from_ref(&root)).unwrap_err().contains("not an installed"));
        assert!(read_local(&root.join("..").join("elsewhere").join("x-1"), &[root]).is_err(), "a path that climbs out is refused");
    }

    #[test]
    fn the_places_themes_are_installed_cover_vs_code_and_its_relatives() {
        let roots = local_roots(std::path::Path::new("C:\\Users\\me"));
        let has = |s: &str| roots.iter().any(|r| r.to_string_lossy().replace('\\', "/").ends_with(s));
        assert!(has(".vscode/extensions") && has(".vscode-insiders/extensions") && has(".cursor/extensions") && has(".vscode-oss/extensions"));
    }

    // ---- downloading

    fn getter(map: HashMap<String, Vec<u8>>) -> impl Fn(&str, u64) -> Result<Vec<u8>, String> {
        move |url, _| map.get(url).cloned().ok_or_else(|| format!("unexpected request {url}"))
    }

    fn online(sha_override: Option<&str>) -> HashMap<String, Vec<u8>> {
        let bytes = standard();
        let sha = sha_override.map(|s| s.to_string()).unwrap_or_else(|| format!("{:x}", Sha256::digest(&bytes)));
        let meta = r#"{"namespace":"p","name":"x","version":"1.0.0","files":{"download":"https://open-vsx.org/api/p/x/1.0.0/file/x.vsix","sha256":"https://open-vsx.org/api/p/x/1.0.0/file/x.sha256"}}"#;
        HashMap::from([
            ("https://open-vsx.org/api/p/x".to_string(), meta.as_bytes().to_vec()),
            ("https://open-vsx.org/api/p/x/1.0.0/file/x.vsix".to_string(), bytes),
            ("https://open-vsx.org/api/p/x/1.0.0/file/x.sha256".to_string(), format!("{sha}  x.vsix\n").into_bytes()),
        ])
    }

    #[test]
    fn a_verified_download_gives_its_themes() {
        let p = fetch_online("p", "x", &getter(online(None))).unwrap();
        assert_eq!(p.themes.len(), 2);
    }

    #[test]
    fn a_download_that_does_not_match_its_checksum_is_refused() {
        let e = fetch_online("p", "x", &getter(online(Some(&"0".repeat(64))))).unwrap_err();
        assert!(e.contains("checksum"), "{e}");
    }

    #[test]
    fn a_bad_name_never_reaches_the_network() {
        let never = |_: &str, _: u64| -> Result<Vec<u8>, String> { panic!("no request expected") };
        assert!(fetch_online("a/b", "x", &never).is_err());
        assert!(fetch_online("a", "../x", &never).is_err());
    }

    #[test]
    fn searching_goes_through_the_same_checked_path() {
        let url = search_url("dracula");
        let body = r#"{"extensions":[{"name":"n","namespace":"s","version":"1","files":{"download":"https://open-vsx.org/x.vsix"}}]}"#;
        let g = getter(HashMap::from([(url, body.as_bytes().to_vec())]));
        assert_eq!(search_online("dracula", &g).unwrap().len(), 1);
    }

    #[test]
    fn only_the_registry_over_https_is_ever_contacted() {
        assert!(http_get("http://open-vsx.org/api/x", 10).unwrap_err().contains("not allowed"));
        assert!(http_get("https://evil.example/api/x", 10).unwrap_err().contains("not allowed"));
        assert!(http_get("https://open-vsx.org.evil.example/x", 10).unwrap_err().contains("not allowed"));
        assert!(http_get("https://open-vsx.org@evil.example/x", 10).unwrap_err().contains("not allowed"));
    }

    /// Talks to the real registry; run by hand: cargo test --lib gallery::tests::live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_registry_search_download_and_read() {
        let found = search_online("dracula", &http_get).unwrap();
        assert!(!found.is_empty());
        println!("found {} (first: {} by {}, {} downloads)", found.len(), found[0].name, found[0].publisher, found[0].downloads);
        let first = &found[0];
        let (ns, name) = first.location.split_once('/').unwrap();
        let pkg = fetch_online(ns, name, &http_get).unwrap();
        println!("themes: {:?}", pkg.themes.iter().map(|t| (&t.label, &t.ui_theme, &t.path)).collect::<Vec<_>>());
        assert!(!pkg.themes.is_empty());
        assert!(pkg.files.values().any(|f| f.contains("colors")));
        let popular = search_online("", &http_get).unwrap();
        println!("popular: {:?}", popular.iter().take(5).map(|e| e.name.as_str()).collect::<Vec<_>>());
        assert!(popular.len() >= 5);
    }
}
