// The draw a swipe asks for (SR-211 AK3): one buffer at a time, resolved once it is drawn, at once when it is
// drawn in advance already, and given up when the swipe ends, another draw takes its place or the buffer goes.
import { describe, expect, it, vi } from "vitest";
import { SwipeDraw } from "./swipe-draw.js";

const host = (ready: readonly string[] = []) => ({
  ready: vi.fn((key: string) => ready.includes(key)),
  undrop: vi.fn<(key: string) => void>(),
});

describe("SwipeDraw", () => {
  it("[SR-211/AK-wfd3] draws a buffer not drawn in advance: it is the key while the swipe lasts, resolved once drawn", async () => {
    const swipe = new SwipeDraw();
    const window = host();
    swipe.attach(window);
    const changed = vi.fn();
    const stop = swipe.subscribe(changed);
    const drawn = swipe.draw("list");
    expect(swipe.key).toBe("list");
    expect(window.undrop).toHaveBeenCalledWith("list");
    expect(changed).toHaveBeenCalledTimes(1);
    swipe.ready("other");
    swipe.ready("list");
    await expect(drawn).resolves.toBe(true);
    // Drawn, it stays the key until the swipe ends.
    expect(swipe.key).toBe("list");
    swipe.end();
    expect(swipe.key).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(2);
    swipe.end();
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
  });

  it("[SR-211/AK-wfd3] a buffer drawn in advance already resolves at once", async () => {
    const swipe = new SwipeDraw();
    swipe.attach(host(["element"]));
    await expect(swipe.draw("element")).resolves.toBe(true);
    expect(swipe.key).toBe("element");
  });

  it("[SR-211/AK-ck1v] gives up when another draw takes its place, the swipe ends, or the buffer is closed", async () => {
    const swipe = new SwipeDraw();
    swipe.attach(host());
    const first = swipe.draw("a");
    const second = swipe.draw("b");
    await expect(first).resolves.toBe(false);
    expect(swipe.key).toBe("b");
    swipe.open(["a", "b"]);
    expect(swipe.key).toBe("b");
    swipe.open(["a"]);
    await expect(second).resolves.toBe(false);
    expect(swipe.key).toBeUndefined();
    const third = swipe.draw("c");
    swipe.end();
    await expect(third).resolves.toBe(false);
    swipe.open([]);
  });

  it("draws nothing for a window that never attached", async () => {
    const swipe = new SwipeDraw();
    const drawn = swipe.draw("a");
    swipe.ready("a");
    await expect(drawn).resolves.toBe(true);
  });
});
