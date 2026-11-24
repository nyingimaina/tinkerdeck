import { useEffect, useRef, useState } from "react";
import { api, errorText, pickFolder, type ShellInfo } from "./api/tauri";
import { AppHeader } from "./features/apps/AppHeader";
import { Banner } from "./features/apps/Banner";
import { Dialog } from "./features/apps/Dialog";
import { EditPane } from "./features/apps/EditPane";
import { EmptyState } from "./features/apps/EmptyState";
import { Sidebar } from "./features/apps/Sidebar";
import { GitBar } from "./features/git/GitBar";
import { GitDrawer, type GitTab } from "./features/git/GitDrawer";
import { HomeScreen } from "./features/home/HomeScreen";
import { EditorView } from "./features/editor/EditorView";
import { ConsoleNav } from "./features/terminals/ConsoleNav";
import { TabStrip } from "./features/terminals/TabStrip";
import { TerminalHost } from "./features/terminals/TerminalHost";
import { UpdateBanner, UpdateDialog, UpdateSettingsBlock } from "./features/updates/UpdateUI";
import { consoleExitAction, consoleId, consoleTitle, isConsoleId } from "./state/console";
import {
  canStop,
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
import { useLauncher } from "./state/useLauncher";
import { useUpdates } from "./state/useUpdates";
import { usePoller } from "./state/usePoller";
import styles from "./App.module.css";

interface Editing {
  app: AppDef;
  isNew: boolean;
}

const COLLAPSE_KEY = "lc.sidebarCollapsed";
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
  const [help, setHelp] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [folderExists, setFolderExists] = useState<Record<string, boolean>>({});
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [paneCollapsed, setPaneCollapsed] = useState(readCollapsed);
  const [refreshKey, setRefreshKey] = useState(0);
  const [consoleNotice, setConsoleNotice] = useState<Record<string, string>>({});
  const autoStarted = useRef<Set<string>>(new Set());
  const prevKinds = useRef<Record<string, string>>({});
  const lastAutoRestart = useRef<Record<string, number>>({});

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

  // the text editor (BRS 7.14): files sent from Explorer's "Edit with Lite Commander" land here
  const editor = useEditor({ onOpened: () => setView("editor") });

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

  // keyboard: Ctrl+B toggles the left pane, F5 refreshes (VS Code habits)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === "F5") {
        e.preventDefault();
        refreshAll();
      }
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
  const openApp = (id: string) => {
    L.selectApp(id);
    L.touchApp(id);
    setGitTab(null);
    setView("app");
  };
  const openConsole = () => {
    if (!app) return;
    L.openConsoleTab(app.id);
    setGitTab(null);
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
    if (!exists) L.selectApp(saved.id);
    // terminals removed from a running app must be stopped first, after confirmation
    const before = apps.find((a) => a.id === saved.id);
    const removed = (before?.terminals ?? []).filter((t) => !saved.terminals.some((s) => s.id === t.id)).map((t) => t.id);
    const removedUp = removed.filter((id) => isUp(L.stateOf(id)));
    if (removedUp.length) setPendingSave({ apps: next, ids: removedUp });
    else {
      await commit(next);
      if (!exists) setView("app");
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

  const startAll = (id: string) => {
    L.actions.startAll(id);
    L.touchApp(id);
  };

  const shellKnown = shells.length === 0 || shells.some((s) => s.id === config.shell);

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <button
          className={styles.iconBtn}
          onClick={toggleSidebar}
          aria-label={paneCollapsed ? "Show sidebar" : "Hide sidebar"}
          title="Toggle sidebar (Ctrl+B)"
        >
          ☰
        </button>
        <img src="/icon.svg" alt="" width="24" height="24" />
        <span className={styles.brand}>Lite Commander</span>
        <span className={styles.spacer} />
        <label className={styles.shellPick}>
          <span>Shell</span>
          <select value={config.shell} onChange={(e) => void L.setShell(e.target.value)}>
            {!shellKnown && <option value={config.shell}>{config.shell} (not found)</option>}
            {(shells.length > 0 ? shells : [{ id: config.shell, name: config.shell, path: "" }]).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => setView((v) => (v === "editor" ? "home" : "editor"))}
          aria-label="Editor"
          aria-pressed={view === "editor"}
          title="Text editor"
        >
          ✎ Editor
        </button>
        <button onClick={refreshAll} aria-label="Refresh everything" title="Refresh everything now (F5)">
          ⟳
        </button>
        <button onClick={() => setHelp(true)} aria-label="Help" title="Help">
          ?
        </button>
        <button
          onClick={() => void L.setTheme(config.theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
          title="Toggle light and dark"
        >
          {config.theme === "dark" ? "☀" : "☾"}
        </button>
        <button className={styles.add} onClick={openAdd} disabled={L.status?.locked && L.status.permanent}>
          + App
        </button>
      </header>

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
        <UpdateBanner info={U.info} onDetails={() => setUpdateOpen(true)} onLater={U.later} onSkip={() => void U.skip()} />
      )}
      {L.error && (
        <Banner kind="error" actions={[{ label: "Dismiss", onClick: L.dismissError }]}>
          {L.error}
        </Banner>
      )}

      <div className={styles.body}>
        {apps.length > 0 && (
          <Sidebar
            apps={apps}
            selectedAppId={view === "app" ? L.selectedAppId : null}
            selectedTerminalId={view === "app" ? L.selectedTerminalId : null}
            stateOf={L.stateOf}
            paneCollapsed={paneCollapsed}
            onTogglePane={toggleSidebar}
            onHome={() => setView("home")}
            homeActive={showHome}
            onSelectApp={openApp}
            onSelectTerminal={(a, t) => {
              L.selectTerminal(a, t);
              L.touchApp(a);
              setView("app");
            }}
          />
        )}

        <main className={styles.main}>
          {view === "editor" ? (
            <EditorView editor={editor} theme={config.theme} />
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
                states={app.terminals.map((t) => L.stateOf(t.id))}
                onStartAll={() => startAll(app.id)}
                onStopAll={() => L.actions.stopAll(app.id)}
                onEdit={() => openEdit(app)}
              />
              <GitBar
                git={git}
                onSwitch={requestSwitch}
                onOpenChanges={() => setGitTab("changes")}
                onOpenHistory={() => setGitTab("history")}
                onOpenConsole={openConsole}
                onRefresh={refreshAll}
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
                        onEdit={() => openEdit(a)}
                      />
                    )),
                  ])}
                </div>
                {onConsole && (
                  <ConsoleNav
                    consoles={appConsoles}
                    activeId={selectedTid}
                    stateOf={L.stateOf}
                    shells={shellChoices}
                    notice={consoleNotice[app.id] || null}
                    onSelect={(id) => L.selectConsole(app.id, id)}
                    onAdd={(shell) => L.addConsole(app.id, shell)}
                    onClose={(id) => {
                      const c = appConsoles.find((x) => x.id === id);
                      if (c) requestCloseConsole(app.id, id, consoleTitle(c));
                    }}
                  />
                )}
              </div>
              {gitTab && <GitDrawer git={git} tab={gitTab} onTab={setGitTab} onClose={() => setGitTab(null)} />}
            </>
          ) : null}

          {editing && (
            <EditPane
              key={editing.app.id + String(editing.isNew)}
              initial={editing.app}
              isNew={editing.isNew}
              runningTerminalIds={runningIds}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
              onDelete={() => setPendingDelete(editing.app)}
            />
          )}
        </main>
      </div>

      {pendingSave && (
        <Dialog
          title="Stop running terminals?"
          actions={[
            {
              label: "Stop and save",
              kind: "primary",
              onClick: async () => {
                const p = pendingSave;
                setPendingSave(null);
                await L.stopAndWait(p.ids);
                await commit(p.apps);
              },
            },
            { label: "Cancel", onClick: () => setPendingSave(null) },
          ]}
        >
          {pendingSave.ids.length} terminal(s) you removed are still running. They will be stopped first.
        </Dialog>
      )}

      {pendingDelete && (
        <Dialog
          title={`Delete ${pendingDelete.name}?`}
          actions={[
            { label: "Delete", kind: "danger", onClick: () => void handleDelete(pendingDelete) },
            { label: "Cancel", onClick: () => setPendingDelete(null) },
          ]}
        >
          This removes the app and its terminals from Lite Commander. Anything running is stopped first. Your project files
          are not touched.
        </Dialog>
      )}

      {pendingCloseConsole && (
        <Dialog
          title={`Close ${pendingCloseConsole.title}?`}
          actions={[
            {
              label: "Stop and close",
              kind: "danger",
              onClick: async () => {
                const p = pendingCloseConsole;
                setPendingCloseConsole(null);
                await L.stopAndWait([p.id]);
                L.closeConsole(p.appId, p.id);
              },
            },
            { label: "Cancel", onClick: () => setPendingCloseConsole(null) },
          ]}
        >
          Something may still be running in it. It will be stopped first.
        </Dialog>
      )}

      {pendingSwitch && (
        <Dialog
          title={`Switch to ${pendingSwitch.branch}?`}
          actions={[
            { label: "Stop all, switch, Start all", kind: "primary", onClick: () => void stopSwitchStart(pendingSwitch) },
            {
              label: "Switch anyway",
              onClick: () => {
                const b = pendingSwitch.branch;
                setPendingSwitch(null);
                void git.switchBranch(b);
              },
            },
            { label: "Cancel", onClick: () => setPendingSwitch(null) },
          ]}
        >
          {pendingSwitch.running.length} terminal{pendingSwitch.running.length === 1 ? " is" : "s are"} running. Switching branches changes the
          files they use, which can break a dev server or trigger rebuilds. Stop them first and start them again afterwards?
        </Dialog>
      )}

      {L.restoreAppIds.length > 0 && !L.status?.locked && (
        <Dialog
          title="Start the apps that were running last time?"
          actions={[
            { label: "Start them", kind: "primary", onClick: () => void L.answerRestore(true) },
            { label: "No, thanks", onClick: () => void L.answerRestore(false) },
          ]}
        >
          {apps
            .filter((a) => L.restoreAppIds.includes(a.id))
            .map((a) => a.name)
            .join(", ")}
        </Dialog>
      )}

      {L.closeRunning !== null && (
        <Dialog
          title="Quit Lite Commander?"
          actions={[
            { label: "Stop and quit", kind: "primary", onClick: () => void L.answerClose(true) },
            { label: "Keep running", onClick: L.cancelClose },
          ]}
        >
          {L.closeRunning} terminal{L.closeRunning === 1 ? " is" : "s are"} running. Stop {L.closeRunning === 1 ? "it" : "them"} and quit?
        </Dialog>
      )}

      {updateOpen && U.info && (
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
      )}

      {help && (
        <Dialog title="Help" actions={[{ label: "Close", onClick: () => setHelp(false) }]}>
          <ul className={styles.help}>
            <li>An app is a group of terminals. Each terminal is a folder plus a command, run in the shell you choose.</li>
            <li>Home shows your favourites (star an app), recent apps and what is running now.</li>
            <li>Stop presses Ctrl+C first, then kills the whole process tree, so ports are released.</li>
            <li>
              Commands that start something and exit (such as <code>docker start db</code>) show as <b>Detached</b> when the
              terminal has a stop command (<code>docker stop db</code>). Without one they show Exited, and the container keeps
              running.
            </li>
            <li>
              The <b>&gt;_ Console</b> tab holds as many shells as you like (PowerShell, Git Bash, WSL, cmd). Use the list on the
              right to add or switch. Typing <code>exit</code> in the first console just starts a fresh shell.
            </li>
            <li>Pull is fast-forward only. For merges, rebases or force pushes use a console.</li>
            <li>Live state refreshes by itself while the window is visible. Press <b>⟳</b> or F5 to refresh now. Ctrl+B hides the sidebar.</li>
            <li>A terminal owns everything it starts: background processes it launches end when it stops.</li>
            <li>Do not put passwords in commands. Use environment variables or a .env file.</li>
          </ul>
          <UpdateSettingsBlock
            version={typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : ""}
            autoCheck={config.update?.autoCheck ?? true}
            phase={U.phase}
            upToDate={U.upToDate}
            available={U.info?.version ?? null}
            error={U.phase === "idle" && !updateOpen ? U.error : null}
            onAutoCheck={(v) => void L.setUpdateSettings({ autoCheck: v })}
            onCheckNow={() => void U.checkNow()}
          />
        </Dialog>
      )}
    </div>
  );
}
