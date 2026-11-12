import type { ElementListOutput, ElementSearchOutput } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { NO_ROW } from "./buffers.js";
import {
  LIST_MAX,
  LIST_PAGE,
  SEARCH_MAX,
  SEARCH_PAGE,
  firstLimit,
  listRows,
  rowName,
  searchRows,
} from "./rows.js";

const element = (n: number, extra: object = {}) => ({
  id: `uuid-${String(n)}`,
  shortId: `SR-00000${String(n)}`,
  type: "system-requirement",
  status: "draft",
  title: `Title ${String(n)}`,
  repository: "spec",
  file: `f${String(n)}.md`,
  properties: {},
  relations: [],
  ...extra,
});

describe("listRows", () => {
  it("[SR-084/AK-c2s2] shows the short ID with the identifier in brackets, else the short ID, with title and status as given", () => {
    const output: ElementListOutput = {
      elements: [element(1, { identifier: "SR-036" }), element(2, { status: undefined })] as never,
      total: 2,
    };
    const rows = listRows(output);
    expect(rows.map((row) => [row.label, row.title, row.status, row.depth])).toEqual([
      ["SR-000001 (SR-036)", "Title 1", "draft", 0],
      ["SR-000002", "Title 2", undefined, 0],
    ]);
    expect(rows.map((row) => row.shortId)).toEqual(["SR-000001", "SR-000002"]);
    // The prompt names a row by the shown ID and the title, the title left out when it is the identifier (#545).
    expect(rows.map(rowName)).toEqual(["SR-000001 (SR-036) Title 1", "SR-000002 Title 2"]);
    expect(rowName({ shortId: "PKG-000003", identifier: "Später", title: "Später" })).toBe(
      "PKG-000003 (Später)",
    );
    expect(rows[0]?.open.key).toBe("element:spec:uuid-1");
    expect(rows[0]?.open.name).toBe("SR-000001 (SR-036) Title 1");
    expect(rows[0]?.terms).toEqual([]);
    expect(rows[0]?.markLabel).toBe(false);
  });

  it("takes the depth of each row from the tree, when there is one", () => {
    const output = {
      elements: [element(1), element(2), element(3)],
      tree: [
        { id: "uuid-1", repository: "spec", depth: 0 },
        { id: "uuid-2", repository: "spec", depth: 1, parent: { id: "uuid-1", repository: "spec" } },
      ],
      total: 3,
    } as unknown as ElementListOutput;
    expect(listRows(output).map((row) => row.depth)).toEqual([0, 1, 0]);
  });
});

describe("searchRows", () => {
  it("keeps the matched words, and marks the ID when it matched", () => {
    const output = {
      hits: [
        { ...element(1), score: 1, fields: ["title"], terms: ["title"] },
        { ...element(2), identifier: "SR-2", score: 0, fields: ["id"], terms: [] },
      ],
      total: 2,
      incomplete: false,
    } as unknown as ElementSearchOutput;
    const rows = searchRows(output);
    expect(rows.map((row) => [row.label, row.terms, row.markLabel])).toEqual([
      ["SR-000001", ["title"], false],
      ["SR-000002 (SR-2)", [], true],
    ]);
  });
});

describe("searchRows, the place of a hit (SR-174)", () => {
  it("takes the title marks and the snippet as core gives them, naming a property by its name", () => {
    const output = {
      hits: [
        {
          ...element(1),
          score: 1,
          fields: ["title", "text"],
          terms: ["title"],
          titleMarks: [{ start: 0, end: 5 }],
          snippet: { field: "text", text: "A title here", marks: [{ start: 2, end: 7 }] },
        },
        {
          ...element(2),
          score: 1,
          fields: ["properties"],
          terms: ["hail"],
          snippet: {
            field: "properties",
            property: "notes",
            propertyName: "Notes",
            text: "A hail sensor",
            marks: [{ start: 2, end: 6 }],
          },
        },
        { ...element(3), score: 0, fields: ["id"], terms: [] },
      ],
      total: 3,
      incomplete: false,
    } as unknown as ElementSearchOutput;
    expect(searchRows(output).map((row) => [row.titleMarks, row.snippet])).toEqual([
      [[[0, 5]], { where: "text", text: "A title here", marks: [[2, 7]] }],
      [[], { where: "Notes", text: "A hail sensor", marks: [[2, 6]] }],
      [[], undefined],
    ]);
  });
});

describe("firstLimit", () => {
  it("asks for whole pages that reach the selected row, up to the most the command gives", () => {
    expect(firstLimit(0, LIST_PAGE, LIST_MAX)).toBe(200);
    expect(firstLimit(199, LIST_PAGE, LIST_MAX)).toBe(200);
    expect(firstLimit(200, LIST_PAGE, LIST_MAX)).toBe(400);
    expect(firstLimit(99_999, LIST_PAGE, LIST_MAX)).toBe(5000);
    expect(firstLimit(120, SEARCH_PAGE, SEARCH_MAX)).toBe(150);
    expect(firstLimit(9000, SEARCH_PAGE, SEARCH_MAX)).toBe(500);
  });

  it("asks for one page while no row is selected (SR-122)", () => {
    expect(firstLimit(NO_ROW, LIST_PAGE, LIST_MAX)).toBe(200);
    expect(firstLimit(NO_ROW, SEARCH_PAGE, SEARCH_MAX)).toBe(50);
  });
});
