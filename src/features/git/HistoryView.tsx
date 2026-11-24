import { useMemo, useState } from "react";
import { relativeTime } from "../../state/home";
import { graphRows, statusWord, type CommitFile, type CommitInfo } from "../../state/git";
import styles from "./Git.module.css";

const LANE = 14;
const ROW = 34;
const COLORS = ["#38bdf8", "#34d399", "#f59e0b", "#f472b6", "#a78bfa", "#fb7185", "#22d3ee", "#a3e635"];
const color = (i: number) => COLORS[i % COLORS.length];

interface Props {
  commits: CommitInfo[] | null;
  loadFiles: (hash: string) => Promise<CommitFile[]>;
}

export function HistoryView({ commits, loadFiles }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, CommitFile[] | "error">>({});
  const graph = useMemo(() => graphRows(commits ?? []), [commits]);

  if (!commits) return <p className={styles.muted}>Loading history…</p>;
  if (commits.length === 0) return <p className={styles.muted}>No commits yet.</p>;

  const width = Math.max(1, graph.maxLanes) * LANE + 8;
  const x = (col: number) => col * LANE + LANE / 2 + 2;

  const toggle = async (hash: string) => {
    setOpen((o) => (o === hash ? null : hash));
    if (!files[hash]) {
      try {
        const f = await loadFiles(hash);
        setFiles((m) => ({ ...m, [hash]: f }));
      } catch {
        setFiles((m) => ({ ...m, [hash]: "error" }));
      }
    }
  };

  return (
    <ol className={styles.history} aria-label="Commit history">
      {graph.rows.map((r) => {
        const mid = ROW / 2;
        return (
          <li key={r.commit.hash}>
            <button className={styles.commitRow} onClick={() => toggle(r.commit.hash)} aria-expanded={open === r.commit.hash}>
              <svg width={width} height={ROW} className={styles.graph} aria-hidden="true">
                {r.before.map((h, i) =>
                  h ? <line key={`t${i}`} x1={x(i)} y1={0} x2={x(i)} y2={mid} stroke={color(i)} strokeWidth={2} /> : null,
                )}
                {r.after.map((h, i) =>
                  h && !r.parentCols.includes(i) ? (
                    <line key={`b${i}`} x1={x(i)} y1={mid} x2={x(i)} y2={ROW} stroke={color(i)} strokeWidth={2} />
                  ) : null,
                )}
                {r.parentCols.map((c, i) => (
                  <line key={`p${i}`} x1={x(r.col)} y1={mid} x2={x(c)} y2={ROW} stroke={color(c)} strokeWidth={2} />
                ))}
                <circle cx={x(r.col)} cy={mid} r={r.commit.parents.length > 1 ? 4 : 5} fill={color(r.col)} stroke="var(--panel)" strokeWidth={2} />
              </svg>
              <span className={styles.subject}>
                {r.commit.subject}
                {r.commit.refs.map((ref) => (
                  <span key={ref} className={styles.ref}>
                    {ref}
                  </span>
                ))}
              </span>
              <span className={styles.meta}>
                {r.commit.short} · {r.commit.author} · {relativeTime(r.commit.date)}
              </span>
            </button>
            {open === r.commit.hash && (
              <ul className={styles.commitFiles}>
                {!files[r.commit.hash] && <li className={styles.muted}>Loading files…</li>}
                {files[r.commit.hash] === "error" && <li className={styles.muted}>Could not read the files.</li>}
                {Array.isArray(files[r.commit.hash]) &&
                  (files[r.commit.hash] as CommitFile[]).map((f) => (
                    <li key={`${f.status}${f.path}`}>
                      <span className={styles.badge} title={statusWord(f.status)}>
                        {f.status}
                      </span>{" "}
                      {f.path}
                    </li>
                  ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
