// The page of the window can end without the window: its renderer process crashed, ran out of memory or
// was killed. Then the window would stay blank and its unsaved input would be gone (#270). Main loads the
// page again in the same window, without a dialog (SR-105 AK3); the page finds the workspace open in the
// core process, its buffers in local storage (SR-115 AK4) and its drafts in the window's session storage
// (`draft-store.ts`), and its minibuffer says that the input came back. A page that keeps ending is
// loaded again at most RELOAD_LIMIT times within RELOAD_WINDOW_MS, so a bug that crashes it at start does
// not loop; after that the window stays as it is and a line in the log says why.

/** Why the page ended, as Electron's `render-process-gone` gives it. */
export interface GoneDetails {
  readonly reason: string;
  readonly exitCode: number;
}

/** The parts of a `BrowserWindow` the guard uses. */
export interface ReloadingWindow {
  readonly webContents: {
    on(event: "render-process-gone", listener: (event: unknown, details: GoneDetails) => void): unknown;
    reload(): void;
  };
  isDestroyed(): boolean;
}

/** How often within RELOAD_WINDOW_MS the page is loaded again after it ended. */
export const RELOAD_LIMIT = 3;

/** The time in which at most RELOAD_LIMIT reloads happen. */
export const RELOAD_WINDOW_MS = 60_000;

const WITHIN = `${String(RELOAD_WINDOW_MS / 1000)} s`;

const ended = (details: GoneDetails): string =>
  `The window's page ended (${details.reason}, exit code ${String(details.exitCode)})`;

/** Loads the page of `window` again whenever its renderer process ends other than by a clean exit. */
export const reloadWhenGone = (
  window: ReloadingWindow,
  log: (line: string) => void,
  now: () => number = Date.now,
): void => {
  // When the page was loaded again lately, oldest first.
  let reloads: number[] = [];
  window.webContents.on("render-process-gone", (_event, details) => {
    // A clean exit is the window closing; a destroyed window has no page to load.
    if (details.reason === "clean-exit" || window.isDestroyed()) {
      return;
    }
    const at = now();
    reloads = reloads.filter((time) => at - time < RELOAD_WINDOW_MS);
    if (reloads.length >= RELOAD_LIMIT) {
      log(`${ended(details)} ${String(RELOAD_LIMIT + 1)} times within ${WITHIN}; it is not loaded again`);
      return;
    }
    reloads.push(at);
    log(`${ended(details)}; it is loaded again`);
    window.webContents.reload();
  });
};
