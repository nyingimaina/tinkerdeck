import { useEffect, useRef, useState } from "react";
import styles from "./UtilitiesMenu.module.css";

interface Props {
  editorActive: boolean;
  onEditor: () => void;
  onCheckUpdates: () => void;
  updatesBusy: boolean;
  /** Non-null when an update is waiting, so it stays noticeable even though Updates is hidden. */
  updateAvailable: string | null;
  onRefresh: () => void;
  onHelp: () => void;
}

/**
 * The Utilities group: advanced or rarely used commands behind one menu. Hidden until
 * opened, and hidden again on choose, Escape or a click outside. The update version shows
 * on the trigger so an available update is still noticeable.
 */
export function UtilitiesMenu({ editorActive, onEditor, onCheckUpdates, updatesBusy, updateAvailable, onRefresh, onHelp }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className={styles.menu} ref={box} role="group" aria-label="Utilities">
      <button
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={updateAvailable ? `Utilities, update ${updateAvailable} available` : "Utilities"}
        title="Utilities"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
        {updateAvailable && (
          <span className={styles.badge} aria-hidden="true">
            ●
          </span>
        )}
      </button>
      {open && (
        <div role="menu" aria-label="Utilities" className={styles.popup}>
          <button role="menuitem" aria-label="Editor" onClick={() => run(onEditor)}>
            <span aria-hidden="true">✎</span> Editor{editorActive ? " ✓" : ""}
          </button>
          <button role="menuitem" aria-label="Check for updates" disabled={updatesBusy} onClick={() => run(onCheckUpdates)}>
            <span aria-hidden="true">⬆</span> {updatesBusy ? "Checking…" : "Check for updates"}
            {updateAvailable && ` (${updateAvailable})`}
          </button>
          <button role="menuitem" aria-label="Refresh everything" onClick={() => run(onRefresh)}>
            <span aria-hidden="true">⟳</span> Refresh <kbd>F5</kbd>
          </button>
          <button role="menuitem" aria-label="Help" onClick={() => run(onHelp)}>
            <span aria-hidden="true">?</span> Help
          </button>
        </div>
      )}
    </div>
  );
}
