// Translating VS Code colour themes (the JSON files extensions ship) into Tinkerdeck themes.
import { contrast, luminance, mix, parseColor, readableOn, solid } from "./colors";
import { defaultFor } from "./builtin";
import type { SyntaxColors, TerminalColors, Theme, ThemeKind, ThemePackage, UiColors } from "./types";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

// ------------------------------------------------------------------ JSON with comments

function stripComments(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
    } else if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end < 0 ? s.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function stripTrailingCommas(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j + 1;
    } else if (c === ",") {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === "}" || s[j] === "]") i++;
      else {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function parseJsonc(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripComments(text.replace(/^﻿/, ""))));
}

// ------------------------------------------------------------------ mapping

const SCOPE_RULES: [string, keyof SyntaxColors][] = [
  ["comment", "comment"],
  ["string", "string"],
  ["constant.numeric", "number"],
  ["constant.language", "constant"],
  ["constant.character", "constant"],
  ["constant", "constant"],
  ["keyword.operator", "operator"],
  ["keyword", "keyword"],
  ["storage", "keyword"],
  ["entity.name.function", "function"],
  ["support.function", "function"],
  ["meta.function-call", "function"],
  ["entity.name.tag", "tag"],
  ["meta.tag", "tag"],
  ["entity.other.attribute-name", "attribute"],
  ["support.type.property-name", "property"],
  ["entity.name.type", "type"],
  ["entity.name.class", "type"],
  ["support.type", "type"],
  ["support.class", "type"],
  ["variable.other.object.property", "property"],
  ["variable.other.property", "property"],
  ["meta.object-literal.key", "property"],
  ["variable", "variable"],
];

function scopeKey(scope: string): keyof SyntaxColors | null {
  const s = scope.trim().split(/\s+/).pop() ?? "";
  for (const [pattern, key] of SCOPE_RULES) if (s === pattern || s.startsWith(pattern + ".")) return key;
  return null;
}

function readSyntax(tokenColors: unknown, fallback: SyntaxColors, over: string): SyntaxColors {
  const out = { ...fallback };
  if (!Array.isArray(tokenColors)) return out;
  for (const rule of tokenColors) {
    if (!isObj(rule) || !isObj(rule.settings)) continue;
    const fg = rule.settings.foreground;
    if (typeof fg !== "string" || !parseColor(fg)) continue;
    const scopes = (Array.isArray(rule.scope) ? rule.scope : [rule.scope]).filter((x): x is string => typeof x === "string").flatMap((x) => x.split(","));
    for (const sc of scopes) {
      const key = scopeKey(sc);
      if (key) out[key] = solid(fg, over);
    }
  }
  return out;
}

const ANSI = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"];

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "theme";

function kindFromType(t: unknown): ThemeKind | undefined {
  if (t === "light" || t === "hc-light" || t === "vs") return "light";
  if (t === "dark" || t === "hc" || t === "hc-black" || t === "vs-dark") return "dark";
  return undefined;
}

interface Options {
  name?: string;
  kind?: ThemeKind;
  salt?: string;
}

function themeFromObject(obj: Json, fileName: string | undefined, opts: Options): Theme {
  if (!("colors" in obj) && !("tokenColors" in obj)) throw new Error("That does not look like a VS Code colour theme.");
  const colors = isObj(obj.colors) ? obj.colors : {};
  const raw = (keys: string[]): string | undefined => keys.map((k) => colors[k]).find((v): v is string => typeof v === "string" && !!parseColor(v));

  const rawBg = raw(["editor.background"]);
  const kind: ThemeKind = opts.kind ?? kindFromType(obj.type) ?? (rawBg && luminance(solid(rawBg, "#000000")) > 0.4 ? "light" : "dark");
  const base = defaultFor(kind);
  const bg = rawBg ? solid(rawBg, base.ui.bg) : base.ui.bg;
  const pick = (keys: string[], over: string): string | undefined => {
    const v = raw(keys);
    return v ? solid(v, over) : undefined;
  };

  let text = pick(["foreground", "editor.foreground"], bg) ?? base.ui.text;
  if (contrast(text, bg) < 4.5) text = readableOn(bg, "#101214", "#f1efe8");
  const panel = pick(["sideBar.background", "editorGroupHeader.tabsBackground", "activityBar.background"], bg) ?? mix(bg, text, 0.04);
  const panel2 = pick(["input.background", "tab.inactiveBackground", "editorWidget.background"], panel) ?? mix(panel, text, 0.07);
  const border = pick(["panel.border", "editorGroup.border", "sideBar.border", "contrastBorder"], bg) ?? mix(bg, text, 0.16);
  const hover = pick(["list.hoverBackground", "toolbar.hoverBackground"], panel) ?? mix(panel, text, 0.09);
  let muted = pick(["descriptionForeground", "sideBarTitle.foreground", "tab.inactiveForeground"], bg) ?? mix(text, bg, 0.42);
  if (contrast(muted, panel) < 3.5) muted = mix(text, bg, 0.3);
  const accent = pick(["button.background", "focusBorder", "textLink.foreground", "progressBar.background", "activityBarBadge.background"], bg) ?? base.ui.accent;
  const termBg = pick(["terminal.background"], bg) ?? bg;
  const termFg = pick(["terminal.foreground"], termBg) ?? text;

  const ui: UiColors = {
    bg,
    panel,
    panel2,
    border,
    text,
    muted,
    hover,
    accent,
    onAccent: readableOn(accent),
    red: pick(["errorForeground", "terminal.ansiRed", "editorError.foreground"], bg) ?? base.ui.red,
    green: pick(["terminal.ansiGreen", "gitDecoration.addedResourceForeground"], bg) ?? base.ui.green,
    amber: pick(["terminal.ansiYellow", "editorWarning.foreground"], bg) ?? base.ui.amber,
    grey: pick(["terminal.ansiBrightBlack"], bg) ?? muted,
    termBg,
    termFg,
  };

  const fallbackAnsi = base.terminal.ansi!;
  const terminal: TerminalColors = {
    background: termBg,
    foreground: termFg,
    cursor: pick(["terminalCursor.foreground"], termBg) ?? accent,
    selection: pick(["terminal.selectionBackground", "editor.selectionBackground"], termBg) ?? mix(termBg, accent, 0.3),
    ansi: Array.from({ length: 16 }, (_, i) => pick([`terminal.ansi${i < 8 ? "" : "Bright"}${ANSI[i % 8]}`], termBg) ?? fallbackAnsi[i]),
  };

  const name = (opts.name ?? (typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : undefined) ?? (fileName ?? "Imported theme").replace(/\.[^.]*$/, "")).trim() || "Imported theme";
  return {
    id: `vsc-${slug(name)}-${hash(`${opts.salt ?? ""}|${name}|${kind}|${bg}`)}`,
    name,
    kind,
    ui,
    terminal,
    syntax: readSyntax(obj.tokenColors, base.syntax, bg),
    source: "vscode",
  };
}

/** Translate one VS Code theme file. Throws an Error that says plainly what is wrong. */
export function importVsCodeTheme(text: string, fileName?: string, opts: Options = {}): Theme {
  let obj: unknown;
  try {
    obj = parseJsonc(text);
  } catch {
    throw new Error("That file is not valid JSON, so it cannot be a VS Code theme.");
  }
  if (!isObj(obj)) throw new Error("That does not look like a VS Code colour theme.");
  if (typeof obj.include === "string") {
    throw new Error("This theme inherits its colours from another file (include). Import the whole extension with Find more themes instead.");
  }
  return themeFromObject(obj, fileName, opts);
}

// ------------------------------------------------------------------ whole extensions

function resolveRel(from: string, rel: string): string | null {
  const parts = from.split("/").slice(0, -1);
  for (const seg of rel.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

function loadMerged(path: string, files: Record<string, string>, seen: Set<string>, depth: number): Json {
  const text = files[path];
  if (text === undefined) throw new Error(`The file ${path} is missing.`);
  const own = parseJsonc(text);
  if (!isObj(own)) throw new Error("not a theme");
  if (typeof own.include === "string" && depth < 5 && !seen.has(path)) {
    seen.add(path);
    const target = resolveRel(path, own.include);
    if (target && files[target] !== undefined && !seen.has(target)) {
      const base = loadMerged(target, files, seen, depth + 1);
      return {
        ...base,
        ...own,
        include: undefined,
        colors: { ...(isObj(base.colors) ? base.colors : {}), ...(isObj(own.colors) ? own.colors : {}) },
        tokenColors: [...(Array.isArray(base.tokenColors) ? base.tokenColors : []), ...(Array.isArray(own.tokenColors) ? own.tokenColors : [])],
        type: own.type ?? base.type,
      };
    }
  }
  return own;
}

/** All the themes of an extension (from the registry or from VS Code's folder). */
export function themesFromPackage(pkg: ThemePackage): Theme[] {
  if (!pkg.themes.length) throw new Error("This extension has no colour themes.");
  const out: Theme[] = [];
  for (const ref of pkg.themes) {
    try {
      const obj = loadMerged(ref.path, pkg.files, new Set(), 0);
      out.push(themeFromObject(obj, undefined, { name: ref.label, kind: kindFromType(ref.uiTheme), salt: ref.path }));
    } catch {
      /* a theme that cannot be read is skipped; the others still install */
    }
  }
  if (!out.length) throw new Error("None of this extension's themes could not be read.");
  return out;
}
