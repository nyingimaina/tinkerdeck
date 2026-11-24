import { describe, expect, it } from "vitest";
import { isBinaryPreview, previewKind } from "./previews";

describe("previewKind", () => {
  it("knows which files can be rendered, ignoring case", () => {
    expect(previewKind("index.html")).toBe("html");
    expect(previewKind("PAGE.HTM")).toBe("html");
    expect(previewKind("README.md")).toBe("markdown");
    expect(previewKind("notes.markdown")).toBe("markdown");
    expect(previewKind("logo.svg")).toBe("svg");
    for (const f of ["a.png", "a.jpg", "a.JPEG", "a.gif", "a.webp", "a.bmp", "a.ico", "a.avif"]) expect(previewKind(f), f).toBe("image");
    expect(previewKind("manual.pdf")).toBe("pdf");
  });

  it("has no preview for everything else", () => {
    for (const f of ["a.ts", "a.txt", "a.json", "png", "", "a.png.txt", "Dockerfile"]) expect(previewKind(f), f).toBeNull();
  });

  it("only images and PDFs are preview-only (svg, html and markdown are text and stay editable)", () => {
    expect(isBinaryPreview("a.png")).toBe(true);
    expect(isBinaryPreview("a.pdf")).toBe(true);
    expect(isBinaryPreview("a.svg")).toBe(false);
    expect(isBinaryPreview("a.html")).toBe(false);
    expect(isBinaryPreview("a.md")).toBe(false);
    expect(isBinaryPreview("a.ts")).toBe(false);
  });
});
