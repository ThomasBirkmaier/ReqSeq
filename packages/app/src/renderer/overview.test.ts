import { describe, expect, it } from "vitest";
import { elementBuffer } from "./buffers.js";
import type { RecentRow, TypeCount } from "./overview.js";
import { openRow, overviewRows, typeLine } from "./overview.js";

const types: TypeCount[] = [
  { key: "need", name: "Need", count: 2 },
  { key: "system-requirement", name: "System Requirement", count: 117 },
];
const recent = (n: number): RecentRow => ({
  buffer: elementBuffer(`uuid-${String(n)}`, "spec", `SR-${String(n)} Title ${String(n)}`),
  label: `SR-${String(n)}`,
  title: `Title ${String(n)}`,
});

describe("the rows of the overview", () => {
  it("[SR-118/AK1] gives a line per type in the order given, then the recent elements", () => {
    const rows = overviewRows(types, [recent(1), recent(2)]);
    expect(rows.map((row) => row.kind)).toEqual(["type", "type", "recent", "recent"]);
    expect(rows.slice(0, 2).map((row) => (row.kind === "type" ? typeLine(row) : ""))).toEqual([
      "Need 2",
      "System Requirement 117",
    ]);
  });

  it("[SR-118/AK1] shows at most five recent elements, in the order given", () => {
    const rows = overviewRows([], [1, 2, 3, 4, 5, 6, 7].map(recent));
    expect(rows.map((row) => (row.kind === "recent" ? row.label : ""))).toEqual([
      "SR-1",
      "SR-2",
      "SR-3",
      "SR-4",
      "SR-5",
    ]);
  });

  it("has no row at all for a workspace without elements and without recent ones", () => {
    expect(overviewRows([], [])).toEqual([]);
  });

  it("[SR-118/AK2] a type line opens the list of the elements of exactly that type", () => {
    const [need, requirement] = overviewRows(types, []);
    expect(need && openRow(need)).toMatchObject({
      kind: "list",
      label: "type: need",
      selection: { where: { type: ["need"], subtypes: false } },
    });
    expect(requirement && openRow(requirement)).toMatchObject({
      label: "type: system-requirement",
      selection: { where: { type: ["system-requirement"], subtypes: false } },
    });
  });

  it("[SR-118/AK1] a recent line opens the element", () => {
    const shown = recent(3);
    const [row] = overviewRows([], [shown]);
    expect(row && openRow(row)).toBe(shown.buffer);
  });
});
