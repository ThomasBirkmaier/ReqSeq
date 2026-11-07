// The keys a prompt held while its Enter waited for core (#467), pressed again one by one on what has the
// focus, once the answer is shown: a shortcut acts on what the Enter opened, and the text typed after it
// goes into the prompt the shortcut opened.

/**
 * Waits for the render a key caused (a prompt that opens takes the focus) before the next key: React
 * renders an update from outside its own handlers in a later task, so one frame and a task after it.
 */
const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });

/**
 * A synthetic key types nothing: a letter or Backspace that no handler took is put into the focused input
 * here, with the `input` event React listens to. Other targets (the text editor) get the key only.
 */
const typeInto = (target: Element, init: KeyboardEventInit): void => {
  const { key = "" } = init;
  if (!(target instanceof HTMLInputElement) || init.ctrlKey === true || init.metaKey === true) {
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

/** Presses `keys` again in their order on the focused element, each after the render of the one before. */
export const replayKeys = async (
  keys: readonly KeyboardEventInit[],
  wait: () => Promise<void> = nextTask,
): Promise<void> => {
  for (const init of keys) {
    const target = document.activeElement ?? document.body;
    const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    if (!event.defaultPrevented) {
      typeInto(target, init);
    }
    await wait();
  }
};
