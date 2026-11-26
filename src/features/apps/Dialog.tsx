import { useEffect, useRef, type ReactNode } from "react";
import { SidePane } from "./SidePane";
import styles from "./Dialog.module.css";

export interface DialogAction {
  label: string;
  onClick: () => void;
  kind?: "primary" | "danger" | "plain";
}

interface Props {
  title: string;
  children: ReactNode;
  actions: DialogAction[];
}

/**
 * A confirmation presented as the app's responsive side pane. The first action is the default
 * and gets focus; the last action is the cancel action, so the named close control and Escape
 * both take the safe way out. A dialog with no actions has no close path at all (R8, A3).
 */
export function Dialog({ title, children, actions }: Props) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const cancel = actions.length > 0 ? actions[actions.length - 1] : null;
  return (
    <SidePane onClose={cancel ? cancel.onClick : undefined} closeLabel={`Close ${title}`}>
      <div role="dialog" aria-modal="true" aria-label={title} className={styles.dialog}>
        <h3>{title}</h3>
        <div className={styles.body}>{children}</div>
        <div className={styles.actions}>
          {actions.map((a, i) => (
            <button
              key={a.label}
              ref={i === 0 ? first : undefined}
              className={`${styles.btn} ${a.kind ? styles[a.kind] : ""}`}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </SidePane>
  );
}
