import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { GoneDetails } from "./renderer-gone.js";
import { RELOAD_LIMIT, RELOAD_WINDOW_MS, reloadWhenGone } from "./renderer-gone.js";

const fakeWindow = () => {
  const contents = Object.assign(new EventEmitter(), { reload: vi.fn() });
  const window = { webContents: contents, destroyed: false, isDestroyed: () => window.destroyed };
  const gone = (reason: string): void => {
    contents.emit("render-process-gone", {}, { reason, exitCode: 5 } satisfies GoneDetails);
  };
  return { window, contents, gone };
};

describe("the page of the window is loaded again when its renderer ends", () => {
  it("reloads after a crash and says so in the log", () => {
    const { window, contents, gone } = fakeWindow();
    const log = vi.fn();
    reloadWhenGone(window, log);
    gone("crashed");
    expect(contents.reload).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("The window's page ended (crashed, exit code 5); it is loaded again");
  });

  it("does nothing for a clean exit or a destroyed window", () => {
    const { window, contents, gone } = fakeWindow();
    reloadWhenGone(window, vi.fn());
    gone("clean-exit");
    window.destroyed = true;
    gone("killed");
    expect(contents.reload).not.toHaveBeenCalled();
  });

  it(`stops after ${String(RELOAD_LIMIT)} reloads within the window of time, and reloads again once it has passed`, () => {
    const { window, contents, gone } = fakeWindow();
    const log = vi.fn();
    let time = 1000;
    reloadWhenGone(window, log, () => time);
    for (let count = 0; count < RELOAD_LIMIT + 1; count += 1) {
      gone("oom");
    }
    expect(contents.reload).toHaveBeenCalledTimes(RELOAD_LIMIT);
    expect(log).toHaveBeenLastCalledWith(
      `The window's page ended (oom, exit code 5) ${String(RELOAD_LIMIT + 1)} times within ${String(RELOAD_WINDOW_MS / 1000)} s; it is not loaded again`,
    );
    time += RELOAD_WINDOW_MS;
    gone("crashed");
    expect(contents.reload).toHaveBeenCalledTimes(RELOAD_LIMIT + 1);
  });

  it("uses the clock by default", () => {
    const { window, contents, gone } = fakeWindow();
    reloadWhenGone(window, vi.fn());
    gone("crashed");
    expect(contents.reload).toHaveBeenCalledOnce();
  });
});
