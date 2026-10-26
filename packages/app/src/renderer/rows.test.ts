import type { ElementListOutput, ElementSearchOutput } from "@logreq/core";
import { describe, expect, it } from "vitest";
import { LIST_MAX, LIST_PAGE, SEARCH_MAX, SEARCH_PAGE, firstLimit, listRows, searchRows } from "./rows.js";

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
  it("shows the identifier, else the short ID, with title and status as given", () => {
    const output: ElementListOutput = {
      elements: [element(1, { identifier: "SR-036" }), element(2, { status: undefined })] as never,
      total: 2,
    };
    const rows = listRows(output);
    expect(rows.map((row) => [row.label, row.title, row.status, row.depth])).toEqual([
      ["SR-036", "Title 1", "draft", 0],
      ["SR-000002", "Title 2", undefined, 0],
    ]);
    expect(rows[0]?.open.key).toBe("element:spec:uuid-1");
    expect(rows[0]?.open.name).toBe("SR-036 Title 1");
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
      ["SR-2", [], true],
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
});
