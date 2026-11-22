import { describe, expect, it, vi } from "vitest";

/** The answers of the commands the queues read, each held until the test lets it go. */
const pending: { command: string; resolve: (value: unknown) => void }[] = [];
vi.mock("./api.js", () => ({
  call: (command: string) =>
    new Promise((resolve) => {
      pending.push({ command, resolve });
    }),
}));

const { queueData } = await import("./queues.js");
const { store } = await import("./store.js");

/** Lets the first `count` held answers go, with `degreeTotal` as the verification degree's total. */
const answer = (count: number, degreeTotal: number): void => {
  for (const { command, resolve } of pending.splice(0, count)) {
    resolve(
      command === "evidence.degree"
        ? {
            degree: {
              total: degreeTotal,
              counts: { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 },
            },
          }
        : command === "hint.list"
          ? { hints: [], total: 0 }
          : { levels: [] },
    );
  }
};

describe("queueData", () => {
  it("does not hand a read of an older load of the store to a newer one", async () => {
    store.epoch = 1;
    const older = queueData();
    const calls = pending.length;
    store.epoch = 2;
    const newer = queueData();
    expect(pending).toHaveLength(2 * calls);
    answer(calls, 1);
    answer(calls, 2);
    expect((await older).epoch).toBe(1);
    const read = await newer;
    expect(read.epoch).toBe(2);
    expect(read.degree.degree.total).toBe(2);
    expect(await queueData()).toBe(read);
  });
});
