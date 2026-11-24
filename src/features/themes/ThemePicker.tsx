import { useEffect, useRef, useState } from "react";
import type { Theme } from "../../themes/types";
import styles from "./Themes.module.css";

interface Props {
  themes: Theme[];
  activeId: string;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  /** Import a VS Code theme file. Resolves to an error message, or null when it worked. */
  onImportText: (text: string, fileName: string) => Promise<string | null>;
  onFind: () => void;
}

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });

/** Header menu: pick a theme, import a VS Code theme file, or find more. */
export function ThemePicker({ themes, activeId, onSelect, onRemove, onImportText, onFind }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

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

  const builtin = themes.filter((t) => t.source === "builtin");
  const imported = themes.filter((t) => t.source !== "builtin");

  const row = (t: Theme) => (
    <div key={t.id} className={styles.row} role="presentation">
      <button
        role="menuitemradio"
        aria-checked={t.id === activeId}
        className={styles.item}
        onClick={() => {
          onSelect(t.id);
          setOpen(false);
        }}
      >
        <span className={styles.swatch} style={{ background: t.ui.bg, borderColor: t.ui.border }} aria-hidden>
          <i style={{ background: t.ui.accent }} />
          <i style={{ background: t.syntax.keyword }} />
        </span>
        <span className={styles.name}>{t.name}</span>
        <span className={styles.tick} aria-hidden>
          {t.id === activeId ? "✓" : ""}
        </span>
      </button>
      {t.source !== "builtin" && (
        <button className={styles.remove} aria-label={`Remove ${t.name}`} title="Remove this imported theme" onClick={() => onRemove(t.id)}>
          ×
        </button>
      )}
    </div>
  );

  return (
    <div className={styles.picker} ref={box}>
      <button aria-label="Theme" aria-haspopup="menu" aria-expanded={open} title="Colour theme" onClick={() => setOpen((v) => !v)}>
        🎨
      </button>
      {open && (
        <div role="menu" aria-label="Colour theme" className={styles.menu}>
          <div className={styles.group} role="presentation">
            Built in
          </div>
          {builtin.map(row)}
          {imported.length > 0 && (
            <>
              <div className={styles.group} role="presentation">
                Imported
              </div>
              {imported.map(row)}
            </>
          )}
          <div className={styles.rule} role="presentation" />
          <button
            className={styles.action}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onFind();
            }}
          >
            Find more themes…
          </button>
          <button className={styles.action} role="menuitem" onClick={() => file.current?.click()}>
            Import a VS Code theme file…
          </button>
          <input
            ref={file}
            type="file"
            accept=".json,.jsonc,application/json"
            aria-label="Import a VS Code theme file"
            className={styles.hidden}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setError(null);
              try {
                const msg = await onImportText(await readFile(f), f.name);
                if (msg) setError(msg);
                else setOpen(false);
              } catch {
                setError("That file could not be read.");
              }
            }}
          />
          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
