import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvokeResult } from "../shared/protocol.js";
import { idle, trackCalls } from "./call-turn.js";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("calls that give way (SR-118 AK8)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives a turn only once no wrapped call is pending, after the window is idle", async () => {
    const answers: ((result: InvokeResult) => void)[] = [];
    const idled = vi.fn(() => Promise.resolve());
    const tracker = trackCalls(idled);
    const invoke = tracker.wrap(
      () =>
        new Promise<InvokeResult>((resolve) => {
          answers.push(resolve);
        }),
    );
    const first = invoke("element.list", {});
    const second = invoke("element.get", {});
    let turned = false;
    void tracker.turn().then(() => {
      turned = true;
    });
    await tick();
    expect(idled).toHaveBeenCalledTimes(1);
    expect(turned).toBe(false);
    answers[0]?.({ ok: true, output: {} });
    await first;
    await tick();
    expect(turned).toBe(false);
    answers[1]?.({ ok: true, output: {} });
    await second;
    await tick();
    expect(turned).toBe(true);
    // With nothing pending, at once.
    await expect(tracker.turn()).resolves.toBeUndefined();
  });

  it("counts a failed call as answered too", async () => {
    const tracker = trackCalls(() => Promise.resolve());
    const invoke = tracker.wrap(() => Promise.reject(new Error("gone")));
    await expect(invoke("element.list", {})).rejects.toThrow("gone");
    await tick();
    await expect(tracker.turn()).resolves.toBeUndefined();
  });

  it("waits for an idle callback where the window has one, else for the next task", async () => {
    const request = vi.fn((callback: () => void) => {
      callback();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", request);
    await idle();
    expect(request).toHaveBeenCalledWith(expect.any(Function), { timeout: 1_000 });
    vi.stubGlobal("requestIdleCallback", undefined);
    await expect(idle()).resolves.toBeUndefined();
  });
});
