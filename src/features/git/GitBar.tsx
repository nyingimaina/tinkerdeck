import { useState } from "react";
import type { GitController } from "../../state/useGit";
import { BranchMenu } from "./BranchMenu";
import styles from "./Git.module.css";

interface Props {
  git: GitController;
  /** Called with the chosen branch; the parent decides whether running terminals need a warning first. */
  onSwitch: (branch: string) => void;
  onOpenChanges: () => void;
  onOpenHistory: () => void;
  onOpenConsole: () => void;
  /** Manual refresh of everything now. */
  onRefresh?: () => void;
  /** When true the bar can start as a branch chip and expand the tools on demand (R5). */
  collapsible?: boolean;
  /** Start collapsed, only meaningful with `collapsible`. Existing callers stay expanded. */
  defaultCollapsed?: boolean;
}

/** Branch pill, fetch/pull/push/sync and links to the changes, history and console. Hidden outside a repository. */
export function GitBar({ git, onSwitch, onOpenChanges, onOpenHistory, onOpenConsole, onRefresh, collapsible = false, defaultCollapsed = false }: Props) {
  const [menu, setMenu] = useState(false);
  const [tools, setTools] = useState(() => !(collapsible && defaultCollapsed));
  const { info, busy, message } = git;
  if (!info) return null; // loading, or not a repository

  const onBranch = !!info.branch;
  const off = !!busy;

  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <div className={styles.pillWrap}>
          <button
            className={styles.pill}
            aria-label={`Switch branch, current ${info.branch ?? "none"}`}
            aria-expanded={menu}
            disabled={off}
            onClick={() => {
              setMenu((m) => !m);
              git.watchBranches(!menu);
              if (!menu) void git.loadBranches();
            }}
          >
            <span className={styles.pillIcon}>⎇</span>
            {`${info.branch ?? (info.detached ? `detached @ ${info.head ?? "?"}` : "no commits yet")}${info.dirty ? " ●" : ""}`}
          </button>
          {menu && (
            <BranchMenu
              branches={git.branches}
              onClose={() => {
                setMenu(false);
                git.watchBranches(false);
              }}
              onPick={(b) => {
                setMenu(false);
                git.watchBranches(false);
                onSwitch(b);
              }}
            />
          )}
        </div>

        <span className={styles.counts} aria-label="Ahead and behind">
          {info.hasUpstream ? `↑${info.ahead} ↓${info.behind}` : "no upstream"}
        </span>

        {onRefresh && (
          <button onClick={onRefresh} aria-label="Refresh" title="Refresh now (F5)">
            ⟳
          </button>
        )}
        {collapsible && (
          <button
            className={styles.toolsToggle}
            onClick={() => setTools((v) => !v)}
            aria-expanded={tools}
            aria-label={tools ? "Hide git tools" : "Show git tools"}
            title={tools ? "Hide git tools" : "Show git tools"}
          >
            <span className={styles.chevron} aria-hidden="true">
              {tools ? "\u25b4" : "\u25be"}
            </span>
          </button>
        )}
        {tools && (
          <>
        <button onClick={() => void git.fetch()} disabled={off}>
          Fetch
        </button>
        <button onClick={() => void git.pull()} disabled={off || !onBranch || !info.hasUpstream} title="Fast-forward only">
          ↓ Pull
        </button>
        <button onClick={() => void git.push()} disabled={off || !onBranch}>
          ↑ Push
        </button>
        <button onClick={() => void git.sync()} disabled={off || !onBranch}>
          ⇅ Sync
        </button>
        <span className={styles.spacer} />
        <button onClick={onOpenChanges}>Changes{info.dirty ? " ●" : ""}</button>
        <button onClick={onOpenHistory}>History</button>
        <button onClick={onOpenConsole} title="Run git or anything else in a terminal">
          &gt;_ Console
        </button>
          </>
        )}
      </div>
      {busy && (
        <p className={styles.busy} role="status">
          {busy}…
        </p>
      )}
      {message && (
        <p className={`${styles.message} ${message.kind === "error" ? styles.error : styles.ok}`} role={message.kind === "error" ? "alert" : "status"}>
          <span className={styles.msgText}>{message.text}</span>
          <button onClick={git.dismiss} aria-label="Dismiss message">
            ✕
          </button>
        </p>
      )}
    </div>
  );
}
