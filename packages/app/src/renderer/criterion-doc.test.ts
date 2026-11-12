// The document of the criteria box with the key of each line (SR-204).
import { describe, expect, it } from "vitest";
import { KEY_MARK, criterionLines, isCriteriaInfo, keyedDoc, shownDoc } from "./criterion-doc.js";
import type { PropertyInfo } from "./element-view.js";

const criteria: PropertyInfo = { kind: "text", many: true, markdown: true, meaning: "acceptance-criteria" };

describe("criterion-doc", () => {
  it("writes and reads the key of each line; a blank line, and a line of a draft without keys, hold none", () => {
    const doc = keyedDoc(["a", " ", "b", "c"], ["kaaa", "kbbb", undefined, "kccc"]);
    expect(doc).toBe(`kaaa${KEY_MARK}a\n \n${KEY_MARK}b\nkccc${KEY_MARK}c`);
    expect(criterionLines(doc)).toEqual({
      lines: ["a", " ", "b", "c"],
      keys: ["kaaa", undefined, undefined, "kccc"],
    });
    expect(criterionLines("old draft")).toEqual({ lines: ["old draft"], keys: [undefined] });
  });

  it("shows the texts of the criteria box only, and every other box as it is", () => {
    expect(shownDoc(criteria, `kaaa${KEY_MARK}a\n${KEY_MARK}b`)).toBe("a\nb");
    const plain: PropertyInfo = { kind: "text", many: true, markdown: false };
    expect(shownDoc(plain, `x${KEY_MARK}y`)).toBe(`x${KEY_MARK}y`);
    expect(shownDoc(undefined, "z")).toBe("z");
    expect(isCriteriaInfo({ ...criteria, many: false })).toBe(false);
  });
});
