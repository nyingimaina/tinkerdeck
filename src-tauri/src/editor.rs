//! Text editor storage (BRS 7.14): files are read and written safely, and nothing typed is ever lost.
//!
//! Like Notepad++, an unsaved buffer is snapshotted to disk as you type and is back after a restart.
//! Editors that go unused for 7 days move to a bin, stay there for 30 days, then are forgotten.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const IDLE_TO_BIN_SECS: i64 = 7 * 24 * 3600;
pub const BIN_KEEP_SECS: i64 = 30 * 24 * 3600;
pub const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const INDEX: &str = "index.json";

/// A file as text: lines are `\n` in memory, and `eol` and `encoding` remember how to write it back.
#[derive(Debug, Clone, PartialEq)]
pub struct Loaded {
    pub content: String,
    pub eol: String,
    pub encoding: String,
}

fn utf16(bytes: &[u8], little: bool) -> Result<String, String> {
    if !bytes.len().is_multiple_of(2) {
        return Err("This UTF-16 file is cut short, so it was not opened.".into());
    }
    let (pairs, _) = bytes.as_chunks::<2>();
    let units: Vec<u16> = pairs.iter().map(|c| if little { u16::from_le_bytes(*c) } else { u16::from_be_bytes(*c) }).collect();
    String::from_utf16(&units).map_err(|_| "This UTF-16 file has invalid text, so it was not opened.".to_string())
}

pub fn decode(b: &[u8]) -> Result<Loaded, String> {
    let (text, encoding) = if let Some(rest) = b.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        (String::from_utf8(rest.to_vec()).map_err(|_| "This file is not valid UTF-8 text.".to_string())?, "utf-8-bom")
    } else if let Some(rest) = b.strip_prefix(&[0xFF, 0xFE]) {
        (utf16(rest, true)?, "utf-16le")
    } else if let Some(rest) = b.strip_prefix(&[0xFE, 0xFF]) {
        (utf16(rest, false)?, "utf-16be")
    } else {
        if b.contains(&0) {
            return Err("This looks like a binary file, so it was not opened.".into());
        }
        match String::from_utf8(b.to_vec()) {
            Ok(s) => (s, "utf-8"),
            Err(_) => (b.iter().map(|&x| x as char).collect(), "latin1"),
        }
    };
    let crlf = text.matches("\r\n").count();
    let total = text.matches('\n').count();
    let eol = if crlf > 0 && crlf * 2 >= total { "crlf" } else { "lf" };
    Ok(Loaded { content: text.replace("\r\n", "\n"), eol: eol.into(), encoding: encoding.into() })
}

pub fn encode(content: &str, eol: &str, encoding: &str) -> Result<Vec<u8>, String> {
    let text = if eol == "crlf" { content.replace('\n', "\r\n") } else { content.to_string() };
    Ok(match encoding {
        "utf-8-bom" => [&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat(),
        "utf-16le" => [&[0xFF, 0xFE][..], &text.encode_utf16().flat_map(|u| u.to_le_bytes()).collect::<Vec<u8>>()].concat(),
        "utf-16be" => [&[0xFE, 0xFF][..], &text.encode_utf16().flat_map(|u| u.to_be_bytes()).collect::<Vec<u8>>()].concat(),
        "latin1" => {
            let mut out = Vec::with_capacity(text.len());
            for ch in text.chars() {
                if (ch as u32) > 255 {
                    return Err(format!(
                        "This file is saved as Latin-1 and cannot hold the character \"{ch}\". Remove it, or save a copy under another name."
                    ));
                }
                out.push(ch as u32 as u8);
            }
            out
        }
        _ => text.into_bytes(),
    })
}

pub fn read_text_file(path: &Path) -> Result<Loaded, String> {
    let meta = std::fs::metadata(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("The file was not found: {}", path.display())
        } else {
            format!("Cannot read {}: {e}", path.display())
        }
    })?;
    if meta.is_dir() {
        return Err(format!("{} is a folder, not a file.", path.display()));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!("This file is too large to edit here (limit {} MB).", MAX_FILE_BYTES / 1024 / 1024));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    decode(&bytes)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tdk-tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, bytes).map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Cannot replace {}: {e}", path.display())
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub path: Option<String>,
    pub title: String,
    pub dirty: bool,
    pub eol: String,
    pub encoding: String,
    pub last_used: i64,
    pub binned_at: Option<i64>,
}

/// What the UI gets when it opens one editor.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Doc {
    pub id: String,
    pub path: Option<String>,
    pub title: String,
    pub content: String,
    pub dirty: bool,
    pub eol: String,
    pub encoding: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub open: Vec<Entry>,
    pub bin: Vec<Entry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rotation {
    pub binned: usize,
    pub forgotten: usize,
}

pub struct Store {
    dir: PathBuf,
    entries: Vec<Entry>,
}

fn same_path(a: &str, b: &str) -> bool {
    a.replace('\\', "/").to_lowercase() == b.replace('\\', "/").to_lowercase()
}

fn file_title(path: &str) -> String {
    Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string())
}

impl Store {
    pub fn load(dir: &Path) -> Store {
        let _ = std::fs::create_dir_all(dir);
        let index = dir.join(INDEX);
        let entries = match std::fs::read_to_string(&index) {
            Ok(text) => match serde_json::from_str::<Vec<Entry>>(&text) {
                Ok(e) => e,
                Err(_) => {
                    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                    let _ = std::fs::rename(&index, dir.join(format!("{INDEX}.corrupt-{secs}")));
                    Vec::new()
                }
            },
            Err(_) => Vec::new(),
        };
        Store { dir: dir.to_path_buf(), entries }
    }

    fn buf_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.buf"))
    }

    fn persist(&self) -> Result<(), String> {
        let json = serde_json::to_vec_pretty(&self.entries).map_err(|e| e.to_string())?;
        write_atomic(&self.dir.join(INDEX), &json)
    }

    fn index_of(&self, id: &str) -> Result<usize, String> {
        self.entries.iter().position(|e| e.id == id).ok_or_else(|| "That editor is no longer remembered.".to_string())
    }

    fn doc(e: &Entry, content: String) -> Doc {
        Doc {
            id: e.id.clone(),
            path: e.path.clone(),
            title: e.title.clone(),
            content,
            dirty: e.dirty,
            eol: e.eol.clone(),
            encoding: e.encoding.clone(),
        }
    }

    pub fn open_path(&mut self, path: &str, now: i64) -> Result<Doc, String> {
        if let Some(i) = self.entries.iter().position(|e| e.path.as_deref().is_some_and(|p| same_path(p, path))) {
            self.entries[i].binned_at = None;
            let id = self.entries[i].id.clone();
            return self.load_doc(&id, now);
        }
        let loaded = read_text_file(Path::new(path))?;
        let entry = Entry {
            id: uuid::Uuid::new_v4().to_string(),
            path: Some(path.to_string()),
            title: file_title(path),
            dirty: false,
            eol: loaded.eol.clone(),
            encoding: loaded.encoding.clone(),
            last_used: now,
            binned_at: None,
        };
        let doc = Self::doc(&entry, loaded.content);
        self.entries.push(entry);
        self.persist()?;
        Ok(doc)
    }

    pub fn new_untitled(&mut self, now: i64) -> Result<Doc, String> {
        let mut n = 1;
        while self.entries.iter().any(|e| e.path.is_none() && e.title == format!("new {n}")) {
            n += 1;
        }
        let entry = Entry {
            id: uuid::Uuid::new_v4().to_string(),
            path: None,
            title: format!("new {n}"),
            dirty: false,
            eol: "crlf".into(),
            encoding: "utf-8".into(),
            last_used: now,
            binned_at: None,
        };
        let doc = Self::doc(&entry, String::new());
        self.entries.push(entry);
        self.persist()?;
        Ok(doc)
    }

    pub fn load_doc(&mut self, id: &str, now: i64) -> Result<Doc, String> {
        let i = self.index_of(id)?;
        self.entries[i].last_used = now;
        let content = if self.entries[i].dirty {
            match std::fs::read_to_string(self.buf_path(id)) {
                Ok(s) => s,
                Err(_) => {
                    // the snapshot is gone: fall back to the file rather than showing nothing
                    self.entries[i].dirty = false;
                    self.disk_content(i)?
                }
            }
        } else {
            self.disk_content(i)?
        };
        self.persist()?;
        Ok(Self::doc(&self.entries[i], content))
    }

    fn disk_content(&mut self, i: usize) -> Result<String, String> {
        match self.entries[i].path.clone() {
            Some(p) => {
                let l = read_text_file(Path::new(&p))?;
                self.entries[i].eol = l.eol;
                self.entries[i].encoding = l.encoding;
                Ok(l.content)
            }
            None => Ok(String::new()),
        }
    }

    pub fn snapshot(&mut self, id: &str, content: &str, now: i64) -> Result<(), String> {
        let i = self.index_of(id)?;
        write_atomic(&self.buf_path(id), content.as_bytes())?;
        self.entries[i].dirty = true;
        self.entries[i].last_used = now;
        self.persist()
    }

    pub fn save(&mut self, id: &str, content: &str, path: Option<&str>, now: i64) -> Result<Doc, String> {
        let i = self.index_of(id)?;
        let target = match path {
            Some(p) => p.to_string(),
            None => self.entries[i].path.clone().ok_or_else(|| "Choose where to save this file first.".to_string())?,
        };
        let bytes = encode(content, &self.entries[i].eol, &self.entries[i].encoding)?;
        write_atomic(Path::new(&target), &bytes)?;
        let _ = std::fs::remove_file(self.buf_path(id));
        let e = &mut self.entries[i];
        e.title = file_title(&target);
        e.path = Some(target);
        e.dirty = false;
        e.last_used = now;
        e.binned_at = None;
        let doc = Self::doc(e, content.to_string());
        self.persist()?;
        Ok(doc)
    }

    /// A clean editor has nothing to lose and is forgotten; one with unsaved text goes to the bin.
    pub fn close(&mut self, id: &str, now: i64) -> Result<(), String> {
        let i = self.index_of(id)?;
        if self.entries[i].dirty {
            self.entries[i].binned_at = Some(now);
        } else {
            self.entries.remove(i);
            let _ = std::fs::remove_file(self.buf_path(id));
        }
        self.persist()
    }

    pub fn touch(&mut self, id: &str, now: i64) {
        if let Ok(i) = self.index_of(id) {
            self.entries[i].last_used = now;
            let _ = self.persist();
        }
    }

    pub fn rotate(&mut self, now: i64) -> Rotation {
        let mut r = Rotation::default();
        for e in self.entries.iter_mut() {
            if e.binned_at.is_none() && now - e.last_used > IDLE_TO_BIN_SECS {
                e.binned_at = Some(now);
                r.binned += 1;
            }
        }
        let dir = self.dir.clone();
        self.entries.retain(|e| match e.binned_at {
            Some(b) if now - b > BIN_KEEP_SECS => {
                let _ = std::fs::remove_file(dir.join(format!("{}.buf", e.id)));
                r.forgotten += 1;
                false
            }
            _ => true,
        });
        if r.binned + r.forgotten > 0 {
            let _ = self.persist();
        }
        r
    }

    pub fn list(&mut self, now: i64) -> Listing {
        self.rotate(now);
        let open = self.entries.iter().filter(|e| e.binned_at.is_none()).cloned().collect();
        let mut bin: Vec<Entry> = self.entries.iter().filter(|e| e.binned_at.is_some()).cloned().collect();
        bin.sort_by_key(|e| std::cmp::Reverse(e.binned_at));
        Listing { open, bin }
    }

    pub fn restore(&mut self, id: &str, now: i64) -> Result<Doc, String> {
        let i = self.index_of(id).map_err(|_| "That editor is no longer in the bin.".to_string())?;
        if self.entries[i].binned_at.is_none() {
            return Err("That editor is not in the bin.".into());
        }
        self.entries[i].binned_at = None;
        self.load_doc(id, now)
    }

    pub fn discard(&mut self, id: &str) -> Result<(), String> {
        let i = self.index_of(id)?;
        self.entries.remove(i);
        let _ = std::fs::remove_file(self.buf_path(id));
        self.persist()
    }
}

/// Files named by `--edit <path>` on a command line (what the Explorer menu entry launches).
pub fn files_from_args(args: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut it = args.iter().peekable();
    while let Some(a) = it.next() {
        if a == "--edit" {
            if let Some(p) = it.peek() {
                if !p.starts_with("--") {
                    out.push((*p).clone());
                    it.next();
                }
            }
        }
    }
    out
}

// ---- preview-only files (images, PDF): shown, never read as text, never edited

pub const MAX_PREVIEW_BYTES: u64 = 50 * 1024 * 1024;
const BINARY_PREVIEW: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "pdf"];

/// Whether a file can only be previewed (the text editor cannot hold it).
pub fn is_binary_preview(path: &str) -> bool {
    Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .is_some_and(|e| BINARY_PREVIEW.contains(&e.as_str()))
}

pub fn read_preview_bytes_capped(path: &Path, cap: u64) -> Result<Vec<u8>, String> {
    if !is_binary_preview(&path.to_string_lossy()) {
        return Err("Only images and PDF files can be read for preview.".into());
    }
    let meta = std::fs::metadata(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("The file was not found: {}", path.display())
        } else {
            format!("Cannot read {}: {e}", path.display())
        }
    })?;
    if meta.len() > cap {
        return Err(format!("This file is too large to preview (limit {} MB).", cap / 1024 / 1024));
    }
    std::fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))
}

pub fn read_preview_bytes(path: &Path) -> Result<Vec<u8>, String> {
    read_preview_bytes_capped(path, MAX_PREVIEW_BYTES)
}

impl Store {
    /// Like `open_path`, but images and PDFs open as preview-only editors.
    pub fn open_any(&mut self, path: &str, now: i64) -> Result<Doc, String> {
        if !is_binary_preview(path) {
            return self.open_path(path, now);
        }
        if let Some(i) = self.entries.iter().position(|e| e.path.as_deref().is_some_and(|p| same_path(p, path))) {
            self.entries[i].binned_at = None;
            let id = self.entries[i].id.clone();
            return self.load_any(&id, now);
        }
        if !Path::new(path).is_file() {
            return Err(format!("The file was not found: {path}"));
        }
        let entry = Entry {
            id: uuid::Uuid::new_v4().to_string(),
            path: Some(path.to_string()),
            title: file_title(path),
            dirty: false,
            eol: "lf".into(),
            encoding: "binary".into(),
            last_used: now,
            binned_at: None,
        };
        let doc = Self::doc(&entry, String::new());
        self.entries.push(entry);
        self.persist()?;
        Ok(doc)
    }

    /// Like `load_doc`, but a preview-only editor has no text to load.
    pub fn load_any(&mut self, id: &str, now: i64) -> Result<Doc, String> {
        let i = self.index_of(id)?;
        if self.entries[i].path.as_deref().is_some_and(is_binary_preview) {
            self.entries[i].last_used = now;
            self.persist()?;
            return Ok(Self::doc(&self.entries[i], String::new()));
        }
        self.load_doc(id, now)
    }

    /// Like `save`, but refuses a preview-only editor.
    pub fn save_any(&mut self, id: &str, content: &str, path: Option<&str>, now: i64) -> Result<Doc, String> {
        let i = self.index_of(id)?;
        if self.entries[i].path.as_deref().is_some_and(is_binary_preview) {
            return Err("This file is shown as a preview only and cannot be edited here.".into());
        }
        self.save(id, content, path, now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const DAY: i64 = 24 * 3600;
    const T0: i64 = 1_800_000_000;

    fn store() -> (TempDir, Store) {
        let d = TempDir::new().unwrap();
        let s = Store::load(&d.path().join("editor"));
        (d, s)
    }
    fn file(d: &TempDir, name: &str, bytes: &[u8]) -> String {
        let p = d.path().join(name);
        std::fs::write(&p, bytes).unwrap();
        p.to_string_lossy().to_string()
    }

    // ---- text files

    #[test]
    fn utf8_with_lf_or_crlf_keeps_its_line_endings() {
        let a = decode(b"one\ntwo\n").unwrap();
        assert_eq!((a.content.as_str(), a.eol.as_str(), a.encoding.as_str()), ("one\ntwo\n", "lf", "utf-8"));
        let b = decode(b"one\r\ntwo\r\n").unwrap();
        assert_eq!((b.content.as_str(), b.eol.as_str()), ("one\ntwo\n", "crlf"));
        assert_eq!(encode(&b.content, &b.eol, &b.encoding).unwrap(), b"one\r\ntwo\r\n");
    }

    #[test]
    fn bom_and_utf16_and_latin1_round_trip_byte_for_byte() {
        let bom = [&[0xEF, 0xBB, 0xBF][..], "héllo".as_bytes()].concat();
        let l = decode(&bom).unwrap();
        assert_eq!((l.content.as_str(), l.encoding.as_str()), ("héllo", "utf-8-bom"));
        assert_eq!(encode(&l.content, &l.eol, &l.encoding).unwrap(), bom);

        let mut u16 = vec![0xFF, 0xFE];
        for c in "hi\r\nyo".encode_utf16() {
            u16.extend_from_slice(&c.to_le_bytes());
        }
        let l = decode(&u16).unwrap();
        assert_eq!((l.content.as_str(), l.encoding.as_str(), l.eol.as_str()), ("hi\nyo", "utf-16le", "crlf"));
        assert_eq!(encode(&l.content, &l.eol, &l.encoding).unwrap(), u16);

        let latin = [b'c', b'a', b'f', 0xE9];
        let l = decode(&latin).unwrap();
        assert_eq!((l.content.as_str(), l.encoding.as_str()), ("café", "latin1"));
        assert_eq!(encode(&l.content, &l.eol, &l.encoding).unwrap(), latin);
        assert!(encode("日本", "lf", "latin1").unwrap_err().contains("Latin-1"));
    }

    #[test]
    fn binary_and_huge_files_are_refused_in_plain_words() {
        assert!(decode(&[0x50, 0x4B, 0x00, 0x03, 0x04]).unwrap_err().contains("binary"));
        let d = TempDir::new().unwrap();
        let p = d.path().join("big.txt");
        std::fs::write(&p, vec![b'a'; (MAX_FILE_BYTES + 1) as usize]).unwrap();
        assert!(read_text_file(&p).unwrap_err().contains("too large"));
        assert!(read_text_file(&d.path().join("missing.txt")).unwrap_err().contains("not found"));
    }

    // ---- opening, saving, hot exit

    #[test]
    fn opening_the_same_file_twice_gives_the_same_editor() {
        let (d, mut s) = store();
        let p = file(&d, "a.txt", b"x");
        let one = s.open_path(&p, T0).unwrap();
        let two = s.open_path(&p, T0 + 5).unwrap();
        assert_eq!(one.id, two.id);
        assert_eq!(one.title, "a.txt");
        assert_eq!(s.list(T0 + 5).open.len(), 1);
    }

    #[test]
    fn unsaved_typing_survives_a_restart() {
        let (d, mut s) = store();
        let p = file(&d, "a.txt", b"disk");
        let doc = s.open_path(&p, T0).unwrap();
        s.snapshot(&doc.id, "typed but never saved", T0 + 1).unwrap();
        drop(s);
        let mut again = Store::load(&d.path().join("editor"));
        let back = again.load_doc(&doc.id, T0 + 2).unwrap();
        assert_eq!(back.content, "typed but never saved");
        assert!(back.dirty);
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "disk", "the file itself is untouched until Save");
    }

    #[test]
    fn untitled_documents_are_kept_too() {
        let (d, mut s) = store();
        let a = s.new_untitled(T0).unwrap();
        let b = s.new_untitled(T0).unwrap();
        assert_eq!((a.title.as_str(), b.title.as_str()), ("new 1", "new 2"));
        s.snapshot(&a.id, "notes", T0 + 1).unwrap();
        drop(s);
        let mut again = Store::load(&d.path().join("editor"));
        assert_eq!(again.list(T0 + 2).open.len(), 2);
        assert_eq!(again.load_doc(&a.id, T0 + 2).unwrap().content, "notes");
    }

    #[test]
    fn save_writes_the_file_clears_the_snapshot_and_keeps_encoding_and_eol() {
        let (d, mut s) = store();
        let p = file(&d, "a.txt", b"one\r\ntwo\r\n");
        let doc = s.open_path(&p, T0).unwrap();
        assert_eq!(doc.eol, "crlf");
        s.snapshot(&doc.id, "one\nTWO\n", T0 + 1).unwrap();
        let saved = s.save(&doc.id, "one\nTWO\n", None, T0 + 2).unwrap();
        assert!(!saved.dirty);
        assert_eq!(std::fs::read(&p).unwrap(), b"one\r\nTWO\r\n");
        assert!(!d.path().join("editor").join(format!("{}.buf", doc.id)).exists());
        assert!(!s.load_doc(&doc.id, T0 + 3).unwrap().dirty);
    }

    #[test]
    fn save_as_gives_an_untitled_document_its_file_and_name() {
        let (d, mut s) = store();
        let doc = s.new_untitled(T0).unwrap();
        assert!(s.save(&doc.id, "x", None, T0).unwrap_err().contains("where"), "needs a path");
        let target = d.path().join("notes.md").to_string_lossy().to_string();
        let saved = s.save(&doc.id, "# hi", Some(&target), T0 + 1).unwrap();
        assert_eq!((saved.title.as_str(), saved.path.as_deref()), ("notes.md", Some(target.as_str())));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "# hi");
    }

    #[test]
    fn a_clean_editor_reads_the_file_fresh_each_time() {
        let (d, mut s) = store();
        let p = file(&d, "a.txt", b"v1");
        let doc = s.open_path(&p, T0).unwrap();
        std::fs::write(&p, "v2 changed elsewhere").unwrap();
        assert_eq!(s.load_doc(&doc.id, T0 + 1).unwrap().content, "v2 changed elsewhere");
    }

    // ---- closing, bin, rotation

    #[test]
    fn closing_a_clean_editor_forgets_it_but_a_dirty_one_goes_to_the_bin() {
        let (d, mut s) = store();
        let clean = s.open_path(&file(&d, "c.txt", b"c"), T0).unwrap();
        let dirty = s.open_path(&file(&d, "d.txt", b"d"), T0).unwrap();
        s.snapshot(&dirty.id, "unsaved work", T0 + 1).unwrap();
        s.close(&clean.id, T0 + 2).unwrap();
        s.close(&dirty.id, T0 + 2).unwrap();
        let l = s.list(T0 + 3);
        assert!(l.open.is_empty());
        assert_eq!(l.bin.len(), 1);
        assert_eq!(l.bin[0].id, dirty.id);
        let back = s.restore(&dirty.id, T0 + 4).unwrap();
        assert_eq!(back.content, "unsaved work");
        assert_eq!((s.list(T0 + 4).open.len(), s.list(T0 + 4).bin.len()), (1, 0));
    }

    #[test]
    fn editors_idle_for_seven_days_move_to_the_bin_with_their_text() {
        let (d, mut s) = store();
        let old = s.open_path(&file(&d, "old.txt", b"o"), T0).unwrap();
        s.snapshot(&old.id, "keep me", T0).unwrap();
        let fresh = s.open_path(&file(&d, "new.txt", b"n"), T0 + 6 * DAY).unwrap();
        let r = s.rotate(T0 + 7 * DAY + 1);
        assert_eq!((r.binned, r.forgotten), (1, 0));
        let l = s.list(T0 + 7 * DAY + 1);
        assert_eq!(l.open.iter().map(|e| e.id.clone()).collect::<Vec<_>>(), vec![fresh.id.clone()]);
        assert_eq!(l.bin[0].id, old.id);
        assert_eq!(s.restore(&old.id, T0 + 8 * DAY).unwrap().content, "keep me");
    }

    #[test]
    fn using_an_editor_resets_its_seven_days() {
        let (d, mut s) = store();
        let doc = s.open_path(&file(&d, "a.txt", b"a"), T0).unwrap();
        s.touch(&doc.id, T0 + 6 * DAY);
        assert_eq!(s.rotate(T0 + 10 * DAY).binned, 0);
        assert_eq!(s.rotate(T0 + 13 * DAY + 1).binned, 1);
    }

    #[test]
    fn the_bin_is_forgotten_after_thirty_days_and_its_files_deleted() {
        let (d, mut s) = store();
        let doc = s.open_path(&file(&d, "a.txt", b"a"), T0).unwrap();
        s.snapshot(&doc.id, "text", T0).unwrap();
        s.close(&doc.id, T0 + DAY).unwrap();
        let buf = d.path().join("editor").join(format!("{}.buf", doc.id));
        assert!(buf.exists());
        assert_eq!(s.rotate(T0 + DAY + 30 * DAY - 1).forgotten, 0);
        assert!(buf.exists());
        let r = s.rotate(T0 + DAY + 30 * DAY + 1);
        assert_eq!(r.forgotten, 1);
        assert!(!buf.exists());
        assert!(s.list(T0 + 40 * DAY).bin.is_empty());
        assert!(s.restore(&doc.id, T0 + 40 * DAY).is_err());
    }

    #[test]
    fn opening_a_binned_file_brings_it_back_and_discard_removes_it_for_good() {
        let (d, mut s) = store();
        let p = file(&d, "a.txt", b"a");
        let doc = s.open_path(&p, T0).unwrap();
        s.snapshot(&doc.id, "draft", T0).unwrap();
        s.close(&doc.id, T0 + 1).unwrap();
        let again = s.open_path(&p, T0 + 2).unwrap();
        assert_eq!(again.id, doc.id);
        assert_eq!(again.content, "draft", "the unsaved draft comes back with the file");
        assert_eq!(s.list(T0 + 2).bin.len(), 0);
        s.close(&doc.id, T0 + 3).unwrap();
        s.discard(&doc.id).unwrap();
        assert!(s.list(T0 + 4).bin.is_empty());
    }

    #[test]
    fn a_damaged_index_starts_empty_and_is_kept_aside() {
        let d = TempDir::new().unwrap();
        let dir = d.path().join("editor");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(INDEX), "{ not json").unwrap();
        let mut s = Store::load(&dir);
        assert!(s.list(T0).open.is_empty());
        let kept = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).any(|e| e.file_name().to_string_lossy().contains("corrupt"));
        assert!(kept, "the unreadable index is preserved");
    }

    #[test]
    fn explorer_launches_name_their_files_after_edit() {
        let a = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(files_from_args(&a(&["tinkerdeck.exe", "--edit", "C:/a b/x.txt"])), vec!["C:/a b/x.txt"]);
        assert_eq!(files_from_args(&a(&["lc.exe", "--edit", "a.txt", "--edit", "b.txt"])), vec!["a.txt", "b.txt"]);
        assert!(files_from_args(&a(&["lc.exe", "--background"])).is_empty());
        assert!(files_from_args(&a(&["lc.exe", "--edit"])).is_empty(), "a flag with no file");
        assert!(files_from_args(&a(&["lc.exe", "--edit", "--background"])).is_empty(), "not a file");
    }

    // ---- preview-only files (images, PDF)

    #[test]
    fn which_files_are_preview_only() {
        for f in ["a.png", "A.JPG", "b.jpeg", "c.gif", "d.webp", "e.bmp", "f.ico", "g.avif", "h.pdf", "C:/x/y.PNG"] {
            assert!(is_binary_preview(f), "{f}");
        }
        for f in ["a.svg", "a.txt", "a.html", "a.md", "png", "a.png.txt", ""] {
            assert!(!is_binary_preview(f), "{f}");
        }
    }

    #[test]
    fn images_and_pdfs_open_as_preview_only_without_being_read_as_text() {
        let (d, mut s) = store();
        let png = file(&d, "pic.png", &[0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 1]);
        let doc = s.open_any(&png, T0).unwrap();
        assert_eq!((doc.content.as_str(), doc.dirty, doc.title.as_str()), ("", false, "pic.png"));
        assert_eq!(s.open_any(&png, T0 + 1).unwrap().id, doc.id, "same file, same editor");
        assert_eq!(s.load_any(&doc.id, T0 + 2).unwrap().content, "");
        assert!(s.save_any(&doc.id, "x", None, T0 + 3).unwrap_err().contains("preview"));
        assert_eq!(std::fs::read(&png).unwrap().len(), 8, "the file is never touched");
        s.close(&doc.id, T0 + 4).unwrap();
        assert!(s.list(T0 + 4).open.is_empty(), "nothing unsaved, so closing forgets it");
    }

    #[test]
    fn text_files_go_through_open_any_exactly_as_before() {
        let (d, mut s) = store();
        let p = file(&d, "a.txt", b"hello");
        let doc = s.open_any(&p, T0).unwrap();
        assert_eq!(doc.content, "hello");
        s.snapshot(&doc.id, "typed", T0 + 1).unwrap();
        assert_eq!(s.load_any(&doc.id, T0 + 2).unwrap().content, "typed");
        assert_eq!(s.save_any(&doc.id, "typed", None, T0 + 3).unwrap().content, "typed");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "typed");
    }

    #[test]
    fn preview_bytes_only_for_previewable_files_and_within_the_cap() {
        let d = TempDir::new().unwrap();
        let png = file(&d, "p.png", &[1, 2, 3, 4]);
        let txt = file(&d, "t.txt", b"secret");
        assert_eq!(read_preview_bytes(Path::new(&png)).unwrap(), vec![1, 2, 3, 4]);
        assert!(read_preview_bytes(Path::new(&txt)).unwrap_err().contains("preview"), "not a general file reader");
        assert!(read_preview_bytes_capped(Path::new(&png), 3).unwrap_err().contains("too large"));
        assert!(read_preview_bytes(&d.path().join("gone.png")).unwrap_err().contains("not found"));
    }
}
