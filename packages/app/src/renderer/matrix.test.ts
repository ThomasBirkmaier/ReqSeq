// The model of the traceability matrix (SR-125, SR-153): the input for a list, the rows, the targets of the
// cursor, the column heads and the gaps.
import type { DataExportRelation, TraceMatrixOutput } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_SORT, filteredList, listBuffer } from "./buffers.js";
import {
  cellGaps,
  columnCount,
  columnName,
  degreeLine,
  gapTitle,
  matrixInput,
  matrixRows,
  opening,
  statusLine,
  targetsOf,
  testCaseLine,
} from "./matrix.js";
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
  const GAP = { column: 0, targetType: "need", targetName: "Need", count: 0, min: 1 };
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
        gaps: [GAP],
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
    expect(rows.map((row) => row.gaps)).toEqual([[], [GAP]]);
  });

  it("[SR-153/AK1] gives a cell the gaps core names for its column, and says each minimum on demand", () => {
    const [, row] = matrixRows(output);
    expect(row === undefined ? [] : [cellGaps(row, 0), cellGaps(row, 1)]).toEqual([[GAP], []]);
    expect(gapTitle([GAP, { ...GAP, targetName: "Use Case", count: 1, min: 2 }])).toBe(
      "at least 1 to Need, has 0\nat least 2 to Use Case, has 1",
    );
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
  it("[SR-153/AK1] writes, with minima, the rows that meet them of those they apply to and core's share", () => {
    const minima = (met: number, expected: number): MatrixColumn =>
      column({ expected, met, share: met / expected });
    expect(columnCount(minima(2, 5))).toBe("2 of 5 · 40 %");
    // Core's percentage, as the CLI: one decimal, rounded down, never "100 %" while a row is a gap.
    expect(columnCount(minima(2, 3))).toBe("2 of 3 · 66.6 %");
    expect(columnCount(minima(999, 1000))).toBe("999 of 1000 · 99.9 %");
    expect(columnCount(minima(29, 100))).toBe("29 of 100 · 29 %");
    expect(columnCount(minima(5, 5))).toBe("5 of 5 · 100 %");
    expect(columnCount(minima(0, 3))).toBe("0 of 3 · 0 %");
  });

  it("[SR-125/AK3] [SR-153/AK2] writes only the count of a column without a minimum", () => {
    expect(columnCount(column())).toBe("4");
    expect(columnCount(column({ direction: "in", count: 1 }))).toBe("1");
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

describe("the evidence columns (SR-126)", () => {
  const last = {
    element: "uuid-s1",
    version: "n1:4b6860725d822fd9",
    kind: "verification",
    method: "test",
    item: "build-602",
    result: "passed",
    date: "2026-10-22T09:00:00Z",
  } as const;

  it("keeps a requirement's test cases and status on its row, and none on another row", () => {
    const testCases = [{ name: "test_speed", executed: true, last }];
    const output = {
      columns: [],
      rows: [
        {
          id: "uuid-s1",
          repository: "spec",
          shortId: "SR-1",
          type: "system-requirement",
          title: "Show wind speed",
          file: "a.md",
          cells: [],
          testCases,
          verification: [{ view: "core", status: "verified" }],
        },
        {
          id: "uuid-n1",
          repository: "spec",
          shortId: "N-1",
          type: "need",
          title: "See",
          file: "n.md",
          cells: [],
        },
      ],
      total: 2,
      incomplete: false,
    } as unknown as TraceMatrixOutput;
    const [requirement, need] = matrixRows(output);
    expect(requirement?.testCases).toBe(testCases);
    expect(requirement?.verification).toEqual({ view: "core", status: "verified" });
    expect(need).not.toHaveProperty("testCases");
    expect(need).not.toHaveProperty("verification");
  });

  it("gives the degree as core's percentage and the count of each status that occurs, in status order", () => {
    expect(
      degreeLine({
        share: 5 / 9,
        total: 9,
        counts: { open: 2, verified: 4, indirect: 1, failed: 1, outdated: 1 },
      }),
    ).toBe("55.5 % · 4 verified · 1 indirect · 1 failed · 1 outdated · 2 open");
    expect(
      degreeLine({ total: 0, counts: { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 } }),
    ).toBe("");
  });

  it("shows a test case by name, result and date of its last execution, a mark in place of the result", () => {
    expect(testCaseLine({ name: "test_speed", className: "tests.test_wind", executed: true, last })).toEqual({
      text: "test_speed · passed · 2026-10-22",
      accent: false,
      title: "tests.test_wind › test_speed\nitem build-602\nversion n1:4b6860725d822fd9",
    });
    expect(
      testCaseLine({
        name: "test_log",
        executed: true,
        last: (({ item: _item, ...rest }) => rest)(last),
        mark: "failed",
      }),
    ).toEqual({
      text: "test_log · failed · 2026-10-22",
      accent: true,
      title: "test_log\nitem —\nversion n1:4b6860725d822fd9",
    });
    expect(testCaseLine({ name: "test_gusts", executed: false, mark: "not-executed" })).toEqual({
      text: "test_gusts · not executed",
      accent: true,
      title: "test_gusts",
    });
  });

  it("shows the status, failed and outdated in the accent colour, an open one with its missing children on demand", () => {
    expect(statusLine({ view: "core", status: "outdated" })).toEqual({
      text: "outdated",
      accent: true,
      title: "",
    });
    expect(statusLine({ view: "core", status: "indirect" })).toEqual({
      text: "indirect",
      accent: false,
      title: "",
    });
    expect(statusLine({ view: "core", status: "open", missingChildren: ["a"] }).title).toBe(
      "1 missing child",
    );
    expect(statusLine({ view: "core", status: "open", missingChildren: ["a", "b"] }).title).toBe(
      "2 missing children",
    );
  });
});
