export type AppShortcutId = "toggleSidebar" | "toggleApp" | "commandPalette" | "toggleTheme";

export interface AppShortcut {
  id: AppShortcutId;
  label: string;
  /** How the shortcut is written in the UI, e.g. "Ctrl+B". */
  keys: string;
}

/** The one list of app-level shortcuts, shared by the window handler, the terminal and the palette. */
export const APP_SHORTCUTS: readonly AppShortcut[] = [
  { id: "toggleSidebar", label: "Toggle sidebar", keys: "Ctrl+B" },
  { id: "toggleApp", label: "Start all / Stop all", keys: "F5" },
  { id: "commandPalette", label: "Open command palette", keys: "Ctrl+Shift+P" },
  { id: "toggleTheme", label: "Switch light/dark theme", keys: "Ctrl+Alt+T" },
];

/** The display label for a shortcut, for the palette and the plan. */
export function shortcutKeys(id: AppShortcutId): string {
  return APP_SHORTCUTS.find((s) => s.id === id)?.keys ?? "";
}

/** The parts of a keyboard event both a DOM listener and xterm's handler provide. */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Which app shortcut, if any, a key event means. Ctrl+B toggles the sidebar, every F5 variant
 * is the app's Start all / Stop all toggle (F5 never refreshes), Ctrl+Shift+P opens the palette
 * and Ctrl+Alt+T switches the theme. The editor's own Ctrl+S/N/O/W are deliberately not matched.
 */
export function matchShortcut(e: KeyEventLike): AppShortcutId | null {
  const k = e.key.toLowerCase();
  if (e.ctrlKey && !e.shiftKey && !e.altKey && k === "b") return "toggleSidebar";
  if (e.key === "F5") return "toggleApp";
  if (e.ctrlKey && e.shiftKey && !e.altKey && k === "p") return "commandPalette";
  if (e.ctrlKey && e.altKey && !e.shiftKey && k === "t") return "toggleTheme";
  return null;
}

/**
 * True when the key belongs to the app rather than to a focused terminal. TerminalHost uses
 * this to hand the event back to the window; every other key goes to the shell.
 */
export function isAppShortcut(e: KeyEventLike): boolean {
  return matchShortcut(e) !== null;
}
