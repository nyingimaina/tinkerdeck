import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../api/tauri";
import type { Branches, CommitFile, CommitInfo, FileChange, RepoInfo } from "./git";
import { usePoller } from "./usePoller";

export interface GitMessage {
  kind: "ok" | "error";
  text: string;
}

export interface GitController {
  /** undefined = still loading, null = not a repository. */
  info: RepoInfo | null | undefined;
  busy: string | null;
  message: GitMessage | null;
  branches: Branches | null;
  changes: FileChange[] | null;
  commits: CommitInfo[] | null;
  refresh: () => Promise<void>;
  /** Keep the branch list fresh while its menu is open. */
  watchBranches: (open: boolean) => void;
  loadBranches: () => Promise<void>;
  loadChanges: () => Promise<void>;
  loadHistory: () => Promise<void>;
  loadCommitFiles: (hash: string) => Promise<CommitFile[]>;
  fetch: () => Promise<void>;
  pull: () => Promise<void>;
  push: () => Promise<void>;
  sync: () => Promise<void>;
  switchBranch: (name: string) => Promise<boolean>;
  commit: (paths: string[], message: string) => Promise<boolean>;
  dismiss: () => void;
}

/** Git state for one app. Refreshes on app change, window focus and after every action; never on a timer. */
export interface GitWatch {
  /** Poll the changed-files list (Changes tab open). */
  changes?: boolean;
  /** Poll the commit history (History tab open). */
  history?: boolean;
  /** Bump to refresh everything now (the manual refresh button). */
  refreshKey?: number;
}

export function useGit(appId: string | null, watch: GitWatch = {}): GitController {
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [info, setInfo] = useState<RepoInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<GitMessage | null>(null);
  const [branches, setBranches] = useState<Branches | null>(null);
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const current = useRef(appId);
  current.current = appId;

  const refresh = useCallback(async () => {
    if (!appId) return setInfo(null);
    try {
      const i = await api.gitInfo(appId);
      if (current.current === appId) setInfo(i);
    } catch (e) {
      if (current.current === appId) {
        setInfo(null);
        setMessage({ kind: "error", text: errorText(e) });
      }
    }
  }, [appId]);

  useEffect(() => {
    setInfo(undefined);
    setBranches(null);
    setChanges(null);
    setCommits(null);
    setMessage(null);
    setBranchesOpen(false);
  }, [appId]);

  // Live state (BRS 7.9): only for the open app, paused while the window is hidden, backing off when unchanged.
  const pollError = (e: unknown, n: number) => {
    if (n >= 5) setMessage({ kind: "error", text: `Could not refresh git. ${errorText(e)}` });
  };
  usePoller<RepoInfo | null>({
    enabled: !!appId,
    func: () => api.gitInfo(appId ?? ""),
    onResult: (v, changed) => {
      if (changed || info === undefined) setInfo(v);
    },
    onError: pollError,
    intervalMs: 5000,
    maxIntervalMs: 30000,
    refreshKey: watch.refreshKey,
  });
  usePoller<FileChange[]>({
    enabled: !!appId && !!watch.changes,
    func: () => api.gitChanges(appId ?? ""),
    onResult: (v, changed) => {
      if (changed || changes === null) setChanges(v);
    },
    onError: pollError,
    intervalMs: 3000,
    maxIntervalMs: 20000,
    refreshKey: watch.refreshKey,
  });
  usePoller<CommitInfo[]>({
    enabled: !!appId && !!watch.history,
    func: () => api.gitLog(appId ?? "", 200),
    onResult: (v, changed) => {
      if (changed || commits === null) setCommits(v);
    },
    onError: pollError,
    intervalMs: 10000,
    maxIntervalMs: 60000,
    refreshKey: watch.refreshKey,
  });
  usePoller<Branches>({
    enabled: !!appId && branchesOpen,
    func: () => api.gitBranches(appId ?? ""),
    onResult: (v, changed) => {
      if (changed || branches === null) setBranches(v);
    },
    onError: pollError,
    intervalMs: 5000,
    maxIntervalMs: 30000,
    refreshKey: watch.refreshKey,
  });

  const guarded = useCallback(
    async (label: string, work: () => Promise<string | void>, okText?: string): Promise<boolean> => {
      if (!appId || busy) return false;
      setBusy(label);
      setMessage(null);
      try {
        const r = await work();
        setMessage({ kind: "ok", text: okText ?? (typeof r === "string" && r ? r : `${label} done.`) });
        return true;
      } catch (e) {
        setMessage({ kind: "error", text: errorText(e) });
        return false;
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [appId, busy, refresh],
  );

  const loadBranches = useCallback(async () => {
    if (!appId) return;
    try {
      setBranches(await api.gitBranches(appId));
    } catch (e) {
      setMessage({ kind: "error", text: errorText(e) });
    }
  }, [appId]);

  const loadChanges = useCallback(async () => {
    if (!appId) return;
    try {
      setChanges(await api.gitChanges(appId));
    } catch (e) {
      setMessage({ kind: "error", text: errorText(e) });
    }
  }, [appId]);

  const loadHistory = useCallback(async () => {
    if (!appId) return;
    try {
      setCommits(await api.gitLog(appId, 200));
    } catch (e) {
      setMessage({ kind: "error", text: errorText(e) });
    }
  }, [appId]);

  return {
    info,
    busy,
    message,
    branches,
    changes,
    commits,
    refresh,
    watchBranches: setBranchesOpen,
    loadBranches,
    loadChanges,
    loadHistory,
    loadCommitFiles: (hash) => (appId ? api.gitCommitFiles(appId, hash) : Promise.resolve([])),
    fetch: async () => void (await guarded("Fetch", () => api.gitFetch(appId ?? ""))),
    pull: async () => void (await guarded("Pull", () => api.gitPull(appId ?? ""))),
    push: async () => void (await guarded("Push", () => api.gitPush(appId ?? ""))),
    sync: async () => void (await guarded("Sync", () => api.gitSync(appId ?? ""))),
    switchBranch: async (name) => {
      const ok = await guarded("Switch", () => api.gitSwitch(appId ?? "", name), `Switched to ${name}.`);
      if (ok) {
        void loadBranches();
        void loadChanges();
      }
      return ok;
    },
    commit: async (paths, text) => {
      const ok = await guarded("Commit", async () => `Committed ${await api.gitCommit(appId ?? "", paths, text)}.`);
      if (ok) {
        void loadChanges();
        void loadHistory();
      }
      return ok;
    },
    dismiss: () => setMessage(null),
  };
}
