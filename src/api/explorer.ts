// Thin wrappers for the Files explorer commands. Nothing else in the UI imports Tauri for these.
import { invoke } from "@tauri-apps/api/core";

export interface ExplorerEntry {
  name: string;
  path: string;
  isDir: boolean;
  /** A folder that could not be read; the tree shows it locked instead of failing. */
  locked: boolean;
}

export interface ExplorerListing {
  path: string;
  entries: ExplorerEntry[];
  /** Visible entries found, even when more than the returned 1000. */
  total: number;
  /** True when the level was capped and does not hold everything. */
  truncated: boolean;
  /** True when the requested folder itself could not be read. */
  locked: boolean;
}

/** An open editor tab re-pointed at a renamed or moved item's new path (A3). */
export interface ExplorerRepath {
  id: string;
  path: string;
  title: string;
}

/**
 * The result of a rename, move or delete: the item's new path (unchanged for a delete), the open
 * tabs re-pointed at the new path, and the tabs closed because the item went away (R9).
 */
export interface ExplorerOp {
  path: string;
  repaths: ExplorerRepath[];
  closed: string[];
}

export type ExplorerItemKind = "file" | "folder";

export const explorerApi = {
  /** One directory level. The noisy build and VCS folders stay hidden unless `showHidden`. */
  list: (path: string, showHidden: boolean) => invoke<ExplorerListing>("explorer_list", { path, showHidden }),
  /** The Windows drive roots, the level above every folder hierarchy. */
  drives: () => invoke<ExplorerEntry[]>("explorer_drives"),
  /** The user's home folder, or null when the core cannot determine one (R13, A1). */
  home: () => invoke<string | null>("explorer_home"),
  /** Create an empty file or folder inside `path`; returns the new item's path (R9). */
  create: (path: string, name: string, kind: ExplorerItemKind) =>
    invoke<string>("explorer_create", { path, name, kind }),
  /** Rename an item in place and re-point any open tab at its new path (R9, A3). */
  rename: (path: string, name: string) => invoke<ExplorerOp>("explorer_rename", { path, name }),
  /** Move an item into another folder and re-point the open tabs under it (R9, A3). */
  move: (path: string, into: string) => invoke<ExplorerOp>("explorer_move", { path, into }),
  /** Send an item to the Recycle Bin and close the open tabs for it or files inside it (R9). */
  remove: (path: string) => invoke<ExplorerOp>("explorer_delete", { path }),
};
