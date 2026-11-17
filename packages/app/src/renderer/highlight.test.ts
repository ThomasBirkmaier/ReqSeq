import { describe, expect, it } from "vitest";
import { highlightRanges, trimLead } from "./highlight.js";

describe("highlightRanges", () => {
  it("cuts the text at the ranges", () => {
    expect(
      highlightRanges("Search elements", [
        [0, 1],
        [3, 6],
      ]),
    ).toEqual([
      { text: "S", mark: true },
      { text: "ea", mark: false },
      { text: "rch", mark: true },
      { text: " elements", mark: false },
    ]);
    expect(highlightRanges("abc", [])).toEqual([{ text: "abc", mark: false }]);
    expect(highlightRanges("abc", [[0, 3]])).toEqual([{ text: "abc", mark: true }]);
    expect(highlightRanges("", [])).toEqual([]);
  });
});

describe("trimLead", () => {
  const text = "The station records pressure and rain, and it sounds an alarm at a squall.";
  const at = text.indexOf("squall");

  it("[SR-174/AK-mxnw] cuts the words before the first mark at a word start, leads with …, and moves the marks", () => {
    const trimmed = trimLead(text, [[at, at + 6]], 11);
    expect(trimmed.text).toBe("…alarm at a squall.");
    const [range] = trimmed.ranges;
    expect(range === undefined ? "" : trimmed.text.slice(range[0], range[1])).toBe("squall");
  });

  it("cuts at the mark when no word begins within keep, and keeps a text that has little before its mark", () => {
    expect(trimLead(text, [[at, at + 6]], 0)).toEqual({ text: "…squall.", ranges: [[1, 7]] });
    expect(trimLead("The squall.", [[4, 10]], 10)).toEqual({ text: "The squall.", ranges: [[4, 10]] });
    expect(trimLead(text, [], 0)).toEqual({ text, ranges: [] });
  });
});
