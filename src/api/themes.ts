// Thin wrappers for the theme commands. Nothing else in the UI imports Tauri.
import { invoke } from "@tauri-apps/api/core";
import type { GalleryEntry, Theme, ThemePackage } from "../themes/types";

export interface ThemeStore {
  active: string | null;
  imported: Theme[];
}

export const themeApi = {
  load: () => invoke<ThemeStore>("themes_load"),
  save: (value: ThemeStore) => invoke<void>("themes_save", { value }),
  /** An empty query lists the most popular themes. Only the query is sent to the registry. */
  searchOnline: (query: string) => invoke<GalleryEntry[]>("themes_search_online", { query }),
  fetchOnline: (publisher: string, name: string) => invoke<ThemePackage>("themes_fetch_online", { publisher, name }),
  scanLocal: () => invoke<GalleryEntry[]>("themes_scan_local"),
  readLocal: (dir: string) => invoke<ThemePackage>("themes_read_local", { dir }),
};
