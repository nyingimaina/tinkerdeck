import { useEffect, useState } from "react";
import { canCommit, statusWord, type FileChange } from "../../state/git";
import styles from "./Git.module.css";

interface Props {
  files: FileChange[] | null;
  busy: boolean;
  onCommit: (paths: string[], message: string) => Promise<boolean>;
}

export function ChangesView({ files, busy, onCommit }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  // when the list changes, keep the user's picks that still exist and select new non-conflicting files
  useEffect(() => {
    if (!files) return;
    setSelected((cur) => {
      const known = new Set(cur);
      const still = files.filter((f) => known.has(f.path)).map((f) => f.path);
      return cur.length === 0 ? files.filter((f) => !f.conflict).map((f) => f.path) : still;
    });
  }, [files]);

  if (!files) return <p className={styles.muted}>Loading changes…</p>;
  if (files.length === 0) return <p className={styles.muted}>Nothing to commit. Your working folder is clean.</p>;

  const check = canCommit(selected, message, files);
  const allSelected = selected.length === files.length;
  const toggle = (p: string) => setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));

  return (
    <div className={styles.changes}>
      <label className={styles.selectAll}>
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => setSelected(allSelected ? [] : files.map((f) => f.path))}
        />
        {selected.length} of {files.length} selected
      </label>
      <ul className={styles.fileList}>
        {files.map((f) => (
          <li key={f.path}>
            <label>
              <input type="checkbox" checked={selected.includes(f.path)} onChange={() => toggle(f.path)} aria-label={f.path} />
              <span className={`${styles.badge} ${styles[`s${f.status}`] ?? ""}`} title={statusWord(f.status)}>
                {f.status}
              </span>
              <span className={styles.path}>{f.path}</span>
              {f.staged && <span className={styles.muted}> staged</span>}
            </label>
          </li>
        ))}
      </ul>
      <textarea
        className={styles.msgBox}
        placeholder="Commit message"
        aria-label="Commit message"
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      {!check.ok && <p className={styles.muted}>{check.reason}</p>}
      <button
        className={styles.commit}
        disabled={!check.ok || busy}
        onClick={async () => {
          if (await onCommit(selected, message)) setMessage("");
        }}
      >
        Commit {selected.length} file{selected.length === 1 ? "" : "s"}
      </button>
    </div>
  );
}
