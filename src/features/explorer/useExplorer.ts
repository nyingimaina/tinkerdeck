// The Files explorer's state (R2, R5, A1): one directory level at a time, expanded folders loaded
// lazily and cached, the noisy names hidden unless asked, and Up walking to the drive list.
//
// It never walks the disk by itself: every request is one level for one folder the user opened.
// Levels are cached per folder and capped (least recently used eviction), so memory stays bounded
// even after browsing for a long time. A folder that cannot be read becomes a locked level rather
// than a thrown error, so the rest of the tree keeps working.
import { useCallback, useEffect, useRef, useState } from "react";
import { explorerApi, type ExplorerEntry, type ExplorerListing } from "../../api/explorer";
import { parentFolder, type ExplorerRootSource } from "./root";

/** One folder level, as the panel renders it. */
export interface ExplorerLevelState {
  listing: ExplorerListing | null;
  loading: boolean;
  /** True when this folder itself could not be read; it is shown locked, not thrown (R2). */
  locked: boolean;
}

const EMPTY_LEVEL: ExplorerLevelState = { listing: null, loading: false, locked: false };

/** Keep at most this many expanded folder levels cached; older ones are evicted (A1/USR-003). */
export const MAX_CACHED_LEVELS = 100;

export interface ExploreOptions {
  /** The folder to browse; null when nothing applies, so no request is made (R13). */
  root: string | null;
  /** "misc" and "home" roots climb with Up; an "app" root is the top folder and offers no Up (R4, R5, R13). */
  source?: ExplorerRootSource;
  /**
   * Changes when the view, selected app or active tab changes. Any Up navigation is discarded and
   * the explorer returns to the automatic root (R4, R5). Defaults to the root itself.
   */
  resetKey?: string;
}

export interface ExplorerController {
  /** The folder on screen, or null when nothing applies. */
  currentRoot: string | null;
  /** True when the drive list is shown (the level above a drive root). */
  atDrives: boolean;
  showHidden: boolean;
  /** Turn the hidden build/VCS names on or off; any level shown is refreshed (R2). */
  setShowHidden: (show: boolean) => void;
  /** True for Misc and home roots, so an app-rooted explorer keeps the app root as its top (R4, R13). */
  canGoUp: boolean;
  /** Climb one folder, or to the drive list from a drive root (R5, R13). */
  up: () => void;
  /** Browse a drive chosen from the drive list. */
  openDrive: (drive: ExplorerEntry) => void;
  /** The current root folder's level. */
  rootLevel: ExplorerLevelState;
  /** The drive list, loaded only while it is shown. */
  drives: ExplorerEntry[];
  drivesLoading: boolean;
  isExpanded: (path: string) => boolean;
  toggleFolder: (path: string) => void;
  /** The loaded level for an expanded folder, if any. */
  levelOf: (path: string) => ExplorerLevelState;
  /** Ask for a folder's children; called the first time it is shown expanded (R2). */
  ensure: (path: string) => void;
  /** Re-read the levels on screen without changing the root. */
  refresh: () => void;
  /**
   * Re-read one folder level after a file operation; only the affected folder is asked for again,
   * never every folder on screen (R9).
   */
  reloadFolder: (path: string) => void;
  /** Drop cached levels at or under an item that was renamed, moved or deleted (R9). */
  forgetUnder: (path: string) => void;
}

/** A path split into whole components, so a prefix never matches a sibling (`C:\foo` vs `C:\foobar`). */
function pathParts(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function samePath(a: string, b: string): boolean {
  const left = pathParts(a);
  const right = pathParts(b);
  return left.length === right.length && left.every((part, i) => part.toLowerCase() === right[i].toLowerCase());
}

function withinPath(child: string, parent: string): boolean {
  const childParts = pathParts(child);
  const parentParts = pathParts(parent);
  return (
    childParts.length >= parentParts.length &&
    parentParts.every((part, i) => part.toLowerCase() === childParts[i].toLowerCase())
  );
}

export function useExplorer({ root, source = "none", resetKey }: ExploreOptions): ExplorerController {
  const [currentRoot, setCurrentRoot] = useState<string | null>(root);
  const [atDrives, setAtDrives] = useState(false);
  const [showHidden, setShowHiddenState] = useState(false);
  const [rootLevel, setRootLevel] = useState<ExplorerLevelState>(EMPTY_LEVEL);
  const [drives, setDrives] = useState<ExplorerEntry[]>([]);
  const [drivesLoading, setDrivesLoading] = useState(false);
  const [levels, setLevels] = useState<Record<string, ExplorerLevelState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reloadToken, setReloadToken] = useState(0);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const showHiddenRef = useRef(showHidden);
  showHiddenRef.current = showHidden;
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const rootReq = useRef(0);
  const drivesReq = useRef(0);
  const childReq = useRef<Map<string, number>>(new Map());
  const childSeq = useRef(0);
  const clock = useRef(0);
  const lastUsed = useRef<Map<string, number>>(new Map());

  const touch = useCallback((path: string) => {
    lastUsed.current.set(path, ++clock.current);
  }, []);

  /** Drop the least recently used levels once the cache is over its cap (A1). */
  const prune = useCallback((record: Record<string, ExplorerLevelState>): Record<string, ExplorerLevelState> => {
    const keys = Object.keys(record);
    if (keys.length <= MAX_CACHED_LEVELS) return record;
    keys.sort((a, b) => (lastUsed.current.get(a) ?? 0) - (lastUsed.current.get(b) ?? 0));
    const next = { ...record };
    for (const key of keys.slice(0, keys.length - MAX_CACHED_LEVELS)) {
      delete next[key];
      lastUsed.current.delete(key);
      childReq.current.delete(key);
    }
    return next;
  }, []);

  const clearLevels = useCallback(() => {
    setLevels({});
    childReq.current.clear();
    lastUsed.current.clear();
  }, []);

  // A change of view, selected app, active tab or root discards any temporary Up navigation
  // (R4, R5); the automatic root is shown again.
  const resetSignature = `${resetKey ?? ""}\u0000${root ?? ""}`;
  const lastSignature = useRef(resetSignature);
  useEffect(() => {
    if (lastSignature.current === resetSignature) return;
    lastSignature.current = resetSignature;
    setCurrentRoot(root);
    setAtDrives(false);
    setExpanded({});
    clearLevels();
    setReloadToken((t) => t + 1);
  }, [resetSignature, root, clearLevels]);

  // One directory read per root change, hidden toggle or explicit refresh (R2: one level at a time).
  useEffect(() => {
    if (atDrives || !currentRoot) {
      setRootLevel(EMPTY_LEVEL);
      return;
    }
    const token = ++rootReq.current;
    setRootLevel({ listing: null, loading: true, locked: false });
    explorerApi
      .list(currentRoot, showHidden)
      .then((listing) => {
        if (alive.current && token === rootReq.current) setRootLevel({ listing, loading: false, locked: listing.locked });
      })
      .catch(() => {
        // An unreadable root appears locked instead of raising (R2).
        if (alive.current && token === rootReq.current) setRootLevel({ listing: null, loading: false, locked: true });
      });
  }, [currentRoot, showHidden, atDrives, reloadToken]);

  // The drive list is asked for only while it is on screen (R5).
  useEffect(() => {
    if (!atDrives) return;
    const token = ++drivesReq.current;
    setDrivesLoading(true);
    explorerApi
      .drives()
      .then((list) => {
        if (!alive.current || token !== drivesReq.current) return;
        setDrives(list);
        setDrivesLoading(false);
      })
      .catch(() => {
        if (!alive.current || token !== drivesReq.current) return;
        setDrives([]);
        setDrivesLoading(false);
      });
  }, [atDrives, reloadToken]);

  const loadChildren = useCallback(
    (path: string, show: boolean) => {
      const token = ++childSeq.current;
      childReq.current.set(path, token);
      touch(path);
      setLevels((prev) => prune({ ...prev, [path]: { listing: prev[path]?.listing ?? null, loading: true, locked: false } }));
      explorerApi
        .list(path, show)
        .then((listing) => {
          if (!alive.current || childReq.current.get(path) !== token) return;
          touch(path);
          setLevels((prev) => (prev[path] ? prune({ ...prev, [path]: { listing, loading: false, locked: listing.locked } }) : prev));
        })
        .catch(() => {
          if (!alive.current || childReq.current.get(path) !== token) return;
          touch(path);
          setLevels((prev) => prune({ ...prev, [path]: { listing: null, loading: false, locked: true } }));
        });
    },
    [prune, touch],
  );

  const ensure = useCallback(
    (path: string) => {
      if (childReq.current.has(path) || levelsRef.current[path]?.listing) return;
      loadChildren(path, showHiddenRef.current);
    },
    [loadChildren],
  );

  const toggleFolder = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = { ...prev };
      if (next[path]) delete next[path];
      else next[path] = true;
      return next;
    });
  }, []);

  const reloadShown = useCallback(
    (show: boolean) => {
      clearLevels();
      for (const path of Object.keys(expandedRef.current)) loadChildren(path, show);
      setReloadToken((t) => t + 1);
    },
    [clearLevels, loadChildren],
  );

  const setShowHidden = useCallback(
    (show: boolean) => {
      if (show === showHiddenRef.current) return;
      showHiddenRef.current = show;
      setShowHiddenState(show);
      reloadShown(show);
    },
    [reloadShown],
  );

  const refresh = useCallback(() => reloadShown(showHiddenRef.current), [reloadShown]);

  // After an operation only the folder it touched is read again (R9): the root gets a fresh read,
  // an expanded child is reloaded in place, and any level that was not shown is left alone.
  const reloadFolder = useCallback(
    (path: string) => {
      if (atDrives) return;
      if (currentRoot && samePath(path, currentRoot)) {
        setReloadToken((t) => t + 1);
        return;
      }
      const known = levelsRef.current[path];
      if (known?.listing || expandedRef.current[path]) loadChildren(path, showHiddenRef.current);
    },
    [atDrives, currentRoot, loadChildren],
  );

  // A renamed, moved or deleted item's own cached level is no longer the truth; forget it and
  // anything cached below it so the tree cannot keep showing the old subtree (R9).
  const forgetUnder = useCallback((path: string) => {
    setLevels((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (withinPath(key, path)) {
          delete next[key];
          childReq.current.delete(key);
          lastUsed.current.delete(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setExpanded((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (withinPath(key, path)) {
          changed = true;
          continue;
        }
        next[key] = value;
      }
      return changed ? next : prev;
    });
  }, []);

  const canGoUp = (source === "misc" || source === "home") && !atDrives;
  const up = useCallback(() => {
    if ((source !== "misc" && source !== "home") || atDrives) return;
    const parent = currentRoot ? parentFolder(currentRoot) : null;
    if (parent) setCurrentRoot(parent);
    else setAtDrives(true);
  }, [source, atDrives, currentRoot]);

  const openDrive = useCallback((drive: ExplorerEntry) => {
    setCurrentRoot(drive.path);
    setAtDrives(false);
  }, []);

  const isExpanded = useCallback((path: string) => !!expanded[path], [expanded]);
  const levelOf = useCallback(
    (path: string) => {
      touch(path);
      return levels[path] ?? EMPTY_LEVEL;
    },
    [levels, touch],
  );

  return {
    currentRoot,
    atDrives,
    showHidden,
    setShowHidden,
    canGoUp,
    up,
    openDrive,
    rootLevel,
    drives,
    drivesLoading,
    isExpanded,
    toggleFolder,
    levelOf,
    ensure,
    refresh,
    reloadFolder,
    forgetUnder,
  };
}
