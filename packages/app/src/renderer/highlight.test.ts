import { describe, expect, it } from "vitest";
import { highlightRanges, highlightTerms } from "./highlight.js";

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

describe("highlightTerms", () => {
  it("marks the words that a term begins, in any case", () => {
    expect(highlightTerms("Wind speed of the Wind", ["wind"])).toEqual([
      { text: "Wind", mark: true },
      { text: " speed of the ", mark: false },
      { text: "Wind", mark: true },
    ]);
  });

  it("does not mark inside a word", () => {
    expect(highlightTerms("Rewind", ["wind"])).toEqual([{ text: "Rewind", mark: false }]);
  });

  it("marks an ID in a text, and merges overlapping terms", () => {
    expect(highlightTerms("SR-100 Hauptansicht", ["sr-100", "sr"])).toEqual([
      { text: "SR-100", mark: true },
      { text: " Hauptansicht", mark: false },
    ]);
    expect(highlightTerms("windy", ["wind", "windy"])).toEqual([{ text: "windy", mark: true }]);
    expect(highlightTerms("windy day", ["day", "wind"])).toEqual([
      { text: "wind", mark: true },
      { text: "y ", mark: false },
      { text: "day", mark: true },
    ]);
  });

  it("marks nothing without terms or for an empty term", () => {
    expect(highlightTerms("Wind", [])).toEqual([{ text: "Wind", mark: false }]);
    expect(highlightTerms("Wind", [""])).toEqual([{ text: "Wind", mark: false }]);
  });
});
