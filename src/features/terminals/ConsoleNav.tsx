import { useState } from "react";
import { consoleTitle, type ConsoleEntry } from "../../state/console";
import type { TermState } from "../../state/model";
import { StatusDot } from "./StatusDot";
import styles from "./ConsoleNav.module.css";

export interface ShellChoice {
  id: string;
  name: string;
}

interface Props {
  consoles: ConsoleEntry[];
  activeId: string | null;
  stateOf: (terminalId: string) => TermState;
  shells: ShellChoice[];
  onSelect: (id: string) => void;
  /** `null` = the default shell. */
  onAdd: (shellId: string | null) => void;
  onClose: (id: string) => void;
  /** One-line note such as "Shell ended, restarted". */
  notice?: string | null;
}

/** The VS Code-style list of console instances, shown beside the terminal when the Console tab is open. */
export function ConsoleNav({ consoles, activeId, stateOf, shells, onSelect, onAdd, onClose, notice }: Props) {
  const [menu, setMenu] = useState(false);
  const shellName = (id: string | null) => (id ? (shells.find((s) => s.id === id)?.name ?? id) : "default shell");

  return (
    <aside className={styles.nav} aria-label="Consoles">
      <div className={styles.head}>
        <span>Consoles</span>
        <span className={styles.add}>
          <button onClick={() => onAdd(null)} aria-label="New console" title="New console (default shell)">
            +
          </button>
          <button
            onClick={() => setMenu((m) => !m)}
            aria-label="Choose shell for a new console"
            aria-expanded={menu}
            title="New console with another shell"
          >
            ▾
          </button>
        </span>
        {menu && (
          <div className={styles.menu} role="menu" onKeyDown={(e) => e.key === "Escape" && setMenu(false)}>
            {shells.length === 0 && <p className={styles.note}>No other shells found.</p>}
            {shells.map((s) => (
              <button
                key={s.id}
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onAdd(s.id);
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <ul className={styles.list}>
        {consoles.map((c, i) => (
          <li key={c.id}>
            <button
              className={`${styles.item} ${c.id === activeId ? styles.active : ""}`}
              onClick={() => onSelect(c.id)}
              aria-current={c.id === activeId ? "true" : undefined}
              aria-label={`${consoleTitle(c)}, ${shellName(c.shell)}`}
            >
              <StatusDot state={stateOf(c.id)} />
              <span className={styles.name}>{consoleTitle(c)}</span>
              <span className={styles.shell}>{shellName(c.shell)}</span>
            </button>
            <button
              className={styles.close}
              onClick={() => onClose(c.id)}
              disabled={i === 0}
              aria-label={`Close ${consoleTitle(c)}`}
              title={i === 0 ? "The first console always stays open" : "Close this console"}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
    </aside>
  );
}
