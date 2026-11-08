// Cut, Copy and Paste as commands (SR-195 AK3): each does what the system's key does in the editor, so
// the result is that of Ctrl/Cmd+X, C and V. Cut and Copy ask the browser for its own cut or copy
// (`execCommand`), which fires the trusted clipboard event that CodeMirror handles as for the key; it needs
// the user's activation, which the click on an entry or the Enter of the prompt gives. Paste cannot be
// asked of the page (Chromium refuses a script's paste), so the editor takes the focus and main pastes
// (`reqseq:edit`, `main/edit.ts`): the editor gets the paste event of the key, with images as in SR-190
// (`paste.ts`). The renderer never reads the clipboard.
import type { Command } from "@codemirror/view";

/** Whether the editor has text selected: the context menu offers Cut and Copy only then (AK1). */
export const hasSelection = (state: {
  readonly selection: { readonly ranges: readonly { readonly empty: boolean }[] };
}): boolean => state.selection.ranges.some((range) => !range.empty);

/**
 * The browser's own cut or copy in the editor, which takes the focus first, so the event reaches it.
 * False when the browser refused it.
 */
const clipboardEvent =
  (kind: "cut" | "copy"): Command =>
  (view) => {
    view.focus();
    // The deprecated call is the only one that gives the editor the trusted clipboard event of the key;
    // the Clipboard API would need a permission the session refuses and would bypass CodeMirror's handler.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- see the line above
    return document.execCommand(kind);
  };

/** "Cut": as Ctrl/Cmd+X. */
export const cutText: Command = clipboardEvent("cut");

/** "Copy": as Ctrl/Cmd+C. */
export const copyText: Command = clipboardEvent("copy");

/**
 * "Paste": the editor takes the focus and `paste` has main paste into it, as Ctrl/Cmd+V does; false in an
 * editor that takes no input.
 */
export const pasteText =
  (paste: () => void): Command =>
  (view) => {
    if (view.state.readOnly) {
      return false;
    }
    view.focus();
    paste();
    return true;
  };
