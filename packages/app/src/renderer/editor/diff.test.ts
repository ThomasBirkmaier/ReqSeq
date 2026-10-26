import { describe, expect, it } from "vitest";
import { minimalChange } from "./diff.js";

const apply = (before: string, after: string): string => {
  const change = minimalChange(before, after);
  return before.slice(0, change.from) + change.insert + before.slice(change.to);
};

describe("minimalChange", () => {
  it("is empty for equal texts", () => {
    expect(minimalChange("abc", "abc")).toEqual({ from: 3, to: 3, insert: "" });
  });

  it("keeps the common beginning and end", () => {
    expect(minimalChange("one two three", "one 2 three")).toEqual({ from: 4, to: 7, insert: "2" });
  });

  it("handles an insertion, a deletion and unrelated texts", () => {
    expect(minimalChange("ab", "aXb")).toEqual({ from: 1, to: 1, insert: "X" });
    expect(minimalChange("aXb", "ab")).toEqual({ from: 1, to: 2, insert: "" });
    expect(minimalChange("abc", "xyz")).toEqual({ from: 0, to: 3, insert: "xyz" });
    expect(minimalChange("", "abc")).toEqual({ from: 0, to: 0, insert: "abc" });
  });

  it("does not let the beginning and the end overlap", () => {
    expect(minimalChange("aa", "aaa")).toEqual({ from: 2, to: 2, insert: "a" });
    expect(apply("aa", "aaa")).toBe("aaa");
    expect(apply("abab", "ab")).toBe("ab");
  });
});
