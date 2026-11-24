// Colour themes (BRS 7.16). A theme is plain data so it can be saved, imported and shared.

export type ThemeKind = "dark" | "light";

/** The colours the app's own interface uses (one CSS variable each, see apply.ts). */
export interface UiColors {
  bg: string;
  panel: string;
  panel2: string;
  border: string;
  text: string;
  muted: string;
  hover: string;
  accent: string;
  /** Text drawn on an accent-coloured button. */
  onAccent: string;
  green: string;
  amber: string;
  red: string;
  grey: string;
  termBg: string;
  termFg: string;
}

export interface TerminalColors {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  /** The 16 ANSI colours: black, red, green, yellow, blue, magenta, cyan, white, then the bright ones. */
  ansi?: string[];
}

export interface SyntaxColors {
  comment: string;
  keyword: string;
  string: string;
  number: string;
  constant: string;
  function: string;
  type: string;
  variable: string;
  property: string;
  operator: string;
  tag: string;
  attribute: string;
}

export interface Theme {
  id: string;
  name: string;
  kind: ThemeKind;
  ui: UiColors;
  terminal: TerminalColors;
  syntax: SyntaxColors;
  source: "builtin" | "vscode";
}

/** A theme-bearing extension found online or on this PC. */
export interface GalleryEntry {
  id: string;
  name: string;
  publisher: string;
  description: string;
  downloads: number;
  version: string;
  icon: string | null;
  source: "online" | "local";
  /** online: `publisher/name`; local: the extension's folder */
  location: string;
}

export interface ThemePackage {
  themes: { label: string; uiTheme: string; path: string }[];
  files: Record<string, string>;
}
