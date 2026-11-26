import { useCallback, useEffect, useRef, useState } from "react";
import { editorApi as api } from "../api/editor";
import { errorText } from "../api/tauri";
import type { EditorDoc, EditorEntry } from "./editor";

const QUIET_MS = 800;
const ACTIVE_KEY = "td.editor.active";

export interface EditorTab {
  id: string;
  title: string;
  path: string | null;
  dirty: boolean;
  eol: string;
  encoding: string;
}
export interface ActiveDoc {
  content: string;
  loaded: boolean;
  error: string | null;
}
export interface EditorController {
  ready: boolean;
  tabs: EditorTab[];
  activeId: string | null;
  active: ActiveDoc | null;
  bin: EditorEntry[];
  error: string | null;
  select: (id: string) => void;
  setContent: (id: string, text: string) => void;
  openPath: (path: string) => Promise<void>;
  openDialog: () => Promise<void>;
  newDoc: () => Promise<void>;
  save: (id: string) => Promise<void>;
  saveAs: (id: string) => Promise<void>;
  close: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  discard: (id: string) => Promise<void>;
  dismissError: () => void;
  /** Snapshot typing still waiting in a timer and wait for it, before a delete closes a tab (A4). */
  flushPending: () => Promise<void>;
  /** Re-point the open tabs the core re-pointed after a rename or move (A3). */
  applyRepaths: (repaths: { id: string; path: string; title: string }[]) => void;
  /** Forget the tabs the core closed for a deleted item; a dirty one is already in the bin (A4). */
  applyClosed: (ids: string[]) => void;
  /** Titles of open tabs with unsaved text at or under a path, for the one delete warning (R9). */
  dirtyTitlesUnder: (path: string) => string[];
}

/** A path split into whole components, so `C:\\foo` never matches a sibling `C:\\foobar`. */
function pathParts(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function withinPath(child: string, parent: string): boolean {
  const childParts = pathParts(child);
  const parentParts = pathParts(parent);
  return (
    childParts.length >= parentParts.length &&
    parentParts.every((part, i) => part.toLowerCase() === childParts[i].toLowerCase())
  );
}

interface DocState extends EditorTab {
  content?: string;
  error?: string | null;
}

const tabOf = (e: { id: string; title: string; path: string | null; dirty: boolean; eol: string; encoding: string }): EditorTab => ({
  id: e.id,
  title: e.title,
  path: e.path,
  dirty: e.dirty,
  eol: e.eol,
  encoding: e.encoding,
});

/**
 * Editor state (BRS 7.14). Typing is snapshotted to disk after a quiet moment, so nothing is lost
 * even when never saved; closing a tab with unsaved text sends it to the bin instead of discarding it.
 */
export function useEditor({ onOpened }: { onOpened?: () => void } = {}): EditorController {
  const [order, setOrder] = useState<string[]>([]);
  const [docs, setDocs] = useState<Record<string, DocState>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bin, setBin] = useState<EditorEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const docsRef = useRef(docs);
  docsRef.current = docs;
  const orderRef = useRef(order);
  orderRef.current = order;
  const opened = useRef(onOpened);
  opened.current = onOpened;
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const latest = useRef<Record<string, string>>({});

  const fail = (e: unknown) => setError(errorText(e));

  const refreshBin = useCallback(async () => {
    try {
      setBin((await api.list()).bin);
    } catch (e) {
      fail(e);
    }
  }, []);

  const addDoc = useCallback((d: EditorDoc) => {
    setDocs((prev) => ({ ...prev, [d.id]: { ...tabOf(d), content: d.content, error: null } }));
    setOrder((prev) => (prev.includes(d.id) ? prev : [...prev, d.id]));
    latest.current[d.id] = d.content;
    setActiveId(d.id);
  }, []);

  const openPath = useCallback(
    async (path: string) => {
      try {
        addDoc(await api.open(path));
        opened.current?.();
      } catch (e) {
        fail(e);
      }
    },
    [addDoc],
  );

  // start: what was open last time, then anything Explorer launched us with
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const l = await api.list();
        if (!live) return;
        setOrder(l.open.map((e) => e.id));
        setDocs(Object.fromEntries(l.open.map((e) => [e.id, tabOf(e)])));
        setBin(l.bin);
        let remembered: string | null = null;
        try {
          remembered = localStorage.getItem(ACTIVE_KEY);
        } catch {
          /* none */
        }
        setActiveId(l.open.find((e) => e.id === remembered)?.id ?? l.open[0]?.id ?? null);
      } catch (e) {
        if (live) fail(e);
      }
      if (live) setReady(true);
      try {
        for (const p of await api.takePending()) if (live) await openPath(p);
      } catch (e) {
        if (live) fail(e);
      }
      try {
        const un = await api.onOpen((p) => void openPath(p));
        if (live) unlisten = un;
        else un();
      } catch {
        /* no event channel (not running inside the app): files can still be opened by hand */
      }
    })();
    return () => {
      live = false;
      unlisten?.();
    };
  }, [openPath]);

  // the editor in front loads its text the first time it is shown
  const frontNeedsText = !!activeId && docs[activeId] !== undefined && docs[activeId].content === undefined && !docs[activeId].error;
  useEffect(() => {
    if (!activeId || !frontNeedsText) return;
    let live = true;
    api
      .load(activeId)
      .then((d) => {
        if (!live) return;
        latest.current[d.id] = d.content;
        setDocs((prev) => (prev[d.id] ? { ...prev, [d.id]: { ...tabOf(d), content: d.content, error: null } } : prev));
      })
      .catch((e) => live && setDocs((prev) => (prev[activeId] ? { ...prev, [activeId]: { ...prev[activeId], error: errorText(e) } } : prev)));
    return () => {
      live = false;
    };
  }, [activeId, frontNeedsText]);

  useEffect(() => {
    if (!activeId) return;
    try {
      localStorage.setItem(ACTIVE_KEY, activeId);
    } catch {
      /* none */
    }
  }, [activeId]);

  const flush = useCallback((id: string) => {
    const t = timers.current[id];
    if (t === undefined) return;
    clearTimeout(t);
    delete timers.current[id];
    const text = latest.current[id];
    if (text !== undefined) void Promise.resolve(api.snapshot(id, text)).catch(fail);
  }, []);

  // Before a delete closes tabs, the last keystrokes must reach the core so the tab keeps its
  // latest text in the bin rather than only what the quiet timer had already sent (A4).
  const flushPending = useCallback(async () => {
    const jobs: Promise<unknown>[] = [];
    for (const id of Object.keys(timers.current)) {
      const t = timers.current[id];
      if (t === undefined) continue;
      clearTimeout(t);
      delete timers.current[id];
      const text = latest.current[id];
      if (text !== undefined) jobs.push(Promise.resolve(api.snapshot(id, text)).catch(fail));
    }
    await Promise.all(jobs);
  }, []);

  // A rename or move re-points the core's saved index; the open tabs follow at once so the tab
  // groups, which are derived from paths, recompute in the same render (A3).
  const applyRepaths = useCallback((repaths: { id: string; path: string; title: string }[]) => {
    if (repaths.length === 0) return;
    setDocs((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const r of repaths) {
        const d = next[r.id];
        if (!d) continue;
        next[r.id] = { ...d, path: r.path, title: r.title };
        changed = true;
      }
      if (!changed) return prev;
      docsRef.current = next;
      return next;
    });
  }, []);

  // A delete has already closed these tabs (and binned any with unsaved text) in the core, so the
  // window only drops them from its own lists and reloads the bin (A4).
  const applyClosed = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const gone = new Set(ids);
      const rest = orderRef.current.filter((id) => !gone.has(id));
      orderRef.current = rest;
      setOrder(rest);
      setDocs((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of ids) {
          if (next[id] !== undefined) {
            delete next[id];
            changed = true;
          }
        }
        if (!changed) return prev;
        docsRef.current = next;
        return next;
      });
      for (const id of ids) delete latest.current[id];
      setActiveId((cur) => (cur !== null && gone.has(cur) ? (rest[0] ?? null) : cur));
      void refreshBin();
    },
    [refreshBin],
  );

  // The one delete confirmation needs to say which open tabs would lose unsaved text (R9). The
  // unsaved mark is set the moment text is typed, so this is accurate before any snapshot.
  const dirtyTitlesUnder = useCallback((path: string) => {
    const titles: string[] = [];
    for (const id of orderRef.current) {
      const d = docsRef.current[id];
      if (d && d.dirty && d.path && withinPath(d.path, path)) titles.push(d.title);
    }
    return titles;
  }, []);

  // never leave typing waiting in a timer when the window goes away
  useEffect(() => {
    const flushAll = () => Object.keys(timers.current).forEach(flush);
    const onVisibility = () => document.visibilityState === "hidden" && flushAll();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", flushAll);
    window.addEventListener("pagehide", flushAll);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", flushAll);
      window.removeEventListener("pagehide", flushAll);
    };
  }, [flush]);

  const setContent = useCallback((id: string, text: string) => {
    latest.current[id] = text;
    setDocs((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], content: text, dirty: true } } : prev));
    const old = timers.current[id];
    if (old !== undefined) clearTimeout(old);
    timers.current[id] = setTimeout(() => {
      delete timers.current[id];
      void Promise.resolve(api.snapshot(id, latest.current[id] ?? text)).catch(fail);
    }, QUIET_MS);
  }, []);

  const doSave = useCallback(
    async (id: string, forcePick: boolean) => {
      const d = docsRef.current[id];
      if (!d) return;
      const text = latest.current[id] ?? d.content;
      if (text === undefined) return;
      let target: string | null = null;
      if (forcePick || !d.path) {
        target = await api.pickSavePath(d.title);
        if (!target) return;
      }
      const t = timers.current[id];
      if (t !== undefined) {
        clearTimeout(t);
        delete timers.current[id];
      }
      try {
        const r = await api.save(id, text, target);
        setDocs((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...tabOf(r), dirty: false } } : prev));
      } catch (e) {
        fail(e);
      }
    },
    [],
  );

  const select = useCallback((id: string) => {
    setActiveId(id);
    void Promise.resolve(api.touch(id)).catch(() => {});
  }, []);

  const close = useCallback(
    async (id: string) => {
      flush(id);
      try {
        await api.close(id);
      } catch (e) {
        fail(e);
        return;
      }
      const at = orderRef.current.indexOf(id);
      const rest = orderRef.current.filter((x) => x !== id);
      setOrder(rest);
      setDocs((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      delete latest.current[id];
      setActiveId((cur) => (cur === id ? (rest[Math.min(at, rest.length - 1)] ?? null) : cur));
      await refreshBin();
    },
    [flush, refreshBin],
  );

  const restore = useCallback(
    async (id: string) => {
      try {
        addDoc(await api.restore(id));
      } catch (e) {
        fail(e);
      }
      await refreshBin();
    },
    [addDoc, refreshBin],
  );

  const discard = useCallback(
    async (id: string) => {
      try {
        await api.discard(id);
      } catch (e) {
        fail(e);
      }
      await refreshBin();
    },
    [refreshBin],
  );

  const openDialog = useCallback(async () => {
    try {
      for (const p of await api.pickOpenPaths()) await openPath(p);
    } catch (e) {
      fail(e);
    }
  }, [openPath]);

  const newDoc = useCallback(async () => {
    try {
      addDoc(await api.newDoc());
    } catch (e) {
      fail(e);
    }
  }, [addDoc]);

  const front = activeId ? docs[activeId] : undefined;
  return {
    ready,
    tabs: order.map((id) => docs[id]).filter(Boolean).map(tabOf),
    activeId,
    active: front ? { content: front.content ?? "", loaded: front.content !== undefined || !!front.error, error: front.error ?? null } : null,
    bin,
    error,
    select,
    setContent,
    openPath,
    openDialog,
    newDoc,
    save: (id) => doSave(id, false),
    saveAs: (id) => doSave(id, true),
    close,
    restore,
    discard,
    dismissError: () => setError(null),
    flushPending,
    applyRepaths,
    applyClosed,
    dirtyTitlesUnder,
  };
}
