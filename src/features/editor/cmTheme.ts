// A Tinkerdeck theme as a CodeMirror theme: editor colours plus syntax highlighting.
// Only ever loaded with CodeSurface, so it costs nothing until a file is open.
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Theme } from "../../themes/types";

export function editorExtension(theme: Theme): Extension {
  const { ui, syntax: s, terminal } = theme;
  const view = EditorView.theme(
    {
      "&": { color: ui.text, backgroundColor: ui.panel },
      ".cm-content": { caretColor: ui.accent },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: ui.accent },
      ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: terminal.selection },
      ".cm-content ::selection": { backgroundColor: terminal.selection },
      ".cm-activeLine": { backgroundColor: ui.hover },
      ".cm-gutters": { backgroundColor: ui.panel, color: ui.muted, border: "none" },
      ".cm-activeLineGutter": { backgroundColor: ui.hover, color: ui.text },
      ".cm-foldPlaceholder": { backgroundColor: ui.panel2, color: ui.muted, border: "none" },
      ".cm-panels": { backgroundColor: ui.panel2, color: ui.text },
      ".cm-panels input, .cm-panels button": { color: ui.text },
      ".cm-searchMatch": { backgroundColor: terminal.selection, outline: `1px solid ${ui.accent}` },
      ".cm-matchingBracket, .cm-nonmatchingBracket": { backgroundColor: ui.hover, outline: `1px solid ${ui.border}` },
      ".cm-tooltip": { backgroundColor: ui.panel2, border: `1px solid ${ui.border}`, color: ui.text },
    },
    { dark: theme.kind === "dark" },
  );
  const highlight = HighlightStyle.define([
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: s.comment, fontStyle: "italic" },
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.modifier, t.operatorKeyword], color: s.keyword },
    { tag: [t.string, t.special(t.string), t.regexp, t.character], color: s.string },
    { tag: [t.number, t.integer, t.float], color: s.number },
    { tag: [t.bool, t.null, t.atom, t.constant(t.name), t.constant(t.variableName)], color: s.constant },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: s.function },
    { tag: [t.typeName, t.className, t.namespace], color: s.type },
    { tag: [t.variableName, t.definition(t.variableName), t.name], color: s.variable },
    { tag: [t.propertyName, t.definition(t.propertyName)], color: s.property },
    { tag: [t.operator, t.punctuation, t.separator], color: s.operator },
    { tag: [t.tagName, t.angleBracket], color: s.tag },
    { tag: [t.attributeName], color: s.attribute },
    { tag: t.heading, color: s.keyword, fontWeight: "bold" },
    { tag: [t.link, t.url], color: ui.accent, textDecoration: "underline" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strong, fontWeight: "bold" },
    { tag: t.invalid, color: ui.red },
  ]);
  return [view, syntaxHighlighting(highlight)];
}
