import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES, defaultFor } from "./builtin";
import { applyTheme, themeVars } from "./apply";
import { terminalTheme } from "./terminal";

describe("applyTheme", () => {
  it("sets every colour the app's styles use, and the dark or light base", () => {
    const root = document.createElement("div");
    const t = BUILTIN_THEMES[0];
    applyTheme(t, root);
    expect(root.dataset.theme).toBe("dark");
    for (const v of ["--bg", "--panel", "--panel-2", "--border", "--text", "--muted", "--hover", "--accent", "--on-accent", "--green", "--amber", "--red", "--grey", "--term-bg", "--term-fg", "--shadow"]) {
      expect(root.style.getPropertyValue(v), v).not.toBe("");
    }
    expect(root.style.getPropertyValue("--bg")).toBe(t.ui.bg);
    expect(root.style.getPropertyValue("--accent")).toBe(t.ui.accent);
    expect(root.style.getPropertyValue("--on-accent")).toBe(t.ui.onAccent);
  });

  it("switches cleanly from one theme to another", () => {
    const root = document.createElement("div");
    applyTheme(defaultFor("dark"), root);
    applyTheme(defaultFor("light"), root);
    expect(root.dataset.theme).toBe("light");
    expect(root.style.getPropertyValue("--bg")).toBe(defaultFor("light").ui.bg);
  });

  it("uses a heavier shadow on dark themes than light ones", () => {
    const d = themeVars(defaultFor("dark"))["--shadow"];
    const l = themeVars(defaultFor("light"))["--shadow"];
    expect(d).not.toBe(l);
  });
});

describe("terminalTheme", () => {
  it("hands xterm its colours, with the 16 ANSI ones spelled out", () => {
    const t = defaultFor("dark");
    const x = terminalTheme(t);
    expect(x.background).toBe(t.terminal.background);
    expect(x.foreground).toBe(t.terminal.foreground);
    expect(x.cursor).toBe(t.terminal.cursor);
    expect(x.selectionBackground).toBe(t.terminal.selection);
    expect(x.black).toBe(t.terminal.ansi![0]);
    expect(x.red).toBe(t.terminal.ansi![1]);
    expect(x.brightWhite).toBe(t.terminal.ansi![15]);
  });

  it("copes with a theme that gave no ANSI colours", () => {
    const t = { ...defaultFor("dark"), terminal: { ...defaultFor("dark").terminal, ansi: undefined } };
    const x = terminalTheme(t);
    expect(x.background).toBe(t.terminal.background);
    expect(x.red).toBeUndefined();
  });
});
