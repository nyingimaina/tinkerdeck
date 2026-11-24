import { describe, expect, it } from "vitest";
import { importVsCodeTheme } from "./vscode";
import { contrast, parseColor } from "./colors";

const sample = `{
  // a comment, as VS Code allows in theme files
  "name": "Night Owl Lite",
  "type": "dark",
  "colors": {
    "editor.background": "#011627",
    "editor.foreground": "#d6deeb",
    "foreground": "#d6deebcc",
    "sideBar.background": "#010e1a",
    "input.background": "#0b2942",
    "panel.border": "#5f7e97",
    "list.hoverBackground": "#011627cc",
    "button.background": "#7e57c2",
    "descriptionForeground": "#7a8fa6",
    "errorForeground": "#ef5350",
    "terminal.background": "#01111d",
    "terminal.foreground": "#d6deeb",
    "terminal.ansiBlack": "#011627",
    "terminal.ansiRed": "#ef5350",
    "terminal.ansiGreen": "#22da6e",
    "terminal.ansiYellow": "#c5e478",
    "terminal.ansiBlue": "#82aaff",
    "terminal.ansiMagenta": "#c792ea",
    "terminal.ansiCyan": "#21c7a8",
    "terminal.ansiWhite": "#ffffff",
    "terminal.ansiBrightBlack": "#575656",
    "terminal.ansiBrightRed": "#ef5350",
    "terminal.ansiBrightGreen": "#22da6e",
    "terminal.ansiBrightYellow": "#ffeb95",
    "terminal.ansiBrightBlue": "#82aaff",
    "terminal.ansiBrightMagenta": "#c792ea",
    "terminal.ansiBrightCyan": "#7fdbca",
    "terminal.ansiBrightWhite": "#ffffff",
    "terminalCursor.foreground": "#80a4c2",
  },
  "tokenColors": [
    { "scope": "comment", "settings": { "foreground": "#637777", "fontStyle": "italic" } },
    { "scope": ["keyword", "storage.type"], "settings": { "foreground": "#c792ea" } },
    { "scope": "string, string.quoted", "settings": { "foreground": "#ecc48d" } },
    { "scope": "constant.numeric", "settings": { "foreground": "#f78c6c" } },
    { "scope": "entity.name.function", "settings": { "foreground": "#82aaff" } },
    { "scope": "entity.name.tag", "settings": { "foreground": "#caece6" } },
  ],
}`;

describe("importVsCodeTheme", () => {
  it("reads a theme file with comments and trailing commas", () => {
    const t = importVsCodeTheme(sample);
    expect(t.name).toBe("Night Owl Lite");
    expect(t.source).toBe("vscode");
    expect(t.kind).toBe("dark");
    expect(t.id).toMatch(/^vsc-night-owl-lite-[0-9a-f]{4,}$/);
  });

  it("maps the workbench colours onto the app's", () => {
    const t = importVsCodeTheme(sample);
    expect(t.ui.bg).toBe("#011627");
    expect(t.ui.panel).toBe("#010e1a");
    expect(t.ui.panel2).toBe("#0b2942");
    expect(t.ui.border).toBe("#5f7e97");
    expect(t.ui.accent).toBe("#7e57c2");
    expect(t.ui.muted).toBe("#7a8fa6");
    expect(t.ui.red).toBe("#ef5350");
    expect(t.ui.green).toBe("#22da6e");
    expect(t.ui.termBg).toBe("#01111d");
  });

  it("flattens translucent colours over the background, so nothing ends up see-through", () => {
    const t = importVsCodeTheme(sample);
    expect(t.ui.hover).toMatch(/^#[0-9a-f]{6}$/);
    expect(t.ui.text).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseColor(t.ui.text)?.a).toBe(1);
  });

  it("chooses text that can be read on the accent colour", () => {
    const t = importVsCodeTheme(sample);
    expect(contrast(t.ui.onAccent, t.ui.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("carries the terminal palette over, in the standard order", () => {
    const t = importVsCodeTheme(sample);
    expect(t.terminal.background).toBe("#01111d");
    expect(t.terminal.foreground).toBe("#d6deeb");
    expect(t.terminal.cursor).toBe("#80a4c2");
    expect(t.terminal.ansi).toHaveLength(16);
    expect(t.terminal.ansi![1]).toBe("#ef5350"); // red
    expect(t.terminal.ansi![4]).toBe("#82aaff"); // blue
    expect(t.terminal.ansi![8]).toBe("#575656"); // bright black
    expect(t.terminal.ansi![15]).toBe("#ffffff");
  });

  it("translates syntax colours from token scopes, whichever way they are written", () => {
    const t = importVsCodeTheme(sample);
    expect(t.syntax.comment).toBe("#637777");
    expect(t.syntax.keyword).toBe("#c792ea");
    expect(t.syntax.string).toBe("#ecc48d");
    expect(t.syntax.number).toBe("#f78c6c");
    expect(t.syntax.function).toBe("#82aaff");
    expect(t.syntax.tag).toBe("#caece6");
  });

  it("lets a later rule win over an earlier one", () => {
    const t = importVsCodeTheme(
      JSON.stringify({
        colors: { "editor.background": "#000000" },
        tokenColors: [
          { scope: "string", settings: { foreground: "#111111" } },
          { scope: "string.quoted", settings: { foreground: "#222222" } },
        ],
      }),
    );
    expect(t.syntax.string).toBe("#222222");
  });

  it("fills whatever a theme leaves out from sensible defaults", () => {
    const t = importVsCodeTheme(JSON.stringify({ name: "Bare", colors: { "editor.background": "#101010" } }));
    expect(t.ui.text).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrast(t.ui.text, t.ui.bg)).toBeGreaterThanOrEqual(7);
    expect(t.terminal.ansi).toHaveLength(16);
    expect(parseColor(t.syntax.keyword)).not.toBeNull();
  });

  it("works out light or dark from the background when the type is missing, and honours the type when given", () => {
    expect(importVsCodeTheme(JSON.stringify({ colors: { "editor.background": "#fafafa" } })).kind).toBe("light");
    expect(importVsCodeTheme(JSON.stringify({ colors: { "editor.background": "#101010" } })).kind).toBe("dark");
    expect(importVsCodeTheme(JSON.stringify({ type: "light", colors: { "editor.background": "#101010" } })).kind).toBe("light");
    expect(importVsCodeTheme(JSON.stringify({ type: "hc", colors: { "editor.background": "#000000" } })).kind).toBe("dark");
  });

  it("falls back to the file name when the theme has no name", () => {
    const t = importVsCodeTheme(JSON.stringify({ colors: { "editor.background": "#000000" } }), "solarized-dark-color-theme.json");
    expect(t.name).toBe("solarized-dark-color-theme");
  });

  it("gives different themes different ids and the same theme the same id", () => {
    const a = importVsCodeTheme(sample);
    const b = importVsCodeTheme(sample.replace("Night Owl Lite", "Other"));
    expect(a.id).not.toBe(b.id);
    expect(importVsCodeTheme(sample).id).toBe(a.id);
  });

  it("says plainly what is wrong with a file that is not a theme", () => {
    expect(() => importVsCodeTheme("{ not json")).toThrow(/not valid JSON/i);
    expect(() => importVsCodeTheme("[1,2]")).toThrow(/VS Code colour theme/i);
    expect(() => importVsCodeTheme(JSON.stringify({ name: "x" }))).toThrow(/VS Code colour theme/i);
    expect(() => importVsCodeTheme("")).toThrow();
  });

  it("explains a theme that only inherits from another file", () => {
    expect(() => importVsCodeTheme(JSON.stringify({ include: "./dark_defaults.json", tokenColors: [] }))).toThrow(/include|another file/i);
  });
});
