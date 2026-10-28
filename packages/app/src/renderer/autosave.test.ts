import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_MS, createAutosave } from "./autosave.js";

/** A save that answers when the test says so. */
const deferredSave = () => {
  const answers: (() => void)[] = [];
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        answers.push(resolve);
      }),
  );
  return {
    save,
    answer: async (): Promise<void> => {
      answers.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    },
  };
};

describe("createAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("[SR-105/AK1] saves once, one second after the last input, not before", async () => {
    const save = vi.fn(() => Promise.resolve());
    const autosave = createAutosave({ save, held: () => false });
    autosave.input();
    await vi.advanceTimersByTimeAsync(500);
    autosave.input();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.busy()).toBe(false);
  });

  it("runs one save at a time: input during a save waits for its answer, then for the rest of its second", async () => {
    const { save, answer } = deferredSave();
    const autosave = createAutosave({ save, held: () => false });
    autosave.input();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    autosave.input();
    expect(autosave.busy()).toBe(true);
    // The second has passed while the first save runs: nothing goes out before its answer.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    expect(save).toHaveBeenCalledTimes(1);
    await answer();
    expect(save).toHaveBeenCalledTimes(2);
    // An answer within the second: the next save waits for the rest of it.
    autosave.input();
    await answer();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("waits while input is still going on, and saves when the hold ends", async () => {
    let held = true;
    const save = vi.fn(() => Promise.resolve());
    const autosave = createAutosave({ save, held: () => held });
    autosave.input();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 3);
    expect(save).not.toHaveBeenCalled();
    autosave.release();
    expect(save).not.toHaveBeenCalled();
    held = false;
    autosave.release();
    expect(save).toHaveBeenCalledTimes(1);
    // Nothing waits: a release saves nothing.
    autosave.release();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a release before the second is over waits for it", async () => {
    const save = vi.fn(() => Promise.resolve());
    const autosave = createAutosave({ save, held: () => false });
    autosave.input();
    autosave.release();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("[SR-105/AK1] saves at once when asked, after the save that runs, in place of the one that waits", async () => {
    const { save, answer } = deferredSave();
    const autosave = createAutosave({ save, held: () => true });
    expect(await autosave.now(() => Promise.resolve("idle"))).toBe("idle");
    autosave.input();
    autosave.release();
    const job = vi.fn(() => Promise.resolve("done"));
    // A hold does not keep it back.
    const first = autosave.now(save);
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    autosave.input();
    const second = autosave.now(job);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
    expect(job).not.toHaveBeenCalled();
    await answer();
    await first;
    expect(await second).toBe("done");
    expect(job).toHaveBeenCalledTimes(1);
    // The input that waited went with the job: no second save follows.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a save asked for now takes the input that came while it waited", async () => {
    const { save, answer } = deferredSave();
    const autosave = createAutosave({ save, held: () => false, delay: 100 });
    autosave.input();
    await vi.advanceTimersByTimeAsync(100);
    const job = vi.fn(() => Promise.resolve(1));
    const later = autosave.now(job);
    autosave.input();
    await answer();
    await later;
    expect(job).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.busy()).toBe(false);
  });

  it("keeps going after a job that rejects", async () => {
    const save = vi.fn(() => Promise.resolve());
    const autosave = createAutosave({ save, held: () => false });
    await expect(autosave.now(() => Promise.reject(new Error("refused")))).rejects.toThrow("refused");
    autosave.input();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer once disposed", async () => {
    const save = vi.fn(() => Promise.resolve());
    const autosave = createAutosave({ save, held: () => false });
    autosave.input();
    autosave.dispose();
    autosave.input();
    autosave.release();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });
});
