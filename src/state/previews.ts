// Which files can be shown rendered (BRS 7.14): html, markdown and svg are text and stay editable
// (Raw and Preview); images and PDFs are preview only.

export type PreviewKind = "html" | "markdown" | "svg" | "image" | "pdf";

const BY_EXT: Record<string, PreviewKind> = {
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  svg: "svg",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  ico: "image",
  avif: "image",
  pdf: "pdf",
};

export function previewKind(name: string): PreviewKind | null {
  const base = (name.split(/[\\/]/).pop() ?? "").toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot > 0 ? (BY_EXT[base.slice(dot + 1)] ?? null) : null;
}

/** Images and PDFs cannot be held as text: they open as preview-only editors. */
export function isBinaryPreview(name: string): boolean {
  const k = previewKind(name);
  return k === "image" || k === "pdf";
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  pdf: "application/pdf",
};

export const mimeOf = (name: string): string => MIME[(name.split(".").pop() ?? "").toLowerCase()] ?? "application/octet-stream";
