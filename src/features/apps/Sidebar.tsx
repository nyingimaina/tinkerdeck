import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppDef, TermState } from "../../state/model";
import { StatusDot } from "../terminals/StatusDot";
import { SidebarProjects, appRollup, projectsRollup } from "./SidebarProjects";
import { SidebarTabs, sidebarPanelId, sidebarTabId, type SidebarTab } from "./SidebarTabs";
import styles from "./Sidebar.module.css";

/** Id of the visually hidden roll-up line the rail's Projects button describes itself with (R7, REV-1). */
const railProjectsStatusId = "sidebar-rail-projects-status";

interface Props {
  apps: AppDef[];
  selectedAppId: string | null;
  selectedTerminalId: string | null;
  stateOf: (terminalId: string) => TermState;
  onSelectApp: (appId: string) => void;
  onSelectTerminal: (appId: string, terminalId: string) => void;
  /** Adds a Home entry at the top when provided. */
  onHome?: () => void;
  homeActive?: boolean;
  /** VS Code-style: the whole pane collapses to a narrow rail. */
  paneCollapsed?: boolean;
  onTogglePane?: () => void;
  /** The Files explorer, shown in the Files tab of the expanded pane. */
  explorer?: ReactNode;
  /** The active tab when the app shell owns it (R8); without it the sidebar keeps its own. */
  tab?: SidebarTab;
  onTabChange?: (tab: SidebarTab) => void;
}

function ProjectsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.8" width="11" height="2.4" rx="1" fill="currentColor" />
      <rect x="2.5" y="6.8" width="11" height="2.4" rx="1" fill="currentColor" opacity="0.75" />
      <rect x="2.5" y="10.8" width="11" height="2.4" rx="1" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.7l1.6 2h4.7A1.5 1.5 0 0 1 14 6.5v5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Sidebar({
  apps,
  selectedAppId,
  selectedTerminalId,
  stateOf,
  onSelectApp,
  onSelectTerminal,
  onHome,
  homeActive,
  paneCollapsed,
  onTogglePane,
  explorer,
  tab,
  onTabChange,
}: Props) {
  // The active tab is owned by the app shell when it passes one, so a tab click, a rail icon and
  // the Show Files shortcut all set the same value (R8). Without it (standalone tests) the
  // sidebar keeps its own local tab exactly as before. It is never derived from the view, the
  // selected app or the active editor file, and it is never persisted.
  const [localTab, setLocalTab] = useState<SidebarTab>("projects");
  const activeTab = tab ?? localTab;
  // The Files panel is mounted on first use and kept afterwards, so opening on Projects reads no
  // folder and coming back to Files keeps the expanded tree without a second listing (A1).
  const [filesMounted, setFilesMounted] = useState(false);
  useEffect(() => {
    if (activeTab === "files") setFilesMounted(true);
  }, [activeTab]);
  // One roll-up for the Projects label and the rail icon, recomputed only when the apps or their
  // live terminal states change, never on a tab switch (R7).
  const tabRollup = useMemo(() => projectsRollup(apps, stateOf), [apps, stateOf]);
  // The per-app fold state lives here, not in SidebarProjects, so the rail branch below does not
  // discard it when the pane is collapsed (USR-004: folding an app must survive collapse/expand).
  const [collapsedApps, setCollapsedApps] = useState<Record<string, boolean>>({});
  const toggleAppCollapsed = useCallback(
    (appId: string) => setCollapsedApps((c) => ({ ...c, [appId]: !c[appId] })),
    [],
  );

  const chooseTab = (next: SidebarTab) => {
    if (tab === undefined) setLocalTab(next);
    onTabChange?.(next);
    if (next === "files") setFilesMounted(true);
  };

  // From the rail one click both expands the pane and selects the tab (R3).
  const expandOnto = (next: SidebarTab) => {
    chooseTab(next);
    onTogglePane?.();
  };

  if (paneCollapsed) {
    return (
      <nav className={styles.rail} aria-label="Apps (collapsed)">
        <button onClick={onTogglePane} aria-label="Expand sidebar" title="Expand sidebar (Ctrl+B)">
          »
        </button>
        <button onClick={() => expandOnto("projects")} aria-label="Projects" title="Projects" aria-describedby={railProjectsStatusId} className={activeTab === "projects" ? styles.railOn : ""}>
          <ProjectsIcon />
          {/* The same one roll-up dot, decorative so the button's name stays "Projects" (R7). */}
          <span aria-hidden="true">
            <StatusDot rollup={tabRollup} className={styles.railDot} />
          </span>
          {/* The roll-up is announced through the button's description, not a second status image (REV-1). */}
          <span id={railProjectsStatusId} className={styles.srOnly}>
            App status: {tabRollup}
          </span>
        </button>
        <button onClick={() => expandOnto("files")} aria-label="Files" title="Files" className={activeTab === "files" ? styles.railOn : ""}>
          <FilesIcon />
        </button>
        {onHome && (
          <button onClick={onHome} aria-label="Home" className={homeActive ? styles.railOn : ""} title="Home">
            ⌂
          </button>
        )}
        {apps.map((a) => (
          <button
            key={a.id}
            onClick={() => onSelectApp(a.id)}
            aria-label={`Open ${a.name}`}
            title={a.name}
            className={a.id === selectedAppId ? styles.railOn : ""}
          >
            <span className={styles.railInitial}>{a.name.trim().charAt(0).toUpperCase() || "?"}</span>
            <StatusDot rollup={appRollup(a, stateOf)} className={styles.railDot} />
          </button>
        ))}
      </nav>
    );
  }

  return (
    <nav className={styles.sidebar} aria-label="Apps">
      <div className={styles.topRow}>
        <SidebarTabs active={activeTab} onChange={chooseTab} projectsRollup={tabRollup} />
        {onTogglePane && (
          <button className={styles.collapseBtn} onClick={onTogglePane} aria-label="Collapse sidebar" title="Collapse sidebar (Ctrl+B)">
            «
          </button>
        )}
      </div>
      <div
        className={styles.panel}
        id={sidebarPanelId("projects")}
        role="tabpanel"
        aria-label="Projects"
        aria-labelledby={sidebarTabId("projects")}
        hidden={activeTab !== "projects"}
      >
        <SidebarProjects
          apps={apps}
          selectedAppId={selectedAppId}
          selectedTerminalId={selectedTerminalId}
          stateOf={stateOf}
          onSelectApp={onSelectApp}
          onSelectTerminal={onSelectTerminal}
          onHome={onHome}
          homeActive={homeActive}
          collapsed={collapsedApps}
          onToggleCollapsed={toggleAppCollapsed}
        />
      </div>
      {explorer && filesMounted && (
        <div
          className={styles.filesPanel}
          id={sidebarPanelId("files")}
          role="tabpanel"
          aria-label="Files"
          aria-labelledby={sidebarTabId("files")}
          hidden={activeTab !== "files"}
        >
          {explorer}
        </div>
      )}
    </nav>
  );
}
