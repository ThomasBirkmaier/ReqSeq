// macOS reports a swipe to the left or right to the window as its own event, `swipe`, in the main process
// only: older mouse software such as Logi Options sends the buttons Back and Forward of a mouse this way, and
// a three-finger swipe arrives so when the system pages with three fingers (SR-163 AK4, #1641). Main passes
// the direction to the window on SWIPE_CHANNEL and decides nothing (ADR-0002): which buffer it shows, and
// whether it switches at all, is the renderer's. `up`, `down` and anything else are dropped. Other systems
// have no such event, so no listener is added there.
import { SWIPE_CHANNEL, swipeDirection } from "../shared/protocol.js";

/** The parts of a `BrowserWindow` the forwarding uses. */
export interface SwipingWindow {
  on(event: "swipe", listener: (event: unknown, direction: unknown) => void): unknown;
  readonly webContents: { send(channel: string, ...args: readonly unknown[]): void };
}

/** On macOS, sends each swipe of `window` to the left or right to its page. */
export const forwardSwipes = (window: SwipingWindow, platform: NodeJS.Platform): void => {
  if (platform !== "darwin") {
    return;
  }
  window.on("swipe", (_event, value) => {
    const direction = swipeDirection(value);
    if (direction !== undefined) {
      window.webContents.send(SWIPE_CHANNEL, direction);
    }
  });
};
