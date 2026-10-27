// The traceability matrix of a list (SR-125): the input of `trace.matrix` for a list buffer and the rows,
// columns and cursor steps of its answer. The matrix is a mode of the list buffer (D-062). Pure display of
// the command's output (ADR-0002): columns, counts, shares, gaps, outdated and missing all come from core, so
// every access shows the same (SR-125 AK6); the app only lays them out.
import type { DataExportRelation, TraceMatrixInput, TraceMatrixOutput } from "@logreq/core";
import type { ElementBuffer, ListBuffer } from "./buffers.js";
import { listSort, relationBuffer } from "./buffers.js";
import { relationLabel } from "./element-view.js";
import { rowOf } from "./rows.js";
import type { Row } from "./rows.js";

export type MatrixColumn = TraceMatrixOutput["columns"][number];
type MatrixOutputRow = TraceMatrixOutput["rows"][number];

/** The input of `trace.matrix` for the list: its selection and sort, so the rows are those of the list (AK1). */
export const matrixInput = (list: ListBuffer, offset: number, limit: number): Partial<TraceMatrixInput> => {
  const sort = listSort(list);
  return {
    ...(list.selection === undefined ? {} : { selection: list.selection }),
    ...(sort === undefined ? {} : { sort }),
    limit,
    offset,
  };
};

/** One row of the matrix: the element, and one cell (a list of relations, empty for a gap) per column. */
export interface MatrixRow {
  /** The row element, as a list row shows it. */
  readonly element: Row;
  readonly cells: readonly (readonly DataExportRelation[])[];
}

export const matrixRows = (output: TraceMatrixOutput): MatrixRow[] =>
  output.rows.map((row: MatrixOutputRow) => ({
    element: rowOf(row, row.depth ?? 0, [], false),
    cells: row.cells,
  }));

/** A step of the cursor inside a row: the row element, or one relation of a cell. */
export type Target =
  | { readonly kind: "element"; readonly open: ElementBuffer }
  | { readonly kind: "relation"; readonly relation: DataExportRelation };

/** Where the cursor can stand in a row, in the order Right walks: the element, then every relation of every cell. */
export const targetsOf = (row: MatrixRow): Target[] => [
  { kind: "element", open: row.element.open },
  ...row.cells.flatMap((cell) => cell.map((relation): Target => ({ kind: "relation", relation }))),
];

/** What Enter or a click on a relation does: the buffer of its element, or why it cannot be opened. */
export type Opening =
  { readonly ok: true; readonly buffer: ElementBuffer } | { readonly ok: false; readonly message: string };

export const opening = (relation: DataExportRelation): Opening => {
  const buffer = relation.targetState === "available" ? relationBuffer(relation) : undefined;
  return buffer === undefined
    ? { ok: false, message: `${relationLabel(relation)} is ${relation.targetState}` }
    : { ok: true, buffer };
};

/**
 * The name above a column. A column of incoming relations whose name another column also has (the kinds
 * "Distinct from" and "See also" read the same both ways) gets an arrow, so the direction is not lost.
 */
export const columnName = (column: MatrixColumn, columns: readonly MatrixColumn[]): string =>
  column.direction === "in" && columns.some((other) => other !== column && other.name === column.name)
    ? `← ${column.name}`
    : column.name;

/**
 * The share as a whole percent, rounded down: 100 only when every row has a relation (a share just under
 * 1 must not read "100 %" while gaps exist). The small addend absorbs the error of the float (0.29 * 100).
 */
export const percent = (share: number): number => Math.floor(share * 100 + 1e-9);

/** "4 · 80 %": how many rows of the whole selection have a relation in the column, and their share. */
export const columnCount = (column: MatrixColumn): string =>
  `${String(column.count)} · ${String(percent(column.share))} %`;
