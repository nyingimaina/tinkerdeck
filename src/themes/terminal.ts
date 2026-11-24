import type { ITheme } from "@xterm/xterm";
import type { Theme } from "./types";

const NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

/** A theme's terminal colours in the form xterm.js wants. */
export function terminalTheme(t: Theme): ITheme {
  const c = t.terminal;
  const out: ITheme = {
    background: c.background,
    foreground: c.foreground,
    cursor: c.cursor,
    cursorAccent: c.background,
    selectionBackground: c.selection,
  };
  if (c.ansi && c.ansi.length >= 16) {
    NAMES.forEach((n, i) => {
      out[n] = c.ansi![i];
      const bright = `bright${n[0].toUpperCase()}${n.slice(1)}` as keyof ITheme;
      (out as Record<string, string>)[bright] = c.ansi![i + 8];
    });
  }
  return out;
}
