import { appButton, type AppDef, type TermState } from "../../state/model";
import styles from "./AppHeader.module.css";

interface Props {
  app: AppDef;
  states: TermState[];
  onStartAll: () => void;
  onStopAll: () => void;
  onEdit: () => void;
}

export function AppHeader({ app, states, onStartAll, onStopAll, onEdit }: Props) {
  const mode = appButton(states);
  const disabled = app.terminals.length === 0;
  return (
    <header className={styles.header}>
      <h2 className={styles.title} title={app.root}>
        {app.name}
      </h2>
      {mode === "start" ? (
        <button className={`${styles.btn} ${styles.primary}`} onClick={onStartAll} disabled={disabled}>
          ▶ Start all
        </button>
      ) : (
        <button className={`${styles.btn} ${styles.danger}`} onClick={onStopAll}>
          ■ Stop all
        </button>
      )}
      <button className={styles.btn} onClick={onEdit} aria-label={`Edit ${app.name}`} title="Edit this app">
        ⚙
      </button>
    </header>
  );
}
