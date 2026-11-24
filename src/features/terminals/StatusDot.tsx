import { dotKind, stateLabel, type TermState, type Rollup } from "../../state/model";
import styles from "./StatusDot.module.css";

interface Props {
  state?: TermState;
  rollup?: Rollup;
  className?: string;
}

/** Colour is never the only signal: tick, hollow ring and a title text are added. */
export function StatusDot({ state, rollup, className }: Props) {
  const kind = state ? dotKind(state) : rollup ?? "grey";
  const label = state ? stateLabel(state) : `App status: ${rollup}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-kind={kind}
      className={`${styles.dot} ${styles[kind] ?? ""} ${className ?? ""}`}
    >
      {kind === "greyTick" ? "✓" : null}
    </span>
  );
}
