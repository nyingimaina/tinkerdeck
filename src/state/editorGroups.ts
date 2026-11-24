// Which app an editor belongs to (BRS 7.14): the app whose project folder holds the file.
import type { AppDef } from "./model";

export const MISC = "Misc";

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** The app that owns a path: the deepest app folder that contains it, or null. */
export function ownerOf<A extends Pick<AppDef, "root">>(path: string | null, apps: A[]): A | null {
  if (!path) return null;
  const p = norm(path);
  let best: A | null = null;
  let bestLen = -1;
  for (const a of apps) {
    if (!a.root.trim()) continue;
    const r = norm(a.root);
    if ((p === r || p.startsWith(r + "/")) && r.length > bestLen) {
      best = a;
      bestLen = r.length;
    }
  }
  return best;
}

export interface TabGroup<T> {
  /** App id, or null for Misc. */
  appId: string | null;
  name: string;
  tabs: T[];
}

/** Editors grouped by owning app, in the apps' order; whatever has no owner goes last, under Misc. */
export function groupTabs<T extends { path: string | null }>(tabs: T[], apps: Pick<AppDef, "id" | "name" | "root">[]): TabGroup<T>[] {
  const by = new Map<string | null, T[]>();
  for (const t of tabs) {
    const id = ownerOf(t.path, apps)?.id ?? null;
    by.set(id, [...(by.get(id) ?? []), t]);
  }
  const groups: TabGroup<T>[] = apps.filter((a) => by.has(a.id)).map((a) => ({ appId: a.id, name: a.name, tabs: by.get(a.id)! }));
  if (by.has(null)) groups.push({ appId: null, name: MISC, tabs: by.get(null)! });
  return groups;
}
