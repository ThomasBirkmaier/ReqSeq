import { describe, expect, it } from "vitest";
import { overviewDisplay, typeCounts } from "./overview.js";

const METAMODEL = {
  types: [
    { key: "need", name: "Need" },
    { key: "system-requirement", name: "System Requirement" },
    { key: "package", name: "Package" },
  ],
};

describe("overview display (ADR-0019)", () => {
  it("counts each type as written, in the metamodel's order, then unknown types as they first appear", () => {
    const elements = ["mystery", "system-requirement", "need", "other", "system-requirement", "mystery"].map(
      (type) => ({ type }),
    );
    expect(typeCounts(elements, METAMODEL)).toEqual([
      { key: "need", name: "Need", count: 1 },
      { key: "system-requirement", name: "System Requirement", count: 2 },
      { key: "mystery", name: "mystery", count: 2 },
      { key: "other", name: "other", count: 1 },
    ]);
  });

  it("lists no type without an element", () => {
    expect(typeCounts([], METAMODEL)).toEqual([]);
  });

  it("gives one line per type in the order given, each leading to the list of its type", () => {
    expect(
      overviewDisplay({
        types: [
          { key: "system-requirement", name: "System Requirement", count: 117 },
          { key: "mystery", name: "mystery", count: 1 },
        ],
      }),
    ).toEqual({
      types: [
        {
          key: "system-requirement",
          name: "System Requirement",
          count: 117,
          target: { list: "system-requirement" },
        },
        { key: "mystery", name: "mystery", count: 1, target: { list: "mystery" } },
      ],
    });
  });
});
