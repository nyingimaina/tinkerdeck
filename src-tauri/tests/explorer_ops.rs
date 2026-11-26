#![cfg(windows)]

//! The Files explorer's file operations, exercised against real folders in a temporary directory:
//! create, rename, move and delete share one set of checks, refuse a clash or a bad name before
//! touching anything, never overwrite, and delete only ever goes through the Recycle Bin (R9).

use std::fs;
use std::path::Path;
use tempfile::tempdir;
use tinkerdeck_lib::features::explorer::{
    create_item, delete_item, delete_item_with, move_item, rename_item, same_volume, ItemKind,
};

fn file(path: &Path, bytes: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create fixture parent");
    }
    fs::write(path, bytes).expect("create fixture file");
}

fn names(dir: &Path) -> Vec<String> {
    let mut found: Vec<String> = fs::read_dir(dir)
        .expect("read fixture folder")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    found.sort();
    found
}

#[test]
fn r9_create_makes_a_new_file_and_a_new_folder() {
    let dir = tempdir().expect("temp dir");

    let made_file = create_item(dir.path(), "notes.txt", ItemKind::File).expect("create a file");
    assert!(Path::new(&made_file).is_file());
    assert_eq!(fs::read(&made_file).expect("the new file is readable"), b"");

    let made_folder = create_item(dir.path(), "stuff", ItemKind::Folder).expect("create a folder");
    assert!(Path::new(&made_folder).is_dir());

    assert_eq!(names(dir.path()), vec!["notes.txt", "stuff"]);
}

#[test]
fn r9_create_refuses_a_name_clash_and_leaves_the_existing_file_untouched() {
    let dir = tempdir().expect("temp dir");
    let existing = dir.path().join("keep.txt");
    file(&existing, b"precious");

    let refused = create_item(dir.path(), "keep.txt", ItemKind::File);

    assert!(refused.is_err());
    assert!(refused.unwrap_err().contains("already exists"));
    assert_eq!(
        fs::read(&existing).expect("the existing file is still there"),
        b"precious"
    );
}

#[test]
fn r9_create_refuses_empty_whitespace_and_windows_invalid_names() {
    let dir = tempdir().expect("temp dir");
    let long = "x".repeat(256);

    for bad in [
        "",
        "   ",
        "bad/name",
        "bad\\name",
        "bad:name",
        "bad?name",
        "con.txt",
        "ends.",
        long.as_str(),
    ] {
        let refused = create_item(dir.path(), bad, ItemKind::File);
        assert!(refused.is_err(), "\"{bad}\" should be refused");
    }

    assert!(
        names(dir.path()).is_empty(),
        "nothing should have been created"
    );
}

#[test]
fn r9_rename_renames_a_file_and_a_folder() {
    let dir = tempdir().expect("temp dir");
    let old_file = dir.path().join("a.txt");
    file(&old_file, b"x");
    let renamed = rename_item(&old_file, "b.txt").expect("rename the file");
    assert!(!old_file.exists());
    assert_eq!(fs::read(&renamed).expect("the renamed file exists"), b"x");

    let old_folder = dir.path().join("old-folder");
    fs::create_dir(&old_folder).expect("create folder");
    let renamed_folder = rename_item(&old_folder, "new-folder").expect("rename the folder");
    assert!(!old_folder.exists());
    assert!(Path::new(&renamed_folder).is_dir());
}

#[test]
fn r9_rename_refuses_a_clash_and_leaves_both_items_untouched() {
    let dir = tempdir().expect("temp dir");
    let a = dir.path().join("a.txt");
    let b = dir.path().join("b.txt");
    file(&a, b"A");
    file(&b, b"B");

    let refused = rename_item(&a, "b.txt");

    assert!(refused.is_err());
    assert!(refused.unwrap_err().contains("already exists"));
    assert_eq!(fs::read(&a).expect("a is untouched"), b"A");
    assert_eq!(fs::read(&b).expect("b is untouched"), b"B");
}

#[test]
fn r9_rename_of_a_missing_item_reports_it_is_gone() {
    let dir = tempdir().expect("temp dir");

    let refused = rename_item(&dir.path().join("never.txt"), "other.txt");

    assert!(refused.is_err());
    assert!(refused.unwrap_err().contains("gone"));
}

#[test]
fn r9_rename_refuses_an_invalid_name_and_changes_nothing() {
    let dir = tempdir().expect("temp dir");
    let item = dir.path().join("a.txt");
    file(&item, b"x");

    let refused = rename_item(&item, "bad?name");

    assert!(refused.is_err());
    assert_eq!(fs::read(&item).expect("the item is untouched"), b"x");
}

#[test]
fn r9_move_moves_a_file_and_a_folder_into_another_folder() {
    let dir = tempdir().expect("temp dir");
    let into = dir.path().join("target");
    fs::create_dir(&into).expect("create destination");
    let source_file = dir.path().join("a.txt");
    file(&source_file, b"x");
    let source_folder = dir.path().join("box");
    fs::create_dir(&source_folder).expect("create folder");

    let moved_file = move_item(&source_file, &into).expect("move the file");
    let moved_folder = move_item(&source_folder, &into).expect("move the folder");

    assert!(!source_file.exists());
    assert_eq!(fs::read(&moved_file).expect("the file moved"), b"x");
    assert!(!source_folder.exists());
    assert!(Path::new(&moved_folder).is_dir());
    assert_eq!(names(&into), vec!["a.txt", "box"]);
}

#[test]
fn r9_move_onto_the_folder_it_is_already_in_changes_nothing() {
    let dir = tempdir().expect("temp dir");
    let item = dir.path().join("a.txt");
    file(&item, b"x");

    let result = move_item(&item, dir.path()).expect("dropping on its own folder is harmless");

    assert_eq!(Path::new(&result), item);
    assert_eq!(fs::read(&item).expect("the item is untouched"), b"x");
}

#[test]
fn r9_move_refuses_a_name_clash_in_the_destination() {
    let dir = tempdir().expect("temp dir");
    let into = dir.path().join("target");
    fs::create_dir(&into).expect("create destination");
    let source = dir.path().join("a.txt");
    file(&source, b"source");
    let existing = into.join("a.txt");
    file(&existing, b"existing");

    let refused = move_item(&source, &into);

    assert!(refused.is_err());
    assert!(refused.unwrap_err().contains("already exists"));
    assert_eq!(
        fs::read(&source).expect("the source is untouched"),
        b"source"
    );
    assert_eq!(
        fs::read(&existing).expect("the destination is untouched"),
        b"existing"
    );
}

#[test]
fn r9_move_refuses_to_put_a_folder_inside_itself_or_a_descendant() {
    let dir = tempdir().expect("temp dir");
    let folder = dir.path().join("tree");
    let child = folder.join("child");
    fs::create_dir_all(&child).expect("create folder tree");

    assert!(
        move_item(&folder, &folder).is_err(),
        "a folder cannot go into itself"
    );
    assert!(
        move_item(&folder, &child).is_err(),
        "a folder cannot go into its own child"
    );
    assert!(folder.is_dir() && child.is_dir(), "nothing moved");
}

#[test]
fn r9_move_refuses_a_destination_that_is_not_a_folder() {
    let dir = tempdir().expect("temp dir");
    let source = dir.path().join("a.txt");
    file(&source, b"x");
    let not_a_folder = dir.path().join("plain");
    file(&not_a_folder, b"y");

    let refused = move_item(&source, &not_a_folder);

    assert!(refused.is_err());
    assert!(source.exists());
}

#[test]
fn r9_a_move_between_drives_is_refused() {
    assert!(!same_volume(
        Path::new("C:\\work\\a"),
        Path::new("D:\\work\\b")
    ));
    assert!(same_volume(
        Path::new("C:\\work\\a"),
        Path::new("c:\\work\\b")
    ));
    assert!(same_volume(
        Path::new("\\\\server\\share\\a"),
        Path::new("\\\\SERVER\\SHARE\\b")
    ));
    assert!(!same_volume(
        Path::new("\\\\server\\share\\a"),
        Path::new("\\\\server\\other\\b")
    ));
}

#[test]
fn r9_delete_hands_the_item_to_the_recycle_bin_and_never_removes_it_itself() {
    let dir = tempdir().expect("temp dir");
    let item = dir.path().join("a.txt");
    file(&item, b"x");

    // A Recycle Bin step that accepts the item but does nothing: delete must not remove it either.
    delete_item_with(&item, |_| Ok(())).expect("the bin accepted the item");

    assert!(
        item.exists(),
        "delete itself never removes the item, only the Recycle Bin does"
    );
}

#[test]
fn r9_delete_is_refused_when_the_recycle_bin_cannot_take_the_item() {
    let dir = tempdir().expect("temp dir");
    let item = dir.path().join("a.txt");
    file(&item, b"x");

    let refused = delete_item_with(&item, |_| Err("no bin here".to_string()));

    let message = refused.expect_err("the delete is refused");
    assert!(message.contains("Recycle Bin"), "{message}");
    assert_eq!(fs::read(&item).expect("the item is left in place"), b"x");
}

#[test]
fn r9_deleting_the_same_item_twice_reports_it_is_already_gone() {
    let dir = tempdir().expect("temp dir");
    let item = dir.path().join("a.txt");
    file(&item, b"x");

    delete_item_with(&item, |path| {
        fs::remove_file(path).map_err(|e| e.to_string())
    })
    .expect("first delete");
    assert!(!item.exists());

    let second = delete_item_with(&item, |_| Ok(()));
    let message = second.expect_err("the second delete is refused");
    assert!(message.contains("gone"), "{message}");
}

fn normalise(path: &Path) -> String {
    let text = fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();
    text.trim_start_matches(r"\\?\").to_lowercase()
}

#[test]
fn r9_delete_uses_the_real_recycle_bin() {
    let dir = tempdir().expect("temp dir");
    let item = dir.path().join("recycled.txt");
    file(&item, b"x");
    let parent = normalise(dir.path());

    delete_item(&item).expect("the Recycle Bin accepts the item");
    assert!(!item.exists(), "the item left its folder");

    let binned: Vec<trash::TrashItem> = trash::os_limited::list()
        .expect("read the Recycle Bin")
        .into_iter()
        .filter(|entry| {
            entry.name == std::ffi::OsStr::new("recycled.txt")
                && normalise(&entry.original_parent) == parent
        })
        .collect();
    assert_eq!(
        binned.len(),
        1,
        "the deleted item is found in the Recycle Bin, not permanently removed"
    );

    trash::os_limited::restore_all(binned).expect("restore the item from the Recycle Bin");
    assert_eq!(
        fs::read(&item).expect("the restored item is back where it was"),
        b"x",
        "the item can be restored from the Recycle Bin"
    );
}
