// Vitest runs these files in Node, but the app's browser build has no Node types.
// @ts-expect-error node:fs is available test-time only
import { readFileSync } from "node:fs";
// @ts-expect-error node:path is available test-time only
import { join } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

// Reading the stylesheet raw keeps this independent of jsdom's lack of layout (R10).
const css = readFileSync(join(process.cwd(), "src/features/command-palette/CommandPalette.module.css"), "utf8");

const base = css.split(/@media/)[0] ?? "";
const media = css.slice(css.indexOf("@media"));

const rule = (source: string, selector: string): string =>
  new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? "";

const declaration = (block: string, property: string): string =>
  new RegExp(`${property}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim() ?? "";

describe("the command palette layout (R10)", () => {
  it("R10: the mobile-first base fills the width, sits at the top and is viewport-bounded", () => {
    const backdrop = rule(base, "backdrop");
    const panel = rule(base, "panel");
    expect(declaration(panel, "width")).toBe("100%");
    expect(declaration(panel, "max-height")).toBe("100dvh");
    expect(backdrop).toContain("place-items: start stretch");
    // The desktop top gap and the centred 560px panel live only in the desktop block.
    expect(base).not.toContain("12vh");
    expect(base).not.toContain("min(560px");
  });

  it("R10: a desktop media query restores the current centred 560px palette", () => {
    expect(media).toContain("@media (min-width:");
    const backdrop = rule(media, "backdrop");
    const panel = rule(media, "panel");
    expect(backdrop).toContain("place-items: start center");
    expect(declaration(backdrop, "padding")).toContain("12vh");
    expect(declaration(panel, "width")).toBe("min(560px, 100%)");
    expect(declaration(panel, "max-height")).toBe("60vh");
  });

  it("R10: a long command label truncates inside the panel instead of overflowing it", () => {
    const item = rule(css, "item");
    const label = rule(css, "label");
    expect(declaration(item, "width")).toBe("100%");
    expect(declaration(label, "min-width")).toBe("0");
    expect(declaration(label, "overflow")).toBe("hidden");
    expect(declaration(label, "text-overflow")).toBe("ellipsis");
    expect(declaration(label, "white-space")).toBe("nowrap");
  });
});
