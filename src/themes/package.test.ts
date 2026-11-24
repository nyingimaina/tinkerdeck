import { describe, expect, it } from "vitest";
import { themesFromPackage } from "./vscode";
import type { ThemePackage } from "./types";

const night = JSON.stringify({ name: "ignored name", colors: { "editor.background": "#101820", "editor.foreground": "#dddddd" }, tokenColors: [{ scope: "comment", settings: { foreground: "#778899" } }] });
const day = JSON.stringify({ include: "./base.json", colors: { "editor.background": "#fafafa" } });
const base = JSON.stringify({ colors: { "editor.foreground": "#222222", "sideBar.background": "#eeeeee" }, tokenColors: [{ scope: "keyword", settings: { foreground: "#aa0000" } }] });

const pkg = (over: Partial<ThemePackage> = {}): ThemePackage => ({
  themes: [
    { label: "Night", uiTheme: "vs-dark", path: "themes/night.json" },
    { label: "Day", uiTheme: "vs", path: "themes/day.json" },
  ],
  files: { "themes/night.json": night, "themes/day.json": day, "themes/base.json": base },
  ...over,
});

describe("themesFromPackage", () => {
  it("turns each theme of an extension into one of ours, named by its label", () => {
    const t = themesFromPackage(pkg());
    expect(t.map((x) => x.name)).toEqual(["Night", "Day"]);
    expect(t.map((x) => x.kind)).toEqual(["dark", "light"]);
    expect(t[0].syntax.comment).toBe("#778899");
    expect(new Set(t.map((x) => x.id)).size).toBe(2);
  });

  it("follows an include to the file beside it, merging colours and token rules", () => {
    const day = themesFromPackage(pkg())[1];
    expect(day.ui.bg).toBe("#fafafa"); // its own
    expect(day.ui.panel).toBe("#eeeeee"); // from the included file
    expect(day.syntax.keyword).toBe("#aa0000");
  });

  it("trusts the extension's own light or dark label over the colours", () => {
    const t = themesFromPackage(pkg({ themes: [{ label: "Odd", uiTheme: "vs", path: "themes/night.json" }] }));
    expect(t[0].kind).toBe("light");
  });

  it("skips a theme that cannot be read and keeps the others", () => {
    const t = themesFromPackage(pkg({ files: { "themes/night.json": night, "themes/day.json": "{ broken" } }));
    expect(t.map((x) => x.name)).toEqual(["Night"]);
  });

  it("says so plainly when nothing in the extension is usable", () => {
    expect(() => themesFromPackage(pkg({ themes: [], files: {} }))).toThrow(/no colour themes/i);
    expect(() => themesFromPackage(pkg({ files: { "themes/night.json": "{ x", "themes/day.json": "{ y" } }))).toThrow(/could not be read|no usable/i);
  });

  it("does not loop forever on files that include each other", () => {
    const a = JSON.stringify({ include: "./b.json", colors: { "editor.background": "#101010" } });
    const b = JSON.stringify({ include: "./a.json" });
    const t = themesFromPackage({ themes: [{ label: "Loop", uiTheme: "vs-dark", path: "t/a.json" }], files: { "t/a.json": a, "t/b.json": b } });
    expect(t).toHaveLength(1);
  });
});
