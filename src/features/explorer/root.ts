// Which folder the Files explorer shows (R4, R5, R13). Pure and disk-free: it only works out the
// folder, so it can be tested without a window.
//
// - app view: the selected app's root;
// - editor view: the root of the app that owns the active tab, found with the same deepest-root
//   lookup the tab groups use, or that loose (Misc) file's parent folder;
// - home view, no tab or an unsaved tab: no app root or file path applies, so the explorer roots at
//   the user's home folder (R13). Only when the core cannot report a home folder does nothing apply.
import { ownerOf } from "../../state/editorGroups";
import { normalizeSlashes, type AppDef } from "../../state/model";

export type ExplorerView = "home" | "app" | "editor";

/** "app" is an app's root, "misc" a loose file's parent folder, "home" the user's home folder, "none" nothing applies. */
export type ExplorerRootSource = "app" | "misc" | "home" | "none";

export interface ExplorerRoot {
  /** The absolute folder to browse, or null when nothing applies. */
  root: string | null;
  /** The app that owns this root, or null for a Misc root and when nothing applies. */
  appId: string | null;
  source: ExplorerRootSource;
}

export interface ExplorerRootOptions {
  view: ExplorerView;
  apps: Pick<AppDef, "id" | "name" | "root">[];
  selectedAppId: string | null;
  activePath: string | null;
  /** The user's home folder from the core, or null when it cannot be determined (R13, A1). */
  homeFolder?: string | null;
}

const tidy = (path: string) => normalizeSlashes(path).replace(/\\+$/, "");

/** A folder path as the explorer passes it to the core, with a drive root written as "C:\". */
function folderOf(path: string): string {
  const t = tidy(path);
  return /^[a-zA-Z]:$/.test(t) ? `${t}\\` : t;
}

/** True when this is the top of a Windows drive; Up from it shows the drive list (R5). */
export function isDriveRoot(folder: string): boolean {
  return /^[a-zA-Z]:$/.test(tidy(folder));
}

/** The folder one level up, or null at a drive root, where the level above is the drive list (R5). */
export function parentFolder(folder: string): string | null {
  const p = tidy(folder);
  if (!p || /^\\+$/.test(p) || /^[a-zA-Z]:$/.test(p)) return null;
  const cut = p.lastIndexOf("\\");
  if (cut < 0) return null;
  const parent = p.slice(0, cut);
  if (/^[a-zA-Z]:$/.test(parent)) return `${parent}\\`;
  if (/^\\+$/.test(parent)) return null;
  return parent;
}

export function explorerRoot({
  view,
  apps,
  selectedAppId,
  activePath,
  homeFolder = null,
}: ExplorerRootOptions): ExplorerRoot {
  const none: ExplorerRoot = { root: null, appId: null, source: "none" };

  if (view === "app") {
    const app = apps.find((a) => a.id === selectedAppId);
    if (!app) return none;
    const root = folderOf(app.root);
    return root ? { root, appId: app.id, source: "app" } : none;
  }

  if (view === "editor" && activePath) {
    const owner = ownerOf(activePath, apps);
    if (owner) return { root: folderOf(owner.root), appId: owner.id, source: "app" };
    // No app owns it (the Misc group): root at the file's own parent folder, never the home folder.
    const root = parentFolder(activePath);
    return root ? { root, appId: null, source: "misc" } : none;
  }

  // Home view, an editor with no tab, or an unsaved tab: no app root or file path applies, so the
  // explorer roots at the user's home folder (R13), and only when the core cannot report one is
  // nothing shown.
  const home = homeFolder ? folderOf(homeFolder) : null;
  return home ? { root: home, appId: null, source: "home" } : none;
}
