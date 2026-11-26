// The Files explorer panel (R2, R3, R4, R5, R9, R13). One directory level at a time: a folder is
// only expanded (and only then read) when clicked, and a file is handed to the editor's existing
// open path so preview, duplicate and error handling stay exactly as the picker already does it.
//
// When the window supplies its editor bridge the panel also becomes a file manager: a wrapping
// action toolbar, row selection, drag-and-drop onto folders, and the create/rename/delete prompts.
import { memo, useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { ExplorerEntry } from "../../api/explorer";
import { detectKind } from "../../state/fileKinds";
import { nameFromPath } from "../../state/model";
import { useExplorer, type ExplorerLevelState } from "./useExplorer";
import { useExplorerOps, type ExplorerEditorBridge } from "./useExplorerOps";
import { ExplorerDialogs } from "./ExplorerDialogs";
import { parentFolder, type ExplorerRootSource } from "./root";
import styles from "./ExplorerPanel.module.css";

export interface ExplorerPanelProps {
  /** The folder the explorer follows; null when no app root, file path or home folder applies (R13). */
  root: string | null;
  /** "misc" and "home" roots offer Up; an "app" root is the top folder (R4, R5, R13). */
  source?: ExplorerRootSource;
  /** Changes with the view, selected app and active tab, discarding temporary Up navigation. */
  resetKey?: string;
  /** Open a file through the editor's existing open path (R3). */
  onOpenFile: (path: string) => void;
  /**
   * The window's editor hooks for the file operations (R9). Without it the panel keeps showing the
   * read-only tree it had before, so it can still be used on its own.
   */
  editor?: ExplorerEditorBridge;
}

/** The tree's read helpers, shared down the levels. */
interface Nav {
  isExpanded: (path: string) => boolean;
  levelOf: (path: string) => ExplorerLevelState;
  ensure: (path: string) => void;
  toggleFolder: (path: string) => void;
}

/** Selection and drag-and-drop, only meaningful when the file operations are available (R9). */
interface RowActions {
  interactive: boolean;
  selectedPath: string | null;
  onSelect: (entry: ExplorerEntry) => void;
  onDragStart: (entry: ExplorerEntry) => void;
  onDrop: (into: string) => void;
}

function dragStarted(e: DragEvent, entry: ExplorerEntry, onDragStart: (entry: ExplorerEntry) => void) {
  e.dataTransfer?.setData("text/plain", entry.path);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  onDragStart(entry);
}

/** A file row. Memoised because a large folder is mostly files (A1). */
const FileRow = memo(function FileRow({
  entry,
  onOpenFile,
  selectedPath,
  interactive,
  onSelect,
  onDragStart,
}: {
  entry: ExplorerEntry;
  onOpenFile: (path: string) => void;
  selectedPath: string | null;
  interactive: boolean;
  onSelect: (entry: ExplorerEntry) => void;
  onDragStart: (entry: ExplorerEntry) => void;
}) {
  const kind = detectKind(entry.name);
  const selected = selectedPath === entry.path;
  return (
    <li>
      <button
        type="button"
        className={styles.fileRow}
        title={entry.path}
        data-selected={selected ? "true" : undefined}
        aria-current={selected ? "true" : undefined}
        draggable={interactive}
        onDragStart={(e) => dragStarted(e, entry, onDragStart)}
        onClick={() => {
          onSelect(entry);
          onOpenFile(entry.path);
        }}
      >
        <span className={styles.icon} role="img" aria-label={kind.label}>
          {kind.icon}
        </span>
        <span className={styles.name}>{entry.name}</span>
      </button>
    </li>
  );
});

function EntryList({
  level,
  nav,
  actions,
  onOpenFile,
}: {
  level: ExplorerLevelState;
  nav: Nav;
  actions: RowActions;
  onOpenFile: (path: string) => void;
}) {
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
              open={nav.isExpanded(entry.path)}
              nav={nav}
              actions={actions}
              onOpenFile={onOpenFile}
            />
          ) : (
            <FileRow
              key={entry.path}
              entry={entry}
              onOpenFile={onOpenFile}
              selectedPath={actions.selectedPath}
              interactive={actions.interactive}
              onSelect={actions.onSelect}
              onDragStart={actions.onDragStart}
            />
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
  nav,
  actions,
  onOpenFile,
}: {
  entry: ExplorerEntry;
  open: boolean;
  nav: Nav;
  actions: RowActions;
  onOpenFile: (path: string) => void;
}) {
  const [over, setOver] = useState(false);
  const selected = actions.selectedPath === entry.path;
  return (
    <li>
      <button
        type="button"
        className={styles.folderRow}
        aria-expanded={open}
        title={entry.path}
        data-selected={selected ? "true" : undefined}
        data-drop={over && actions.interactive ? "true" : undefined}
        aria-current={selected ? "true" : undefined}
        draggable={actions.interactive}
        onDragStart={(e) => dragStarted(e, entry, actions.onDragStart)}
        onDragOver={(e) => {
          if (!actions.interactive) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          if (!over) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (actions.interactive) actions.onDrop(entry.path);
        }}
        onClick={() => {
          actions.onSelect(entry);
          nav.toggleFolder(entry.path);
        }}
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
          <FolderBody path={entry.path} level={nav.levelOf(entry.path)} nav={nav} actions={actions} onOpenFile={onOpenFile} />
        </div>
      )}
    </li>
  );
}

/** Loads its folder the first time it is shown expanded, and never before (R2). */
function FolderBody({
  path,
  level,
  nav,
  actions,
  onOpenFile,
}: {
  path: string;
  level: ExplorerLevelState;
  nav: Nav;
  actions: RowActions;
  onOpenFile: (path: string) => void;
}) {
  useEffect(() => {
    nav.ensure(path);
  }, [path, nav.ensure]);
  return <EntryList level={level} nav={nav} actions={actions} onOpenFile={onOpenFile} />;
}

export function ExplorerPanel({ root, source = "none", resetKey, onOpenFile, editor }: ExplorerPanelProps) {
  const X = useExplorer({ root, source, resetKey });
  const [selected, setSelected] = useState<ExplorerEntry | null>(null);
  // A rename, move or delete makes the selected path point at nothing or at a different item, so
  // the selection is dropped rather than left to act on a stale path (REV-2).
  const clearSelection = useCallback(() => setSelected(null), []);
  const ops = useExplorerOps({ explorer: X, editor, onCommitted: clearSelection });
  const dragging = useRef<ExplorerEntry | null>(null);

  // A new view, app or active tab starts a fresh tree, so a selection from the old one is dropped.
  useEffect(() => {
    setSelected(null);
    dragging.current = null;
  }, [resetKey, root]);

  const select = useCallback((entry: ExplorerEntry) => setSelected(entry), []);
  const beginDrag = useCallback((entry: ExplorerEntry) => {
    dragging.current = entry;
  }, []);
  const dropInto = useCallback(
    (into: string) => {
      const entry = dragging.current;
      dragging.current = null;
      if (entry) ops.drop(entry, into);
    },
    [ops.drop],
  );

  const interactive = !!editor;
  const targetFolder = selected ? (selected.isDir ? selected.path : parentFolder(selected.path)) : X.currentRoot;
  const actions: RowActions = {
    interactive,
    selectedPath: selected?.path ?? null,
    onSelect: select,
    onDragStart: beginDrag,
    onDrop: dropInto,
  };
  const nav: Nav = {
    isExpanded: X.isExpanded,
    levelOf: X.levelOf,
    ensure: X.ensure,
    toggleFolder: X.toggleFolder,
  };

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

      {interactive && (
        <div className={styles.toolbar} role="toolbar" aria-label="File actions">
          <button
            type="button"
            className={styles.action}
            disabled={ops.busy || !targetFolder}
            onClick={() => targetFolder && ops.createFile(targetFolder)}
          >
            New file
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={ops.busy || !targetFolder}
            onClick={() => targetFolder && ops.createFolder(targetFolder)}
          >
            New folder
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={ops.busy || !selected}
            onClick={() => selected && ops.rename(selected)}
          >
            Rename
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={ops.busy || !selected}
            onClick={() => selected && ops.move(selected)}
          >
            Move
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={ops.busy || !selected}
            onClick={() => selected && ops.remove(selected)}
          >
            Delete
          </button>
        </div>
      )}

      {ops.busy && (
        <p className={styles.status} role="status">
          Working…
        </p>
      )}
      {ops.error && (
        <p className={styles.error} role="alert">
          <span>{ops.error}</span>
          <button type="button" className={styles.action} onClick={ops.dismissError}>
            Dismiss
          </button>
        </p>
      )}

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
          <EntryList level={X.rootLevel} nav={nav} actions={actions} onOpenFile={onOpenFile} />
        </div>
      )}

      {interactive && (
        <ExplorerDialogs prompt={ops.prompt} busy={ops.busy} onSubmit={ops.submit} onCancel={ops.cancel} />
      )}
    </section>
  );
}
