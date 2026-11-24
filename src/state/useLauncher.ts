import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, onCloseRequested, onTerminalState } from "../api/tauri";
import { consoleInstanceId, nextConsoleNumber, parseConsoleId, type ConsoleEntry } from "./console";
import {
  canStop,
  isUp,
  type AppDef,
  type Config,
  type ConfigStatus,
  type TermState,
} from "./model";

const STOPPED: TermState = { kind: "stopped" };

export interface Launcher {
  loaded: boolean;
  config: Config | null;
  status: ConfigStatus | null;
  jobWarning: string | null;
  states: Record<string, TermState>;
  selectedAppId: string | null;
  selectedTerminalId: string | null;
  openedTerminalIds: string[];
  error: string | null;
  closeRunning: number | null;
  restoreAppIds: string[];
  stateOf: (terminalId: string) => TermState;
  selectApp: (id: string) => void;
  selectTerminal: (appId: string, terminalId: string) => void;
  saveApps: (apps: AppDef[]) => Promise<boolean>;
  setTheme: (t: "light" | "dark") => Promise<void>;
  setShell: (s: string) => Promise<void>;
  /** Re-read every terminal's state from Rust (manual refresh). */
  resync: () => Promise<void>;
  ack: () => Promise<void>;
  dismissError: () => void;
  stopAndWait: (terminalIds: string[]) => Promise<void>;
  /** Console instances per app (session only, BRS 7.10). */
  consoles: Record<string, ConsoleEntry[]>;
  openConsoleTab: (appId: string) => string;
  addConsole: (appId: string, shell: string | null) => string;
  closeConsole: (appId: string, consoleId: string) => void;
  selectConsole: (appId: string, consoleId: string) => void;
  /** Remember that the app was opened or started (Recent on the Home screen). */
  touchApp: (appId: string) => void;
  toggleFavourite: (appId: string) => Promise<void>;
  answerClose: (stop: boolean) => Promise<void>;
  cancelClose: () => void;
  answerRestore: (start: boolean) => Promise<void>;
  actions: {
    start: (appId: string, tid: string) => void;
    stop: (appId: string, tid: string) => void;
    restart: (appId: string, tid: string) => void;
    startAll: (appId: string) => void;
    stopAll: (appId: string) => void;
  };
}

export function useLauncher(): Launcher {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [jobWarning, setJobWarning] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, TermState>>({});
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [selectedByApp, setSelectedByApp] = useState<Record<string, string>>({});
  const [opened, setOpened] = useState<string[]>([]);
  const [consoles, setConsoles] = useState<Record<string, ConsoleEntry[]>>({});
  const [lastConsole, setLastConsole] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [closeRunning, setCloseRunning] = useState<number | null>(null);
  const [restoreAppIds, setRestoreAppIds] = useState<string[]>([]);
  const statesRef = useRef(states);
  statesRef.current = states;

  const guard = useCallback(async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  // initial load + events
  useEffect(() => {
    let unlisten: Array<() => void> = [];
    let cancelled = false;
    (async () => {
      try {
        const [view, st] = await Promise.all([api.getConfig(), api.terminalStates()]);
        if (cancelled) return;
        setConfig(view.config);
        setStatus(view.status);
        setJobWarning(view.jobWarning);
        setStates(Object.fromEntries(st.map((s) => [s.terminalId, s.state])));
        const first = view.config.apps[0];
        if (first) setSelectedAppId(first.id);
        const alive = st.some((s) => isUp(s.state));
        if (!view.status.locked && !alive) {
          const ids = view.config.lastRunning.filter((id) => view.config.apps.some((a) => a.id === id));
          setRestoreAppIds(ids);
        }
        setLoaded(true);
      } catch (e) {
        setError(errorText(e));
        setLoaded(true);
      }
      const u1 = await onTerminalState((p) => setStates((prev) => ({ ...prev, [p.terminalId]: p.state })));
      const u2 = await onCloseRequested((n) => setCloseRunning(n));
      if (cancelled) {
        u1();
        u2();
      } else unlisten = [u1, u2];
    })();
    return () => {
      cancelled = true;
      unlisten.forEach((u) => u());
    };
  }, []);

  useEffect(() => {
    if (config) document.documentElement.dataset.theme = config.theme;
  }, [config?.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedApp = config?.apps.find((a) => a.id === selectedAppId) ?? null;
  const selectedTerminalId = useMemo(() => {
    if (!selectedApp) return null;
    const chosen = selectedByApp[selectedApp.id];
    if (chosen && ((consoles[selectedApp.id] ?? []).some((c) => c.id === chosen) || selectedApp.terminals.some((t) => t.id === chosen)))
      return chosen;
    return selectedApp.terminals[0]?.id ?? null;
  }, [selectedApp, selectedByApp, consoles]);

  /** Select (creating the first if needed) the active console of an app; returns its id. */
  const openConsoleTab = (appId: string): string => {
    const list = consoles[appId] ?? [];
    const existing = list.find((c) => c.id === lastConsole[appId]) ?? list[0];
    if (existing) {
      setSelectedAppId(appId);
      setSelectedByApp((m) => ({ ...m, [appId]: existing.id }));
      return existing.id;
    }
    return addConsole(appId, null);
  };

  const addConsole = (appId: string, shell: string | null): string => {
    const list = consoles[appId] ?? [];
    const n = nextConsoleNumber(list);
    const id = consoleInstanceId(appId, n, shell);
    setConsoles((m) => ({ ...m, [appId]: [...(m[appId] ?? []), { id, n, shell }] }));
    setLastConsole((m) => ({ ...m, [appId]: id }));
    setSelectedAppId(appId);
    setSelectedByApp((m) => ({ ...m, [appId]: id }));
    return id;
  };

  const closeConsole = (appId: string, id: string) => {
    const list = consoles[appId] ?? [];
    const idx = list.findIndex((c) => c.id === id);
    const rest = list.filter((c) => c.id !== id);
    setConsoles((m) => ({ ...m, [appId]: rest }));
    if (selectedByApp[appId] === id || lastConsole[appId] === id) {
      const next = rest[Math.max(0, idx - 1)];
      setLastConsole((m) => ({ ...m, [appId]: next?.id ?? "" }));
      if (selectedByApp[appId] === id) setSelectedByApp((m) => ({ ...m, [appId]: next?.id ?? "" }));
    }
  };

  const selectConsole = (appId: string, id: string) => {
    setLastConsole((m) => ({ ...m, [appId]: id }));
    setSelectedAppId(appId);
    setSelectedByApp((m) => ({ ...m, [appId]: id }));
  };

  // remember every terminal that was ever shown so its xterm instance stays alive
  useEffect(() => {
    if (selectedTerminalId) setOpened((o) => (o.includes(selectedTerminalId) ? o : [...o, selectedTerminalId]));
  }, [selectedTerminalId]);

  const stateOf = useCallback((id: string) => states[id] ?? STOPPED, [states]);

  const saveApps = useCallback(
    async (apps: AppDef[]) => {
      try {
        await api.saveApps(apps);
        setConfig((c) => (c ? { ...c, apps } : c));
        if (!apps.some((a) => a.id === selectedAppId)) setSelectedAppId(apps[0]?.id ?? null);
        return true;
      } catch (e) {
        setError(errorText(e));
        return false;
      }
    },
    [selectedAppId],
  );

  const stopAndWait = useCallback(
    async (ids: string[]) => {
      const running = ids.filter((id) => canStop(statesRef.current[id] ?? STOPPED));
      const app = config?.apps.find((a) => a.terminals.some((t) => running.includes(t.id)));
      for (const id of running) {
        const consoleApp = parseConsoleId(id)?.appId;
        const owner = config?.apps.find((a) => a.terminals.some((t) => t.id === id) || a.id === consoleApp) ?? app;
        if (owner) await guard(api.stopTerminal(owner.id, id));
      }
      const start = Date.now();
      while (running.some((id) => isUp(statesRef.current[id] ?? STOPPED) || statesRef.current[id]?.kind === "stopping")) {
        if (Date.now() - start > 40_000) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    [config, guard],
  );

  return {
    loaded,
    config,
    status,
    jobWarning,
    states,
    selectedAppId,
    selectedTerminalId,
    openedTerminalIds: opened,
    error,
    closeRunning,
    restoreAppIds,
    stateOf,
    selectApp: setSelectedAppId,
    selectTerminal: (appId, terminalId) => {
      setSelectedAppId(appId);
      setSelectedByApp((m) => ({ ...m, [appId]: terminalId }));
    },
    saveApps,
    setTheme: async (t) => {
      await guard(api.setTheme(t));
      setConfig((c) => (c ? { ...c, theme: t } : c));
    },
    setShell: async (s) => {
      await guard(api.setShell(s));
      setConfig((c) => (c ? { ...c, shell: s } : c));
    },
    ack: async () => {
      await guard(api.ackConfig());
      setStatus((s) => (s ? { ...s, locked: false, message: null } : s));
    },
    dismissError: () => setError(null),
    stopAndWait,
    consoles,
    resync: async () => {
      try {
        const st = await api.terminalStates();
        setStates(Object.fromEntries(st.map((x) => [x.terminalId, x.state])));
      } catch (e) {
        setError(errorText(e));
      }
    },
    openConsoleTab,
    addConsole,
    closeConsole,
    selectConsole,
    touchApp: (appId) => {
      const now = Math.floor(Date.now() / 1000);
      void guard(api.touchApp(appId));
      setConfig((c) =>
        c ? { ...c, apps: c.apps.map((a) => (a.id === appId ? { ...a, lastOpened: Math.max(a.lastOpened ?? 0, now) } : a)) } : c,
      );
    },
    toggleFavourite: async (appId) => {
      const current = config?.apps.find((a) => a.id === appId)?.favourite ?? false;
      await guard(api.setFavourite(appId, !current));
      setConfig((c) => (c ? { ...c, apps: c.apps.map((a) => (a.id === appId ? { ...a, favourite: !current } : a)) } : c));
    },
    answerClose: async (stop) => {
      await guard(api.quitApp(stop));
    },
    cancelClose: () => setCloseRunning(null),
    answerRestore: async (start) => {
      const ids = restoreAppIds;
      setRestoreAppIds([]);
      if (start) for (const id of ids) await guard(api.startAll(id));
      await guard(api.setLastRunning([]));
    },
    actions: {
      start: (a, t) => void guard(api.startTerminal(a, t)),
      stop: (a, t) => void guard(api.stopTerminal(a, t)),
      restart: (a, t) => void guard(api.restartTerminal(a, t)),
      startAll: (a) => void guard(api.startAll(a)),
      stopAll: (a) => void guard(api.stopAll(a)),
    },
  };
}
