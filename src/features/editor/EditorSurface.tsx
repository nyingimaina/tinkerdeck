import { lazy, Suspense, useState } from "react";
import type { Theme } from "../../themes/types";
import { detectKind } from "../../state/fileKinds";
import { isBinaryPreview, previewKind } from "../../state/previews";
import { encodingLabel, eolLabel } from "../../state/editor";
import type { EditorController } from "../../state/useEditor";
import styles from "./EditorSurface.module.css";

// The editor itself (CodeMirror and the language modules) is fetched only when a file is on screen.
const CodeSurface = lazy(() => import("./CodeSurface"));
// Rendered previews (markdown, html, svg, images, PDF) are likewise fetched only when asked for.
const PreviewPane = lazy(() => import("./PreviewPane"));

interface Props {
  editor: EditorController;
  theme: string;
  /** The colour theme in use (editor colours and syntax highlighting). */
  palette?: Theme;
  /** Keep the surface mounted but out of sight while a terminal tab is shown (A1). */
  hidden?: boolean;
}

/**
 * The one editor surface (R1, R2, R5, A1): Save/Save as, the Raw/Preview toggle, the file's
 * error and the language/EOL/encoding bar. It never draws a tab list or an owner side pane, so
 * both the workspace main area and the global view can show the same mounted instance.
 */
export function EditorSurface({ editor, theme, palette, hidden = false }: Props) {
  const [modes, setModes] = useState<Record<string, "raw" | "preview">>({});
  const activeTab = editor.tabs.find((t) => t.id === editor.activeId) ?? null;
  const a = editor.active;
  const kind = detectKind(activeTab?.title ?? "", a?.content);
  const pk = activeTab ? previewKind(activeTab.title) : null;
  const binary = !!activeTab && isBinaryPreview(activeTab.title);
  const mode = binary ? "preview" : pk && activeTab ? (modes[activeTab.id] ?? "raw") : "raw";
  const setMode = (m: "raw" | "preview") => activeTab && setModes((prev) => ({ ...prev, [activeTab.id]: m }));
  const preview =
    pk && activeTab ? (
      <Suspense fallback={<div className={styles.loading}>Loading preview…</div>}>
        <PreviewPane kind={pk} title={activeTab.title} path={activeTab.path} content={a?.content ?? ""} />
      </Suspense>
    ) : null;

  return (
    <div className={styles.root} style={hidden ? { display: "none" } : undefined} data-hidden={hidden || undefined}>
      <div className={styles.actions} role="toolbar" aria-label="Editor actions">
        <button
          onClick={() => editor.activeId && void editor.save(editor.activeId)}
          disabled={!editor.activeId || binary}
          title="Save (Ctrl+S)"
        >
          Save
        </button>
        <button
          onClick={() => editor.activeId && void editor.saveAs(editor.activeId)}
          disabled={!editor.activeId || binary}
          title="Save as (Ctrl+Shift+S)"
        >
          Save as…
        </button>
        {pk && !binary && (
          <div className={styles.modes} role="toolbar" aria-label="View">
            <button aria-pressed={mode === "raw"} onClick={() => setMode("raw")}>
              Raw
            </button>
            <button aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>
              Preview
            </button>
          </div>
        )}
        <span className={styles.spacer} />
      </div>

      <div className={styles.surface}>
        {a?.error ? (
          <div className={styles.empty}>
            <p>{a.error}</p>
            <div className={styles.emptyButtons}>
              <button onClick={() => editor.activeId && void editor.close(editor.activeId)}>Close this tab</button>
            </div>
          </div>
        ) : binary && editor.activeId ? (
          preview
        ) : editor.activeId && a?.loaded ? (
          <>
            <div style={{ display: mode === "preview" ? "none" : "block", height: "100%" }}>
              <Suspense fallback={<div className={styles.loading}>Loading editor…</div>}>
                <CodeSurface
                  docId={editor.activeId}
                  value={a.content}
                  filename={kind.filename}
                  dark={theme === "dark"}
                  palette={palette}
                  liveIds={editor.tabs.map((t) => t.id)}
                  onChange={editor.setContent}
                  onSave={() => editor.activeId && void editor.save(editor.activeId)}
                />
              </Suspense>
            </div>
            {mode === "preview" && preview}
          </>
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
  );
}
