// The extension points of the editor. The built-in live preview (D-061) knows Markdown as CommonMark with
// GitHub extensions; the issues that follow plug in here and change nothing else:
//
// - `markdown`: parser extensions. Formulas and diagrams (#108) add their syntax nodes.
// - `rules`: preview rules after the built-in ones. Formulas and diagrams (#108) and images (#109) draw
//   their nodes as widgets; a rule only ever returns decorations, the document is never rewritten.
// - `extensions`: further CodeMirror extensions. The `[[` link search (#78) is an input handler that asks
//   `element.search` and inserts an inline reference (ADR-0004).
//
// Autosave (#401) plugs in through `onChange` and `onSave` of the editor component and the pure functions
// of `save.ts`; the property boxes (#400) stay below the editor in the element buffer.
import type { Extension, EditorState } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";
import type { MarkdownConfig } from "@lezer/markdown";

export interface PreviewContext {
  readonly state: EditorState;
  /** Whether the source of the line at `pos` is shown: the lines the selection touches, while the editor has the focus. */
  readonly sourceLine: (pos: number) => boolean;
}

export interface PreviewRule {
  /** Node names of the Markdown syntax tree (lezer) this rule decorates. */
  readonly nodes: readonly string[];
  readonly decorate: (node: SyntaxNodeRef, context: PreviewContext) => readonly Range<Decoration>[];
}

export interface EditorPlugins {
  /** Parser extensions (formulas and diagrams, #108). */
  readonly markdown?: readonly MarkdownConfig[];
  /** Live-preview rules after the built-in ones (formulas, diagrams #108, images #109). */
  readonly rules?: readonly PreviewRule[];
  /** Further CodeMirror extensions (`[[` link search #78). */
  readonly extensions?: readonly Extension[];
}
