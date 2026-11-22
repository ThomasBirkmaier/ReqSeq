import { describe, expect, it } from "vitest";
import { crateProblems, parseTree, spdxOf } from "./crates.mjs";

describe("crates.mjs", () => {
  it("reads each crate of cargo tree once and leaves out the workspace's own", () => {
    const text = [
      "shell v0.0.0 (/repo/packages/shell/shell)|UNLICENSED",
      "launcher v0.0.0 (C:\\repo\\packages\\shell\\launcher)|UNLICENSED",
      "url v2.5.9|MIT OR Apache-2.0",
      "url v2.5.9|MIT OR Apache-2.0 (*)",
      "icu_normalizer v2.4.0|Unicode-3.0",
      "nameless v1.0.0|",
      "",
    ].join("\n");
    expect(parseTree(text)).toEqual([
      { name: "url", version: "2.5.9", license: "MIT OR Apache-2.0" },
      { name: "icu_normalizer", version: "2.4.0", license: "Unicode-3.0" },
      { name: "nameless", version: "1.0.0", license: null },
    ]);
  });

  it("reads the old slash spelling as OR and names every crate outside the allowlist", () => {
    expect(spdxOf("MIT/Apache-2.0")).toBe("MIT OR Apache-2.0");
    expect(spdxOf("Apache-2.0 / MIT")).toBe("Apache-2.0 OR MIT");
    expect(
      crateProblems([
        { name: "a", version: "1.0.0", license: "MIT/Apache-2.0" },
        { name: "b", version: "1.0.0", license: "Zlib" },
        { name: "c", version: "1.0.0", license: null },
        { name: "b", version: "1.0.0", license: "Zlib" },
        { name: "e", version: "1.0.0", license: "(MIT OR Apache-2.0) AND Unicode-3.0" },
        { name: "d", version: "1.0.0", license: "Apache-2.0 WITH LLVM-exception" },
      ]),
    ).toEqual([
      "b@1.0.0: Zlib",
      "c@1.0.0: no licence in its manifest",
      "d@1.0.0: Apache-2.0 WITH LLVM-exception",
    ]);
  });
});
