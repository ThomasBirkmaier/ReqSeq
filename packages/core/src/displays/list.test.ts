import { describe, expect, it } from "vitest";
import type { ListMetamodel, ListOrder, ListRowInput } from "./list.js";
import { listDisplay } from "./list.js";

const METAMODEL: ListMetamodel = {
  types: [
    {
      key: "req",
      name: "Requirement",
      meaning: "requirement",
      properties: ["title", "level", "packages", "gone"],
    },
    { key: "note", name: "Note", properties: ["mood"] },
  ],
  properties: [
    { key: "title", name: "Title", kind: "text", meaning: "title" },
    {
      key: "level",
      name: "Level",
      kind: "choice",
      choices: [
        { key: "high", name: "High" },
        { key: "low", name: "Low" },
      ],
    },
    { key: "packages", name: "Packages", kind: "relation", meaning: "packages" },
    // A choice without choices (a metamodel error) still filters.
    { key: "mood", name: "Mood", kind: "choice" },
  ],
  statuses: [{ key: "draft" }, { key: "approved" }, { key: "obsolete", invalid: true }],
};

/** Texts in order, statuses and choices by the order of the metamodel, hints as numbers. */
const ORDER: ListOrder<string | number> = {
  keyOf: (field, value) => {
    if (field.kind === "hints") {
      return Number(value);
    }
    if (field.kind === "status") {
      return ["draft", "approved", "obsolete"].indexOf(value);
    }
    if (field.kind === "choice") {
      return ["high", "low"].indexOf(value);
    }
    return value.toLowerCase();
  },
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};

const row = (
  id: string,
  element: Partial<ListRowInput["element"]> = {},
  more: Partial<Omit<ListRowInput, "element">> = {},
): ListRowInput => ({
  element: {
    id,
    repository: "spec",
    shortId: `SR-${id}`,
    type: "req",
    title: `Title ${id}`,
    file: `${id}.md`,
    properties: {},
    relations: [],
    ...element,
  },
  hints: 0,
  ...more,
});

const pkg = (title: string, extra: object = {}) => ({
  id: `p-${title}`,
  shortId: `PKG-${title}`,
  kind: "packages",
  property: true,
  direction: "out" as const,
  targetState: "available" as const,
  title,
  ...extra,
});

describe("listDisplay", () => {
  const rows = [
    row(
      "1",
      {
        identifier: "REQ-1",
        status: "approved",
        properties: { level: ["low", "high"] },
        relations: [
          pkg("Beta"),
          pkg("", { identifier: "PKG-A" }),
        ] as unknown as ListRowInput["element"]["relations"],
      },
      { verification: [{ view: "core", status: "open", criteria: { verified: 1, total: 2 } }], hints: 2 },
    ),
    row("2", { status: "draft", title: "", properties: { level: "high" } }, { hints: 2 }),
    row("3", { status: "obsolete" }, { verification: [{ view: "core", status: "verified" }] }),
  ];

  it("gives the columns, the filters with their values in order and the cells of each row (SR-233 AK1)", () => {
    const display = listDisplay(
      { type: "req", rows, metamodel: METAMODEL },
      { id: "identifier", order: ORDER },
    );
    expect(display.title).toBe("Requirement");
    expect(display.columns).toEqual([
      { label: "Identifier", total: true },
      { label: "Title" },
      { label: "Status" },
      { label: "Packages" },
      { label: "Verification status in the core" },
      { label: "Open hints" },
    ]);
    expect(display.filters).toEqual([
      { label: "Status", values: ["draft", "approved", "obsolete", "–"] },
      { label: "Packages", values: ["Beta", "PKG-A", "–"] },
      { label: "Verification status in the core", values: ["open", "verified", "–"] },
      { label: "Level", values: ["high", "low", "–"] },
    ]);
    const [first, second, third] = display.rows;
    expect(first?.cells).toEqual([
      { kind: "id", text: "REQ-1" },
      { kind: "text", text: "Title 1" },
      { kind: "text", text: "approved" },
      { kind: "text", text: "Beta, PKG-A" },
      {
        kind: "verification",
        cell: { view: "core", status: "open", criteria: { verified: 1, total: 2 } },
        text: "open · 1 of 2",
      },
      { kind: "hints", count: 2 },
    ]);
    expect(first?.facets).toEqual([[1], [0, 1], [0], [1, 0]]);
    expect(first?.search).toBe("req-1\nsr-1\ntitle 1");
    // No identifier: the short ID; no packages, no verification in the core: "–" (SR-137 AK4).
    expect(second?.cells.slice(0, 5)).toEqual([
      { kind: "id", text: "SR-2" },
      { kind: "text", text: "" },
      { kind: "text", text: "draft" },
      { kind: "text", text: "–" },
      { kind: "verification", cell: undefined, text: "–" },
    ]);
    expect(second?.facets).toEqual([[0], [2], [2], [0]]);
    expect(third?.ref).toMatchObject({ id: "3", invalid: true });
  });

  it("ranks each column densely by the order given, a row without a value null, the identifier by position", () => {
    const display = listDisplay(
      { type: "req", rows, metamodel: METAMODEL },
      { id: "identifier", order: ORDER },
    );
    expect(display.rows.map((r) => r.ranks)).toEqual([
      [0, 0, 1, 0, 0, 1],
      [1, null, 0, null, null, 1],
      [2, 1, 2, null, 1, 0],
    ]);
  });

  it("gives two values the order holds equal one rank", () => {
    const display = listDisplay(
      {
        type: "note",
        rows: [row("a", { title: "Wind" }), row("b", { title: "wind" })],
        metamodel: METAMODEL,
      },
      { id: "identifier", order: ORDER },
    );
    expect(display.rows.map((r) => r.ranks[1])).toEqual([0, 0]);
  });

  it('keeps a real value "–" apart from the rows without a value', () => {
    const display = listDisplay(
      {
        type: "note",
        rows: [row("a", { type: "note", properties: { mood: "–" } }), row("b", { type: "note" })],
        metamodel: METAMODEL,
      },
      { id: "identifier", order: ORDER },
    );
    expect(display.filters.at(-1)).toEqual({ label: "Mood", values: ["–", "–"] });
    expect(display.rows.map((r) => r.facets.at(-1))).toEqual([[0], [1]]);
  });

  it("names a row by its short ID with the identifier for the app (SR-084 AK4), and a type without requirements has no verification", () => {
    const shown = listDisplay({ type: "req", rows, metamodel: METAMODEL }, { id: "shownId", order: ORDER });
    expect(shown.rows.map((r) => r.cells[0])).toEqual([
      { kind: "id", text: "SR-1 (REQ-1)" },
      { kind: "id", text: "SR-2" },
      { kind: "id", text: "SR-3" },
    ]);
    const notes = listDisplay(
      { type: "unknown", rows: [row("4", { type: "unknown" })], metamodel: METAMODEL },
      { id: "identifier", order: ORDER },
    );
    expect(notes.title).toBe("unknown");
    expect(notes.columns.map((c) => c.label)).toEqual([
      "Identifier",
      "Title",
      "Status",
      "Packages",
      "Open hints",
    ]);
    expect(notes.filters.map((f) => f.label)).toEqual(["Status", "Packages"]);
    const moods = listDisplay(
      {
        type: "note",
        rows: [row("5", { type: "note", properties: { mood: "calm" } })],
        metamodel: METAMODEL,
      },
      { id: "identifier", order: ORDER },
    );
    expect(moods.filters.at(-1)).toEqual({ label: "Mood", values: ["calm", "–"] });
  });
});
