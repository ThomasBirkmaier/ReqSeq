import { describe, expect, it } from "vitest";
import { NO_HISTORY, record, redo, undo } from "./value-history.js";

describe("value history of a choice or relation box", () => {
  it("[SR-105/AK2] steps back and forth through the values since the buffer was opened", () => {
    const history = record(record(NO_HISTORY, "draft", "approved"), "approved", "rejected");
    const back = undo(history, "rejected");
    expect(back?.doc).toBe("approved");
    const first = undo(back?.history ?? NO_HISTORY, "approved");
    expect(first?.doc).toBe("draft");
    expect(undo(first?.history ?? NO_HISTORY, "draft")).toBeUndefined();
    const forth = redo(first?.history ?? NO_HISTORY, "draft");
    expect(forth?.doc).toBe("approved");
    expect(redo(forth?.history ?? NO_HISTORY, "approved")?.doc).toBe("rejected");
  });

  it("drops what was undone on a new change, and records no change that changes nothing", () => {
    const undone = undo(record(NO_HISTORY, "a", "b"), "b")?.history ?? NO_HISTORY;
    expect(undone).toEqual({ done: [], undone: ["b"] });
    expect(record(undone, "a", "c")).toEqual({ done: ["a"], undone: [] });
    expect(record(undone, "a", "a")).toBe(undone);
    expect(redo(NO_HISTORY, "a")).toBeUndefined();
  });
});
