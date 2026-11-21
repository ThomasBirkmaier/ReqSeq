import { describe, expect, it } from "vitest";
import { lintGroups } from "./lint.mjs";

describe("lint.mjs", () => {
  it("lints core and app in processes of their own and everything else in a third", () => {
    expect(lintGroups(["--fix"])).toEqual([
      ["packages/core", "--max-warnings", "0", "--fix"],
      ["packages/app", "--max-warnings", "0", "--fix"],
      [
        ".",
        "--ignore-pattern",
        "packages/core/**",
        "--ignore-pattern",
        "packages/app/**",
        "--max-warnings",
        "0",
        "--fix",
      ],
    ]);
  });
});
