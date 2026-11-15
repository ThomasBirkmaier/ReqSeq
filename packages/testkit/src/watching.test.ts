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

  it("gives up after the timeout and names the probes, the time and the slowest probe and check", async () => {
    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    const error = await untilWatching({
      probe: () => wait(30),
      seen: () => wait(20).then(() => false),
      timeoutMs: 200,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    const match =
      /^the watcher saw no probe change in time: (\d+) probes in (\d+) ms, the slowest probe took (\d+) ms, the slowest check (\d+) ms$/.exec(
        (error as Error).message,
      );
    const [probes, waited, probe, check] = (match ?? []).slice(1).map(Number);
    expect(probes).toBeGreaterThanOrEqual(1);
    expect(waited).toBeGreaterThanOrEqual(200);
    expect(probe).toBeGreaterThanOrEqual(25);
    expect(check).toBeGreaterThanOrEqual(15);
  });
});
