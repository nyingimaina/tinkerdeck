#![cfg(windows)]

//! Re-pointing and closing the editor's open tabs when the explorer renames, moves or deletes
//! files (R9, A3, A4). The store keeps an unsaved buffer by tab id, so a rename must only change
//! the path a tab points at, and a delete must keep unsaved text in the bin.

use std::fs;
use std::path::Path;
use tempfile::TempDir;
use tinkerdeck_lib::editor::Store;
use tinkerdeck_lib::features::explorer::commands::{
    delete_and_close_with, move_and_repath, rename_and_repath,
};

const T0: i64 = 1_800_000_000;

/// Make the store's next (and every later) index save fail, so a tab update cannot be persisted.
fn block_saves(dir: &TempDir) {
    fs::create_dir(dir.path().join("editor").join("index.json.tdk-tmp"))
        .expect("obstruct the editor index save");
}

fn store() -> (TempDir, Store) {
    let dir = TempDir::new().expect("temp dir");
    let store = Store::load(&dir.path().join("editor"));
    (dir, store)
}

fn file(dir: &TempDir, name: &str, bytes: &[u8]) -> String {
    let path = dir.path().join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create fixture parent");
    }
    fs::write(&path, bytes).expect("create fixture file");
    path.to_string_lossy().to_string()
}

fn open_paths(store: &mut Store) -> Vec<String> {
    let mut paths: Vec<String> = store
        .list(T0)
        .open
        .into_iter()
        .filter_map(|entry| entry.path)
        .collect();
    paths.sort();
    paths
}

#[test]
fn r9_rename_repoints_an_open_file_to_its_new_path_and_keeps_unsaved_text() {
    let (dir, mut store) = store();
    let old = file(&dir, "a.txt", b"disk");
    let doc = store.open_path(&old, T0).expect("open the file");
    store
        .snapshot(&doc.id, "typed but not saved", T0 + 1)
        .expect("snapshot typing");

    let new_path = dir.path().join("b.txt");
    fs::rename(&old, &new_path).expect("rename on disk");
    let new_text = new_path.to_string_lossy().to_string();
    let changed = store
        .repath_prefix(Path::new(&old), &new_path)
        .expect("re-point the tab");

    assert_eq!(changed.len(), 1);
    assert_eq!(changed[0].id, doc.id);
    assert_eq!(changed[0].path.as_deref(), Some(new_text.as_str()));
    assert_eq!(changed[0].title, "b.txt");

    let back = store.load_doc(&doc.id, T0 + 2).expect("load the tab again");
    assert_eq!(back.path.as_deref(), Some(new_text.as_str()));
    assert_eq!(
        back.content, "typed but not saved",
        "the unsaved text follows the tab"
    );
    assert!(back.dirty);
}

#[test]
fn r9_moving_a_folder_repoints_every_open_file_under_it() {
    let (dir, mut store) = store();
    let first = file(&dir, "tree/a.txt", b"a");
    let second = file(&dir, "tree/sub/b.txt", b"b");
    let unrelated = file(&dir, "elsewhere/c.txt", b"c");
    let one = store.open_path(&first, T0).expect("open a");
    let two = store.open_path(&second, T0).expect("open b");
    store.open_path(&unrelated, T0).expect("open c");

    let old_root = dir.path().join("tree");
    let new_root = dir.path().join("moved");
    fs::rename(&old_root, &new_root).expect("move the folder on disk");
    let changed = store
        .repath_prefix(&old_root, &new_root)
        .expect("re-point the tabs");

    assert_eq!(changed.len(), 2);
    let moved: Vec<String> = changed
        .iter()
        .filter_map(|entry| entry.path.clone())
        .collect();
    assert!(moved.contains(&new_root.join("a.txt").to_string_lossy().to_string()));
    assert!(moved.contains(
        &new_root
            .join("sub")
            .join("b.txt")
            .to_string_lossy()
            .to_string()
    ));
    assert_eq!(store.load_doc(&one.id, T0 + 1).expect("a").title, "a.txt");
    assert_eq!(store.load_doc(&two.id, T0 + 1).expect("b").title, "b.txt");
    assert!(
        open_paths(&mut store).contains(&unrelated),
        "a file outside the folder keeps its path"
    );
}

#[test]
fn r9_repath_does_not_touch_a_sibling_that_only_shares_a_name_prefix() {
    let (dir, mut store) = store();
    let exact = file(&dir, "foo", b"one");
    let sibling = file(&dir, "foobar/b.txt", b"two");
    store.open_path(&exact, T0).expect("open foo");
    store.open_path(&sibling, T0).expect("open foobar/b.txt");

    let old = dir.path().join("foo");
    let new = dir.path().join("renamed");
    fs::rename(&old, &new).expect("rename foo on disk");
    let changed = store.repath_prefix(&old, &new).expect("re-point the tabs");

    assert_eq!(changed.len(), 1, "only the exact file changed");
    assert_eq!(
        changed[0].path.as_deref(),
        Some(new.to_string_lossy().as_ref())
    );

    let paths = open_paths(&mut store);
    assert!(paths.contains(&sibling), "foobar/b.txt is untouched");
}

#[test]
fn r9_a_repointed_tab_stays_at_its_new_path_after_a_restart() {
    let (dir, mut store) = store();
    let old = file(&dir, "a.txt", b"x");
    store.open_path(&old, T0).expect("open the file");
    let new = dir.path().join("b.txt");
    fs::rename(&old, &new).expect("rename on disk");
    store
        .repath_prefix(Path::new(&old), &new)
        .expect("re-point");

    drop(store);
    let mut again = Store::load(&dir.path().join("editor"));

    assert_eq!(
        open_paths(&mut again),
        vec![new.to_string_lossy().to_string()]
    );
}

#[test]
fn r9_deleting_an_open_file_closes_its_tab_and_keeps_unsaved_text_in_the_bin() {
    let (dir, mut store) = store();
    let path = file(&dir, "a.txt", b"disk");
    let doc = store.open_path(&path, T0).expect("open the file");
    store
        .snapshot(&doc.id, "unsaved draft", T0 + 1)
        .expect("snapshot typing");

    let closed = store
        .close_prefix(Path::new(&path), T0 + 2)
        .expect("close the tab");

    assert_eq!(closed, vec![doc.id.clone()]);
    let listing = store.list(T0 + 3);
    assert!(listing.open.is_empty(), "the tab is closed");
    assert_eq!(listing.bin.len(), 1, "the unsaved text is kept in the bin");
    assert_eq!(listing.bin[0].id, doc.id);
    assert_eq!(
        store
            .restore(&doc.id, T0 + 4)
            .expect("restore the draft")
            .content,
        "unsaved draft"
    );
}

#[test]
fn r9_deleting_a_folder_closes_the_tabs_of_every_open_file_inside_it() {
    let (dir, mut store) = store();
    let first = file(&dir, "tree/a.txt", b"a");
    let second = file(&dir, "tree/sub/b.txt", b"b");
    let outside = file(&dir, "outside/c.txt", b"c");
    let one = store.open_path(&first, T0).expect("open a");
    let two = store.open_path(&second, T0).expect("open b");
    store.open_path(&outside, T0).expect("open c");

    let closed = store
        .close_prefix(&dir.path().join("tree"), T0 + 1)
        .expect("close the folder's tabs");

    assert_eq!(closed.len(), 2);
    assert!(closed.contains(&one.id));
    assert!(closed.contains(&two.id));
    let paths = open_paths(&mut store);
    assert_eq!(
        paths,
        vec![outside],
        "only the file outside the folder stays open"
    );
}

#[test]
fn r9_closing_a_clean_deleted_file_forgets_it_without_using_the_bin() {
    let (dir, mut store) = store();
    let path = file(&dir, "a.txt", b"x");
    let doc = store.open_path(&path, T0).expect("open the file");

    let closed = store
        .close_prefix(Path::new(&path), T0 + 1)
        .expect("close the tab");

    assert_eq!(closed, vec![doc.id]);
    let listing = store.list(T0 + 2);
    assert!(listing.open.is_empty());
    assert!(
        listing.bin.is_empty(),
        "a clean tab is forgotten, not binned"
    );
}

#[test]
fn r9_a_rename_whose_tab_update_cannot_be_saved_is_undone() {
    let (dir, mut store) = store();
    let old = file(&dir, "a.txt", b"disk");
    let doc = store.open_path(&old, T0).expect("open the file");
    block_saves(&dir);

    let refused = rename_and_repath(&mut store, Path::new(&old), "b.txt");

    assert!(
        refused.is_err(),
        "the rename is refused when the tabs cannot be saved"
    );
    assert!(
        Path::new(&old).exists(),
        "the file is put back at its old path"
    );
    assert!(
        !dir.path().join("b.txt").exists(),
        "no half-applied rename is left behind"
    );
    let open = store.list(T0 + 1).open;
    assert_eq!(open.len(), 1, "the tab stays open");
    assert_eq!(
        open[0].id, doc.id,
        "the tab is unchanged and points at the file that still exists"
    );
    assert_eq!(open[0].path.as_deref(), Some(old.as_str()));
}

#[test]
fn r9_a_move_whose_tab_update_cannot_be_saved_is_undone() {
    let (dir, mut store) = store();
    let into = dir.path().join("target");
    fs::create_dir(&into).expect("create destination");
    let source = file(&dir, "a.txt", b"disk");
    let doc = store.open_path(&source, T0).expect("open the file");
    block_saves(&dir);

    let refused = move_and_repath(&mut store, Path::new(&source), &into);

    assert!(
        refused.is_err(),
        "the move is refused when the tabs cannot be saved"
    );
    assert!(
        Path::new(&source).exists(),
        "the file is put back where it was"
    );
    assert!(
        !into.join("a.txt").exists(),
        "no half-applied move is left behind"
    );
    let open = store.list(T0 + 1).open;
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].id, doc.id);
    assert_eq!(open[0].path.as_deref(), Some(source.as_str()));
}

#[test]
fn r9_a_delete_whose_tab_update_cannot_be_saved_deletes_nothing() {
    let (dir, mut store) = store();
    let path = file(&dir, "a.txt", b"x");
    let doc = store.open_path(&path, T0).expect("open the file");
    block_saves(&dir);

    let refused = delete_and_close_with(&mut store, Path::new(&path), T0 + 1, |_| {
        panic!("the Recycle Bin must not be touched when the tabs cannot be saved")
    });

    assert!(
        refused.is_err(),
        "the delete is refused when the tabs cannot be saved"
    );
    assert!(
        Path::new(&path).exists(),
        "nothing is removed when the tab update fails"
    );
    let open = store.list(T0 + 2).open;
    assert_eq!(open.len(), 1, "the tab stays open");
    assert_eq!(open[0].id, doc.id);
}

#[test]
fn r9_a_refused_recycle_bin_leaves_the_item_and_its_open_tab_in_place() {
    let (dir, mut store) = store();
    let path = file(&dir, "a.txt", b"x");
    let doc = store.open_path(&path, T0).expect("open the file");

    let refused = delete_and_close_with(&mut store, Path::new(&path), T0 + 1, |_| {
        Err("no Recycle Bin on this drive".to_string())
    });

    let message = refused.expect_err("the delete is refused");
    assert!(message.contains("Recycle Bin"), "{message}");
    assert!(
        Path::new(&path).exists(),
        "the item is left where it was, never permanently deleted"
    );
    let open = store.list(T0 + 2).open;
    assert_eq!(open.len(), 1, "the tab is put back");
    assert_eq!(open[0].id, doc.id);
}
