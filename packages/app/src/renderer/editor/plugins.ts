// The extension points of the editor. The built-in live preview (D-061) knows Markdown as CommonMark with
// GitHub extensions; the issues that follow plug in here and change nothing else:
//
// - `markdown`: parser extensions. Formulas (SR-096, `math-syntax.ts`) add their syntax nodes.
// - `rules`: preview rules after the built-in ones. Formulas (SR-096, `formula-preview.ts`), diagrams (ThomasBirkmaier/ReqSeq-archive#108)
//   and images (SR-184, `image-preview.ts`) draw their nodes as widgets; a rule only ever returns decorations, the document is
//   never rewritten. A rule that `owns` a node draws it alone (a fenced `math` block set in place of its
//   source), so the built-in rules do not decorate what it replaces.
// - `extensions`: further CodeMirror extensions. The slash menu (SR-129, `slash-menu.ts`) is one; the `[[`
//   search (SR-066, `reference-search.ts`) is another: a typed `[[` asks the app for an element in the
//   prompt "Insert reference" and the pick is written as an inline reference (ADR-0004,
//   `reference-pick.ts`, shared with the slash menu).
//
// Autosave (ThomasBirkmaier/ReqSeq-archive#401) plugs in through `onChange` and `onSave` of the editor component and the pure functions
// of `save.ts`; the property boxes (ThomasBirkmaier/ReqSeq-archive#400) stay below the editor in the element buffer.
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
  /**
   * Whether this rule draws the node alone in this state: then only the rules that own it decorate it. It
   * reads the context, because whether a widget replaces a node depends on the focus and the selection.
   */
  readonly owns?: (node: SyntaxNodeRef, context: PreviewContext) => boolean;
}

export interface EditorPlugins {
  /** Parser extensions (formulas, SR-096). */
  readonly markdown?: readonly MarkdownConfig[];
  /** Live-preview rules after the built-in ones (formulas SR-096, diagrams ThomasBirkmaier/ReqSeq-archive#108, images SR-184). */
  readonly rules?: readonly PreviewRule[];
  /** Further CodeMirror extensions (the slash menu SR-129, the `[[` search SR-066). */
  readonly extensions?: readonly Extension[];
}

/**
 * The plugins of the editor together: the lists of each, in the given order. The element buffer combines
 * the reference marks (ThomasBirkmaier/ReqSeq-archive#424), the slash menu (SR-129), the `[[` search (SR-066) and the formulas (SR-096)
 * this way.
 */
export const mergePlugins = (...plugins: readonly EditorPlugins[]): EditorPlugins => ({
  markdown: plugins.flatMap((plugin) => plugin.markdown ?? []),
  rules: plugins.flatMap((plugin) => plugin.rules ?? []),
  extensions: plugins.flatMap((plugin) => plugin.extensions ?? []),
});
