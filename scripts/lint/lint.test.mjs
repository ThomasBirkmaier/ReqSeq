import { describe, expect, it } from "vitest";
import { lintGroups } from "./lint.mjs";

describe("lint.mjs", () => {
  it("lints core in a process of its own and everything else in a second", () => {
    expect(lintGroups(["--fix"])).toEqual([
      ["packages/core", "--max-warnings", "0", "--fix"],
      [".", "--ignore-pattern", "packages/core/**", "--max-warnings", "0", "--fix"],
    ]);
  });
});
