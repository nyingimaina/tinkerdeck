import { memo } from "react";
import { isExecutable, rollup, type AppDef, type Rollup, type TermState } from "../../state/model";
import { StatusDot } from "../terminals/StatusDot";
import styles from "./Sidebar.module.css";

/** The app status dot shows only what Start all / Stop all would act on (R11). */
export function appRollup(app: AppDef, stateOf: (terminalId: string) => TermState): Rollup {
  return rollup(app.terminals.filter(isExecutable).map((t) => stateOf(t.id)));
}

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
  /** Which apps are folded. Owned by Sidebar so it survives a pane collapse/expand. */
  collapsed: Record<string, boolean>;
  onToggleCollapsed: (appId: string) => void;
}

/**
 * The Projects tab's content: the Home row and every app with its terminals, exactly as the
 * sidebar showed it before the tabs. Memoised so switching to Files and back never reconciles
 * the (possibly 500-row) list (R1, R2, R4).
 */
export const SidebarProjects = memo(function SidebarProjects({
  apps,
  selectedAppId,
  selectedTerminalId,
  stateOf,
  onSelectApp,
  onSelectTerminal,
  onHome,
  homeActive,
  collapsed,
  onToggleCollapsed,
}: Props) {
  return (
    <>
      {onHome && (
        <button className={`${styles.homeRow} ${homeActive ? styles.selected : ""}`} onClick={onHome} aria-current={homeActive ? "page" : undefined}>
          ⌂ Home
        </button>
      )}
      {apps.map((app) => {
        const isCollapsed = collapsed[app.id];
        return (
          <div key={app.id} className={styles.group}>
            <div className={`${styles.appRow} ${app.id === selectedAppId ? styles.selected : ""}`}>
              <button
                className={styles.chevron}
                aria-label={isCollapsed ? `Expand ${app.name}` : `Collapse ${app.name}`}
                aria-expanded={!isCollapsed}
                onClick={() => onToggleCollapsed(app.id)}
              >
                {isCollapsed ? "▶" : "▼"}
              </button>
              <button className={styles.appName} onClick={() => onSelectApp(app.id)} title={app.root}>
                <span className={styles.nameText}>{app.name}</span>
                <StatusDot rollup={appRollup(app, stateOf)} />
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
    </>
  );
});
