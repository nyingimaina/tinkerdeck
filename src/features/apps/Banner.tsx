import type { ReactNode } from "react";
import styles from "./Banner.module.css";

interface Props {
  kind: "warn" | "error" | "info";
  children: ReactNode;
  actions?: { label: string; onClick: () => void }[];
}

export function Banner({ kind, children, actions = [] }: Props) {
  return (
    <div className={`${styles.banner} ${styles[kind]}`} role="alert">
      <span className={styles.text}>{children}</span>
      {actions.map((a) => (
        <button key={a.label} onClick={a.onClick}>
          {a.label}
        </button>
      ))}
    </div>
  );
}
