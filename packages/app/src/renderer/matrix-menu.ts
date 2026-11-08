// The context menu of the traceability matrix (SR-199 AK3, AK4): in a cell outside its connected elements
// "Create relation", with the element of the row and the kind and direction of the column given, so only the
// other element is asked; on a connected element, after the entries of an element (SR-197), "Remove
// relation" for the relation between the element of the row and it. Both are the catalog commands
// `relation.add` and `relation.remove`, started with those arguments given (`startCommand`): the app builds
// the input as the command prompt does and core decides (ADR-0002).
import type { DataExportRelation } from "@reqseq/core";
import type { ElementBuffer } from "./buffers.js";
import type { MenuEntry, MenuHit, MenuPlace } from "./context-menu.js";
import type { MatrixColumn, MatrixRow, Target } from "./matrix.js";

/** The mark of a cell of a relation property's column: no relation kind, so no relation is created or removed there. */
export const PROPERTY_COLUMN = "data-property-column";

/**
 * Where the matrix's cursor or right-click stands, as far as a relation goes: the element of the row, the
 * kind and direction of the column, and on a connected element its other end. The matrix reports it with
 * the marked element (`BufferData`).
 */
export interface MatrixSpot {
  readonly row: ElementBuffer;
  /** How the row's element is named in the prompt's line: its ID. */
  readonly rowLabel: string;
  /** The key of the relation kind (or of the relation property) of the column. */
  readonly kind: string;
  readonly direction: "out" | "in";
  /** The column is a property of kind relation, not a relation kind. */
  readonly property: boolean;
  /** A connected element of the cell: the other end of its relation. Absent: the cell itself. */
  readonly other?: {
    readonly id: string;
    /** The repository of the other end, as the relation names it; absent when it names none as text. */
    readonly repository?: string;
    readonly label: string;
  };
}

/** The spot of a cell of `row` in the column of `kind` and `direction`. */
export const cellSpot = (
  row: { readonly open: ElementBuffer; readonly label: string },
  column: { readonly kind: string; readonly direction: "out" | "in"; readonly property?: true },
): MatrixSpot => ({
  row: row.open,
  rowLabel: row.label,
  kind: column.kind,
  direction: column.direction,
  property: column.property === true,
});

/** The spot of a connected element of `row`: its relation names the column and the other end. */
export const relationSpot = (
  row: { readonly open: ElementBuffer; readonly label: string },
  relation: DataExportRelation,
): MatrixSpot => ({
  ...cellSpot(row, relation),
  other: {
    id: relation.id,
    ...(relation.repository === undefined ? {} : { repository: relation.repository }),
    label: relation.identifier ?? relation.shortId ?? relation.id,
  },
});

/**
 * The spot of the matrix: the selected `cell` while one is selected, else the relation of the selected
 * `target` in the `selected` row; none on the element of a row.
 */
export const matrixSpotOf = (
  columns: readonly MatrixColumn[],
  rows: readonly MatrixRow[],
  selected: MatrixRow | undefined,
  cell: { readonly row: number; readonly column: number } | undefined,
  target: Target | undefined,
): MatrixSpot | undefined => {
  if (cell !== undefined) {
    const row = rows[cell.row];
    const of = columns[cell.column];
    return row === undefined || of === undefined ? undefined : cellSpot(row.element, of);
  }
  return selected !== undefined && target?.kind === "relation"
    ? relationSpot(selected.element, target.relation)
    : undefined;
};

/** A text that changes only when the spot does, for a view's effect. */
export const spotKey = (spot: MatrixSpot | undefined): string =>
  spot === undefined
    ? ""
    : [spot.row.key, spot.kind, spot.direction, spot.other?.id ?? "", spot.other?.repository ?? ""].join(
        "\u0000",
      );

/** An argument given before the command prompt asks the others: its field, value and how its line names it. */
export interface Prefilled {
  readonly field: string;
  readonly value: unknown;
  readonly label: string;
}

/** The arguments given to catalog commands by name (`ActionContext.given`). */
export type GivenArguments = Readonly<Record<string, readonly Prefilled[]>>;

const kindOf = (spot: MatrixSpot, kindNames: ReadonlyMap<string, string>): Prefilled => ({
  field: "kind",
  value: spot.kind,
  label: kindNames.get(spot.kind) ?? spot.kind,
});

/**
 * "Create relation" in a cell (AK3): the element of the row as the source of an outgoing column, as the
 * target of an incoming one, and the kind of the column; the prompt asks the other end.
 */
const created = (spot: MatrixSpot, kindNames: ReadonlyMap<string, string>): Prefilled[] => {
  const row = { value: spot.row.id, label: spot.rowLabel };
  return spot.direction === "out"
    ? [{ field: "source", ...row }, kindOf(spot, kindNames)]
    : [kindOf(spot, kindNames), { field: "target", ...row }];
};

/**
 * "Remove relation" on a connected element (AK4): the relation between the element of the row and it, in
 * the direction of its column, in the repository of its target, so every argument is given and it runs.
 */
const removed = (
  spot: MatrixSpot,
  other: NonNullable<MatrixSpot["other"]>,
  kindNames: ReadonlyMap<string, string>,
): Prefilled[] => {
  const row = { value: spot.row.id, label: spot.rowLabel };
  const end = { value: other.id, label: other.label };
  const repository = spot.direction === "out" ? other.repository : spot.row.repository;
  return [
    { field: "source", ...(spot.direction === "out" ? row : end) },
    kindOf(spot, kindNames),
    { field: "target", ...(spot.direction === "out" ? end : row) },
    ...(repository === undefined ? [] : [{ field: "repository", value: repository, label: "" }]),
  ];
};

/**
 * The arguments the menu at `place` gives: `relation.add` in a cell, `relation.remove` on a connected
 * element; none elsewhere, in a relation property's column, or without a spot.
 */
export const matrixGiven = (
  place: MenuPlace,
  spot: MatrixSpot | undefined,
  kindNames: ReadonlyMap<string, string>,
): GivenArguments | undefined => {
  if (spot === undefined || spot.property) {
    return undefined;
  }
  if (place === "matrix-cell" && spot.other === undefined) {
    return { "relation.add": created(spot, kindNames) };
  }
  if (place === "matrix-target" && spot.other !== undefined) {
    return { "relation.remove": removed(spot, spot.other, kindNames) };
  }
  return undefined;
};

/** The press is in the column of a relation kind, not of a relation property. */
const ofKind = (hit: MenuHit): boolean =>
  hit.target.closest('[data-menu="matrix-cell"]')?.hasAttribute(PROPERTY_COLUMN) !== true;

/** "Create relation" in a cell outside its connected elements (AK3). */
export const MATRIX_CELL_MENU: readonly MenuEntry[] = [{ id: "command:relation.add", when: ofKind }];

/** "Remove relation" on a connected element, after the entries of an element (AK4). */
export const MATRIX_TARGET_MENU: readonly MenuEntry[] = [{ id: "command:relation.remove", when: ofKind }];
