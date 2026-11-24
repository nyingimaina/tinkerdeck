// Types shared with git.rs plus pure helpers for the git panel and the commit graph.

export interface RepoInfo {
  toplevel: string;
  branch: string | null;
  detached: boolean;
  head: string | null;
  dirty: boolean;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
}

export interface FileChange {
  path: string;
  status: string;
  staged: boolean;
  conflict: boolean;
}

export interface Branches {
  current: string | null;
  local: string[];
  remote: string[];
}

export interface CommitInfo {
  hash: string;
  short: string;
  parents: string[];
  subject: string;
  author: string;
  date: number;
  refs: string[];
}

export interface CommitFile {
  status: string;
  path: string;
}

export function branchLabel(i: RepoInfo): string {
  let base: string;
  if (i.branch) base = i.branch;
  else if (i.detached) base = `detached @ ${i.head ?? "?"}`;
  else return "no commits yet";
  if (i.dirty) base += " ●";
  const counts = [i.ahead > 0 ? `↑${i.ahead}` : "", i.behind > 0 ? `↓${i.behind}` : ""].filter(Boolean).join(" ");
  return counts ? `${base} ${counts}` : base;
}

export function filterBranches(names: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  return q ? names.filter((n) => n.toLowerCase().includes(q)) : names;
}

export function canCommit(
  selected: string[],
  message: string,
  files: FileChange[],
): { ok: true } | { ok: false; reason: string } {
  if (selected.length === 0) return { ok: false, reason: "Select at least one file." };
  if (!message.trim()) return { ok: false, reason: "Write a commit message." };
  if (files.some((f) => f.conflict && selected.includes(f.path))) {
    return { ok: false, reason: "A selected file has a conflict. Resolve it in the Console tab first." };
  }
  return { ok: true };
}

export function statusWord(letter: string): string {
  switch (letter) {
    case "M":
      return "modified";
    case "?":
      return "new";
    case "D":
      return "deleted";
    case "A":
      return "added";
    case "R":
      return "renamed";
    case "U":
      return "conflict";
    default:
      return "changed";
  }
}

// ------------------------------------------------------------ commit graph

export interface GraphRow {
  commit: CommitInfo;
  /** Column of this commit's dot. */
  col: number;
  /** Lanes (waiting commit hash or null) before and after this row, trailing empties trimmed. */
  before: (string | null)[];
  after: (string | null)[];
  /** Columns the parents continue in (after this row). */
  parentCols: number[];
}

const trim = (l: (string | null)[]) => {
  const c = [...l];
  while (c.length && c[c.length - 1] === null) c.pop();
  return c;
};

/** Assign each commit (newest first) to a lane, the way a git graph does. */
export function graphRows(commits: CommitInfo[]): { rows: GraphRow[]; maxLanes: number } {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  let maxLanes = 0;
  for (const commit of commits) {
    const before = trim(lanes);
    let col = lanes.indexOf(commit.hash);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) {
        lanes.push(null);
        col = lanes.length - 1;
      }
    }
    // other lanes waiting for this same commit converge here
    lanes.forEach((h, i) => {
      if (i !== col && h === commit.hash) lanes[i] = null;
    });
    const parentCols: number[] = [];
    if (commit.parents.length === 0) {
      lanes[col] = null;
    } else {
      const first = commit.parents[0];
      const j = lanes.indexOf(first);
      if (j !== -1 && j !== col) {
        lanes[col] = null;
        parentCols.push(j);
      } else {
        lanes[col] = first;
        parentCols.push(col);
      }
      for (const p of commit.parents.slice(1)) {
        let k = lanes.indexOf(p);
        if (k === -1) {
          k = lanes.indexOf(null);
          if (k === -1) {
            lanes.push(p);
            k = lanes.length - 1;
          } else lanes[k] = p;
        }
        parentCols.push(k);
      }
    }
    const after = trim(lanes);
    maxLanes = Math.max(maxLanes, before.length, after.length, col + 1, ...parentCols.map((c) => c + 1));
    rows.push({ commit, col, before, after, parentCols });
  }
  return { rows, maxLanes };
}
