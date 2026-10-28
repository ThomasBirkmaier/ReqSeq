import { describe, expect, it } from "vitest";
import type { UndoMemory } from "./buffer-memory.js";
import { forgetClosed, memoryOf, queueSave, savesDone } from "./buffer-memory.js";

describe("memoryOf and forgetClosed", () => {
  it("[SR-105/AK2] keeps one undo memory per open buffer and drops those of closed buffers", () => {
    const all = new Map<string, UndoMemory>();
    const one = memoryOf(all, "a");
    one.editors.set("Text", { doc: "x" });
    expect(memoryOf(all, "a")).toBe(one);
    memoryOf(all, "b");
    forgetClosed(all, ["b"]);
    expect([...all.keys()]).toEqual(["b"]);
    expect(memoryOf(all, "a").editors.size).toBe(0);
  });
});

describe("queueSave and savesDone", () => {
  it("runs the saves of one buffer in order, also after one that fails, and says when none is left", async () => {
    const queue = new Map<string, Promise<unknown>>();
    const order: string[] = [];
    let release: (() => void) | undefined;
    const first = queueSave(
      queue,
      "a",
      () =>
        new Promise<string>((resolve) => {
          release = () => {
            order.push("first");
            resolve("one");
          };
        }),
    );
    const failing = queueSave(queue, "a", () => Promise.reject(new Error("refused")));
    const third = queueSave(queue, "a", () => {
      order.push("third");
      return Promise.resolve(3);
    });
    const other = queueSave(queue, "b", () => {
      order.push("other");
      return Promise.resolve(0);
    });
    await other;
    expect(order).toEqual(["other"]);
    let done = false;
    const idle = savesDone(queue, "a").then(() => {
      done = true;
    });
    release?.();
    expect(await first).toBe("one");
    await expect(failing).rejects.toThrow("refused");
    expect(await third).toBe(3);
    await idle;
    expect(done).toBe(true);
    expect(order).toEqual(["other", "first", "third"]);
    expect(queue.size).toBe(0);
    await savesDone(queue, "a");
  });
});
