// The states of the window in which a swipe switches no buffer (SR-163 AK4; SR-211 AK11 names the same list):
// the command line open, a context menu, the slash menu, the calendar, the card of the next keys or the window
// "About ReqSeq" shown, and also while another workspace opens (SR-131 AK3). One list for every swipe, so the
// swipe of SR-211 takes it as well. Nothing is closed by it.
import { completionStatus } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { calendarOpen } from "./editor/calendar.js";

/** What the window knows of its own state when a swipe comes. */
export interface SwitchState {
  /** Another workspace is being opened (SR-131 AK3). */
  readonly switching: boolean;
  /** A prompt of the command line is open. */
  readonly prompting: boolean;
  readonly contextMenu: boolean;
  /** The window "About ReqSeq" (SR-161). */
  readonly about: boolean;
  /** The card of the next keys after the prefix key (SR-109 AK3). */
  readonly nextKeys: boolean;
}

/**
 * Whether the slash menu or the calendar is open in the focused editor of `document`. Both close when the
 * editor loses the focus (`closeOnBlur`), so the focused one is the only one to ask. The slash menu is the one
 * completion source of the editor (`slash-menu.ts`), so an active completion is the slash menu.
 */
export const editorMenuOpen = (document: Document): boolean => {
  const editor = document.activeElement?.closest(".cm-editor");
  const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null;
  return view !== null && (completionStatus(view.state) === "active" || calendarOpen(view.state));
};

/** Whether a swipe switches no buffer now (SR-163 AK4). */
export const bufferSwitchBlocked = (state: SwitchState, document: Document): boolean =>
  state.switching ||
  state.prompting ||
  state.contextMenu ||
  state.about ||
  state.nextKeys ||
  editorMenuOpen(document);
