import { useEffect, useRef, useState } from "react";
import { filterBranches, type Branches } from "../../state/git";
import { SidePane } from "../apps/SidePane";
import styles from "./Git.module.css";

interface Props {
  branches: Branches | null;
  onPick: (branch: string) => void;
  onClose: () => void;
}

/**
 * The branch picker, presented as the app's responsive side pane like every other dialog. It
 * keeps its filter box, local/remote sections, per-branch buttons and Escape close; the pane's
 * named close control runs the same close action (R8, A3, A4).
 */
export function BranchMenu({ branches, onPick, onClose }: Props) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const local = filterBranches(branches?.local ?? [], q);
  const remote = filterBranches(branches?.remote ?? [], q);

  return (
    <SidePane title="Switch branch" onClose={onClose} closeLabel="Close Switch branch">
      <div className={styles.menu} role="dialog" aria-label="Switch branch">
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
    </SidePane>
  );
}
