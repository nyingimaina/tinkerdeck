import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { AppDef } from "../../state/model";
import { groupTabs } from "../../state/editorGroups";
import { detectKind } from "../../state/fileKinds";
import { binDaysLeft, BIN_DAYS, encodingLabel, eolLabel } from "../../state/editor";
import type { EditorController } from "../../state/useEditor";
import styles from "./EditorView.module.css";

// The editor itself (CodeMirror and the language modules) is fetched only when a file is on screen.
const CodeSurface = lazy(() => import("./CodeSurface"));

const daysText = (n: number) => `${n} ${n === 1 ? "day" : "days"} left`;

export function EditorView({ editor, theme, apps = [] }: { editor: EditorController; theme: string; apps?: AppDef[] }) {
  const [binOpen, setBinOpen] = useState(false);
  const E = useRef(editor);
  E.current = editor;
  const activeTab = editor.tabs.find((t) => t.id === editor.activeId) ?? null;
  const groups = groupTabs(editor.tabs, apps);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const id = E.current.activeId;
      if (k === "s" && id) void (e.shiftKey ? E.current.saveAs(id) : E.current.save(id));
      else if (k === "n" && !e.shiftKey) void E.current.newDoc();
      else if (k === "o") void E.current.openDialog();
      else if (k === "w" && id) void E.current.close(id);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const now = Math.floor(Date.now() / 1000);
  const a = editor.active;
  const kind = detectKind(activeTab?.title ?? "", a?.content);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <button onClick={() => void editor.newDoc()} title="New file (Ctrl+N)">
          New
        </button>
        <button onClick={() => void editor.openDialog()} title="Open files (Ctrl+O)">
          Open…
        </button>
        <button onClick={() => editor.activeId && void editor.save(editor.activeId)} disabled={!editor.activeId} title="Save (Ctrl+S)">
          Save
        </button>
        <button
          onClick={() => editor.activeId && void editor.saveAs(editor.activeId)}
          disabled={!editor.activeId}
          title="Save as (Ctrl+Shift+S)"
        >
          Save as…
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
          <p className={styles.hint}>You can also right-click any file in Explorer and choose "Edit with Lite Commander".</p>
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
            <div className={styles.surface}>
              {a?.error ? (
                <div className={styles.empty}>
                  <p>{a.error}</p>
                  <div className={styles.emptyButtons}>
                    <button onClick={() => editor.activeId && void editor.close(editor.activeId)}>Close this tab</button>
                  </div>
                </div>
              ) : editor.activeId && a?.loaded ? (
                <Suspense fallback={<div className={styles.loading}>Loading editor…</div>}>
                  <CodeSurface
                    docId={editor.activeId}
                    value={a.content}
                    filename={kind.filename}
                    dark={theme === "dark"}
                    liveIds={editor.tabs.map((t) => t.id)}
                    onChange={editor.setContent}
                    onSave={() => editor.activeId && void editor.save(editor.activeId)}
                  />
                </Suspense>
              ) : (
                <div className={styles.loading}>Opening…</div>
              )}
            </div>

            <div className={styles.status}>
              <span>Unsaved changes are kept automatically.</span>
              <span className={styles.spacer} />
              {activeTab && (
                <>
                  <span data-role="language">{kind.label}</span>
                  <span>{eolLabel(activeTab.eol)}</span>
                  <span>{encodingLabel(activeTab.encoding)}</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
