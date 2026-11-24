// Rendered views for files the webview can show (BRS 7.14). Loaded only when Preview is chosen, and
// markdown rendering (marked + DOMPurify) is loaded only for markdown. Everything shown is inert:
// html runs in an empty sandbox, svg is shown as an image, markdown is sanitised.
import { useEffect, useState } from "react";
import { editorApi } from "../../api/editor";
import { errorText } from "../../api/tauri";
import { mimeOf, type PreviewKind } from "../../state/previews";
import styles from "./PreviewPane.module.css";

interface Props {
  kind: PreviewKind;
  title: string;
  path: string | null;
  /** The live text (html, markdown, svg). Images and PDFs are read from their file instead. */
  content: string;
}

/** An object URL for a blob, released when no longer needed. */
function useBlobUrl(make: () => Promise<Blob> | Blob, deps: unknown[]) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    setError(null);
    const show = (b: Blob) => {
      made = URL.createObjectURL(b);
      if (live) setUrl(made);
      else URL.revokeObjectURL(made);
    };
    try {
      const r = make();
      if (r instanceof Blob) show(r);
      else r.then(show).catch((e) => live && setError(errorText(e)));
    } catch (e) {
      setError(errorText(e));
    }
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { url, error };
}

function Markdown({ content }: { content: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([import("marked"), import("dompurify")]).then(([{ marked }, { default: DOMPurify }]) => {
      const raw = marked.parse(content, { async: false }) as string;
      if (live) setHtml(DOMPurify.sanitize(raw));
    });
    return () => {
      live = false;
    };
  }, [content]);
  if (html === null) return <div className={styles.note}>Rendering…</div>;
  return (
    <div
      className={styles.md}
      // links must never navigate the app window away
      onClick={(e) => (e.target as HTMLElement).closest("a") && e.preventDefault()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function FileBlob({ kind, title, path }: { kind: "image" | "pdf"; title: string; path: string | null }) {
  const { url, error } = useBlobUrl(async () => {
    if (!path) throw new Error("This file has not been saved yet.");
    const bytes = await editorApi.readBytes(path);
    return new Blob([bytes as BlobPart], { type: mimeOf(title) });
  }, [path, title]);
  if (error) {
    return (
      <div className={styles.error} role="alert">
        {error}
      </div>
    );
  }
  if (!url) return <div className={styles.note}>Loading…</div>;
  return kind === "pdf" ? (
    <iframe className={styles.pdf} src={url} title={`Preview of ${title}`} />
  ) : (
    <div className={styles.imageWrap}>
      <img className={styles.image} src={url} alt={`Preview of ${title}`} />
    </div>
  );
}

function Svg({ title, content }: { title: string; content: string }) {
  const { url, error } = useBlobUrl(() => new Blob([content], { type: "image/svg+xml" }), [content]);
  if (error) {
    return (
      <div className={styles.error} role="alert">
        {error}
      </div>
    );
  }
  if (!url) return <div className={styles.note}>Rendering…</div>;
  return (
    <div className={styles.imageWrap}>
      <img className={styles.image} src={url} alt={`Preview of ${title}`} />
    </div>
  );
}

export default function PreviewPane({ kind, title, path, content }: Props) {
  return (
    <div className={styles.root}>
      {kind === "markdown" && <Markdown content={content} />}
      {kind === "html" && <iframe className={styles.frame} title={`Preview of ${title}`} sandbox="" srcDoc={content} />}
      {kind === "svg" && <Svg title={title} content={content} />}
      {(kind === "image" || kind === "pdf") && <FileBlob kind={kind} title={title} path={path} />}
    </div>
  );
}
