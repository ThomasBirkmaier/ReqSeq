// The model of the traceability matrix (SR-125): the input for a list, the rows, the targets of the cursor.
import type { DataExportRelation, TraceMatrixOutput } from "@logreq/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_SORT, filteredList, listBuffer } from "./buffers.js";
import { columnCount, columnName, matrixInput, matrixRows, opening, targetsOf } from "./matrix.js";
import type { MatrixColumn } from "./matrix.js";
import { savedStep, typeStep } from "./list-filters.js";
import { nth } from "./lists.js";

const relation = (extra: Partial<DataExportRelation> = {}): DataExportRelation => ({
  kind: "derives-from",
  direction: "out",
  id: "uuid-n1",
  repository: "spec",
  shortId: "N-000001",
  identifier: "N-1",
  title: "See the wind",
  accessible: true,
  targetState: "available",
  outdated: false,
  ...extra,
});

const column = (extra: Partial<MatrixColumn> = {}): MatrixColumn => ({
  type: "relation",
  kind: "derives-from",
  direction: "out",
  name: "Derives from",
  count: 4,
  share: 0.8,
  ...extra,
});

describe("matrixInput", () => {
  it("[SR-125/AK1] asks for the selection and sort of the list, so the rows are the list's", () => {
    const list = filteredList([typeStep("system-requirement")]);
    expect(matrixInput(list, 0, 200)).toEqual({
      selection: { where: { type: ["system-requirement"] } },
      sort: DEFAULT_SORT,
      limit: 200,
      offset: 0,
    });
    const sorted = filteredList([typeStep("need")], [{ by: "title", order: "desc" }]);
    expect(matrixInput(sorted, 200, 50)).toEqual({
      selection: { where: { type: ["need"] } },
      sort: [{ by: "title", order: "desc" }],
      limit: 50,
      offset: 200,
    });
  });

  it("[SR-125/AK6] sends no selection for all elements, and none sort for a saved filter (its own sort holds)", () => {
    expect(matrixInput(listBuffer("All elements"), 0, 200)).toEqual({
      sort: DEFAULT_SORT,
      limit: 200,
      offset: 0,
    });
    const saved = filteredList([savedStep("Stage SRs")]);
    const input = matrixInput(saved, 0, 200);
    expect(input).toEqual({ selection: { filter: "Stage SRs" }, limit: 200, offset: 0 });
    expect(input).not.toHaveProperty("sort");
  });
});

describe("rows and targets", () => {
  const output = {
    columns: [column(), column({ direction: "in", name: "Derived by" })],
    rows: [
      {
        id: "uuid-s1",
        repository: "spec",
        shortId: "SR-000001",
        identifier: "SR-1",
        type: "system-requirement",
        status: "draft",
        title: "Show wind speed",
        file: "a.md",
        depth: 2,
        cells: [[relation(), relation({ id: "uuid-n2", title: "See the rain" })], []],
      },
      {
        id: "uuid-s2",
        repository: "spec",
        shortId: "SR-000002",
        type: "system-requirement",
        title: "Show rain",
        file: "b.md",
        cells: [[], []],
      },
    ],
    total: 2,
    incomplete: false,
  } as unknown as TraceMatrixOutput;

  it("[SR-125/AK1] has one row per element in the order of the answer, the depth of a tree", () => {
    const rows = matrixRows(output);
    expect(rows.map((row) => [row.element.label, row.element.title, row.element.depth])).toEqual([
      ["SR-1", "Show wind speed", 2],
      ["SR-000002", "Show rain", 0],
    ]);
    expect(rows[0]?.element.open.key).toBe("element:spec:uuid-s1");
    expect(rows[0]?.cells).toBe(output.rows[0]?.cells);
  });

  it("[SR-125/AK5] walks the row element first, then every relation of every cell in column order", () => {
    const rows = matrixRows(output);
    const first = nth(rows, 0);
    const targets = targetsOf(first);
    expect(targets.map((target) => target.kind)).toEqual(["element", "relation", "relation"]);
    expect(targets[0]).toEqual({ kind: "element", open: first.element.open });
    expect(targetsOf(nth(rows, 1))).toHaveLength(1);
  });
});

describe("opening a relation (AK5)", () => {
  it("[SR-125/AK5] opens the element of an available relation in its repository", () => {
    expect(opening(relation())).toEqual({
      ok: true,
      buffer: {
        kind: "element",
        key: "element:spec:uuid-n1",
        id: "uuid-n1",
        repository: "spec",
        name: "N-1 See the wind",
      },
    });
  });

  it("[SR-125/AK5] opens nothing for a missing, ambiguous or inaccessible end, and says its state", () => {
    for (const targetState of ["missing", "ambiguous", "inaccessible", "unknown-repository"] as const) {
      expect(opening(relation({ targetState, accessible: false, title: "Gone" }))).toEqual({
        ok: false,
        message: `N-1 Gone is ${targetState}`,
      });
    }
  });

  it("opens nothing for an available relation that names no repository", () => {
    const { repository: _repository, ...unnamed } = relation();
    expect(opening(unnamed).ok).toBe(false);
  });
});

describe("column heads", () => {
  it("[SR-125/AK3] writes the count and the share of the whole selection", () => {
    expect(columnCount(column())).toBe("4 · 80 %");
    expect(columnCount(column({ count: 1, share: 1 / 3 }))).toBe("1 · 33 %");
    expect(columnCount(column({ count: 2, share: 2 / 3 }))).toBe("2 · 66 %");
    // Never "100 %" while a row has a gap, and no float error below a whole percent.
    expect(columnCount(column({ count: 999, share: 0.999 }))).toBe("999 · 99 %");
    expect(columnCount(column({ count: 29, share: 0.29 }))).toBe("29 · 29 %");
    expect(columnCount(column({ count: 5, share: 1 }))).toBe("5 · 100 %");
  });

  it("[SR-125/AK2] marks an incoming column with an arrow only when another column has its name", () => {
    const columns = [
      column(),
      column({ direction: "in", name: "Derived by" }),
      column({ kind: "distinct-from", name: "Distinct from" }),
      column({ kind: "distinct-from", direction: "in", name: "Distinct from" }),
    ];
    expect(columns.map((each) => columnName(each, columns))).toEqual([
      "Derives from",
      "Derived by",
      "Distinct from",
      "← Distinct from",
    ]);
  });
});
