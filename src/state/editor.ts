// Types and small helpers for the text editor (BRS 7.14).

export const IDLE_DAYS = 7;
export const BIN_DAYS = 30;
const DAY = 86400;

/** One remembered editor, as the backend stores it. */
export interface EditorEntry {
  id: string;
  path: string | null;
  title: string;
  dirty: boolean;
  eol: string;
  encoding: string;
  lastUsed: number;
  binnedAt: number | null;
}

/** An editor with its text. */
export interface EditorDoc {
  id: string;
  path: string | null;
  title: string;
  content: string;
  dirty: boolean;
  eol: string;
  encoding: string;
}

export interface EditorListing {
  open: EditorEntry[];
  bin: EditorEntry[];
}

/** Whole days before a binned editor is forgotten. */
export function binDaysLeft(binnedAt: number | null, nowSecs: number): number {
  if (binnedAt == null) return BIN_DAYS;
  return Math.max(0, BIN_DAYS - Math.floor((nowSecs - binnedAt) / DAY));
}

export const eolLabel = (eol: string) => (eol === "crlf" ? "Windows (CRLF)" : "Unix (LF)");

export function encodingLabel(encoding: string): string {
  switch (encoding) {
    case "utf-8":
      return "UTF-8";
    case "utf-8-bom":
      return "UTF-8 with BOM";
    case "utf-16le":
      return "UTF-16 LE";
    case "utf-16be":
      return "UTF-16 BE";
    case "latin1":
      return "Latin-1";
    default:
      return encoding;
  }
}
