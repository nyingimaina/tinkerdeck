import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, pickFolder, type ShellInfo } from "./api/tauri";
import { explorerApi } from "./api/explorer";
import { AppFooter } from "./features/apps/AppFooter";
import { AppHeader } from "./features/apps/AppHeader";
import { Banner } from "./features/apps/Banner";
import { Dialog } from "./features/apps/Dialog";
import { EmptyState } from "./features/apps/EmptyState";
import { Sidebar } from "./features/apps/Sidebar";
import { TopBar } from "./features/apps/TopBar";
import { GitBar } from "./features/git/GitBar";
import type { GitTab } from "./features/git/GitDrawer";
import { HomeScreen } from "./features/home/HomeScreen";
import { EditorView } from "./features/editor/EditorView";
import { ExplorerPanel } from "./features/explorer/ExplorerPanel";
import { explorerRoot } from "./features/explorer/root";
import { TabStrip } from "./features/terminals/TabStrip";
import { TerminalHost } from "./features/terminals/TerminalHost";
import { consoleExitAction, consoleId, consoleTitle, isConsoleId } from "./state/console";
import {
  appButton,
  canStop,
  isExecutable,
  isUp,
  nameFromPath,
  newApp,
  newTerminal,
  suggestionToTerminal,
  uniqueName,
  type AppDef,
  type TermState,
} from "./state/model";
import { useEditor } from "./state/useEditor";
import { useGit } from "./state/useGit";
import { useThemeFinder } from "./themes/useThemeFinder";
import { useThemes } from "./themes/useThemes";
import { useLauncher } from "./state/useLauncher";
import { useUpdates } from "./state/useUpdates";
import { usePoller } from "./state/usePoller";
import { matchShortcut, shortcutKeys } from "./shared/shortcuts";
import type { PaletteAction } from "./features/command-palette/CommandPalette";
import styles from "./App.module.css";

// Optional panels and tool bodies are code-split so the initial view does not carry them (R5).
const ConsoleNav = lazy(() => import("./features/terminals/ConsoleNav").then((m) => ({ default: m.ConsoleNav })));
const EditPane = lazy(() => import("./features/apps/EditPane").then((m) => ({ default: m.EditPane })));
const GitDrawer = lazy(() => import("./features/git/GitDrawer").then((m) => ({ default: m.GitDrawer })));
const ThemeFinder = lazy(() => import("./features/themes/ThemeFinder").then((m) => ({ default: m.ThemeFinder })));
const CommandPalette = lazy(() => import("./features/command-palette/CommandPalette").then((m) => ({ default: m.CommandPalette })));
// The update banner, update dialog and the help dialog are only shown in response to a signal or a
// click, so their bodies share on-demand chunks instead of the initial one (R5).
const UpdateBanner = lazy(() => import("./features/updates/UpdateUI").then((m) => ({ default: m.UpdateBanner })));
const UpdateDialog = lazy(() => import("./features/updates/UpdateUI").then((m) => ({ default: m.UpdateDialog })));
const HelpDialog = lazy(() => import("./features/command-palette/CommandPalette").then((m) => ({ default: m.HelpDialog })));
// The short confirmation dialogs share the palette's on-demand chunk: their bodies are not in the
// initial view either, and a dialog loads them the first time one opens (R5).
const ConfirmDialogs = lazy(() => import("./features/command-palette/CommandPalette").then((m) => ({ default: m.ConfirmDialogs })));

interface Editing {
  app: AppDef;
  isNew: boolean;
}

const COLLAPSE_KEY = "td.sidebarCollapsed";
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
};

export function App() {
  const L = useLauncher();
  const [view, setView] = useState<"home" | "app" | "editor">("home");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pendingSave, setPendingSave] = useState<{ apps: AppDef[]; ids: string[] } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AppDef | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<{ branch: string; running: string[] } | null>(null);
  const [pendingCloseConsole, setPendingCloseConsole] = useState<{ appId: string; id: string; title: string } | null>(null);
  const [gitTab, setGitTab] = useState<GitTab | null>(null);
  // The last tab shown keeps the drawer mounted while it is hidden, so a typed commit
  // message survives the drawer being closed and reopened in the same visit (R8).
  const [gitTabKept, setGitTabKept] = useState<GitTab | null>(null);
  const [gitToolsOpen, setGitToolsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [finderOpen, setFinderOpen] = useState(false);
  const [manualCheck, setManualCheck] = useState(false); // the user pressed Check for updates: show its result
  const [folderExists, setFolderExists] = useState<Record<string, boolean>>({});
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [homeFolder, setHomeFolder] = useState<string | null>(null);
  const [paneCollapsed, setPaneCollapsed] = useState(readCollapsed);
  const [refreshKey, setRefreshKey] = useState(0);
  const [consoleNotice, setConsoleNotice] = useState<Record<string, string>>({});
  // Start all / F5 has nothing executable to start: say so briefly instead of looking broken (A5).
  const [noExecutable, setNoExecutable] = useState(false);
  const noExecutableTimer = useRef<number | null>(null);
  const autoStarted = useRef<Set<string>>(new Set());
  const prevKinds = useRef<Record<string, string>>({});
  const lastAutoRestart = useRef<Record<string, number>>({});
  // F5 mirrors the on-screen Start all / Stop all button. The key listener is registered once,
  // so it calls this ref, which is refreshed every render and reads the live view and app (R6).
  const toggleAppNow = useRef<() => void>(() => {});
  // The control that opened the git drawer, so closing it hands focus back instead of leaving
  // it on the now-hidden Close button (R8).
  const gitReturnFocus = useRef<HTMLElement | null>(null);

  const apps = L.config?.apps;
  const app = apps?.find((a) => a.id === L.selectedAppId) ?? null;
  const showHome = view === "home" && (apps?.length ?? 0) > 0;
  const git = useGit(view === "app" ? (app?.id ?? null) : null, {
    changes: gitTab === "changes",
    history: gitTab === "history",
    refreshKey,
  });
  const resync = L.resync;
  const U = useUpdates({
    autoCheck: L.loaded && (L.config?.update?.autoCheck ?? true), // never before the saved choice is known
    skippedVersion: L.config?.update?.skippedVersion,
    save: L.setUpdateSettings,
  });

  // the text editor (BRS 7.14): files sent from Explorer's "Edit with Tinkerdeck" land here
  const editor = useEditor({ onOpened: () => setView("editor") });

  // The explorer's file operations keep the editor's tabs in step (R9). The bridge is memoised on
  // the editor's own stable callbacks so the explorer's memoised file rows are not re-rendered by
  // an unrelated App update (A1).
  const editorBridge = useMemo(
    () => ({
      flushPending: editor.flushPending,
      applyRepaths: editor.applyRepaths,
      applyClosed: editor.applyClosed,
      dirtyTitlesUnder: editor.dirtyTitlesUnder,
    }),
    [editor.flushPending, editor.applyRepaths, editor.applyClosed, editor.dirtyTitlesUnder],
  );

  // The brief "No executable terminals" notice goes away by itself, but its timer is released too.
  useEffect(
    () => () => {
      if (noExecutableTimer.current !== null) window.clearTimeout(noExecutableTimer.current);
    },
    [],
  );

  const checkForUpdates = async () => {
    setManualCheck(true);
    await U.checkNow();
    window.setTimeout(() => setManualCheck(false), 12000);
  };

  // colour themes (BRS 7.16): the chosen theme drives the whole look, terminals and editor included
  const T = useThemes({ kind: L.config?.theme, ready: L.loaded, setKind: L.setTheme });
  const finder = useThemeFinder({ open: finderOpen, onInstall: T.install });

  const refreshAll = () => {
    setRefreshKey((k) => k + 1);
    void resync();
    void api.listShells().then(setShells).catch(() => {});
  };

  const toggleSidebar = () =>
    setPaneCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* per-viewer convenience only */
      }
      return !c;
    });

  // keyboard: the shared registry drives Ctrl+B, F5 (Start all / Stop all), Ctrl+Shift+P and
  // Ctrl+Alt+T (VS Code habits). F5 is always prevented, so it never reloads the webview (R6).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = matchShortcut(e);
      if (!id) return;
      e.preventDefault();
      if (id === "toggleSidebar") toggleSidebar();
      else if (id === "toggleApp") toggleAppNow.current();
      else if (id === "commandPalette") setPaletteOpen(true);
      else if (id === "toggleTheme") void T.toggleKind();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // installed shells (for the header dropdown, new consoles and the edit form)
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => api.listShells())
      .then((s) => live && setShells(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // The user's home folder comes from the core once, so the explorer can root there in the home
  // view or an editor with no file without the window guessing a path (R13, A1). When the core
  // cannot report one, it stays null and the explorer keeps its existing no-root hint.
  useEffect(() => {
    let live = true;
    explorerApi
      .home()
      .then((path) => live && setHomeFolder(path))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // which project folders still exist, polled gently while Home is on screen (BRS 7.9)
  const roots = [...new Set((apps ?? []).map((a) => a.root))];
  usePoller<Record<string, boolean>>({
    enabled: showHome && roots.length > 0,
    func: async () => {
      const r = await api.pathsExist(roots);
      return Object.fromEntries(roots.map((p, i) => [p, r[i] !== false]));
    },
    onResult: (v, changed) => {
      if (changed) setFolderExists(v);
    },
    intervalMs: 10000,
    maxIntervalMs: 60000,
    refreshKey,
  });

  // every console starts the first time it is shown
  const selectedTid = L.selectedTerminalId;
  const selectedState = selectedTid ? L.stateOf(selectedTid) : null;
  useEffect(() => {
    if (view !== "app" || !app || !selectedTid || !isConsoleId(selectedTid)) return;
    if (selectedState?.kind === "stopped" && !autoStarted.current.has(selectedTid)) {
      autoStarted.current.add(selectedTid);
      L.actions.start(app.id, selectedTid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, app?.id, selectedTid, selectedState?.kind]);

  // guard: a console whose shell ends by itself (exit, logout, Ctrl+D) is never left dead (BRS 7.10)
  useEffect(() => {
    for (const [appId, list] of Object.entries(L.consoles)) {
      list.forEach((c, i) => {
        const next = L.stateOf(c.id).kind;
        const prev = prevKinds.current[c.id];
        prevKinds.current[c.id] = next;
        if (prev === next) return;
        const action = consoleExitAction(prev, next, {
          primary: i === 0,
          msSinceAutoRestart: Date.now() - (lastAutoRestart.current[c.id] ?? 0),
        });
        if (action === "restart") {
          lastAutoRestart.current[c.id] = Date.now();
          setConsoleNotice((n) => ({ ...n, [appId]: `${consoleTitle(c)}: the shell ended, so a fresh one was started.` }));
          window.setTimeout(() => setConsoleNotice((n) => ({ ...n, [appId]: "" })), 8000);
          window.setTimeout(() => L.actions.start(appId, c.id), 250);
        } else if (action === "remove") {
          L.closeConsole(appId, c.id);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L.states, L.consoles]);

  if (!L.loaded || !L.config || !apps) {
    return <div className={styles.loading}>{L.error ? L.error : "Loading…"}</div>;
  }
  const { config } = L;
  const runningIds = apps.flatMap((a) => a.terminals.filter((t) => canStop(L.stateOf(t.id))).map((t) => t.id));
  const consoleIdsOf = (appId: string) => (L.consoles[appId] ?? []).map((c) => c.id);
  const appConsoles = app ? (L.consoles[app.id] ?? []) : [];
  const onConsole = !!selectedTid && isConsoleId(selectedTid);
  const consoleAgg: TermState = appConsoles.some((c) => isUp(L.stateOf(c.id))) ? { kind: "running" } : { kind: "stopped" };
  const shellChoices = shells.map((s) => ({ id: s.id, name: s.name }));

  const openAdd = () => setEditing({ app: newApp(), isNew: true });
  const openEdit = (a: AppDef) => setEditing({ app: a, isNew: false });
  /** Show the drawer on a tab and remember it, so hiding keeps its contents mounted (R8). */
  const showGitTab = (tab: GitTab) => {
    setGitTab(tab);
    setGitTabKept(tab);
  };
  const openGitTab = (tab: GitTab) => {
    const active = document.activeElement;
    gitReturnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
    showGitTab(tab);
  };
  const closeGitTab = () => {
    setGitTab(null);
    const target = gitReturnFocus.current;
    gitReturnFocus.current = null;
    if (target?.isConnected && target.closest("[hidden]") === null) target.focus();
    else
      document
        .querySelector<HTMLElement>('button[aria-label="Show git tools"], button[aria-label="Hide git tools"]')
        ?.focus();
  };
  const hideGitTab = () => {
    setGitTab(null);
    gitReturnFocus.current = null;
  };
  const openApp = (id: string, list: AppDef[] = apps ?? []) => {
    L.selectApp(id);
    L.touchApp(id);
    hideGitTab();
    setGitTabKept(null);
    setGitToolsOpen(false);
    // A calm start (R9): open on the app's first terminal, or no tab at all when it has no
    // terminals, so a console or drawer left open on an earlier visit is not reopened.
    const target = list.find((a) => a.id === id);
    L.selectTerminal(id, target?.terminals[0]?.id ?? "");
    setView("app");
  };
  const openConsole = () => {
    if (!app) return;
    L.openConsoleTab(app.id);
    hideGitTab();
    setView("app");
  };

  const commit = async (next: AppDef[]) => {
    if (await L.saveApps(next)) setEditing(null);
  };

  /** One step: pick a folder, detect terminals, save and open. */
  const quickAdd = async () => {
    const folder = await pickFolder();
    if (!folder) return;
    try {
      const found = await api.detectProject(folder);
      const fresh = newApp();
      const terminals = found.map((s) => suggestionToTerminal(s));
      terminals.forEach((t, i) => (t.name = uniqueName(t.name, terminals.slice(0, i).map((x) => x.name))));
      const created: AppDef = { ...fresh, name: nameFromPath(folder) || "App", root: folder, terminals };
      if (await L.saveApps([...apps, created])) openApp(created.id);
    } catch (e) {
      alert(errorText(e));
    }
  };

  const handleSave = async (saved: AppDef) => {
    const exists = apps.some((a) => a.id === saved.id);
    const next = exists ? apps.map((a) => (a.id === saved.id ? saved : a)) : [...apps, saved];
    // terminals removed from a running app must be stopped first, after confirmation
    const before = apps.find((a) => a.id === saved.id);
    const removed = (before?.terminals ?? []).filter((t) => !saved.terminals.some((s) => s.id === t.id)).map((t) => t.id);
    const removedUp = removed.filter((id) => isUp(L.stateOf(id)));
    if (removedUp.length) setPendingSave({ apps: next, ids: removedUp });
    else {
      await commit(next);
      // A newly created app opens through the same calm reset as any other app visit (R9),
      // so it never inherits the previous app's expired drawer or expanded git tools.
      if (!exists) openApp(saved.id, next);
    }
  };

  const handleDelete = async (a: AppDef) => {
    const ids = [...a.terminals.map((t) => t.id), ...consoleIdsOf(a.id)].filter((id) => isUp(L.stateOf(id)));
    if (ids.length) await L.stopAndWait(ids);
    setPendingDelete(null);
    await commit(apps.filter((x) => x.id !== a.id));
    setView("home");
  };

  /** Close a console: stop it first (asking if something is running in it). */
  const requestCloseConsole = (appId: string, id: string, title: string) => {
    if (isUp(L.stateOf(id))) setPendingCloseConsole({ appId, id, title });
    else L.closeConsole(appId, id);
  };

  /** Switching branch under running dev servers needs a warning first (BRS 7.7). */
  const requestSwitch = (branch: string) => {
    if (!app) return;
    const running = app.terminals.filter((t) => isUp(L.stateOf(t.id))).map((t) => t.id);
    if (running.length === 0) void git.switchBranch(branch);
    else setPendingSwitch({ branch, running });
  };

  const stopSwitchStart = async (p: { branch: string; running: string[] }) => {
    if (!app) return;
    setPendingSwitch(null);
    await L.stopAndWait(p.running);
    if (await git.switchBranch(p.branch)) for (const id of p.running) L.actions.start(app.id, id);
  };

  /** Say briefly that a bulk start had nothing executable to act on (A5). */
  const showNoExecutable = () => {
    setNoExecutable(true);
    if (noExecutableTimer.current !== null) window.clearTimeout(noExecutableTimer.current);
    noExecutableTimer.current = window.setTimeout(() => setNoExecutable(false), 8000);
  };

  // Start all honours the executable flag in the core too; when every terminal is marked
  // non-executable it starts nothing and says why (R11, A5).
  const startAll = (id: string) => {
    const target = apps?.find((a) => a.id === id) ?? null;
    if (target && target.terminals.length > 0 && !target.terminals.some(isExecutable)) {
      showNoExecutable();
      return;
    }
    L.actions.startAll(id);
    L.touchApp(id);
  };

  // F5 runs exactly what the app's on-screen button would at this moment: the same appButton
  // decision over the live executable terminal states, the same startAll / stopAll calls, and
  // nothing at all outside the app view or for an app with no terminals (R6, R11).
  toggleAppNow.current = () => {
    if (view !== "app" || !app) return;
    const executable = app.terminals.filter(isExecutable);
    if (executable.length === 0) {
      if (app.terminals.length > 0) showNoExecutable();
      return;
    }
    if (appButton(executable.map((t) => L.stateOf(t.id))) === "stop") L.actions.stopAll(app.id);
    else startAll(app.id);
  };

  /** Hide the console by selecting a terminal in the same app; the shell keeps running (R8). */
  const hideConsole = () => {
    if (!app) return;
    const first = app.terminals[0];
    if (first) L.selectTerminal(app.id, first.id);
  };

  /** Return to the calm default without closing anything that is running (R8). */
  const resetLayout = () => {
    setPaneCollapsed(false);
    try {
      localStorage.setItem(COLLAPSE_KEY, "0");
    } catch {
      /* per-viewer convenience only */
    }
    hideGitTab();
    setGitToolsOpen(false);
    if (onConsole) hideConsole();
  };

  // The Files explorer follows where the user is (R4, R5, R13): the selected app's root in the app
  // view, the root of the app that owns the active editor tab, the parent folder of a Misc
  // (app-less) file, or the user's home folder when no app root or file path applies. The same
  // deepest-root lookup the tab groups use decides the owner.
  const activePath = editor.tabs.find((t) => t.id === editor.activeId)?.path ?? null;
  const explorer = explorerRoot({ view, apps: apps ?? [], selectedAppId: L.selectedAppId, activePath, homeFolder });
  // A change of view, selected app or root discards any temporary Up navigation (R4, R5). The
  // resolved root, not the active path, is the trigger, so re-pointing a renamed tab to a new
  // path under the same root does not throw away the tree the user was browsing (R9).
  const explorerResetKey = `${view}|${L.selectedAppId ?? ""}|${explorer.root ?? ""}`;

  // The palette lists every app-level command the window offers, each with the shortcut that
  // also runs it or a visible note when it has none (R7). Commands that only exist while an app
  // is open are added then, and ones that cannot run now (no repository, no console) stay out
  // rather than failing when chosen.
  const paletteActions: PaletteAction[] = [
    { id: "toggleSidebar", label: "Toggle sidebar", shortcut: shortcutKeys("toggleSidebar"), run: toggleSidebar },
    // Refresh has no keyboard shortcut any more: F5 is the app toggle (R6).
    { id: "refresh", label: "Refresh everything", run: refreshAll },
    { id: "toggleTheme", label: "Switch light/dark theme", shortcut: shortcutKeys("toggleTheme"), run: () => void T.toggleKind() },
    { id: "commandPalette", label: "Open command palette", shortcut: shortcutKeys("commandPalette"), run: () => setPaletteOpen(true) },
    { id: "editor", label: view === "editor" ? "Close editor" : "Open editor", run: () => setView((v) => (v === "editor" ? "home" : "editor")) },
    // Open file… is offered in every view and runs the editor's one existing picker path (R1).
    { id: "openFile", label: "Open file…", run: () => void editor.openDialog() },
    { id: "updates", label: "Check for updates", run: () => void checkForUpdates() },
    { id: "help", label: "Help", run: () => setHelp(true) },
    { id: "home", label: "Go to Home", run: () => setView("home") },
    { id: "findThemes", label: "Find themes", run: () => setFinderOpen(true) },
    { id: "resetLayout", label: "Reset layout", run: resetLayout },
  ];
  if (!(L.status?.locked && L.status.permanent)) paletteActions.push({ id: "addApp", label: "Add app", run: openAdd });
  if (view === "app" && app) {
    paletteActions.push(
      { id: "editApp", label: "Edit app", run: () => openEdit(app) },
      // Start all / Stop all is what F5 does, so the palette shows the real key hint (R6, R12).
      { id: "startAll", label: "Start all", shortcut: shortcutKeys("toggleApp"), run: () => startAll(app.id) },
      { id: "stopAll", label: "Stop all", shortcut: shortcutKeys("toggleApp"), run: () => L.actions.stopAll(app.id) },
    );
    const activeTid = L.selectedTerminalId;
    if (activeTid) {
      paletteActions.push(
        { id: "startTerminal", label: "Start selected terminal", run: () => L.actions.start(app.id, activeTid) },
        { id: "stopTerminal", label: "Stop selected terminal", run: () => L.actions.stop(app.id, activeTid) },
        { id: "restartTerminal", label: "Restart selected terminal", run: () => L.actions.restart(app.id, activeTid) },
      );
    }
    if (git.info) {
      paletteActions.push(
        { id: "gitFetch", label: "Git fetch", run: () => void git.fetch() },
        { id: "gitPull", label: "Git pull", run: () => void git.pull() },
        { id: "gitPush", label: "Git push", run: () => void git.push() },
        { id: "gitSync", label: "Git sync", run: () => void git.sync() },
        { id: "gitChanges", label: "Git: show changes", run: () => openGitTab("changes") },
        { id: "gitHistory", label: "Git: show history", run: () => openGitTab("history") },
        {
          id: "gitTools",
          label: gitToolsOpen ? "Hide git tools" : "Show git tools",
          run: () => setGitToolsOpen((v) => !v),
        },
      );
      if (gitTab) paletteActions.push({ id: "gitClose", label: "Close git drawer", run: closeGitTab });
    }
    paletteActions.push(
      { id: "openConsole", label: "Open console", run: openConsole },
      { id: "newConsole", label: "New console", run: () => L.addConsole(app.id, null) },
    );
    if (onConsole) {
      const onlyWorkspace = app.terminals.length === 0;
      paletteActions.push({
        id: "hideConsole",
        label: "Hide console",
        disabled: onlyWorkspace,
        disabledReason: onlyWorkspace ? "Only workspace: this app has no terminals." : undefined,
        run: hideConsole,
      });
    }
  }

  return (
    <div className={styles.shell}>
      <TopBar
        sidebarCollapsed={paneCollapsed}
        onToggleSidebar={toggleSidebar}
        shell={config.shell}
        shells={shells}
        onShellChange={(v) => void L.setShell(v)}
        themeKind={config.theme}
        onToggleTheme={() => void T.toggleKind()}
        themes={T.themes}
        activeThemeId={T.active.id}
        onSelectTheme={(id) => void T.select(id)}
        onRemoveTheme={(id) => void T.remove(id)}
        onImportTheme={T.importText}
        onFindThemes={() => setFinderOpen(true)}
        onAddApp={openAdd}
        addDisabled={!!L.status?.locked && L.status.permanent}
        editorActive={view === "editor"}
        onEditor={() => setView((v) => (v === "editor" ? "home" : "editor"))}
        onCheckUpdates={() => void checkForUpdates()}
        updatesBusy={U.phase === "checking"}
        updateAvailable={U.visible && U.info ? U.info.version : null}
        onRefresh={refreshAll}
        onHelp={() => setHelp(true)}
      />

      {L.status?.locked && L.status.message && (
        <Banner
          kind="error"
          actions={[
            { label: "Open folder", onClick: () => void api.openConfigFolder() },
            ...(L.status.permanent ? [] : [{ label: "Continue", onClick: () => void L.ack() }]),
          ]}
        >
          {L.status.message} <code>{L.status.path}</code>
        </Banner>
      )}
      {L.jobWarning && <Banner kind="warn">{L.jobWarning}</Banner>}
      {U.visible && U.info && (
        <Suspense fallback={null}>
          <UpdateBanner info={U.info} onDetails={() => setUpdateOpen(true)} onLater={U.later} onSkip={() => void U.skip()} />
        </Suspense>
      )}
      {manualCheck && U.upToDate && !U.error && !U.visible && (
        <Banner kind="info" actions={[{ label: "Dismiss", onClick: () => setManualCheck(false) }]}>
          You have the latest version{typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? ` (${__APP_VERSION__})` : ""}.
        </Banner>
      )}
      {manualCheck && U.error && U.phase === "idle" && (
        <Banner
          kind="error"
          actions={[
            {
              label: "Dismiss",
              onClick: () => {
                U.clearError();
                setManualCheck(false);
              },
            },
          ]}
        >
          {U.error}
        </Banner>
      )}
      {L.error && (
        <Banner kind="error" actions={[{ label: "Dismiss", onClick: L.dismissError }]}>
          {L.error}
        </Banner>
      )}
      {noExecutable && (
        <Banner kind="info" actions={[{ label: "Dismiss", onClick: () => setNoExecutable(false) }]}>
          No executable terminals
        </Banner>
      )}

      <div className={styles.body}>
        {(apps.length > 0 || explorer.root !== null) && (
          <Sidebar
            apps={apps}
            selectedAppId={view === "app" ? L.selectedAppId : null}
            selectedTerminalId={view === "app" ? L.selectedTerminalId : null}
            stateOf={L.stateOf}
            paneCollapsed={paneCollapsed}
            onTogglePane={toggleSidebar}
            onHome={apps.length > 0 ? () => setView("home") : undefined}
            homeActive={showHome}
            onSelectApp={openApp}
            onSelectTerminal={(a, t) => {
              L.selectTerminal(a, t);
              L.touchApp(a);
              setView("app");
            }}
            explorer={
              <ExplorerPanel
                root={explorer.root}
                source={explorer.source}
                resetKey={explorerResetKey}
                onOpenFile={editor.openPath}
                editor={editorBridge}
              />
            }
          />
        )}

        <main className={styles.main}>
          {view === "editor" ? (
            <EditorView editor={editor} theme={config.theme} apps={apps} palette={T.active} />
          ) : apps.length === 0 || (!app && !showHome) ? (
            <EmptyState
              title="No apps yet. An app groups the terminals you run together."
              buttonLabel="Add your first app"
              onClick={openAdd}
            />
          ) : showHome ? (
            <HomeScreen
              apps={apps}
              stateOf={L.stateOf}
              consoleIdsOf={consoleIdsOf}
              folderExists={folderExists}
              onOpen={openApp}
              onStartAll={startAll}
              onStopAll={L.actions.stopAll}
              onToggleFavourite={(id) => void L.toggleFavourite(id)}
              onAdd={openAdd}
              onOpenFolder={() => void quickAdd()}
            />
          ) : app ? (
            <>
              <AppHeader
                app={app}
                states={app.terminals.filter(isExecutable).map((t) => L.stateOf(t.id))}
                onStartAll={() => startAll(app.id)}
                onStopAll={() => L.actions.stopAll(app.id)}
                onEdit={() => openEdit(app)}
              />
              <GitBar
                git={git}
                onSwitch={requestSwitch}
                onOpenChanges={() => openGitTab("changes")}
                onOpenHistory={() => openGitTab("history")}
                onOpenConsole={openConsole}
                onRefresh={refreshAll}
                collapsible
                open={gitToolsOpen}
                onOpenChange={setGitToolsOpen}
              />
              {app.terminals.length === 0 && !onConsole ? (
                <EmptyState
                  title="This app has no terminals."
                  buttonLabel="Add a terminal"
                  onClick={() => setEditing({ app: { ...app, terminals: [newTerminal()] }, isNew: false })}
                />
              ) : null}
              <TabStrip
                app={app}
                selectedTerminalId={L.selectedTerminalId}
                stateOf={L.stateOf}
                consoleTabId={consoleId(app.id)}
                consoleState={consoleAgg}
                onSelect={(tid) => (tid === consoleId(app.id) ? L.openConsoleTab(app.id) : L.selectTerminal(app.id, tid))}
                onStart={() => L.selectedTerminalId && L.actions.start(app.id, L.selectedTerminalId)}
                onStop={() => L.selectedTerminalId && L.actions.stop(app.id, L.selectedTerminalId)}
                onRestart={() => L.selectedTerminalId && L.actions.restart(app.id, L.selectedTerminalId)}
              />
              <div className={styles.termWrap}>
                <div className={styles.termArea}>
                  {apps.flatMap((a) => [
                    ...a.terminals
                      .filter((t) => L.openedTerminalIds.includes(t.id))
                      .map((t) => (
                        <TerminalHost
                          key={t.id}
                          appId={a.id}
                          terminalId={t.id}
                          visible={a.id === app.id && t.id === L.selectedTerminalId}
                          state={L.stateOf(t.id)}
                          theme={config.theme}
                          palette={T.active}
                          onEdit={() => openEdit(a)}
                        />
                      )),
                    ...(L.consoles[a.id] ?? []).map((c) => (
                      <TerminalHost
                        key={c.id}
                        appId={a.id}
                        terminalId={c.id}
                        visible={a.id === app.id && L.selectedTerminalId === c.id}
                        state={L.stateOf(c.id)}
                        theme={config.theme}
                        palette={T.active}
                        onEdit={() => openEdit(a)}
                      />
                    )),
                  ])}
                </div>
                {onConsole && (
                  <Suspense fallback={<div className={styles.lazyPanel} aria-hidden="true" />}>
                    <ConsoleNav
                      consoles={appConsoles}
                      activeId={selectedTid}
                      stateOf={L.stateOf}
                      shells={shellChoices}
                      notice={consoleNotice[app.id] || null}
                      onHide={hideConsole}
                      hideDisabledReason={
                        app.terminals.length === 0 ? "Only workspace: this app has no terminals." : null
                      }
                      onSelect={(id) => L.selectConsole(app.id, id)}
                      onAdd={(shell) => L.addConsole(app.id, shell)}
                      onClose={(id) => {
                        const c = appConsoles.find((x) => x.id === id);
                        if (c) requestCloseConsole(app.id, id, consoleTitle(c));
                      }}
                    />
                  </Suspense>
                )}
              </div>
              {gitTabKept && (
                <div hidden={gitTab === null}>
                  <Suspense fallback={null}>
                    <GitDrawer git={git} tab={gitTabKept} onTab={showGitTab} onClose={closeGitTab} />
                  </Suspense>
                </div>
              )}
            </>
          ) : null}

          {editing && (
            <Suspense fallback={<div className={styles.lazy}>Loading…</div>}>
              <EditPane
                key={editing.app.id + String(editing.isNew)}
                initial={editing.app}
                isNew={editing.isNew}
                runningTerminalIds={runningIds}
                onSave={handleSave}
                onCancel={() => setEditing(null)}
                onDelete={() => setPendingDelete(editing.app)}
              />
            </Suspense>
          )}
        </main>
      </div>

      <AppFooter
        version={typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : ""}
        sidebarCollapsed={paneCollapsed}
        onToggleSidebar={toggleSidebar}
      />

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette actions={paletteActions} onClose={() => setPaletteOpen(false)} />
        </Suspense>
      )}

      {finderOpen && (
        <Dialog title="Find themes" actions={[{ label: "Close", onClick: () => setFinderOpen(false) }]}>
          <Suspense fallback={<div className={styles.lazy}>Loading themes…</div>}>
            <ThemeFinder finder={finder} />
          </Suspense>
        </Dialog>
      )}

      {(pendingSave ||
        pendingDelete ||
        pendingCloseConsole ||
        pendingSwitch ||
        (L.restoreAppIds.length > 0 && !L.status?.locked) ||
        L.closeRunning !== null) && (
        <Suspense fallback={null}>
          <ConfirmDialogs
            save={
              pendingSave
                ? {
                    count: pendingSave.ids.length,
                    onConfirm: async () => {
                      const p = pendingSave;
                      setPendingSave(null);
                      await L.stopAndWait(p.ids);
                      await commit(p.apps);
                    },
                    onCancel: () => setPendingSave(null),
                  }
                : null
            }
            deleteApp={
              pendingDelete
                ? {
                    name: pendingDelete.name,
                    onConfirm: () => void handleDelete(pendingDelete),
                    onCancel: () => setPendingDelete(null),
                  }
                : null
            }
            closeConsole={
              pendingCloseConsole
                ? {
                    title: pendingCloseConsole.title,
                    onConfirm: async () => {
                      const p = pendingCloseConsole;
                      setPendingCloseConsole(null);
                      await L.stopAndWait([p.id]);
                      L.closeConsole(p.appId, p.id);
                    },
                    onCancel: () => setPendingCloseConsole(null),
                  }
                : null
            }
            switchBranch={
              pendingSwitch
                ? {
                    branch: pendingSwitch.branch,
                    runningCount: pendingSwitch.running.length,
                    onStopStart: () => void stopSwitchStart(pendingSwitch),
                    onSwitchAnyway: () => {
                      const b = pendingSwitch.branch;
                      setPendingSwitch(null);
                      void git.switchBranch(b);
                    },
                    onCancel: () => setPendingSwitch(null),
                  }
                : null
            }
            restore={
              L.restoreAppIds.length > 0 && !L.status?.locked
                ? {
                    names: apps
                      .filter((a) => L.restoreAppIds.includes(a.id))
                      .map((a) => a.name)
                      .join(", "),
                    onStart: () => void L.answerRestore(true),
                    onDismiss: () => void L.answerRestore(false),
                  }
                : null
            }
            quit={
              L.closeRunning !== null
                ? {
                    runningCount: L.closeRunning,
                    onQuit: () => void L.answerClose(true),
                    onKeep: L.cancelClose,
                  }
                : null
            }
          />
        </Suspense>
      )}

      {updateOpen && U.info && (
        <Suspense fallback={null}>
          <UpdateDialog
            info={U.info}
            phase={U.phase}
            progress={U.progress}
            error={U.error}
            runningCount={Object.values(L.states).filter(isUp).length}
            onInstall={() => void U.install()}
            onClose={() => {
              if (U.phase === "idle") {
                U.clearError();
                setUpdateOpen(false);
              }
            }}
          />
        </Suspense>
      )}

      {help && (
        <Suspense fallback={null}>
          <HelpDialog
            version={typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : ""}
            autoCheck={config.update?.autoCheck ?? true}
            phase={U.phase}
            upToDate={U.upToDate}
            available={U.info?.version ?? null}
            error={U.phase === "idle" && !updateOpen ? U.error : null}
            onAutoCheck={(v) => void L.setUpdateSettings({ autoCheck: v })}
            onCheckNow={() => void U.checkNow()}
            onClose={() => setHelp(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
