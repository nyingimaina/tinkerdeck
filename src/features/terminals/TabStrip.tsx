import ZestTabs from "jattac.libs.web.zest-tabs";
import { canStart, canStop, type AppDef, type TermState } from "../../state/model";
import { isConsoleId } from "../../state/console";
import { StatusDot } from "./StatusDot";
import styles from "./TabStrip.module.css";

interface Props {
  app: AppDef;
  selectedTerminalId: string | null;
  stateOf: (terminalId: string) => TermState;
  /** Called with a terminal id, or with `consoleTabId` for the Console tab (the parent picks the instance). */
  onSelect: (terminalId: string) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  /** The Console tab group of this app. Omit to hide the Console tab. */
  consoleTabId?: string;
  /** State shown by the Console tab: the worst/most-alive of its instances. */
  consoleState?: TermState;
}

/** Only the selected app's terminals appear as tabs. Buttons are disabled, never hidden. */
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
}: Props) {
  const current = selectedTerminalId ? stateOf(selectedTerminalId) : null;
  const onConsole = !!selectedTerminalId && isConsoleId(selectedTerminalId);
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
  ];
  const active = onConsole && consoleTabId ? consoleTabId : (selectedTerminalId ?? "");

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
