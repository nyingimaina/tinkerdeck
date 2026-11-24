// The themes that ship with the app. Tinkerdeck (graphite, bone, rose and brass: the colours of the
// icon) is the default; Classic is the blue look of earlier versions.
import type { Theme, ThemeKind } from "./types";

export const DEFAULT_THEME_ID = "tinkerdeck-dark";

const tinkerdeckDark: Theme = {
  id: "tinkerdeck-dark",
  name: "Tinkerdeck Dark",
  kind: "dark",
  source: "builtin",
  ui: {
    bg: "#14161a",
    panel: "#1b1e23",
    panel2: "#252930",
    border: "#363b44",
    text: "#ece8dc",
    muted: "#a0a4ab",
    hover: "#2c3139",
    accent: "#facc15",
    onAccent: "#14110a",
    green: "#5fd08f",
    amber: "#f5b942",
    red: "#f87171",
    grey: "#8a8f98",
    termBg: "#101215",
    termFg: "#ece8dc",
  },
  terminal: {
    background: "#101215",
    foreground: "#ece8dc",
    cursor: "#facc15",
    selection: "#4b4526",
    ansi: [
      "#1b1e23", "#f87171", "#5fd08f", "#facc15", "#7aa2d6", "#e58fb0", "#6fc3bd", "#d9d4c5",
      "#5c626c", "#ff8f8f", "#86e3ac", "#fde047", "#9dbce6", "#f2a9c4", "#92d9d3", "#f7f3e6",
    ],
  },
  syntax: {
    comment: "#7c828b",
    keyword: "#fb7185",
    string: "#f3d36a",
    number: "#7cc7c0",
    constant: "#7cc7c0",
    function: "#f3ecd6",
    type: "#cbd5e1",
    variable: "#ece8dc",
    property: "#d8d2bf",
    operator: "#a0a4ab",
    tag: "#fb7185",
    attribute: "#f3d36a",
  },
};

const tinkerdeckLight: Theme = {
  id: "tinkerdeck-light",
  name: "Tinkerdeck Light",
  kind: "light",
  source: "builtin",
  ui: {
    bg: "#f4f1ea",
    panel: "#fffdf7",
    panel2: "#ece7da",
    border: "#d6cfbb",
    text: "#1f2328",
    muted: "#5d6168",
    hover: "#e6e0d0",
    accent: "#8a6200",
    onAccent: "#ffffff",
    green: "#1f8f4f",
    amber: "#b36b00",
    red: "#c0392b",
    grey: "#6b7078",
    termBg: "#fffdf7",
    termFg: "#1f2328",
  },
  terminal: {
    background: "#fffdf7",
    foreground: "#1f2328",
    cursor: "#8a6200",
    selection: "#eadfae",
    ansi: [
      "#1f2328", "#c0392b", "#1f8f4f", "#9a7400", "#2f6db5", "#a3407a", "#1b8a86", "#8c8f96",
      "#4a4f57", "#d9534f", "#2fae65", "#b58100", "#4a8ad4", "#bf5c94", "#2aa5a0", "#b9b5a8",
    ],
  },
  syntax: {
    comment: "#7a7e85",
    keyword: "#be123c",
    string: "#7a5800",
    number: "#1b7a76",
    constant: "#1b7a76",
    function: "#2f5f8f",
    type: "#5a5f68",
    variable: "#1f2328",
    property: "#4a4f57",
    operator: "#6b7078",
    tag: "#be123c",
    attribute: "#7a5800",
  },
};

const classicDark: Theme = {
  id: "classic-dark",
  name: "Classic Dark",
  kind: "dark",
  source: "builtin",
  ui: {
    bg: "#0b1020",
    panel: "#111833",
    panel2: "#172044",
    border: "#243058",
    text: "#e6ebff",
    muted: "#8d98c4",
    hover: "#1b2550",
    accent: "#38bdf8",
    onAccent: "#04121f",
    green: "#22c55e",
    amber: "#f59e0b",
    red: "#ef4444",
    grey: "#8b93a7",
    termBg: "#070b18",
    termFg: "#d7defa",
  },
  terminal: {
    background: "#070b18",
    foreground: "#d7defa",
    cursor: "#38bdf8",
    selection: "#2a3a78",
    ansi: [
      "#1b2140", "#ef4444", "#22c55e", "#f59e0b", "#60a5fa", "#c084fc", "#22d3ee", "#d7defa",
      "#5d6892", "#f87171", "#4ade80", "#fbbf24", "#93c5fd", "#d8b4fe", "#67e8f9", "#ffffff",
    ],
  },
  syntax: {
    comment: "#7f8bb3",
    keyword: "#c084fc",
    string: "#86efac",
    number: "#fdba74",
    constant: "#fdba74",
    function: "#7dd3fc",
    type: "#fcd34d",
    variable: "#e6ebff",
    property: "#bae6fd",
    operator: "#94a3b8",
    tag: "#f87171",
    attribute: "#fcd34d",
  },
};

const classicLight: Theme = {
  id: "classic-light",
  name: "Classic Light",
  kind: "light",
  source: "builtin",
  ui: {
    bg: "#f3f5fb",
    panel: "#ffffff",
    panel2: "#eef1fa",
    border: "#d5dbee",
    text: "#151b33",
    muted: "#5d6892",
    hover: "#e6ebf8",
    accent: "#0b6bcb",
    onAccent: "#ffffff",
    green: "#15803d",
    amber: "#b45309",
    red: "#dc2626",
    grey: "#6b7390",
    termBg: "#ffffff",
    termFg: "#1b2140",
  },
  terminal: {
    background: "#ffffff",
    foreground: "#1b2140",
    cursor: "#0b6bcb",
    selection: "#bcd3f7",
    ansi: [
      "#1b2140", "#dc2626", "#15803d", "#b45309", "#1d4ed8", "#9333ea", "#0e7490", "#6b7390",
      "#4b5563", "#ef4444", "#16a34a", "#d97706", "#3b82f6", "#a855f7", "#0891b2", "#9ca3af",
    ],
  },
  syntax: {
    comment: "#7a84a8",
    keyword: "#9333ea",
    string: "#166534",
    number: "#b45309",
    constant: "#b45309",
    function: "#1d4ed8",
    type: "#a16207",
    variable: "#151b33",
    property: "#0e7490",
    operator: "#5d6892",
    tag: "#dc2626",
    attribute: "#a16207",
  },
};

export const BUILTIN_THEMES: Theme[] = [tinkerdeckDark, tinkerdeckLight, classicDark, classicLight];

export function defaultFor(kind: ThemeKind): Theme {
  return kind === "light" ? tinkerdeckLight : tinkerdeckDark;
}

const PAIRS: Record<string, string> = {
  "tinkerdeck-dark": "tinkerdeck-light",
  "tinkerdeck-light": "tinkerdeck-dark",
  "classic-dark": "classic-light",
  "classic-light": "classic-dark",
};

/** The theme the quick light/dark toggle switches to. */
export function counterpartOf(id: string, imported: Theme[]): Theme | undefined {
  const twin = PAIRS[id];
  if (twin) return BUILTIN_THEMES.find((t) => t.id === twin);
  const current = [...BUILTIN_THEMES, ...imported].find((t) => t.id === id);
  return current ? defaultFor(current.kind === "dark" ? "light" : "dark") : undefined;
}
