import { useCallback, useEffect, useRef, useState } from "react";
import { themeApi, type ThemeStore } from "../api/themes";
import { applyTheme } from "./apply";
import { BUILTIN_THEMES, counterpartOf, defaultFor } from "./builtin";
import type { Theme, ThemeKind } from "./types";
import { importVsCodeTheme } from "./vscode";

export interface ThemesController {
  /** Built-in themes first, then the imported ones. */
  themes: Theme[];
  active: Theme;
  select: (id: string) => Promise<void>;
  /** Add (or replace) themes, and switch to the first. */
  install: (themes: Theme[]) => Promise<void>;
  /** Import one VS Code theme file. Returns an error message, or null when it worked. */
  importText: (text: string, fileName?: string) => Promise<string | null>;
  remove: (id: string) => Promise<void>;
  /** The quick light/dark switch: the matching theme of the other kind. */
  toggleKind: () => Promise<void>;
}

interface Options {
  /** The dark/light setting in the saved configuration. */
  kind: ThemeKind | undefined;
  /** The configuration has been read. */
  ready: boolean;
  /** Keep the saved dark/light setting in step with the chosen theme. */
  setKind: (k: ThemeKind) => Promise<void>;
}

/**
 * Colour themes (BRS 7.16): the built-in ones plus those imported from VS Code. The chosen theme and
 * the imports are kept in themes.json; the saved dark/light setting stays in step with the choice.
 */
export function useThemes({ kind, ready, setKind }: Options): ThemesController {
  const [store, setStore] = useState<ThemeStore>({ active: null, imported: [] });
  const [loaded, setLoaded] = useState(false);
  const storeRef = useRef(store);
  storeRef.current = store;
  const setKindRef = useRef(setKind);
  setKindRef.current = setKind;
  const kindRef = useRef(kind);
  kindRef.current = kind;

  const themes = [...BUILTIN_THEMES, ...store.imported];
  const active = themes.find((t) => t.id === store.active) ?? defaultFor(kind ?? "dark");
  const activeRef = useRef(active);
  activeRef.current = active;

  // read the saved choice once the configuration is known
  useEffect(() => {
    if (!ready) return;
    let live = true;
    (async () => {
      let saved: ThemeStore = { active: null, imported: [] };
      try {
        const r = await themeApi.load();
        if (r && Array.isArray(r.imported)) saved = { active: r.active ?? null, imported: r.imported };
      } catch {
        /* no saved themes: the defaults apply */
      }
      if (!live) return;
      setStore(saved);
      setLoaded(true);
      const chosen = [...BUILTIN_THEMES, ...saved.imported].find((t) => t.id === saved.active);
      if (chosen && kindRef.current && chosen.kind !== kindRef.current) void setKindRef.current(chosen.kind);
    })();
    return () => {
      live = false;
    };
  }, [ready]);

  useEffect(() => {
    if (loaded) applyTheme(active);
  }, [loaded, active]);

  const persist = useCallback((next: ThemeStore) => {
    setStore(next);
    storeRef.current = next;
    void Promise.resolve(themeApi.save(next)).catch(() => {});
  }, []);

  const choose = useCallback(
    async (next: ThemeStore, target: Theme) => {
      const before = activeRef.current;
      persist(next);
      if (target.kind !== before.kind) await setKindRef.current(target.kind);
    },
    [persist],
  );

  const select = useCallback(
    async (id: string) => {
      const target = [...BUILTIN_THEMES, ...storeRef.current.imported].find((t) => t.id === id);
      if (!target) return;
      await choose({ ...storeRef.current, active: id }, target);
    },
    [choose],
  );

  const install = useCallback(
    async (list: Theme[]) => {
      if (!list.length) return;
      const keep = storeRef.current.imported.filter((t) => !list.some((n) => n.id === t.id));
      await choose({ active: list[0].id, imported: [...keep, ...list] }, list[0]);
    },
    [choose],
  );

  const importText = useCallback(
    async (text: string, fileName?: string) => {
      try {
        await install([importVsCodeTheme(text, fileName)]);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [install],
  );

  const remove = useCallback(
    async (id: string) => {
      const s = storeRef.current;
      const gone = s.imported.find((t) => t.id === id);
      if (!gone) return; // built-in themes stay
      const imported = s.imported.filter((t) => t.id !== id);
      if (s.active === id || activeRef.current.id === id) await choose({ active: null, imported }, defaultFor(gone.kind));
      else persist({ ...s, imported });
    },
    [choose, persist],
  );

  const toggleKind = useCallback(async () => {
    const other = counterpartOf(activeRef.current.id, storeRef.current.imported);
    if (other) await select(other.id);
  }, [select]);

  return { themes, active, select, install, importText, remove, toggleKind };
}
