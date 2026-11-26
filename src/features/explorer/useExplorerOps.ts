// The explorer's file operations (R9, A1, A2, A3, A4): open the create/rename/delete prompts, call
// the one explorer API each operation shares, keep the editor's open tabs in step, and re-read only
// the folder levels that changed.
//
// Every operation runs one at a time: while one is in flight the toolbar and the drop targets are
// disabled, so a second click cannot start a competing operation on the same item (A1).
import { useCallback, useRef, useState } from "react";
import {
  explorerApi,
  type ExplorerEntry,
  type ExplorerItemKind,
  type ExplorerRepath,
} from "../../api/explorer";
import { errorText, pickFolder } from "../../api/tauri";
import { parentFolder } from "./root";
import type { ExplorerPrompt } from "./ExplorerDialogs";
import type { ExplorerController } from "./useExplorer";

/** What the explorer needs from the window's editor to keep its tabs in step (A3, A4). */
export interface ExplorerEditorBridge {
  /** Snapshot typing still waiting in a timer, so the core sees the tab as dirty before a delete. */
  flushPending: () => Promise<void>;
  /** Re-point the open tabs the core reported after a rename or move. */
  applyRepaths: (repaths: ExplorerRepath[]) => void;
  /** Close the tabs the core closed for a deleted item. */
  applyClosed: (ids: string[]) => void;
  /** Titles of open tabs with unsaved text at or under a path, for the single delete warning. */
  dirtyTitlesUnder: (path: string) => string[];
}

export interface ExplorerOps {
  prompt: ExplorerPrompt | null;
  busy: boolean;
  error: string | null;
  dismissError: () => void;
  createFile: (parent: string) => void;
  createFolder: (parent: string) => void;
  rename: (entry: ExplorerEntry) => void;
  remove: (entry: ExplorerEntry) => void;
  /** Ask for a destination folder with the existing folder picker. */
  move: (entry: ExplorerEntry) => void;
  /** A row dropped onto a folder: the non-drag alternative is `move`. */
  drop: (entry: ExplorerEntry, into: string) => void;
  /** The prompt's Create/Rename/Delete was pressed with a validated value. */
  submit: (value: string) => void;
  cancel: () => void;
}

function parts(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function samePath(a: string, b: string): boolean {
  const left = parts(a);
  const right = parts(b);
  return left.length === right.length && left.every((part, i) => part.toLowerCase() === right[i].toLowerCase());
}

function withinPath(child: string, parent: string): boolean {
  const childParts = parts(child);
  const parentParts = parts(parent);
  return (
    childParts.length >= parentParts.length &&
    parentParts.every((part, i) => part.toLowerCase() === childParts[i].toLowerCase())
  );
}

export interface ExplorerOpsOptions {
  explorer: ExplorerController;
  /** Without an editor bridge the operations are unavailable, matching the read-only tree. */
  editor?: ExplorerEditorBridge;
  /**
   * Called after a rename, move or delete changed the tree, so the caller can drop a selection whose
   * old path may now point at a different item. A create leaves the selected item in place and does
   * not report here.
   */
  onCommitted?: () => void;
}

export function useExplorerOps({ explorer, editor, onCommitted }: ExplorerOpsOptions): ExplorerOps {
  const [prompt, setPrompt] = useState<ExplorerPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const { reloadFolder, forgetUnder } = explorer;

  const run = useCallback(
    async (work: () => Promise<void>, reloadAt: (string | null)[]) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setError(null);
      try {
        await work();
      } catch (e) {
        // A refused or failed operation leaves the item where it was; re-read the true state (A1).
        setError(errorText(e));
        for (const folder of reloadAt) if (folder) reloadFolder(folder);
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [reloadFolder],
  );

  const doCreate = useCallback(
    async (parent: string, item: ExplorerItemKind, name: string) => {
      await explorerApi.create(parent, name, item);
      reloadFolder(parent);
    },
    [reloadFolder],
  );

  const doRename = useCallback(
    async (entry: ExplorerEntry, name: string) => {
      const before = parentFolder(entry.path);
      const result = await explorerApi.rename(entry.path, name);
      editor?.applyRepaths(result.repaths);
      forgetUnder(entry.path);
      if (before) reloadFolder(before);
      const after = parentFolder(result.path);
      if (after && (!before || !samePath(before, after))) reloadFolder(after);
      onCommitted?.();
    },
    [editor, forgetUnder, reloadFolder, onCommitted],
  );

  const doMove = useCallback(
    async (entry: ExplorerEntry, into: string) => {
      const before = parentFolder(entry.path);
      const result = await explorerApi.move(entry.path, into);
      editor?.applyRepaths(result.repaths);
      forgetUnder(entry.path);
      if (before) reloadFolder(before);
      if (!before || !samePath(before, into)) reloadFolder(into);
      onCommitted?.();
      return result;
    },
    [editor, forgetUnder, reloadFolder, onCommitted],
  );

  const doDelete = useCallback(
    async (entry: ExplorerEntry) => {
      // Wait for the last keystrokes to reach the core first, so the tab lands in the bin with its
      // latest text rather than losing them (A4).
      if (editor) await editor.flushPending();
      const result = await explorerApi.remove(entry.path);
      editor?.applyClosed(result.closed);
      forgetUnder(entry.path);
      const parent = parentFolder(entry.path);
      if (parent) reloadFolder(parent);
      onCommitted?.();
    },
    [editor, forgetUnder, reloadFolder, onCommitted],
  );

  const refuseMove = useCallback(
    (entry: ExplorerEntry, into: string): boolean => {
      const parent = parentFolder(entry.path);
      // Dropping an item onto the folder it already lives in changes nothing and is not an error.
      if (parent && samePath(parent, into)) return true;
      if (entry.isDir && withinPath(into, entry.path)) {
        setError("A folder cannot be moved into itself or one of its folders.");
        return true;
      }
      return false;
    },
    [],
  );

  const createFile = useCallback(
    (parent: string) => {
      if (!editor || running.current) return;
      setPrompt({ kind: "create", parent, item: "file" });
    },
    [editor],
  );

  const createFolder = useCallback(
    (parent: string) => {
      if (!editor || running.current) return;
      setPrompt({ kind: "create", parent, item: "folder" });
    },
    [editor],
  );

  const rename = useCallback(
    (entry: ExplorerEntry) => {
      if (!editor || running.current) return;
      setPrompt({ kind: "rename", entry });
    },
    [editor],
  );

  const remove = useCallback(
    (entry: ExplorerEntry) => {
      if (!editor || running.current) return;
      setPrompt({ kind: "delete", entry, dirtyTitles: editor.dirtyTitlesUnder(entry.path) });
    },
    [editor],
  );

  const move = useCallback(
    (entry: ExplorerEntry) => {
      if (!editor || running.current) return;
      void (async () => {
        const family = parentFolder(entry.path);
        const into = await pickFolder(family ?? undefined);
        if (!into || refuseMove(entry, into)) return;
        await run(() => doMove(entry, into).then(() => undefined), [family, into]);
      })();
    },
    [editor, refuseMove, run, doMove],
  );

  const drop = useCallback(
    (entry: ExplorerEntry, into: string) => {
      if (!editor || running.current) return;
      if (refuseMove(entry, into)) return;
      void run(() => doMove(entry, into).then(() => undefined), [parentFolder(entry.path), into]);
    },
    [editor, refuseMove, run, doMove],
  );

  const submit = useCallback(
    (value: string) => {
      if (!prompt || running.current) return;
      const current = prompt;
      setPrompt(null);
      if (current.kind === "delete") {
        void run(() => doDelete(current.entry), [parentFolder(current.entry.path), current.entry.path]);
        return;
      }
      if (!editor) return;
      if (current.kind === "create") {
        void run(() => doCreate(current.parent, current.item, value), [current.parent]);
        return;
      }
      void run(
        () => doRename(current.entry, value),
        [parentFolder(current.entry.path), current.entry.path],
      );
    },
    [prompt, editor, run, doCreate, doRename, doDelete],
  );

  const cancel = useCallback(() => setPrompt(null), []);
  const dismissError = useCallback(() => setError(null), []);

  return {
    prompt,
    busy,
    error,
    dismissError,
    createFile,
    createFolder,
    rename,
    remove,
    move,
    drop,
    submit,
    cancel,
  };
}
