import { describe, expect, it } from "vitest";
import { LIMIT, wordDiff } from "./word-diff.js";

describe("word-level difference on the element page (SR-232 AK7)", () => {
  it("[SR-232/AK-dywy] strikes removed words and marks added ones, keeping the rest and its white space as written", () => {
    expect(wordDiff("the station shows the speed", "the station shows the wind speed")).toBe(
      "the station shows the <ins>wind </ins>speed",
    );
    expect(wordDiff("shows it in km/h now", "shows it in knots now")).toBe(
      "shows it in <del>km/h </del><ins>knots </ins>now",
    );
    expect(wordDiff("a b\n\nc d", "a\n\nc")).toBe("a\n\n<del>b\n\n</del>c<del>d</del>");
    // A rewritten phrase is one mark; white space alone is no change.
    expect(wordDiff("the quick fox", "a slow dog")).toBe("<del>the quick fox</del><ins>a slow dog</ins>");
    expect(wordDiff("a b", "a  b")).toBe("a  b");
    expect(wordDiff("", "new")).toBe("<ins>new</ins>");
    expect(wordDiff("old", "")).toBe("<del>old</del>");
    expect(wordDiff("same", "same")).toBe("same");
  });

  it("escapes every part (SR-235)", () => {
    expect(wordDiff("<b> & x", "<i> & x")).toBe("<del>&lt;b&gt; </del><ins>&lt;i&gt; </ins>&amp; x");
  });

  it("shows a middle too long to compare word by word as removed and added as a whole", () => {
    const words = (prefix: string): string =>
      Array.from({ length: Math.ceil(Math.sqrt(LIMIT)) + 1 }, (_, i) => `${prefix}${String(i)}`).join(" ");
    const before = `start ${words("a")} end`;
    const after = `start ${words("b")} end`;
    expect(wordDiff(before, after)).toBe(`start <del>${words("a")} </del><ins>${words("b")} </ins>end`);
  });
});
