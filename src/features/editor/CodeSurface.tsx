// The CodeMirror surface. This file is only ever loaded through React.lazy (see EditorView), so the
// editor and its language modules cost nothing until a file is opened (BRS 7.14).
import { useEffect, useRef } from "react";
import { Compartment, EditorState, type Text } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Theme } from "../../themes/types";
import { editorExtension } from "./cmTheme";

interface Props {
  docId: string;
  value: string;
  filename: string;
  dark: boolean;
  /** The colour theme in use (editor colours and syntax highlighting). Without one the plain dark/light look is used. */
  palette?: Theme;
  /** Ids still open, so the saved view state of closed ones can be dropped. */
  liveIds: string[];
  onChange: (id: string, text: string) => void;
  onSave: () => void;
}

const TYPING_MS = 150;

export default function CodeSurface({ docId, value, filename, dark, palette, liveIds, onChange, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const current = useRef<string | null>(null);
  const lang = useRef(new Compartment());
  const theme = useRef(new Compartment());
  const cb = useRef({ onChange, onSave });
  cb.current = { onChange, onSave };
  const darkNow = useRef(dark);
  darkNow.current = dark;
  const paletteNow = useRef(palette);
  paletteNow.current = palette;
  const themeExt = () => (paletteNow.current ? editorExtension(paletteNow.current) : darkNow.current ? oneDark : []);
  const pending = useRef<{ id: string; doc: Text } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // typing is reported shortly after it pauses, so a large file is not copied on every keystroke
  const emit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) cb.current.onChange(p.id, p.doc.toString());
  };

  const makeState = (text: string) =>
    EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              emit();
              cb.current.onSave();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        lang.current.of([]),
        theme.current.of(themeExt()),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged || !current.current) return;
          pending.current = { id: current.current, doc: u.state.doc };
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(emit, TYPING_MS);
        }),
      ],
    });

  useEffect(() => {
    const v = new EditorView({ parent: host.current ?? undefined });
    view.current = v;
    const saved = states.current;
    return () => {
      emit();
      v.destroy();
      view.current = null;
      saved.clear();
      current.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // switching editors keeps each one's own undo history and cursor
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (current.current !== docId) {
      emit();
      if (current.current) states.current.set(current.current, v.state);
      v.setState(states.current.get(docId) ?? makeState(value));
      current.current = docId;
      v.dispatch({ effects: theme.current.reconfigure(themeExt()) });
      v.focus();
    }
    let live = true;
    const d = LanguageDescription.matchFilename(languages, filename);
    if (d) {
      void d
        .load()
        .then((support) => {
          if (live && view.current && current.current === docId) view.current.dispatch({ effects: lang.current.reconfigure(support) });
        })
        .catch(() => {});
    } else {
      v.dispatch({ effects: lang.current.reconfigure([]) });
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, filename]);

  useEffect(() => {
    view.current?.dispatch({ effects: theme.current.reconfigure(themeExt()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, palette]);

  const live = liveIds.join("|");
  useEffect(() => {
    const keep = new Set(live.split("|"));
    for (const id of [...states.current.keys()]) if (!keep.has(id)) states.current.delete(id);
  }, [live]);

  return <div ref={host} style={{ height: "100%" }} data-testid="code-surface" />;
}
