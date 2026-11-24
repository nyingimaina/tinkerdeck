import { useEffect, useRef, type ReactNode } from "react";
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

/** Modal confirmation. The first action is the default and gets focus. */
export function Dialog({ title, children, actions }: Props) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div className={styles.backdrop}>
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
    </div>
  );
}
