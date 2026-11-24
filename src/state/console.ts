// The built-in Console tab: unsaved interactive shells per app (BRS 7.8, 7.10). Mirrors model.rs.
//
// `console-<appId>` is the Console tab group; instances are `console-<appId>:<n>[:<shellId>]`.

const PREFIX = "console-";

/** The Console tab group of an app (never started itself). */
export const consoleId = (appId: string) => `${PREFIX}${appId}`;

export const isConsoleId = (terminalId: string) => terminalId.startsWith(PREFIX) && terminalId.length > PREFIX.length;

export const consoleInstanceId = (appId: string, n: number, shell?: string | null) =>
  `${PREFIX}${appId}:${n}${shell ? `:${shell}` : ""}`;

export interface ConsoleRef {
  appId: string;
  n: number | null;
  shell: string | null;
}

export function parseConsoleId(id: string): ConsoleRef | null {
  if (!isConsoleId(id)) return null;
  const [appId, n, shell] = id.slice(PREFIX.length).split(":");
  if (!appId) return null;
  const num = n === undefined ? null : Number.parseInt(n, 10);
  return { appId, n: Number.isFinite(num as number) ? (num as number) : null, shell: shell || null };
}

export interface ConsoleEntry {
  id: string;
  n: number;
  shell: string | null;
}

/** Next free number for an app's consoles (1-based, never reuses a live number). */
export function nextConsoleNumber(list: ConsoleEntry[]): number {
  return list.reduce((m, c) => Math.max(m, c.n), 0) + 1;
}

export const consoleTitle = (c: ConsoleEntry) => `Console ${c.n}`;

export type ConsoleExitAction = "restart" | "remove" | "none";

/** Loop guard: an automatic restart is only allowed if the previous one is older than this. */
export const RESTART_GUARD_MS = 3000;

/**
 * What to do when a console's shell ends by itself (`exit`, `logout`, Ctrl+D…), so it can never be
 * left in a dead state: the primary console restarts with a fresh shell, extra consoles close like
 * in VS Code. A shell that dies again right after a restart is left alone with its Restart banner.
 */
export function consoleExitAction(
  prevKind: string | undefined,
  nextKind: string,
  opts: { primary: boolean; msSinceAutoRestart: number },
): ConsoleExitAction {
  if (prevKind !== "running") return "none"; // only a shell that was alive and ended by itself
  if (nextKind !== "exited") return "none"; // Stopped by the user, failed to start, ...
  if (!opts.primary) return "remove";
  return opts.msSinceAutoRestart < RESTART_GUARD_MS ? "none" : "restart";
}
