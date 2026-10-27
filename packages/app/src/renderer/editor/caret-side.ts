// The side of the caret is let go when an editor loses the focus. A caret on the point where a long line
// wraps is both the end of one visual line and the start of the next; CodeMirror keeps the side it is
// shown on (`assoc`) and, in its next measure, puts the browser selection on that side again. That measure
// comes after the blur too, and placing the browser selection in this editor gives it the focus back: Down
// on the last visual line of a wrapped value went to the next box and came back (#348), a click into
// another box came back the same way. An editor without the focus shows no caret, so the side means nothing
// then; Up from the box after puts the caret at the end anyway.
import { EditorSelection } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const releaseCaretSide: Extension = EditorView.domEventHandlers({
  blur: (_event, view) => {
    const { selection } = view.state;
    const { main } = selection;
    if (main.empty && main.assoc !== 0) {
      view.dispatch({
        selection: selection.replaceRange(EditorSelection.cursor(main.head), selection.mainIndex),
      });
    }
    return false;
  },
});
