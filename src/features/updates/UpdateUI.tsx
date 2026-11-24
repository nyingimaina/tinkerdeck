import type { UpdateInfo } from "../../state/model";
import type { UpdatePhase } from "../../state/useUpdates";
import { Banner } from "../apps/Banner";
import { Dialog } from "../apps/Dialog";
import styles from "./UpdateUI.module.css";

interface BannerProps {
  info: UpdateInfo;
  onDetails: () => void;
  onLater: () => void;
  onSkip: () => void;
}

export function UpdateBanner({ info, onDetails, onLater, onSkip }: BannerProps) {
  return (
    <Banner
      kind="info"
      actions={[
        { label: "Update now", onClick: onDetails },
        { label: "Later", onClick: onLater },
        { label: "Skip this version", onClick: onSkip },
      ]}
    >
      Tinkerdeck <b>{info.version}</b> is available.
    </Banner>
  );
}

interface DialogProps {
  info: UpdateInfo;
  phase: UpdatePhase;
  progress: { done: number; total: number } | null;
  error: string | null;
  /** Running terminals that the update will stop. */
  runningCount: number;
  onInstall: () => void;
  onClose: () => void;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function UpdateDialog({ info, phase, progress, error, runningCount, onInstall, onClose }: DialogProps) {
  const busy = phase === "downloading" || phase === "installing";
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <Dialog
      title={`Update to ${info.version}`}
      actions={
        busy
          ? []
          : [
              { label: "Update and restart", kind: "primary", onClick: onInstall },
              { label: "Cancel", onClick: onClose },
            ]
      }
    >
      {info.notes ? <pre className={styles.notes}>{info.notes}</pre> : <p>This version has no release notes.</p>}
      <p className={styles.size}>Download size {mb(info.size)}. The update is checked against a signed checksum before it runs.</p>
      {runningCount > 0 && (
        <p className={styles.warn}>
          {runningCount} terminal{runningCount === 1 ? " is" : "s are"} running. {runningCount === 1 ? "It" : "They"} will be stopped, and
          after the restart Tinkerdeck offers to start the apps that were running.
        </p>
      )}
      {phase === "downloading" && (
        <div className={styles.progress}>
          <progress className={styles.prog} value={pct} max={100} aria-label="Downloading update" />
          <span>Downloading… {pct}%</span>
        </div>
      )}
      {phase === "installing" && <p role="status">Installing. Tinkerdeck will close and open again in a moment…</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

interface SettingsProps {
  version: string;
  autoCheck: boolean;
  phase: UpdatePhase;
  upToDate: boolean;
  available: string | null;
  error: string | null;
  onAutoCheck: (v: boolean) => void;
  onCheckNow: () => void;
}

export function UpdateSettingsBlock({ version, autoCheck, phase, upToDate, available, error, onAutoCheck, onCheckNow }: SettingsProps) {
  const status = phase === "checking" ? "Checking…" : error ? error : available ? `Version ${available} is available.` : upToDate ? "You are up to date." : "";
  return (
    <div className={styles.settings}>
      <h4>Updates</h4>
      <p>Version {version}</p>
      <label>
        <input type="checkbox" checked={autoCheck} onChange={(e) => onAutoCheck(e.target.checked)} /> Check for updates automatically
      </label>
      <div className={styles.row}>
        <button onClick={onCheckNow} disabled={phase !== "idle"}>
          Check now
        </button>
        {status && (
          <span role="status" className={error ? styles.error : undefined}>
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
