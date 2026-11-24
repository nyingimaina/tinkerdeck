import { useCallback, useState } from "react";
import { api, errorText, onUpdateProgress } from "../api/tauri";
import type { UpdateInfo } from "./model";
import { usePoller } from "./usePoller";

export type UpdatePhase = "idle" | "checking" | "downloading" | "installing";

interface Options {
  autoCheck: boolean;
  skippedVersion?: string | null;
  /** Persist a settings change (`skippedVersion: null` clears it). */
  save: (p: { autoCheck?: boolean; skippedVersion?: string | null }) => Promise<void>;
}

const ONE_HOUR = 3600 * 1000;

/**
 * Self-update state (BRS 7.13). A quiet check runs while the window is visible (Rust limits it to
 * about once an hour); nothing is ever installed without the user pressing the button.
 */
export function useUpdates({ autoCheck, skippedVersion, save }: Options) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upToDate, setUpToDate] = useState(false);
  const [laterFor, setLaterFor] = useState<string | null>(null);

  usePoller<UpdateInfo | null>({
    enabled: autoCheck,
    func: () => api.checkUpdate(false),
    onResult: (v) => {
      if (v) setInfo(v);
    },
    intervalMs: ONE_HOUR,
    maxIntervalMs: ONE_HOUR,
    maxErrors: 3,
  });

  const checkNow = useCallback(async () => {
    setPhase("checking");
    setError(null);
    setUpToDate(false);
    try {
      const found = await api.checkUpdate(true);
      setInfo(found);
      setUpToDate(!found);
      setLaterFor(null);
      if (found && skippedVersion === found.version) await save({ skippedVersion: null });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPhase("idle");
    }
  }, [save, skippedVersion]);

  /** Download (with progress), verify, then hand over to the installer. The app exits on success. */
  const install = useCallback(async () => {
    setError(null);
    setProgress(null);
    setPhase("downloading");
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await onUpdateProgress((p) => setProgress(p));
      await api.downloadUpdate();
      setPhase("installing");
      await api.applyUpdate();
    } catch (e) {
      setError(errorText(e));
      setPhase("idle");
    } finally {
      unlisten?.();
    }
  }, []);

  const visible = !!info && laterFor !== info.version && skippedVersion !== info.version;

  return {
    info,
    visible,
    phase,
    progress,
    error,
    upToDate,
    checkNow,
    install,
    later: () => setLaterFor(info?.version ?? null),
    skip: async () => {
      if (info) await save({ skippedVersion: info.version });
    },
    clearError: () => setError(null),
  };
}
