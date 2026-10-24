import { describe, expect, it } from "vitest";
import { untilWatching } from "./index.js";

describe("untilWatching", () => {
  it("repeats the probe until the watcher has seen one", async () => {
    const attempts: number[] = [];
    await untilWatching({
      probe: (attempt) => {
        attempts.push(attempt);
        return Promise.resolve();
      },
      seen: () => Promise.resolve(attempts.length >= 3),
      intervalMs: 20,
    });
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("gives up after the timeout", async () => {
    await expect(
      untilWatching({ probe: () => Promise.resolve(), seen: () => Promise.resolve(false), timeoutMs: 50 }),
    ).rejects.toThrow("the watcher saw no probe change in time");
  });
});
