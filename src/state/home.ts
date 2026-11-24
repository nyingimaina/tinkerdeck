import { consoleId } from "./console";
import { isUp, type AppDef, type TermState } from "./model";

export function relativeTime(unixSeconds: number, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  const d = Math.max(0, nowSeconds - unixSeconds);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 30 * 86400) return `${Math.floor(d / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export const RECENT_LIMIT = 8;

export interface HomeSections {
  running: AppDef[];
  favourites: AppDef[];
  recent: AppDef[];
}

/** Running now (any terminal or the console is up), favourites (file order), recent (newest first). */
export function homeSections(
  apps: AppDef[],
  stateOf: (terminalId: string) => TermState,
  consoleIdsOf: (appId: string) => string[] = () => [],
): HomeSections {
  const running = apps.filter(
    (a) => a.terminals.some((t) => isUp(stateOf(t.id))) || isUp(stateOf(consoleId(a.id))) || consoleIdsOf(a.id).some((id) => isUp(stateOf(id))),
  );
  const favourites = apps.filter((a) => a.favourite);
  const recent = apps
    .filter((a) => typeof a.lastOpened === "number")
    .sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
    .slice(0, RECENT_LIMIT);
  return { running, favourites, recent };
}
