// ADR-0019 Consequences: one list model, and the HTML export shows each of its columns, filters with their values
// in order, rows with their cells, search texts, facets and ranks. The app does not render lists from the model
// yet, so this is the export's side only.
import { describe, expect, it } from "vitest";
import type { DataExportElement } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import type { ListEntry } from "./list-page.js";
import { listMetamodelOf, listOrderOf, listPageOf, listRowOf } from "./list-page.js";
import { listDisplay } from "../displays/index.js";
import { escapeHtml } from "./markdown.js";

const metamodel = {
  effectiveTypes: [{ key: "req", name: "Requirement", meaning: "requirement", properties: ["level"] }],
  properties: [
    {
      key: "level",
      name: "Level",
      kind: "choice",
      choices: [
        { key: "high", name: "High" },
        { key: "low", name: "Low" },
      ],
    },
  ],
  relations: [],
  statuses: [
    { key: "draft", name: "Draft" },
    { key: "approved", name: "Approved" },
  ],
} as unknown as Metamodel;

const entry = (id: string, element: Partial<DataExportElement>, hints = 0): ListEntry => ({
  record: { type: "req" } as unknown as ElementRecord,
  element: {
    id,
    shortId: `SR-${id}`,
    type: "req",
    title: `Title <${id}>`,
    repository: "r",
    file: `${id}.md`,
    relations: [],
    properties: {},
    ...element,
  },
  hints,
});

describe("the HTML export renders the list model", () => {
  it("shows every column, filter value, row, cell, facet and rank of the model", () => {
    const entries = [
      entry(
        "1",
        {
          identifier: "REQ-1",
          status: "approved",
          properties: { level: ["low", "high"] },
          verification: [{ view: "core", status: "failed", criteria: { verified: 0, total: 1 } }],
        },
        3,
      ),
      entry("2", { status: "draft", properties: { level: "high" } }),
    ];
    const context = { metamodel, store: {} as ElementStore, shortIds: {} as ShortIds };
    const { body } = listPageOf(context, "req", entries);
    const display = listDisplay(
      { type: "req", rows: entries.map(listRowOf), metamodel: listMetamodelOf(metamodel) },
      { id: "identifier", order: listOrderOf(metamodel) },
    );
    const settings = escapeHtml(JSON.stringify({ columns: display.columns, filters: display.filters }));
    expect(body).toContain(`data-rq-list="${settings}"`);
    for (const column of display.columns) {
      expect(body).toContain(`>${column.label}</th>`);
    }
    for (const row of display.rows) {
      expect(body).toContain(
        `<tr data-q="${escapeHtml(row.search)}" data-f="${escapeHtml(JSON.stringify(row.facets))}" data-s="${escapeHtml(JSON.stringify(row.ranks))}">`,
      );
      for (const cell of row.cells) {
        const text =
          cell.kind === "hints" ? (cell.count === 0 ? "" : String(cell.count)) : escapeHtml(cell.text);
        expect(body).toContain(text);
      }
    }
    expect(body).toContain('<span class="rq-badge rq-badge-danger">failed · 0 of 1</span>');
    expect(body).toContain('<span class="rq-badge rq-badge-caution">3</span>');
    expect(body).toContain(">REQ-1</a>");
    expect(body).toContain("Title &lt;2&gt;");
  });
});
