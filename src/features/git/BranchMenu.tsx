import { useEffect, useRef, useState } from "react";
import { filterBranches, type Branches } from "../../state/git";
import styles from "./Git.module.css";

interface Props {
  branches: Branches | null;
  onPick: (branch: string) => void;
  onClose: () => void;
}

export function BranchMenu({ branches, onPick, onClose }: Props) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const local = filterBranches(branches?.local ?? [], q);
  const remote = filterBranches(branches?.remote ?? [], q);

  return (
    <div className={styles.menu} role="dialog" aria-label="Switch branch" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <input
        ref={input}
        className={styles.filter}
        placeholder="Find a branch…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Filter branches"
      />
      {!branches && <p className={styles.muted}>Loading…</p>}
      {branches && local.length === 0 && remote.length === 0 && <p className={styles.muted}>No branch matches.</p>}
      {local.length > 0 && <p className={styles.menuHead}>Local</p>}
      {local.map((b) => (
        <button key={`l-${b}`} className={styles.item} disabled={b === branches?.current} onClick={() => onPick(b)}>
          {b === branches?.current ? "✓ " : ""}
          {b}
        </button>
      ))}
      {remote.length > 0 && <p className={styles.menuHead}>On the remote (creates a local branch)</p>}
      {remote.map((b) => (
        <button key={`r-${b}`} className={styles.item} onClick={() => onPick(b)}>
          ⇣ {b}
        </button>
      ))}
    </div>
  );
}
