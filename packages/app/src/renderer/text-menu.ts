// The context menu in the text of an element (SR-195): what its entries ask of the editor at the place of
// the right-click. The press has already put the caret at the pointer, or kept the selection it landed in
// (AK2, `focusPressed`), so each test reads the editor's own state: Cut and Copy with text selected (AK1),
// "Follow reference" on a reference (AK4), the table actions in a table (AK5), and "Fold section" or
// "Unfold section" on a heading with a section (AK6). Display only: the actions do the work.
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { MenuHit } from "./context-menu.js";
import { hasSelection } from "./editor/clipboard.js";
import { headingFoldAt } from "./editor/folding.js";
import { referenceAt } from "./editor/references.js";
import { cellCaret, inTable } from "./editor/tables.js";

/** The editor of the text the menu was asked for in. */
const textView = (hit: MenuHit): EditorView | undefined => {
  const editor =
    hit.target.closest(".cm-editor") ?? hit.target.closest('[data-menu="text"]')?.querySelector(".cm-editor");
  return editor instanceof HTMLElement ? (EditorView.findFromDOM(editor) ?? undefined) : undefined;
};

/** The entry shows where `test` holds for the editor's state at its caret. */
const atCaret =
  (test: (state: EditorState, pos: number) => boolean) =>
  (hit: MenuHit): boolean => {
    const state = textView(hit)?.state;
    return state !== undefined && test(state, state.selection.main.head);
  };

/** The tests of the entries of the place `text` (`MENU_PLACES`). */
export const TEXT_MENU = {
  selected: (hit: MenuHit): boolean => {
    const state = textView(hit)?.state;
    return state !== undefined && hasSelection(state);
  },
  reference: atCaret((state, pos) => referenceAt(state, pos) !== undefined),
  table: atCaret(inTable),
  fold: atCaret((state, pos) => headingFoldAt(state, pos) === "fold"),
  unfold: atCaret((state, pos) => headingFoldAt(state, pos) === "unfold"),
} as const;

/**
 * The position in the text of a press on `target` at `point`: in a cell of a drawn table, that cell (the
 * drawing is one widget, whose position would be the table's start); elsewhere the position at the point.
 */
export const pressedPosition = (
  view: EditorView,
  target: Element,
  point: { readonly x: number; readonly y: number },
): number | null => {
  const cell = target.closest(".cm-lr-table td, .cm-lr-table th");
  const row = cell?.parentElement;
  const section = row?.parentElement;
  const table = cell?.closest(".cm-lr-table");
  if (cell !== null && row instanceof Element && section instanceof Element && table instanceof Element) {
    // Row 0 is the header (`thead`), the body rows follow; the indices are counted, not read, so they hold
    // in any DOM.
    const index = section.tagName === "THEAD" ? 0 : [...section.children].indexOf(row) + 1;
    const caret = cellCaret(view.state, view.posAtDOM(table), index, [...row.children].indexOf(cell));
    if (caret !== undefined) {
      return caret;
    }
  }
  return view.posAtCoords(point);
};
