// The checkers of the process as the app's main process uses them: `findTypedWorkspace` and
// `workspaceExists` without an injected `check` (#574, review of #614 S1). The module-level checkers take
// `fs.stat` when the module loads, so `node:fs/promises` is mocked before it is imported.
import type * as FsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stat = vi.hoisted(() =>
  vi.fn((file: string): Promise<{ isFile: () => boolean }> => {
    if (file.includes("nfs")) {
      // A dead mount: the `stat` never returns.
      return new Promise(() => undefined);
    }
    if (file.includes("local")) {
      return Promise.resolve({ isFile: () => true });
    }
    return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  }),
);

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>();
  return { ...original, default: { ...original, stat }, stat };
});

const { EXISTS_TIMEOUT_MS, findTypedWorkspace, workspaceExists } = await import("./recent.js");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the existence checkers of the process", () => {
  it("[SR-131/AK5] a typed path on a hung mount blocks only further typed paths, by default too, never a chosen root", async () => {
    let typed: string | undefined | null = null;
    void findTypedWorkspace("/top/nfs", { platform: "linux" }).then((found) => {
      typed = found;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stat).toHaveBeenCalledTimes(1);
    // The chosen root has a slot of its own: it answers at once, while the typed path still hangs.
    let chosen: boolean | undefined;
    void workspaceExists("/top/local").then((exists) => {
      chosen = exists;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(chosen).toBe(true);
    expect(typed).toBeNull();
    // The hung level ends the walk after the timeout.
    await vi.advanceTimersByTimeAsync(EXISTS_TIMEOUT_MS);
    expect(typed).toBeUndefined();
    // The typed checker's one slot is still held: a second typed path gets no `stat` and times out.
    const calls = stat.mock.calls.length;
    let other: string | undefined | null = null;
    void findTypedWorkspace("/top/other", { platform: "linux" }).then((found) => {
      other = found;
    });
    await vi.advanceTimersByTimeAsync(EXISTS_TIMEOUT_MS - 1);
    expect(other).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(other).toBeUndefined();
    expect(stat).toHaveBeenCalledTimes(calls);
  });
});
