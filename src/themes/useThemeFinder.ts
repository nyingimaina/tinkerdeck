import { useCallback, useEffect, useRef, useState } from "react";
import { themeApi } from "../api/themes";
import { errorText } from "../api/tauri";
import type { GalleryEntry, Theme } from "./types";
import { themesFromPackage } from "./vscode";

export type FinderTab = "online" | "local";

export interface FinderController {
  tab: FinderTab;
  setTab: (t: FinderTab) => void;
  query: string;
  setQuery: (q: string) => void;
  search: () => Promise<void>;
  entries: GalleryEntry[];
  loading: boolean;
  error: string | null;
  install: (e: GalleryEntry) => Promise<void>;
  /** Id of the extension being installed right now. */
  installing: string | null;
  /** Ids installed during this visit. */
  done: Set<string>;
}

interface Options {
  /** Only does anything while the finder is on screen. */
  open: boolean;
  onInstall: (themes: Theme[]) => Promise<void> | void;
}

/** Finding themes (BRS 7.16): the Open VSX registry online, or the VS Code extensions already on this PC. */
export function useThemeFinder({ open, onInstall }: Options): FinderController {
  const [tab, setTab] = useState<FinderTab>("online");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<GalleryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const seq = useRef(0);
  const busy = useRef(false);
  const onInstallRef = useRef(onInstall);
  onInstallRef.current = onInstall;

  const load = useCallback(async (which: FinderTab, q: string) => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const list = which === "local" ? await themeApi.scanLocal() : await themeApi.searchOnline(q.trim());
      if (mine !== seq.current) return; // a newer search is in flight
      setEntries(list);
    } catch (e) {
      if (mine !== seq.current) return;
      setEntries([]);
      setError(errorText(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // list something as soon as the finder opens or the tab changes
  useEffect(() => {
    if (open) void load(tab, tab === "online" ? query : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  const search = useCallback(() => load(tab, query), [load, tab, query]);

  const install = useCallback(async (e: GalleryEntry) => {
    if (busy.current) return;
    busy.current = true;
    setInstalling(e.id);
    setError(null);
    try {
      const pkg = e.source === "local" ? await themeApi.readLocal(e.location) : await themeApi.fetchOnline(e.publisher, e.location.split("/")[1] ?? "");
      const themes = themesFromPackage(pkg);
      await onInstallRef.current(themes);
      setDone((d) => new Set(d).add(e.id));
    } catch (err) {
      setError(errorText(err));
    } finally {
      busy.current = false;
      setInstalling(null);
    }
  }, []);

  return { tab, setTab, query, setQuery, search, entries, loading, error, install, installing, done };
}
