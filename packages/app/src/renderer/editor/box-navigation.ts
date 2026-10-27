// Moving between the editors of the element buffer with the arrow keys (SR-104, Logseq style): Down on the
// last visual line of an editor goes to the next one, Up on the first visual line to the one before.
// Wrapped lines count as lines (the editor wraps), so the key moves the caret inside a long value first and
// leaves only when the caret could not go further. `moveToLineBoundary` asks the layout, which is why the
// edge is not computed from the document. Every other press, a selection and a missing neighbour are left
// to the editor (`false`). On macOS Ctrl-p and Ctrl-n are the caret keys of CodeMirror and move the same way.
import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { EditorView, KeyBinding } from "@codemirror/view";

export interface BoxNavigation {
  /** Down at the last line: goes to the next editor; false when there is none. */
  readonly down?: () => boolean;
  /** Up at the first line: goes to the previous editor; false when there is none. */
  readonly up?: () => boolean;
}

/** Whether the caret is on the last (`forward`) or first visual line of the document, with no selection. */
export const atEdge = (view: EditorView, forward: boolean): boolean => {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return false;
  }
  const edge = view.moveToLineBoundary(selection, forward);
  return forward ? edge.head === view.state.doc.length : edge.head === 0;
};

/** The bindings of one direction: the arrow key, and on macOS the Emacs key as well. */
const bindings = (
  keys: { readonly arrow: string; readonly emacs: string },
  forward: boolean,
  go: () => boolean,
): KeyBinding[] => {
  const run = (view: EditorView): boolean => atEdge(view, forward) && go();
  return [
    { key: keys.arrow, run },
    { mac: keys.emacs, run },
  ];
};

/**
 * The keymap of the navigation. `strength` is the precedence: a box editor runs it before the Markdown
 * keymap (highest); the text editor after the slash menu, which takes Down while it is open (high).
 */
export const boxNavigation = (
  navigation: BoxNavigation,
  strength: typeof Prec.high | typeof Prec.highest = Prec.highest,
): Extension => {
  const { down, up } = navigation;
  return strength(
    keymap.of([
      ...(down === undefined ? [] : bindings({ arrow: "ArrowDown", emacs: "Ctrl-n" }, true, down)),
      ...(up === undefined ? [] : bindings({ arrow: "ArrowUp", emacs: "Ctrl-p" }, false, up)),
    ]),
  );
};
