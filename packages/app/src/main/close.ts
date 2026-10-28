// Closing the window leaves the elements shown in it (SR-105 AK1: „wenn … das Element verlassen wird, dann
// steht die Änderung in der Datei“), also when the app quits, since Electron closes its windows first. So
// the first close of the window is held: main asks the window to save its unsaved input (SAVE_CHANNEL with
// `closing`, as before a switch of the workspace, SR-131 AK3) and closes it once the window answers that
// everything is saved. When the window answers that input is left (a change on disk, a deleted file, a
// value core refuses), the window stays open and its minibuffer says why; the window itself lets the next
// close go through. A window that does not answer in time stays open too (it is told, and says so), and a
// close within CLOSE_FREE_MS after that goes through without asking, so a window that hangs can always be
// closed; a later close asks again. No dialog (SR-105 AK3).

/** The parts of a `BrowserWindow` the guard uses. */
export interface ClosingWindow {
  on(event: "close", listener: (event: { preventDefault(): void }) => void): unknown;
  close(): void;
  isDestroyed(): boolean;
}

/**
 * How long main waits for the window to save before it closes. Longer than one save of an element on a
 * large workspace (the median is below 200 ms, N-036) and short enough for a quit.
 */
export const CLOSE_SAVE_TIMEOUT_MS = 2000;

/**
 * How long after a save that did not answer in time a close goes through without asking (a window that
 * hangs); after that, a close asks the window to save again.
 */
export const CLOSE_FREE_MS = 10_000;

/**
 * Holds every close of `window` until `save` (the window saves its unsaved input; `true`, `false` or
 * `timeout`) answers `true`, then closes it.
 */
export const guardClose = (
  window: ClosingWindow,
  save: () => Promise<boolean | "timeout">,
  log: (line: string) => void,
): void => {
  // The window may close: everything was saved.
  let free = false;
  // Until when a close goes through without asking: the window did not answer in time just before.
  let freeUntil = 0;
  let asking = false;
  window.on("close", (event) => {
    if (free || Date.now() < freeUntil) {
      return;
    }
    event.preventDefault();
    // A second close while the window saves waits for the same answer.
    if (asking) {
      return;
    }
    asking = true;
    void save().then((answer) => {
      asking = false;
      if (answer === "timeout") {
        log(
          "The window did not say in time whether its unsaved input was saved; it stays open, and a close within 10 s closes it",
        );
        freeUntil = Date.now() + CLOSE_FREE_MS;
        return;
      }
      if (answer && !window.isDestroyed()) {
        free = true;
        window.close();
      }
    });
  });
};
