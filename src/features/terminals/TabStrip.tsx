import ZestTabs from "jattac.libs.web.zest-tabs";
import { canStart, canStop, type AppDef, type TermState } from "../../state/model";
import { isConsoleId } from "../../state/console";
import { StatusDot } from "./StatusDot";
import styles from "./TabStrip.module.css";

/** The bit of an open editor the strip needs: its id, readable label and unsaved mark (R1, R4). */
export interface TabStripEditor {
  id: string;
  title: string;
  dirty: boolean;
}

interface Props {
  app: AppDef;
  selectedTerminalId: string | null;
  stateOf: (terminalId: string) => TermState;
  /** Called with a terminal id, `consoleTabId` for the Console, or an editor id (the parent decides). */
  onSelect: (tabId: string) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  /** The Console tab group of this app. Omit to hide the Console tab. */
  consoleTabId?: string;
  /** State shown by the Console tab: the worst/most-alive of its instances. */
  consoleState?: TermState;
  /** The editor tabs filed under this workspace, shown beside its terminals and Console (R1, R4). */
  editors?: TabStripEditor[];
  /** The one selected tab of this workspace: a terminal, the Console group or an editor (R1). */
  activeTabId?: string | null;
  /** Close an editor tab from the strip without selecting it first (R1, R4). */
  onCloseEditor?: (id: string) => void;
}

/**
 * The workspace's one tab strip: its terminals, the Console group and its editor tabs (R1, R4, R5).
 * It is the only tab list inside a workspace; there is no owner side pane, and every tab is
 * reachable by keyboard through ZestTabs. Buttons are disabled, never hidden.
 */
export function TabStrip({
  app,
  selectedTerminalId,
  stateOf,
  onSelect,
  onStart,
  onStop,
  onRestart,
  consoleTabId,
  consoleState,
  editors = [],
  activeTabId,
  onCloseEditor,
}: Props) {
  const editorActive = !!activeTabId && editors.some((e) => e.id === activeTabId);
  const current = !editorActive && selectedTerminalId ? stateOf(selectedTerminalId) : null;
  const onConsole = !editorActive && !!selectedTerminalId && isConsoleId(selectedTerminalId);
  const items = [
    ...app.terminals.map((t) => ({
      value: t.id,
      label: (
        <span className={styles.label}>
          <StatusDot state={stateOf(t.id)} />
          <span>{t.name}</span>
        </span>
      ),
    })),
    ...(consoleTabId
      ? [
          {
            value: consoleTabId,
            label: (
              <span className={`${styles.label} ${styles.consoleLabel}`} title="Shells for git and anything else">
                <StatusDot state={consoleState ?? { kind: "stopped" }} />
                <span>&gt;_ Console</span>
              </span>
            ),
          },
        ]
      : []),
    ...editors.map((e) => ({
      value: e.id,
      label: (
        <span className={`${styles.label} ${styles.editorLabel}`} title={e.title}>
          <span className={styles.editorName}>{e.title}</span>
          {e.dirty && <span className={styles.dirty} role="img" aria-label="unsaved changes kept">●</span>}
          <button
            className={styles.close}
            aria-label={`Close ${e.title}`}
            onClick={(ev) => {
              ev.stopPropagation();
              onCloseEditor?.(e.id);
            }}
          >
            ×
          </button>
        </span>
      ),
    })),
  ];
  const active = activeTabId ?? (onConsole && consoleTabId ? consoleTabId : (selectedTerminalId ?? ""));

  return (
    <div className={styles.strip}>
      <div className={styles.tabs}>
        {items.length > 0 && <ZestTabs id={`tabs-${app.id}`} items={items} activeValue={active} onChange={onSelect} />}
      </div>
      <div className={styles.actions}>
        <button onClick={onStart} disabled={!current || !canStart(current)}>
          ▶ Start
        </button>
        <button onClick={onStop} disabled={!current || !canStop(current)}>
          ■ Stop
        </button>
        <button onClick={onRestart} disabled={!current || !(canStart(current) || canStop(current))}>
          ↻ Restart
        </button>
      </div>
    </div>
  );
}
