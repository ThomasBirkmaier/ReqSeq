import { describe, expect, it } from "vitest";
import { criteriaCopy } from "./criterion-copy.js";

describe("criteriaCopy", () => {
  it("puts each criterion's reference before its text and copies all of them line by line", () => {
    const copy = criteriaCopy(
      ["The first.", "The second."],
      [
        { criterion: 1, reference: "[SR-1/AK-abcd]" },
        { criterion: 2, reference: "[SR-1/AK-efgh]" },
      ],
    );
    expect(copy).toEqual({
      rows: ["[SR-1/AK-abcd] The first.", "[SR-1/AK-efgh] The second."],
      all: "[SR-1/AK-abcd] The first.\n[SR-1/AK-efgh] The second.",
    });
  });

  it("copies a criterion without a reference as its text", () => {
    expect(
      criteriaCopy(["Keyless.", "Keyed."], [{ criterion: 1 }, { criterion: 2, reference: "[X-a/AK-k7f3]" }]),
    ).toEqual({ rows: ["Keyless.", "[X-a/AK-k7f3] Keyed."], all: "Keyless.\n[X-a/AK-k7f3] Keyed." });
    expect(criteriaCopy(["Only text."])).toEqual({ rows: ["Only text."], all: "Only text." });
  });
});
