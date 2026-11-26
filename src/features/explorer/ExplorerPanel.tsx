// The Files explorer panel (R2, R3, R4, R5, A5). One directory level at a time: a folder is only
// expanded (and only then read) when clicked, and a file is handed to the editor's existing open
// path so preview, duplicate and error handling stay exactly as the picker already does it.
import { memo, useEffect } from "react";
import type { ExplorerEntry } from "../../api/explorer";
import { detectKind } from "../../state/fileKinds";
import { nameFromPath } from "../../state/model";
import { useExplorer, type ExplorerLevelState } from "./useExplorer";
import type { ExplorerRootSource } from "./root";
import styles from "./ExplorerPanel.module.css";

export interface ExplorerPanelProps {
  /** The folder the explorer follows; null when no app root or file path applies (A5). */
  root: string | null;
  /** "misc" roots offer Up; an "app" root is the top folder (R4, R5). */
  source?: ExplorerRootSource;
  /** Changes with the view, selected app and active tab, discarding temporary Up navigation. */
  resetKey?: string;
  /** Open a file through the editor's existing open path (R3). */
  onOpenFile: (path: string) => void;
}

interface LevelProps {
  level: ExplorerLevelState;
  isExpanded: (path: string) => boolean;
  levelOf: (path: string) => ExplorerLevelState;
  ensure: (path: string) => void;
  toggleFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
}

type TreeCallbacks = Omit<LevelProps, "level">;

/** A file row. Memoised because a large folder is mostly files (A1). */
const FileRow = memo(function FileRow({ entry, onOpenFile }: { entry: ExplorerEntry; onOpenFile: (path: string) => void }) {
  const kind = detectKind(entry.name);
  return (
    <li>
      <button type="button" className={styles.fileRow} title={entry.path} onClick={() => onOpenFile(entry.path)}>
        <span className={styles.icon} role="img" aria-label={kind.label}>
          {kind.icon}
        </span>
        <span className={styles.name}>{entry.name}</span>
      </button>
    </li>
  );
});

function EntryList({ level, isExpanded, levelOf, ensure, toggleFolder, onOpenFile }: LevelProps) {
  if (level.loading && !level.listing) {
    return (
      <p className={styles.status} role="status">
        Loading…
      </p>
    );
  }
  if (level.locked) {
    return (
      <p className={styles.locked} role="status">
        <span role="img" aria-label="Locked folder">
          🔒
        </span>{" "}
        This folder can&apos;t be read.
      </p>
    );
  }
  const listing = level.listing;
  if (!listing) return null;

  return (
    <>
      <ul className={styles.list}>
        {listing.entries.map((entry) =>
          entry.isDir ? (
            <FolderRow
              key={entry.path}
              entry={entry}
              open={isExpanded(entry.path)}
              isExpanded={isExpanded}
              levelOf={levelOf}
              ensure={ensure}
              toggleFolder={toggleFolder}
              onOpenFile={onOpenFile}
            />
          ) : (
            <FileRow key={entry.path} entry={entry} onOpenFile={onOpenFile} />
          ),
        )}
      </ul>
      {listing.entries.length === 0 && <p className={styles.empty}>Empty folder</p>}
      {listing.truncated && (
        <p className={styles.more}>
          Showing first {listing.entries.length} of {listing.total}
        </p>
      )}
    </>
  );
}

function FolderRow({
  entry,
  open,
  isExpanded,
  levelOf,
  ensure,
  toggleFolder,
  onOpenFile,
}: TreeCallbacks & { entry: ExplorerEntry; open: boolean }) {
  return (
    <li>
      <button
        type="button"
        className={styles.folderRow}
        aria-expanded={open}
        title={entry.path}
        onClick={() => toggleFolder(entry.path)}
      >
        <span className={styles.chevron} aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className={styles.name}>{entry.name}</span>
        {entry.locked && (
          <span className={styles.lock} role="img" aria-label="Locked folder">
            🔒
          </span>
        )}
      </button>
      {open && (
        <div className={styles.children}>
          <FolderBody
            path={entry.path}
            level={levelOf(entry.path)}
            isExpanded={isExpanded}
            levelOf={levelOf}
            ensure={ensure}
            toggleFolder={toggleFolder}
            onOpenFile={onOpenFile}
          />
        </div>
      )}
    </li>
  );
}

/** Loads its folder the first time it is shown expanded, and never before (R2). */
function FolderBody({
  path,
  level,
  ...rest
}: LevelProps & { path: string }) {
  useEffect(() => {
    rest.ensure(path);
  }, [path, rest.ensure]);
  return <EntryList level={level} {...rest} />;
}

export function ExplorerPanel({ root, source = "none", resetKey, onOpenFile }: ExplorerPanelProps) {
  const X = useExplorer({ root, source, resetKey });

  return (
    <section className={styles.panel} aria-label="Files">
      <header className={styles.header}>
        <span className={styles.title} title={X.currentRoot ?? undefined}>
          {X.atDrives ? "Drives" : X.currentRoot ? nameFromPath(X.currentRoot) || X.currentRoot : "Files"}
        </span>
        {X.canGoUp && (
          <button type="button" className={styles.action} onClick={X.up} title="Go up one folder (to the drives at the top)">
            Up
          </button>
        )}
        <button
          type="button"
          className={styles.action}
          aria-pressed={X.showHidden}
          onClick={() => X.setShowHidden(!X.showHidden)}
          title="Show or hide node_modules, .git, target and dist"
        >
          {X.showHidden ? "Hide hidden" : "Show hidden"}
        </button>
      </header>

      {X.atDrives ? (
        <div className={styles.body}>
          {X.drivesLoading && (
            <p className={styles.status} role="status">
              Loading…
            </p>
          )}
          <ul className={styles.list}>
            {X.drives.map((drive) => (
              <li key={drive.path}>
                <button type="button" className={styles.folderRow} onClick={() => X.openDrive(drive)} title={drive.path}>
                  <span className={styles.chevron} aria-hidden="true">
                    ▸
                  </span>
                  <span className={styles.name}>{drive.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : X.currentRoot === null ? (
        <p className={styles.hint}>Open an app or a file to browse its folder.</p>
      ) : (
        <div className={styles.body}>
          <EntryList
            level={X.rootLevel}
            isExpanded={X.isExpanded}
            levelOf={X.levelOf}
            ensure={X.ensure}
            toggleFolder={X.toggleFolder}
            onOpenFile={onOpenFile}
          />
        </div>
      )}
    </section>
  );
}
