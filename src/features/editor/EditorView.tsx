import { useEffect, useMemo, useRef, useState } from "react";
import ZestTabs from "jattac.libs.web.zest-tabs";
import type { AppDef } from "../../state/model";
import type { Theme } from "../../themes/types";
import { groupTabs } from "../../state/editorGroups";
import { detectKind } from "../../state/fileKinds";
import { isBinaryPreview } from "../../state/previews";
import { binDaysLeft, BIN_DAYS } from "../../state/editor";
import type { EditorController } from "../../state/useEditor";
import { globalActiveTab, partitionTabs } from "../../state/workspaceTabs";
import { EditorSurface } from "./EditorSurface";
import styles from "./EditorView.module.css";

const daysText = (n: number) => `${n} ${n === 1 ? "day" : "days"} left`;

/** The global editor's keyboard shortcuts: the same window-level ones the old view had (Ctrl+S/N/O/W). */
function useEditorShortcuts(editor: EditorController) {
  const E = useRef(editor);
  E.current = editor;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const id = E.current.activeId;
      const title = E.current.tabs.find((t) => t.id === id)?.title ?? "";
      if (k === "s" && id) {
        if (!isBinaryPreview(title)) void (e.shiftKey ? E.current.saveAs(id) : E.current.save(id));
      } else if (k === "n" && !e.shiftKey) void E.current.newDoc();
      else if (k === "o") void E.current.openDialog();
      else if (k === "w" && id) void E.current.close(id);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * The separate global editor view (R2, R4, R5, A2). It lists only editors with no workspace home,
 * as one plain ungrouped strip, and never the vertical "Open editors" side pane. Kept for the old
 * grouped view's tests until the window is switched over in the next slice.
 */
export function EditorView({ editor, theme, apps = [], palette }: { editor: EditorController; theme: string; apps?: AppDef[]; palette?: Theme }) {
  const [binOpen, setBinOpen] = useState(false);
  const groups = groupTabs(editor.tabs, apps);
  useEditorShortcuts(editor);

  const now = Math.floor(Date.now() / 1000);
  const a = editor.active;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <button onClick={() => void editor.newDoc()} title="New file (Ctrl+N)">
          New
        </button>
        <button onClick={() => void editor.openDialog()} title="Open files (Ctrl+O)">
          Open…
        </button>
        <span className={styles.spacer} />
        <button onClick={() => setBinOpen((v) => !v)} aria-expanded={binOpen} title="Editors closed with unsaved text, or idle for 7 days">
          Bin ({editor.bin.length})
        </button>
      </div>

      {editor.error && (
        <div className={styles.error} role="alert">
          <span>{editor.error}</span>
          <button onClick={editor.dismissError}>Dismiss</button>
        </div>
      )}

      {binOpen && (
        <div className={styles.bin}>
          <p className={styles.binNote}>
            Editors you close with unsaved text, or leave unused for {7} days, wait here for {BIN_DAYS} days, then are forgotten.
          </p>
          {editor.bin.length === 0 && <p className={styles.binNote}>The bin is empty.</p>}
          {editor.bin.map((b) => (
            <div key={b.id} className={styles.binRow}>
              <span className={styles.binTitle} title={b.path ?? "never saved"}>
                {b.title}
              </span>
              <span className={styles.binDays}>{daysText(binDaysLeft(b.binnedAt, now))}</span>
              <button aria-label={`Restore ${b.title}`} onClick={() => void editor.restore(b.id)}>
                Restore
              </button>
              <button aria-label={`Delete ${b.title} for good`} onClick={() => void editor.discard(b.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {editor.tabs.length === 0 ? (
        <div className={styles.empty}>
          <p>Nothing is open. Text you type here is kept automatically, even if you never save.</p>
          <div className={styles.emptyButtons}>
            <button onClick={() => void editor.newDoc()}>New file</button>
            <button onClick={() => void editor.openDialog()}>Open a file…</button>
          </div>
          <p className={styles.hint}>You can also right-click any file in Explorer and choose "Edit with Tinkerdeck".</p>
        </div>
      ) : (
        <div className={styles.workspace}>
          <nav className={styles.pane} role="tablist" aria-orientation="vertical" aria-label="Open editors">
            {groups.map((g) => (
              <div key={g.appId ?? "misc"} role="group" aria-label={g.name} className={styles.group}>
                <div className={styles.groupHead}>
                  <span>{g.name}</span>
                  <span className={styles.count}>{g.tabs.length}</span>
                </div>
                {g.tabs.map((t) => {
                  const k = detectKind(t.title, t.id === editor.activeId ? a?.content : undefined);
                  return (
                    <div key={t.id} className={styles.tabWrap} data-active={t.id === editor.activeId}>
                      <button
                        role="tab"
                        aria-selected={t.id === editor.activeId}
                        className={styles.tab}
                        title={t.path ?? "not saved yet"}
                        onClick={() => editor.select(t.id)}
                      >
                        <span role="img" aria-label={k.label} className={styles.icon}>
                          {k.icon}
                        </span>
                        <span className={styles.name}>{t.title}</span>
                        {t.dirty && <span className={styles.dot} role="img" aria-label="unsaved changes kept" />}
                      </button>
                      <button className={styles.close} aria-label={`Close ${t.title}`} onClick={() => void editor.close(t.id)}>
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className={styles.editorCol}>
            <EditorSurface editor={editor} theme={theme} palette={palette} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The global editor view (R2, R4, R5, A2): one plain ungrouped strip of unowned editors only, the
 * New/Open/Bin toolbar, the error and the bin, and the shared editor surface as the body. A
 * workspace-owned file is never listed or shown here, even when it is the editor's active document.
 */
export function GlobalEditorView({ editor, theme, apps = [], palette }: { editor: EditorController; theme: string; apps?: AppDef[]; palette?: Theme }) {
  const [binOpen, setBinOpen] = useState(false);
  const E = useRef(editor);
  E.current = editor;
  const unowned = useMemo(() => partitionTabs(editor.tabs, apps).unowned, [editor.tabs, apps]);
  const shownId = globalActiveTab(unowned, editor.activeId);
  const select = editor.select;
  useEditorShortcuts(editor);

  // Entering (or staying in) the global view must land on an unowned tab, never on a workspace file (A2).
  useEffect(() => {
    if (shownId && editor.activeId !== shownId) select(shownId);
  }, [shownId, editor.activeId, select]);

  const now = Math.floor(Date.now() / 1000);
  const items = unowned.map((t) => {
    const k = detectKind(t.title, t.id === editor.activeId ? editor.active?.content : undefined);
    return {
      value: t.id,
      label: (
        <span className={styles.tab} title={t.path ?? "not saved yet"}>
          <span role="img" aria-label={k.label} className={styles.icon}>
            {k.icon}
          </span>
          <span className={styles.name}>{t.title}</span>
          {t.dirty && <span className={styles.dot} role="img" aria-label="unsaved changes kept" />}
          <button
            className={styles.close}
            aria-label={`Close ${t.title}`}
            onClick={(e) => {
              e.stopPropagation();
              void editor.close(t.id);
            }}
          >
            ×
          </button>
        </span>
      ),
    };
  });

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <button onClick={() => void editor.newDoc()} title="New file (Ctrl+N)">
          New
        </button>
        <button onClick={() => void editor.openDialog()} title="Open files (Ctrl+O)">
          Open…
        </button>
        <span className={styles.spacer} />
        <button onClick={() => setBinOpen((v) => !v)} aria-expanded={binOpen} title="Editors closed with unsaved text, or idle for 7 days">
          Bin ({editor.bin.length})
        </button>
      </div>

      {editor.error && (
        <div className={styles.error} role="alert">
          <span>{editor.error}</span>
          <button onClick={editor.dismissError}>Dismiss</button>
        </div>
      )}

      {binOpen && (
        <div className={styles.bin}>
          <p className={styles.binNote}>
            Editors you close with unsaved text, or leave unused for {7} days, wait here for {BIN_DAYS} days, then are forgotten.
          </p>
          {editor.bin.length === 0 && <p className={styles.binNote}>The bin is empty.</p>}
          {editor.bin.map((b) => (
            <div key={b.id} className={styles.binRow}>
              <span className={styles.binTitle} title={b.path ?? "never saved"}>
                {b.title}
              </span>
              <span className={styles.binDays}>{daysText(binDaysLeft(b.binnedAt, now))}</span>
              <button aria-label={`Restore ${b.title}`} onClick={() => void editor.restore(b.id)}>
                Restore
              </button>
              <button aria-label={`Delete ${b.title} for good`} onClick={() => void editor.discard(b.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {unowned.length === 0 ? (
        <div className={styles.empty}>
          <p>Nothing is open. Text you type here is kept automatically, even if you never save.</p>
          <div className={styles.emptyButtons}>
            <button onClick={() => void editor.newDoc()}>New file</button>
            <button onClick={() => void editor.openDialog()}>Open a file…</button>
          </div>
          <p className={styles.hint}>You can also right-click any file in Explorer and choose "Edit with Tinkerdeck".</p>
        </div>
      ) : (
        <div className={styles.editorCol}>
          <div className={styles.modes}>
            <ZestTabs id="global-editor-tabs" items={items} activeValue={shownId ?? ""} onChange={(v) => select(String(v))} />
          </div>
          {shownId === editor.activeId ? (
            <EditorSurface editor={editor} theme={theme} palette={palette} />
          ) : (
            <div className={styles.loading}>Opening…</div>
          )}
        </div>
      )}
    </div>
  );
}
