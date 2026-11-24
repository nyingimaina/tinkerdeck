import type { Theme } from "./types";

/** The CSS variables the app's styles read (see styles/global.css for the defaults). */
export function themeVars(t: Theme): Record<string, string> {
  const u = t.ui;
  return {
    "--bg": u.bg,
    "--panel": u.panel,
    "--panel-2": u.panel2,
    "--border": u.border,
    "--text": u.text,
    "--muted": u.muted,
    "--hover": u.hover,
    "--accent": u.accent,
    "--on-accent": u.onAccent,
    "--green": u.green,
    "--amber": u.amber,
    "--red": u.red,
    "--grey": u.grey,
    "--term-bg": u.termBg,
    "--term-fg": u.termFg,
    "--shadow": t.kind === "dark" ? "0 10px 30px rgba(0, 0, 0, 0.55)" : "0 10px 30px rgba(60, 50, 30, 0.18)",
  };
}

/** Show a theme: dark or light base plus every colour. Safe to call again to switch. */
export function applyTheme(t: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = t.kind;
  root.style.colorScheme = t.kind;
  for (const [k, v] of Object.entries(themeVars(t))) root.style.setProperty(k, v);
}
