import { describe, expect, it } from "vitest";
import { APP_SHORTCUTS, isAppShortcut, matchShortcut, shortcutKeys, type KeyEventLike } from "./shortcuts";

const key = (k: string, mods: Partial<Omit<KeyEventLike, "key">> = {}): KeyEventLike => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("app shortcut registry", () => {
  it("R4: maps Ctrl+B, F5, Ctrl+Shift+P and Ctrl+Alt+T to their actions", () => {
    expect(matchShortcut(key("b", { ctrlKey: true }))).toBe("toggleSidebar");
    expect(matchShortcut(key("F5"))).toBe("refresh");
    expect(matchShortcut(key("P", { ctrlKey: true, shiftKey: true }))).toBe("commandPalette");
    expect(matchShortcut(key("t", { ctrlKey: true, altKey: true }))).toBe("toggleTheme");
  });

  it("R4: the palette labels come from the same registry", () => {
    expect(APP_SHORTCUTS.map((s) => [s.id, s.keys])).toEqual([
      ["toggleSidebar", "Ctrl+B"],
      ["refresh", "F5"],
      ["commandPalette", "Ctrl+Shift+P"],
      ["toggleTheme", "Ctrl+Alt+T"],
    ]);
    expect(shortcutKeys("commandPalette")).toBe("Ctrl+Shift+P");
  });

  it("A3: forwards exactly the app shortcuts and leaves shell keys alone", () => {
    for (const e of [
      key("b", { ctrlKey: true }),
      key("F5"),
      key("p", { ctrlKey: true, shiftKey: true }),
      key("t", { ctrlKey: true, altKey: true }),
    ]) {
      expect(isAppShortcut(e)).toBe(true);
    }

    for (const e of [
      key("b"),
      key("c", { ctrlKey: true }),
      key("c", { ctrlKey: true, shiftKey: true }),
      key("v", { ctrlKey: true }),
      key("b", { ctrlKey: true, shiftKey: true }),
      key("s", { ctrlKey: true }),
      key("o", { ctrlKey: true }),
      key("w", { ctrlKey: true }),
    ]) {
      expect(isAppShortcut(e)).toBe(false);
    }
  });

  it("R4: does not claim the editor's Ctrl+O or a near-miss theme chord", () => {
    expect(matchShortcut(key("o", { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key("p", { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key("t", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});
