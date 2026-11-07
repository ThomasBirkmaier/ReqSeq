// Moving between the editors of the element buffer with the arrow keys (SR-104, Logseq style): Down on the
// last visual line of an editor goes to the next one, Up on the first visual line to the one before.
// Wrapped lines count as lines (the editor wraps), so the key moves the caret inside a long value first and
// leaves only when the caret could not go further. `moveToLineBoundary` asks the layout, which is why the
// edge is not computed from the document. Every other press, a selection and a missing neighbour are left
// to the editor (`false`). Ctrl-n and Ctrl-p act as Down and Up on every platform (SR-155 AK4): inside the text
// they move the caret a line, as CodeMirror's own Emacs keys do on macOS, and they never go on to the window, where
// Ctrl+P on Linux and Windows is "Go to".
import { cursorLineDown, cursorLineUp } from "@codemirror/commands";
import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { EditorView, KeyBinding } from "@codemirror/view";
import { BOX_NEXT, BOX_PREVIOUS } from "./editor-keys.js";

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

/**
 * The bindings of one direction: the arrow key, and the Emacs key, which moves the caret a line where the arrow
 * leaves it to the editor, and is always taken.
 */
const bindings = (
  keys: { readonly arrow: string; readonly emacs: string },
  forward: boolean,
  go: () => boolean,
): KeyBinding[] => {
  const run = (view: EditorView): boolean => atEdge(view, forward) && go();
  const line = forward ? cursorLineDown : cursorLineUp;
  return [
    { key: keys.arrow, run },
    {
      key: keys.emacs,
      run: (view) => {
        if (!run(view)) {
          line(view);
        }
        return true;
      },
    },
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
      ...(down === undefined ? [] : bindings(BOX_NEXT, true, down)),
      ...(up === undefined ? [] : bindings(BOX_PREVIOUS, false, up)),
    ]),
  );
};
