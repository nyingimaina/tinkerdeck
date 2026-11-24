import { describe, expect, it } from "vitest";
import { contrast, luminance, parseColor } from "./colors";
import { BUILTIN_THEMES, counterpartOf, DEFAULT_THEME_ID, defaultFor } from "./builtin";
import type { Theme } from "./types";

const UI_KEYS = ["bg", "panel", "panel2", "border", "text", "muted", "hover", "accent", "onAccent", "green", "amber", "red", "grey", "termBg", "termFg"] as const;
const SYNTAX_KEYS = ["comment", "keyword", "string", "number", "constant", "function", "type", "variable", "property", "operator", "tag", "attribute"] as const;

describe("built-in themes", () => {
  it("makes Tinkerdeck (the icon's graphite, bone, rose and brass) the default", () => {
    expect(DEFAULT_THEME_ID).toBe("tinkerdeck-dark");
    expect(BUILTIN_THEMES[0].id).toBe("tinkerdeck-dark");
    expect(BUILTIN_THEMES.map((t) => t.id)).toEqual(["tinkerdeck-dark", "tinkerdeck-light", "classic-dark", "classic-light"]);
    expect(new Set(BUILTIN_THEMES.map((t) => t.id)).size).toBe(BUILTIN_THEMES.length);
  });

  it("steers clear of the violet and blue gradients associated with AI products", () => {
    for (const t of BUILTIN_THEMES.filter((x) => x.id.startsWith("tinkerdeck"))) {
      for (const k of ["bg", "panel", "accent"] as const) {
        const c = parseColor(t.ui[k])!;
        const violet = c.b > c.r + 25 && c.b > c.g + 25; // clearly blue or violet
        expect(violet, `${t.id}.${k} ${t.ui[k]}`).toBe(false);
      }
    }
  });

  for (const t of BUILTIN_THEMES) {
    describe(t.id, () => {
      it("defines every colour as a valid colour", () => {
        for (const k of UI_KEYS) expect(parseColor(t.ui[k]), `ui.${k}`).not.toBeNull();
        for (const k of SYNTAX_KEYS) expect(parseColor(t.syntax[k]), `syntax.${k}`).not.toBeNull();
        for (const k of ["background", "foreground", "cursor", "selection"] as const) expect(parseColor(t.terminal[k]), `terminal.${k}`).not.toBeNull();
        expect(t.terminal.ansi).toHaveLength(16);
        t.terminal.ansi!.forEach((c) => expect(parseColor(c)).not.toBeNull());
      });

      it("says whether it is dark or light truthfully", () => {
        expect(luminance(t.ui.bg) < 0.35).toBe(t.kind === "dark");
      });

      it("keeps text readable", () => {
        expect(contrast(t.ui.text, t.ui.bg)).toBeGreaterThanOrEqual(7);
        expect(contrast(t.ui.text, t.ui.panel)).toBeGreaterThanOrEqual(7);
        expect(contrast(t.ui.muted, t.ui.panel)).toBeGreaterThanOrEqual(3.5);
        expect(contrast(t.ui.onAccent, t.ui.accent)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.terminal.foreground, t.terminal.background)).toBeGreaterThanOrEqual(7);
        expect(contrast(t.syntax.comment, t.ui.bg)).toBeGreaterThanOrEqual(3);
        expect(contrast(t.syntax.keyword, t.ui.bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.syntax.string, t.ui.bg)).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  it("pairs each dark theme with its light twin", () => {
    expect(counterpartOf("tinkerdeck-dark", [])?.id).toBe("tinkerdeck-light");
    expect(counterpartOf("tinkerdeck-light", [])?.id).toBe("tinkerdeck-dark");
    expect(counterpartOf("classic-dark", [])?.id).toBe("classic-light");
    expect(counterpartOf("classic-light", [])?.id).toBe("classic-dark");
  });

  it("falls back to the default of the other kind for any other theme", () => {
    const imported: Theme = { ...BUILTIN_THEMES[0], id: "vsc-x", name: "X", source: "vscode" };
    expect(counterpartOf("vsc-x", [imported])?.id).toBe("tinkerdeck-light");
    expect(defaultFor("light").id).toBe("tinkerdeck-light");
    expect(defaultFor("dark").id).toBe("tinkerdeck-dark");
  });
});
