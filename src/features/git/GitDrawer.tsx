import { useEffect } from "react";
import type { GitController } from "../../state/useGit";
import { ChangesView } from "./ChangesView";
import { HistoryView } from "./HistoryView";
import styles from "./Git.module.css";

export type GitTab = "changes" | "history";

interface Props {
  git: GitController;
  tab: GitTab;
  onTab: (t: GitTab) => void;
  onClose: () => void;
}

export function GitDrawer({ git, tab, onTab, onClose }: Props) {
  const { loadChanges, loadHistory } = git;
  useEffect(() => {
    if (tab === "changes") void loadChanges();
    else void loadHistory();
  }, [tab, loadChanges, loadHistory]);

  return (
    <aside className={styles.drawer} aria-label="Git">
      <div className={styles.drawerHead}>
        <div role="tablist" className={styles.tabs}>
          <button role="tab" aria-selected={tab === "changes"} onClick={() => onTab("changes")}>
            Changes
          </button>
          <button role="tab" aria-selected={tab === "history"} onClick={() => onTab("history")}>
            History
          </button>
        </div>
        <button onClick={onClose} aria-label="Close git panel">
          ✕
        </button>
      </div>
      <div className={styles.drawerBody}>
        {tab === "changes" ? (
          <ChangesView files={git.changes} busy={!!git.busy} onCommit={git.commit} />
        ) : (
          <HistoryView commits={git.commits} loadFiles={git.loadCommitFiles} />
        )}
      </div>
    </aside>
  );
}
