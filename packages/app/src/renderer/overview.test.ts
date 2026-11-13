import { describe, expect, it } from "vitest";
import { elementBuffer } from "./buffers.js";
import type { ListedPerspective } from "./buffers.js";
import type { RecentRow, TypeCount } from "./overview.js";
import {
  PERSPECTIVES_SHOWN,
  openRow,
  overviewRows,
  perspectiveCount,
  perspectiveLine,
  shownPerspectives,
  typeLine,
} from "./overview.js";

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
  it("[SR-118/AK-yggg] gives a line per type in the order given, then the perspectives, then the recent elements", () => {
    const rows = overviewRows(types, [{ name: "Drafts", counted: { count: 4 } }], [recent(1), recent(2)]);
    expect(rows.map((row) => row.kind)).toEqual(["type", "type", "perspective", "recent", "recent"]);
    expect(rows.slice(0, 2).map((row) => (row.kind === "type" ? typeLine(row) : ""))).toEqual([
      "Need 2",
      "System Requirement 117",
    ]);
  });

  it("[SR-118/AK-yggg] shows at most five recent elements, in the order given", () => {
    const rows = overviewRows([], [], [1, 2, 3, 4, 5, 6, 7].map(recent));
    expect(rows.map((row) => (row.kind === "recent" ? row.label : ""))).toEqual([
      "SR-1",
      "SR-2",
      "SR-3",
      "SR-4",
      "SR-5",
    ]);
  });

  it("has no row at all for a workspace without elements and without recent ones", () => {
    expect(overviewRows([], [], [])).toEqual([]);
  });

  it("[SR-118/AK-p9z9] a type line opens the list of the elements of exactly that type", () => {
    const [need, requirement] = overviewRows(types, [], []);
    expect(need?.kind === "type" && openRow(need)).toMatchObject({
      kind: "list",
      label: "type: need",
      selection: { where: { type: ["need"], subtypes: false } },
    });
    expect(requirement?.kind === "type" && openRow(requirement)).toMatchObject({
      label: "type: system-requirement",
      selection: { where: { type: ["system-requirement"], subtypes: false } },
    });
  });

  it("[SR-118/AK-yggg] a recent line opens the element", () => {
    const shown = recent(3);
    const [row] = overviewRows([], [], [shown]);
    expect(row?.kind === "recent" && openRow(row)).toBe(shown.buffer);
  });
});

describe("the perspectives of the overview", () => {
  const listed = (name: string): ListedPerspective => ({
    name,
    file: `perspectives/${name}.yaml`,
    where: { all: [] },
  });

  it("[SR-118/AK-h5f7] shows at most ten perspectives, by name ignoring case", () => {
    const names = ["b", "K", "a", "C", "j", "e", "D", "i", "g", "F", "h", "Zeta"];
    expect(PERSPECTIVES_SHOWN).toBe(10);
    expect(shownPerspectives(names.map(listed))).toEqual(["a", "b", "C", "D", "e", "F", "g", "h", "i", "j"]);
    expect(shownPerspectives([])).toEqual([]);
  });

  it("[SR-118/AK-h5f7] counts the elements of the selection, each once, as element.list gives its total", () => {
    expect(perspectiveCount({ ok: true, output: { total: 12, partial: [], rows: 14 } })).toEqual({
      count: 12,
    });
    expect(perspectiveLine({ name: "Drafts", counted: { count: 12 } })).toBe("Drafts 12");
  });

  it("[SR-118/AK-hvth] shows only the name while the count is not computed", () => {
    expect(perspectiveLine({ name: "Drafts" })).toBe("Drafts");
  });

  it("gives a short reason instead of the count for a perspective that cannot be listed, with core's message", () => {
    const faulty = perspectiveCount({
      ok: false,
      code: "file.faulty",
      message: "The saved filter is faulty",
    });
    expect(faulty).toEqual({ reason: "faulty file", message: "The saved filter is faulty" });
    expect(perspectiveLine({ name: "Drafts", counted: faulty })).toBe("Drafts faulty file");
    expect(perspectiveCount({ ok: false, code: "input.invalid", message: "no filter Open" })).toEqual({
      reason: "cannot be listed",
      message: "no filter Open",
    });
  });
});
