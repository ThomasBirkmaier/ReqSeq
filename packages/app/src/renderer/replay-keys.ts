// A key a prompt held while its Enter waited for core (#467), pressed again on what has the focus once the
// answer is shown: a shortcut acts on what the Enter opened, a letter is typed where the focus is. The app
// presses one such key each render (`App.tsx`); a prompt that opens takes the rest itself (`Minibuffer`).
import { deleteCharBackward } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";

/** Whether `init` is pressed with no modifier but Shift: a key that types. */
const plain = (init: KeyboardEventInit): boolean =>
  init.ctrlKey !== true && init.metaKey !== true && init.altKey !== true;

/** Types a letter or Backspace into the text editor that `target` belongs to; whether it is one. */
const typeIntoEditor = (target: Element, key: string): boolean => {
  const view = target instanceof HTMLElement ? EditorView.findFromDOM(target) : null;
  if (view === null) {
    return false;
  }
  if (key.length === 1) {
    view.dispatch(view.state.replaceSelection(key), { scrollIntoView: true, userEvent: "input.type" });
  } else if (key === "Backspace") {
    deleteCharBackward(view);
  }
  return true;
};

/**
 * A synthetic key types nothing: a letter or Backspace that no handler took is put into the focused input
 * here, with the `input` event React listens to, or into the text editor through its view.
 */
const typeInto = (target: Element, init: KeyboardEventInit): void => {
  const { key = "" } = init;
  if (!plain(init) || typeIntoEditor(target, key) || !(target instanceof HTMLInputElement)) {
    return;
  }
  const end = target.selectionEnd ?? target.value.length;
  const start = target.selectionStart ?? end;
  if (key.length === 1) {
    target.setRangeText(key, start, end, "end");
  } else if (key === "Backspace" && end > 0) {
    target.setRangeText("", start === end ? start - 1 : start, end, "end");
  } else {
    return;
  }
  target.dispatchEvent(new Event("input", { bubbles: true }));
};

/** Presses `init` on the focused element, as a keydown that bubbles to the window, and types it. */
export const pressKey = (init: KeyboardEventInit): void => {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  if (!event.defaultPrevented) {
    typeInto(target, init);
  }
};
