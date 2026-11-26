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

export const explorerApi = {
  /** One directory level. The noisy build and VCS folders stay hidden unless `showHidden`. */
  list: (path: string, showHidden: boolean) => invoke<ExplorerListing>("explorer_list", { path, showHidden }),
  /** The Windows drive roots, the level above every folder hierarchy. */
  drives: () => invoke<ExplorerEntry[]>("explorer_drives"),
};
