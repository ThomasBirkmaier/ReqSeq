// When the inactive area follows the marked element (SR-150 AK4): only a new selection in the same buffer.
import { describe, expect, it } from "vitest";
import type { MarkState } from "./follow-mark.js";
import { NO_MARK, markStep } from "./follow-mark.js";

const state = (token: string, marked: string | undefined, split = true): MarkState => ({
  buffer: "list",
  token,
  marked,
  other: split ? "e9" : undefined,
});

describe("markStep (SR-150 AK4)", () => {
  it("[SR-150/AK4] follows a new selection in the same buffer, also when its element comes a render later", () => {
    expect(markStep(state("0", "e1"), state("1", "e2"), undefined)).toEqual({
      pending: undefined,
      follow: true,
    });
    const waiting = markStep(state("0", "e1"), state("1", "e1"), undefined);
    expect(waiting).toEqual({ pending: { marked: "e1" }, follow: false });
    expect(markStep(state("1", "e1"), state("1", "e2"), waiting.pending)).toEqual({
      pending: undefined,
      follow: true,
    });
    // A fresh list: no element before the first selection.
    expect(markStep(state("-1", undefined), state("0", "e1"), undefined).follow).toBe(true);
  });

  it("moves nothing on another buffer, without a split, on a split without a new selection, or on a reload", () => {
    expect(markStep(NO_MARK, state("1", "e2"), undefined)).toEqual({ pending: undefined, follow: false });
    expect(markStep(state("0", "e1"), state("1", "e2", false), undefined).follow).toBe(false);
    expect(markStep(state("1", "e1", false), state("1", "e2"), { marked: "e0" })).toEqual({
      pending: undefined,
      follow: false,
    });
    // Reading again: the same selection, the element comes back.
    expect(markStep(state("1", undefined), state("1", "e1"), undefined)).toEqual({
      pending: undefined,
      follow: false,
    });
  });
});
