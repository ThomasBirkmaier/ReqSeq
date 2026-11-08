// The context menu of the traceability matrix (SR-199 AK3, AK4): the spot of the cursor, the arguments the
// menu gives "Create relation" and "Remove relation", and where they are shown.
import type { DataExportRelation } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import type { ActionContext } from "./actions.js";
import { elementBuffer, listBuffer } from "./buffers.js";
import type { MenuHit } from "./context-menu.js";
import { MENU_PLACES, menuEntries } from "./context-menu.js";
import { menuContext } from "./entry-menu.js";
import type { MatrixColumn, MatrixRow } from "./matrix.js";
import type { MatrixSpot } from "./matrix-menu.js";
import {
  CREATABLE,
  NO_OPTIONS,
  PROPERTY_COLUMN,
  cellSpot,
  creatable,
  matrixGiven,
  matrixSpotOf,
  optionAsks,
  relationSpot,
  spotKey,
  withOptions,
} from "./matrix-menu.js";

const row = { open: elementBuffer("uuid-1", "spec", "SR-1 First"), label: "SR-1" };
const names = new Map([["derives-from", "Derives from"]]);

const relation = (direction: "out" | "in", more: Partial<DataExportRelation> = {}): DataExportRelation => ({
  kind: "derives-from",
  direction,
  id: "uuid-2",
  repository: "needs",
  shortId: "N-2",
  accessible: true,
  targetState: "available",
  ...more,
});

const column = (direction: "out" | "in", property = false): MatrixColumn => ({
  type: "relation",
  kind: "derives-from",
  direction,
  name: direction === "out" ? "Derives from" : "Derived by",
  count: 1,
  ...(property ? { property: true } : {}),
});

const matrixRow: MatrixRow = {
  element: {
    ...row,
    shortId: "SR-1",
    title: "First",
    status: undefined,
    depth: 0,
    terms: [],
    markLabel: false,
    titleMarks: [],
  },
  type: "system-requirement",
  cells: [[relation("out")]],
  gaps: [],
};

/** A press inside a cell with the marks `marks` (a relation property's column, a creatable cell). */
const inCell = (place: MenuHit["place"], ...marks: readonly string[]): MenuHit => ({
  place,
  target: {
    closest: (selector: string) =>
      selector === '[data-menu="matrix-cell"]'
        ? { hasAttribute: (name: string) => marks.includes(name) }
        : null,
  } as unknown as Element,
  point: { x: 0, y: 0 },
});

describe("the spot of the matrix's cursor (SR-199)", () => {
  it("is the selected cell's row and column, else the relation of the selected target", () => {
    const columns = [column("out")];
    const rows = [matrixRow];
    expect(matrixSpotOf(columns, rows, undefined, { row: 0, column: 0 }, undefined)).toEqual({
      row: row.open,
      rowLabel: "SR-1",
      kind: "derives-from",
      direction: "out",
      property: false,
    });
    expect(matrixSpotOf(columns, rows, matrixRow, { row: 0, column: 3 }, undefined)).toBeUndefined();
    expect(matrixSpotOf(columns, rows, matrixRow, { row: 2, column: 0 }, undefined)).toBeUndefined();
    const target = { kind: "relation", relation: relation("out") } as const;
    expect(matrixSpotOf(columns, rows, matrixRow, undefined, target)?.other).toEqual({
      id: "uuid-2",
      repository: "needs",
      label: "N-2",
    });
    expect(matrixSpotOf(columns, rows, undefined, undefined, target)).toBeUndefined();
    // The element of the row is no relation.
    expect(
      matrixSpotOf(columns, rows, matrixRow, undefined, { kind: "element", open: row.open }),
    ).toBeUndefined();
  });

  it("names the other end by its identifier, else its short ID, else its UUID", () => {
    expect(relationSpot(row, relation("in", { identifier: "wind" })).other?.label).toBe("wind");
    const bare = relationSpot(row, { ...relation("in"), shortId: undefined, repository: undefined } as never);
    expect(bare.other).toEqual({ id: "uuid-2", label: "uuid-2" });
  });

  it("has a key that changes with the spot", () => {
    expect(spotKey(undefined)).toBe("");
    expect(spotKey(cellSpot(row, column("out")))).not.toBe(spotKey(cellSpot(row, column("in"))));
    expect(spotKey(relationSpot(row, relation("out")))).not.toBe(spotKey(cellSpot(row, column("out"))));
  });
});

describe("the arguments the matrix's menu gives (SR-199)", () => {
  it("[SR-199/AK3] gives Create relation in a cell the row and the column's kind and direction", () => {
    expect(matrixGiven("matrix-cell", cellSpot(row, column("out")), names)).toEqual({
      "relation.add": [
        { field: "source", value: "uuid-1", label: "SR-1" },
        { field: "kind", value: "derives-from", label: "Derives from" },
      ],
    });
    // An incoming column: the row is the target, the prompt asks the source.
    expect(matrixGiven("matrix-cell", cellSpot(row, column("in")), new Map())).toEqual({
      "relation.add": [
        { field: "kind", value: "derives-from", label: "derives-from" },
        { field: "target", value: "uuid-1", label: "SR-1" },
      ],
    });
  });

  it("[SR-199/AK4] gives Remove relation on a connected element the relation between the row and it", () => {
    expect(matrixGiven("matrix-target", relationSpot(row, relation("out")), names)).toEqual({
      "relation.remove": [
        { field: "source", value: "uuid-1", label: "SR-1" },
        { field: "kind", value: "derives-from", label: "Derives from" },
        { field: "target", value: "uuid-2", label: "N-2" },
        { field: "repository", value: "needs", label: "" },
      ],
    });
    // An incoming relation is stored by the other end, and points into the row's repository.
    expect(matrixGiven("matrix-target", relationSpot(row, relation("in")), names)).toEqual({
      "relation.remove": [
        { field: "source", value: "uuid-2", label: "N-2" },
        { field: "kind", value: "derives-from", label: "Derives from" },
        { field: "target", value: "uuid-1", label: "SR-1" },
        { field: "repository", value: "spec", label: "" },
      ],
    });
    const unnamed = relationSpot(row, { ...relation("out"), repository: undefined } as never);
    expect(matrixGiven("matrix-target", unnamed, names)?.["relation.remove"]).toHaveLength(3);
  });

  it("gives nothing in a relation property's column, elsewhere, on the wrong spot or without one", () => {
    const property: MatrixSpot = { ...cellSpot(row, column("out", true)) };
    expect(property.property).toBe(true);
    expect(matrixGiven("matrix-cell", property, names)).toBeUndefined();
    expect(matrixGiven("matrix-cell", undefined, names)).toBeUndefined();
    expect(matrixGiven("matrix-cell", relationSpot(row, relation("out")), names)).toBeUndefined();
    expect(matrixGiven("matrix-target", cellSpot(row, column("out")), names)).toBeUndefined();
    expect(matrixGiven("buffer", cellSpot(row, column("out")), names)).toBeUndefined();
  });

  it("are in the context while the matrix's menu is open (`menuContext`)", () => {
    const marked = elementBuffer("uuid-2", "needs", "N-2 Second");
    const base = {
      buffers: [listBuffer("All elements")],
      marked,
      matrix: relationSpot(row, relation("out")),
    } as unknown as ActionContext;
    const onTarget = menuContext(base, { hit: { place: "matrix-target" } }, names);
    expect(onTarget.entry).toBe(marked);
    expect(onTarget.given?.["relation.remove"]).toHaveLength(4);
    const cell = { ...base, matrix: cellSpot(row, column("out")) } as ActionContext;
    expect(menuContext(cell, { hit: { place: "matrix-cell" } }).given?.["relation.add"]?.[1]?.label).toBe(
      "derives-from",
    );
  });
});

describe("the entries of the matrix's menu (SR-199)", () => {
  const items = ["command:relation.add", "command:relation.remove", "entry-show"].map((id) => ({
    id,
    name: id,
    run: () => undefined,
  }));
  const ids = (hit: MenuHit): string[] => menuEntries(hit, items).map((item) => item.id);

  it("[SR-199/AK3] has Create relation only in a cell where a relation of its column can be created", () => {
    expect(MENU_PLACES["matrix-cell"].map((entry) => entry.id)).toEqual(["command:relation.add"]);
    expect(ids(inCell("matrix-cell", CREATABLE))).toEqual(["command:relation.add"]);
    expect(ids(inCell("matrix-cell"))).toEqual([]);
  });

  it("[SR-199/AK4] has Remove relation after the entries of the connected element", () => {
    expect(MENU_PLACES["matrix-target"].at(-1)?.id).toBe("command:relation.remove");
    expect(ids(inCell("matrix-target"))).toEqual([
      "entry-show",
      "command:relation.add",
      "command:relation.remove",
    ]);
    expect(ids(inCell("matrix-target", PROPERTY_COLUMN))).toEqual(["entry-show", "command:relation.add"]);
  });
});

describe("where a relation of a column can be created (SR-199 AK3)", () => {
  const derives = { kind: "derives-from", name: "Derives from", targetTypes: ["need", "system-requirement"] };
  const basedOn = { kind: "based-on", name: "Based on", targetTypes: ["decision"] };
  /** A row of `type`, with `cells`. */
  const rowOf = (id: string, type: string, cells: MatrixRow["cells"] = [[], []]): MatrixRow => ({
    ...matrixRow,
    element: { ...matrixRow.element, open: elementBuffer(id, "spec", id) },
    type,
    cells,
  });
  const requirement = withOptions(
    NO_OPTIONS,
    { key: "type:system-requirement", ref: "sr", type: "system-requirement" },
    [derives, basedOn],
  );
  const known = withOptions(requirement, { key: "type:need", ref: "n", type: "need" }, []);

  it("[SR-199/AK3] is where relation.options lets the row's type be the source or the target of the column's kind", () => {
    // An outgoing column: the row's type may have the kind; a need may not derive from anything.
    expect(creatable(known, "system-requirement", column("out"))).toBe(true);
    expect(creatable(known, "need", column("out"))).toBe(false);
    // An incoming column: the row's type is among the kind's target types; a decision is not.
    expect(creatable(known, "need", column("in"))).toBe(true);
    expect(creatable(known, "decision", column("in"))).toBe(false);
    // Not a relation property's column, and nothing while nothing is known.
    expect(creatable(known, "system-requirement", column("out", true))).toBe(false);
    expect(creatable(NO_OPTIONS, "system-requirement", column("out"))).toBe(false);
    expect(creatable(NO_OPTIONS, "need", column("in"))).toBe(false);
  });

  it("asks relation.options once per type of row, then for the source of an incoming column no type offers", () => {
    const source = relation("in", { id: "uuid-9" });
    const rows = [rowOf("a", "need", [[], [source]]), rowOf("b", "need"), rowOf("c", "decision")];
    const columns = [column("out"), column("in")];
    expect(optionAsks(rows, columns, NO_OPTIONS, new Set())).toEqual([
      { key: "type:need", ref: "a", type: "need" },
      { key: "type:decision", ref: "c", type: "decision" },
    ]);
    // Asked already: nothing again, and the columns wait for every type's answer.
    expect(optionAsks(rows, columns, NO_OPTIONS, new Set(["type:need", "type:decision"]))).toEqual([]);
    const types = withOptions(
      withOptions(NO_OPTIONS, { key: "type:need", ref: "a", type: "need" }, []),
      { key: "type:decision", ref: "c", type: "decision" },
      [],
    );
    const asked = new Set(["type:need", "type:decision"]);
    expect(optionAsks(rows, columns, types, asked)).toEqual([{ key: "kind:derives-from", ref: "uuid-9" }]);
    expect(optionAsks(rows, columns, types, new Set([...asked, "kind:derives-from"]))).toEqual([]);
    // The answer for that source gives the kind's target types.
    const sourced = withOptions(types, { key: "kind:derives-from", ref: "uuid-9" }, [derives]);
    expect(sourced.sources).toEqual([[derives]]);
    expect(optionAsks(rows, columns, sourced, asked)).toEqual([]);
    expect(creatable(sourced, "need", column("in"))).toBe(true);
    // No available source: nothing to ask.
    const gone = [rowOf("a", "need", [[], [relation("in", { targetState: "missing" })]])];
    expect(optionAsks(gone, columns, types, asked)).toEqual([]);
    // A property's column and an outgoing one are never asked for.
    expect(optionAsks(rows, [column("out"), column("in", true)], types, asked)).toEqual([]);
  });
});
