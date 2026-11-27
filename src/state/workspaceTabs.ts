// Which workspace each open editor belongs to, and which tab a strip shows (R2, R3, R4, A2).
//
// The partition is derived from the existing groupTabs/ownerOf rule: the deepest registered
// workspace root that contains a path wins, the first saved workspace wins a depth tie, and a
// path outside every root (or an unsaved document) has no owner. Because both tab strips read
// this one partition, an editor can only ever be in one strip (R4).
import type { AppDef } from "./model";
import { groupTabs } from "./editorGroups";
import { isConsoleId } from "./console";

export interface EditorTabOwnership<T> {
  /** Open editors per registered workspace id, in the order they were opened. */
  byApp: Record<string, T[]>;
  /** Editors with no workspace home: unowned files and unsaved documents. */
  unowned: T[];
}

/**
 * Split the open editors by owner once: the workspace strips read `byApp` and the global strip
 * reads `unowned`. Workspaces with nothing open are simply absent (look them up with `?? []`).
 */
export function partitionTabs<T extends { path: string | null }>(
  tabs: T[],
  apps: Pick<AppDef, "id" | "name" | "root">[],
): EditorTabOwnership<T> {
  const byApp: Record<string, T[]> = {};
  const unowned: T[] = [];
  for (const group of groupTabs(tabs, apps)) {
    if (group.appId === null) unowned.push(...group.tabs);
    else byApp[group.appId] = group.tabs;
  }
  return { byApp, unowned };
}

export function editorsOf<T>(ownership: EditorTabOwnership<T>, appId: string): T[] {
  return ownership.byApp[appId] ?? [];
}

export interface WorkspaceTabSelection {
  /** The editor tab this workspace last selected (session state), if any. */
  editorId: string | null;
  /** Ids of the editor tabs currently filed under the workspace. */
  editorIds: readonly string[];
  /** The workspace's Console group id, when it has one. */
  consoleTabId?: string;
  /** The launcher's selected terminal, which may be one of the Console's instances. */
  selectedTerminalId: string | null;
}

/**
 * The one value a workspace's strip shows as selected: a still-open editor wins, then the
 * Console group when a Console instance is selected, otherwise the selected terminal (R1).
 */
export function selectedWorkspaceTab({
  editorId,
  editorIds,
  consoleTabId,
  selectedTerminalId,
}: WorkspaceTabSelection): string | null {
  if (editorId && editorIds.includes(editorId)) return editorId;
  if (consoleTabId && selectedTerminalId && isConsoleId(selectedTerminalId)) return consoleTabId;
  return selectedTerminalId ?? null;
}

/**
 * The unowned tab the global view shows: the active one when it really is unowned, else the first
 * unowned tab, so a workspace-owned file is never shown there merely because it was active (A2).
 */
export function globalActiveTab<T extends { id: string }>(unowned: T[], activeId: string | null): string | null {
  if (activeId && unowned.some((t) => t.id === activeId)) return activeId;
  return unowned[0]?.id ?? null;
}
