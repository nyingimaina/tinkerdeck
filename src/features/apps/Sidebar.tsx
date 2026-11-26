import { useState, type ReactNode } from "react";
import { rollup, type AppDef, type TermState } from "../../state/model";
import { StatusDot } from "../terminals/StatusDot";
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
  /** The Files explorer section, shown below the apps in the expanded pane and never in the rail. */
  explorer?: ReactNode;
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (paneCollapsed) {
    return (
      <nav className={styles.rail} aria-label="Apps (collapsed)">
        <button onClick={onTogglePane} aria-label="Expand sidebar" title="Expand sidebar (Ctrl+B)">
          »
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
            <StatusDot rollup={rollup(a.terminals.map((t) => stateOf(t.id)))} className={styles.railDot} />
          </button>
        ))}
      </nav>
    );
  }

  return (
    <nav className={styles.sidebar} aria-label="Apps">
      {onTogglePane && (
        <button className={styles.collapseBtn} onClick={onTogglePane} aria-label="Collapse sidebar" title="Collapse sidebar (Ctrl+B)">
          «
        </button>
      )}
      {onHome && (
        <button className={`${styles.homeRow} ${homeActive ? styles.selected : ""}`} onClick={onHome} aria-current={homeActive ? "page" : undefined}>
          ⌂ Home
        </button>
      )}
      {apps.map((app) => {
        const isCollapsed = collapsed[app.id];
        const roll = rollup(app.terminals.map((t) => stateOf(t.id)));
        return (
          <div key={app.id} className={styles.group}>
            <div className={`${styles.appRow} ${app.id === selectedAppId ? styles.selected : ""}`}>
              <button
                className={styles.chevron}
                aria-label={isCollapsed ? `Expand ${app.name}` : `Collapse ${app.name}`}
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((c) => ({ ...c, [app.id]: !c[app.id] }))}
              >
                {isCollapsed ? "▶" : "▼"}
              </button>
              <button className={styles.appName} onClick={() => onSelectApp(app.id)} title={app.root}>
                <span className={styles.nameText}>{app.name}</span>
                <StatusDot rollup={roll} />
              </button>
            </div>
            {!isCollapsed &&
              app.terminals.map((t) => (
                <button
                  key={t.id}
                  className={`${styles.termRow} ${
                    app.id === selectedAppId && t.id === selectedTerminalId ? styles.termSelected : ""
                  }`}
                  onClick={() => onSelectTerminal(app.id, t.id)}
                >
                  <StatusDot state={stateOf(t.id)} />
                  <span className={styles.nameText}>{t.name}</span>
                </button>
              ))}
          </div>
        );
      })}
      {explorer && <div className={styles.explorerSlot}>{explorer}</div>}
    </nav>
  );
}
