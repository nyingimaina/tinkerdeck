// The explorer's create, rename and delete prompts (R9, A1, A2). They reuse the shipped responsive
// Dialog (a jattac side pane) so a small window gets the same fit as every other dialog.
//
// A name is checked here before anything is sent to the core, so an empty, whitespace-only, too
// long or Windows-invalid name is refused with a message and no file-system call (A2). The core
// checks again, so the same rules hold even if this prompt is bypassed.
import { useEffect, useRef, useState } from "react";
import type { ExplorerEntry, ExplorerItemKind } from "../../api/explorer";
import { Dialog } from "../apps/Dialog";
import styles from "./ExplorerPanel.module.css";

/** Which prompt is open, if any. */
export type ExplorerPrompt =
  | { kind: "create"; parent: string; item: ExplorerItemKind }
  | { kind: "rename"; entry: ExplorerEntry }
  | { kind: "delete"; entry: ExplorerEntry; dirtyTitles: string[] };

const MAX_NAME_LEN = 255;

/** Windows device names that cannot be used for a file or folder, matching the core's list. */
const RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/**
 * The first problem with a name, or null when it is usable (A2). The wording matches the core so
 * the user sees one message whether the window or the core refused it.
 */
export function validateExplorerName(name: string): string | null {
  if (name.trim().length === 0) return "A name is required.";
  if (name !== name.trim()) return "A name cannot start or end with a space.";
  if ([...name].length > MAX_NAME_LEN) return `A name can be at most ${MAX_NAME_LEN} characters.`;
  if (/[\u0000-\u001f<>:"/\\|?*]/.test(name)) return 'A name cannot contain any of < > : " / \\ | ? *.';
  if (name.endsWith(".")) return "A name cannot end with a dot.";
  const stem = name.split(".")[0].replace(/ +$/, "").toUpperCase();
  if (RESERVED_NAMES.has(stem)) return `The name "${name}" is reserved by Windows.`;
  return null;
}

export interface ExplorerDialogsProps {
  prompt: ExplorerPrompt | null;
  busy: boolean;
  /** Called with the name for a create or rename, and with "" for a delete. */
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

function listTitles(titles: string[]): string {
  if (titles.length <= 3) return titles.join(", ");
  return `${titles.slice(0, 3).join(", ")} and ${titles.length - 3} more`;
}

export function ExplorerDialogs({ prompt, busy, onSubmit, onCancel }: ExplorerDialogsProps) {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!prompt) return;
    setName(prompt.kind === "rename" ? prompt.entry.name : "");
    setProblem(null);
    if (prompt.kind !== "delete") input.current?.focus();
  }, [prompt]);

  if (!prompt) return null;

  if (prompt.kind === "delete") {
    return (
      <Dialog
        title={`Delete ${prompt.entry.name}?`}
        actions={[
          { label: busy ? "Deleting…" : "Delete", kind: "danger", onClick: () => !busy && onSubmit("") },
          { label: "Cancel", onClick: onCancel },
        ]}
      >
        <p>
          Delete <strong>{prompt.entry.name}</strong>?
        </p>
        {prompt.entry.isDir && <p>Everything inside this folder goes with it.</p>}
        {prompt.dirtyTitles.length > 0 && (
          <p className={styles.warning}>
            These open files have unsaved changes: {listTitles(prompt.dirtyTitles)}.
          </p>
        )}
        <p className={styles.note}>The item goes to the Recycle Bin, where it can be restored.</p>
      </Dialog>
    );
  }

  const title = prompt.kind === "rename" ? "Rename" : prompt.item === "folder" ? "New folder" : "New file";
  const submitLabel = prompt.kind === "rename" ? "Rename" : "Create";

  const submit = () => {
    if (busy) return;
    const found = validateExplorerName(name);
    if (found) {
      setProblem(found);
      return;
    }
    setProblem(null);
    onSubmit(name);
  };

  return (
    <Dialog
      title={title}
      actions={[
        { label: busy ? "Working…" : submitLabel, onClick: submit },
        { label: "Cancel", onClick: onCancel },
      ]}
    >
      <label className={styles.label}>
        <span>{prompt.kind === "rename" ? "New name" : "Name"}</span>
        <input
          ref={input}
          className={styles.input}
          aria-label="Name"
          value={name}
          disabled={busy}
          onChange={(e) => {
            setName(e.target.value);
            if (problem) setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </label>
      {problem && (
        <p className={styles.fieldError} role="alert">
          {problem}
        </p>
      )}
    </Dialog>
  );
}
