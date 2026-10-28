// The window is closed only after it saved its unsaved input (SR-105 AK1), also when the app quits.
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { CLOSE_FREE_MS, guardClose } from "./close.js";

class FakeWindow extends EventEmitter {
  destroyed = false;
  readonly close = vi.fn(() => {
    this.attempt();
  });

  /** A close of the window, by the user or by a quit: whether it went through. */
  attempt(): boolean {
    let prevented = false;
    this.emit("close", {
      preventDefault: () => {
        prevented = true;
      },
    });
    return !prevented;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

/** Lets the answers that are due arrive. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("closing the window (SR-105 AK1)", () => {
  it("[SR-105/AK1] holds the close until the window saved its input, then closes it", async () => {
    const window = new FakeWindow();
    let answer: (saved: boolean | "timeout") => void = () => undefined;
    const save = vi.fn(
      () =>
        new Promise<boolean | "timeout">((resolve) => {
          answer = resolve;
        }),
    );
    guardClose(window, save, vi.fn());
    expect(window.attempt()).toBe(false);
    // A second close while the window saves asks no second time.
    expect(window.attempt()).toBe(false);
    expect(save).toHaveBeenCalledOnce();
    expect(window.close).not.toHaveBeenCalled();
    answer(true);
    await tick();
    expect(window.close).toHaveBeenCalledOnce();
    // The close that main made went through, and so does any later one.
    expect(window.attempt()).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it("keeps the window open when input is left; the next close asks the window again", async () => {
    const window = new FakeWindow();
    const save = vi.fn(() => Promise.resolve<boolean | "timeout">(false));
    guardClose(window, save, vi.fn());
    expect(window.attempt()).toBe(false);
    await tick();
    expect(window.close).not.toHaveBeenCalled();
    // The window answers true the second time: it discards what it could not save.
    save.mockResolvedValueOnce(true);
    expect(window.attempt()).toBe(false);
    await tick();
    expect(save).toHaveBeenCalledTimes(2);
    expect(window.close).toHaveBeenCalledOnce();
  });

  it("a window that did not answer in time stays open; a close within CLOSE_FREE_MS closes it without asking, a later one asks again", async () => {
    vi.useFakeTimers();
    try {
      const window = new FakeWindow();
      const log = vi.fn();
      const save = vi.fn(() => Promise.resolve<boolean | "timeout">("timeout"));
      guardClose(window, save, log);
      expect(window.attempt()).toBe(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(window.close).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledExactlyOnceWith(
        "The window did not say in time whether its unsaved input was saved; it stays open, and a close within 10 s closes it",
      );
      // Soon after: the window may hang, so the close goes through.
      await vi.advanceTimersByTimeAsync(1000);
      expect(window.attempt()).toBe(true);
      expect(save).toHaveBeenCalledOnce();
      // After CLOSE_FREE_MS a close asks the window to save again.
      await vi.advanceTimersByTimeAsync(CLOSE_FREE_MS);
      save.mockResolvedValueOnce(false);
      expect(window.attempt()).toBe(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(save).toHaveBeenCalledTimes(2);
      expect(window.close).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not close a window that is gone meanwhile", async () => {
    const window = new FakeWindow();
    guardClose(window, () => Promise.resolve<boolean | "timeout">(true), vi.fn());
    window.attempt();
    window.destroyed = true;
    await tick();
    expect(window.close).not.toHaveBeenCalled();
  });
});
