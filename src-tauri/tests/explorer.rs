#![cfg(windows)]

//! The Files explorer core, exercised against real folders in a temporary directory: one level is
//! read at a time, the noisy folders are hidden unless asked for, an unreadable folder is locked
//! rather than an error, and a huge level is capped.

use std::fs;
use std::path::Path;
use std::process::Command;
use tempfile::tempdir;
use tinkerdeck_lib::features::explorer::{
    drives, home_folder, list_level, list_level_with, Listing, MAX_RETURNED, MAX_SCANNED,
};

fn folder(path: &Path) {
    fs::create_dir_all(path).expect("create fixture folder");
}

fn file(path: &Path) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create fixture parent");
    }
    fs::write(path, b"x").expect("create fixture file");
}

fn names(listing: &Listing) -> Vec<String> {
    listing.entries.iter().map(|e| e.name.clone()).collect()
}

#[test]
fn r2_lists_one_level_and_tells_folders_from_files() {
    let dir = tempdir().expect("temp dir");
    folder(&dir.path().join("alpha"));
    folder(&dir.path().join("beta"));
    file(&dir.path().join("zeta.txt"));

    let listing = list_level(dir.path(), false);

    assert!(!listing.locked);
    assert_eq!(listing.path, dir.path().to_string_lossy().to_string());
    assert_eq!(names(&listing), vec!["alpha", "beta", "zeta.txt"]);
    assert!(listing.entries[0].is_dir);
    assert!(listing.entries[1].is_dir);
    assert!(!listing.entries[2].is_dir);
    assert_eq!(listing.total, 3);
    assert!(!listing.truncated);
}

#[test]
fn r2_children_are_fetched_only_when_their_level_is_requested() {
    let dir = tempdir().expect("temp dir");
    let alpha = dir.path().join("alpha");
    file(&alpha.join("inner.txt"));

    let top = list_level(dir.path(), false);
    assert_eq!(names(&top), vec!["alpha"]);
    assert!(!names(&top).contains(&"inner.txt".to_string()));

    let inside = list_level(&alpha, false);
    assert_eq!(names(&inside), vec!["inner.txt"]);
}

#[test]
fn r2_hides_the_four_noisy_names_by_default_at_any_depth() {
    let dir = tempdir().expect("temp dir");
    for name in ["node_modules", ".git", "target", "dist"] {
        folder(&dir.path().join(name));
        folder(&dir.path().join("src").join(name));
        file(&dir.path().join(name).join("noise.txt"));
    }
    file(&dir.path().join("visible.txt"));

    assert_eq!(
        names(&list_level(dir.path(), false)),
        vec!["src", "visible.txt"]
    );
    assert_eq!(
        names(&list_level(&dir.path().join("src"), false)),
        Vec::<String>::new()
    );
}

#[test]
fn r2_show_hidden_reveals_the_four_names_and_can_hide_them_again() {
    let dir = tempdir().expect("temp dir");
    folder(&dir.path().join("node_modules"));
    folder(&dir.path().join("target"));
    file(&dir.path().join("visible.txt"));

    assert_eq!(names(&list_level(dir.path(), false)), vec!["visible.txt"]);
    assert_eq!(
        names(&list_level(dir.path(), true)),
        vec!["node_modules", "target", "visible.txt"]
    );
    assert_eq!(names(&list_level(dir.path(), false)), vec!["visible.txt"]);
}

#[test]
fn r2_other_dot_named_entries_are_listed_normally() {
    let dir = tempdir().expect("temp dir");
    folder(&dir.path().join(".github"));
    folder(&dir.path().join(".vscode"));
    file(&dir.path().join(".env"));

    assert_eq!(
        names(&list_level(dir.path(), false)),
        vec![".github", ".vscode", ".env"]
    );
}

#[test]
fn r2_an_empty_folder_lists_no_children_without_error() {
    let dir = tempdir().expect("temp dir");
    let empty = dir.path().join("empty");
    folder(&empty);

    let listing = list_level(&empty, false);

    assert!(!listing.locked);
    assert!(listing.entries.is_empty());
    assert_eq!(listing.total, 0);
    assert!(!listing.truncated);
}

#[test]
fn r2_an_unreadable_folder_is_locked_and_does_not_raise() {
    let dir = tempdir().expect("temp dir");
    let not_a_folder = dir.path().join("plain.txt");
    file(&not_a_folder);

    let listing = list_level(&not_a_folder, false);

    assert!(listing.locked);
    assert!(listing.entries.is_empty());
    assert_eq!(listing.total, 0);
}

#[test]
fn r2_listing_a_level_never_opens_its_child_folders() {
    let dir = tempdir().expect("temp dir");
    let secret = dir.path().join("secret");
    folder(&secret);

    // Deny everyone read access to the child, so opening it would fail. The SID form keeps this
    // independent of the Windows display language.
    let denied = Command::new("icacls")
        .arg(&secret)
        .arg("/deny")
        .arg("*S-1-1-0:(RX)")
        .output()
        .expect("run icacls to deny access");
    assert!(
        denied.status.success(),
        "icacls could not deny access to the fixture"
    );

    // Read both levels while the child is unreadable, then lift the deny before asserting.
    let parent = list_level(dir.path(), false);
    let child = list_level(&secret, false);
    let _ = Command::new("icacls")
        .arg(&secret)
        .arg("/remove:d")
        .arg("*S-1-1-0")
        .output();

    let entry = parent
        .entries
        .iter()
        .find(|e| e.name == "secret")
        .expect("the child folder is listed");
    assert!(entry.is_dir);
    assert!(
        !entry.locked,
        "listing the parent must not probe the child folder to learn its locked state"
    );
    assert!(child.locked, "the folder's own level reports it locked");
}

#[test]
fn r4_a_missing_app_root_is_locked_instead_of_raising() {
    let dir = tempdir().expect("temp dir");
    let gone = dir.path().join("app-that-was-deleted");

    let listing = list_level(&gone, false);

    assert!(listing.locked);
    assert!(listing.entries.is_empty());
    assert!(!listing.truncated);
}

#[test]
fn a1_a_large_level_is_capped_with_total_and_truncated() {
    let dir = tempdir().expect("temp dir");
    for i in 0..1200 {
        fs::write(dir.path().join(format!("f{i:04}.txt")), b"x").expect("create fixture file");
    }

    let listing = list_level(dir.path(), false);

    assert_eq!(MAX_RETURNED, 1000);
    assert_eq!(MAX_SCANNED, 10_000);
    assert_eq!(listing.entries.len(), 1000);
    assert_eq!(listing.total, 1200);
    assert!(listing.truncated);
    assert_eq!(
        listing.entries.first().map(|e| e.name.as_str()),
        Some("f0000.txt")
    );
    assert_eq!(
        listing.entries.last().map(|e| e.name.as_str()),
        Some("f0999.txt")
    );
}

#[test]
fn a1_folders_come_first_then_files_sorted_by_name() {
    let dir = tempdir().expect("temp dir");
    folder(&dir.path().join("Zebra"));
    folder(&dir.path().join("apple"));
    file(&dir.path().join("zeta.txt"));
    file(&dir.path().join("Alpha.txt"));

    let listing = list_level(dir.path(), false);

    assert_eq!(
        names(&listing),
        vec!["apple", "Zebra", "Alpha.txt", "zeta.txt"]
    );
    assert!(listing.entries[0].is_dir && listing.entries[1].is_dir);
    assert!(!listing.entries[2].is_dir && !listing.entries[3].is_dir);
}

#[test]
fn a1_scanning_stops_at_the_scan_limit() {
    let dir = tempdir().expect("temp dir");
    for i in 0..20 {
        fs::write(dir.path().join(format!("f{i:02}.txt")), b"x").expect("create fixture file");
    }

    let listing = list_level_with(dir.path(), false, 5, 10);

    assert_eq!(listing.entries.len(), 5);
    assert_eq!(listing.total, 10);
    assert!(listing.truncated);
}

#[test]
fn a1_home_folder_reads_only_the_user_profile() {
    let expected = std::env::var_os("USERPROFILE")
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty());

    assert_eq!(home_folder(), expected);
}

#[test]
fn r5_drives_are_listed_as_drive_roots() {
    let drivers = drives();

    assert!(!drivers.is_empty());
    for entry in drivers {
        assert!(entry.is_dir);
        assert!(!entry.locked);
        assert_eq!(entry.path.len(), 3);
        assert!(entry.path.ends_with(":\\"));
        assert_eq!(entry.name, entry.path[..2].to_string());
    }
}
