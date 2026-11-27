import { useCallback, useState, type ReactNode } from "react";
import type { AppDef, TermState } from "../../state/model";
import { StatusDot } from "../terminals/StatusDot";
import { SidebarProjects, appRollup } from "./SidebarProjects";
import { SidebarTabs, sidebarPanelId, sidebarTabId, type SidebarTab } from "./SidebarTabs";
import styles from "./Sidebar.module.css";

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
}: Props) {
  // The tab belongs to the sidebar area, not the app shell, and is never derived from the view,
  // the selected app or the active editor file (R1, R4). This revision does not persist it.
  const [tab, setTab] = useState<SidebarTab>("projects");
  // The Files panel is mounted on first use and kept afterwards, so opening on Projects reads no
  // folder and coming back to Files keeps the expanded tree without a second listing (A1).
  const [filesMounted, setFilesMounted] = useState(false);
  // The per-app fold state lives here, not in SidebarProjects, so the rail branch below does not
  // discard it when the pane is collapsed (USR-004: folding an app must survive collapse/expand).
  const [collapsedApps, setCollapsedApps] = useState<Record<string, boolean>>({});
  const toggleAppCollapsed = useCallback(
    (appId: string) => setCollapsedApps((c) => ({ ...c, [appId]: !c[appId] })),
    [],
  );

  const chooseTab = (next: SidebarTab) => {
    setTab(next);
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
        <button onClick={() => expandOnto("projects")} aria-label="Projects" title="Projects" className={tab === "projects" ? styles.railOn : ""}>
          <ProjectsIcon />
        </button>
        <button onClick={() => expandOnto("files")} aria-label="Files" title="Files" className={tab === "files" ? styles.railOn : ""}>
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
        <SidebarTabs active={tab} onChange={chooseTab} />
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
        hidden={tab !== "projects"}
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
          hidden={tab !== "files"}
        >
          {explorer}
        </div>
      )}
    </nav>
  );
}
