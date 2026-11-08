// The traceability matrix of a list (SR-125): the input of `trace.matrix` for a list buffer and the rows,
// columns and cursor steps of its answer. The matrix is a mode of the list buffer (D-062). Pure display of
// the command's output (ADR-0002): columns, counts, shares, gaps, outdated and missing all come from core, so
// every access shows the same (SR-125 AK6, SR-153 AK3); the app only lays them out. A gap is what core's
// `gaps` names, only where the metamodel sets a minimum (SR-153); an empty cell is no gap by itself. With evidence locations, two more
// columns (SR-126): the test cases of each requirement with the result and date of their last execution,
// and its verification status, with the degree of the selection above it (`degreeLine`, `testCaseLine`,
// `statusLine`).
import { degreePercent, minimumHeadText } from "@reqseq/core/verification-degree";
import type {
  DataExportRelation,
  DataExportVerificationDegree,
  DataExportVerificationEntry,
  TraceMatrixInput,
  TraceMatrixOutput,
} from "@reqseq/core";
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

export type MatrixTestCase = NonNullable<MatrixOutputRow["testCases"]>[number];

export type MatrixGap = NonNullable<MatrixOutputRow["gaps"]>[number];

/**
 * One row of the matrix: the element, one cell (a list of relations, empty when it has none) per column,
 * and the minima its cells undershoot (`gaps`, SR-153); with evidence, a requirement's test cases and
 * verification status (SR-126), both left out on any other row.
 */
export interface MatrixRow {
  /** The row element, as a list row shows it. */
  readonly element: Row;
  /** The type of the row element (SR-199: whether a relation of a column can be created in its row). */
  readonly type: string;
  readonly cells: readonly (readonly DataExportRelation[])[];
  readonly gaps: readonly MatrixGap[];
  readonly testCases?: readonly MatrixTestCase[];
  readonly verification?: DataExportVerificationEntry;
}

export const matrixRows = (output: TraceMatrixOutput): MatrixRow[] =>
  output.rows.map((row: MatrixOutputRow) => ({
    element: rowOf(row, row.depth ?? 0, [], false),
    type: row.type,
    cells: row.cells,
    gaps: row.gaps ?? [],
    ...(row.testCases === undefined ? {} : { testCases: row.testCases }),
    ...(row.verification?.[0] === undefined ? {} : { verification: row.verification[0] }),
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
 * The element a target stands for, which the commands of the context menu and "Open to the right" act on
 * (SR-194 AK5, SR-150): the row's element, or the element of a relation, when it is there.
 */
export const targetElement = (target: Target | undefined): ElementBuffer | undefined => {
  if (target === undefined) {
    return undefined;
  }
  if (target.kind === "element") {
    return target.open;
  }
  const opened = opening(target.relation);
  return opened.ok ? opened.buffer : undefined;
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
 * The head of a column. With minima (SR-153 AK1): how many rows meet them, of how many they apply to, and
 * their share as core's percentage (`minimumHeadText`, one decimal rounded down, as the CLI), e.g.
 * "2 of 5 · 40 %". Without (AK2): how many rows have a relation in the column, e.g. "4".
 */
export const columnCount = (column: MatrixColumn): string =>
  column.share === undefined || column.expected === undefined || column.met === undefined
    ? String(column.count)
    : minimumHeadText(column.met, column.expected, column.share);

/** The gaps of a row in the column at `index`: one per minimum its cell undershoots. */
export const cellGaps = (row: MatrixRow, index: number): readonly MatrixGap[] =>
  row.gaps.filter((gap) => gap.column === index);

/** What a gap mark says on demand: "at least 1 to Need, has 0", one line per minimum. */
export const gapTitle = (gaps: readonly MatrixGap[]): string =>
  gaps.map((gap) => `at least ${String(gap.min)} to ${gap.targetName}, has ${String(gap.count)}`).join("\n");

/** The statuses in the order the degree line names them: those that count for the degree first. */
const STATUSES = ["verified", "indirect", "failed", "outdated", "open"] as const;

/**
 * The line above the status column (SR-126 AK4): the degree of the whole selection as core's percentage
 * (`degreePercent`, one decimal rounded down, as the CLI), then the count of each status that occurs, e.g.
 * "55.5 % · 4 verified · 1 indirect · 1 failed · 1 outdated · 2 open"; no percentage without a share.
 */
export const degreeLine = (degree: DataExportVerificationDegree): string =>
  [
    ...(degree.share === undefined ? [] : [degreePercent(degree.share)]),
    ...STATUSES.filter((status) => degree.counts[status] > 0).map(
      (status) => `${String(degree.counts[status])} ${status}`,
    ),
  ].join(" · ");

/** A line of a cell: its text, whether it is in the accent colour, and what it shows on demand (title). */
export interface CellLine {
  readonly text: string;
  readonly accent: boolean;
  readonly title: string;
}

/** The word of a mark of a test case (AK2): it replaces the result. */
const MARK_WORDS: Readonly<Record<NonNullable<MatrixTestCase["mark"]>, string>> = {
  "not-executed": "not executed",
  failed: "failed",
  outdated: "outdated",
};

/**
 * A test case in its cell (SR-126 AK1, AK2): "<name> · <result> · <date>" of its last execution, the date
 * without the time; a mark replaces the result word, in the accent colour. The class name, the item and
 * the version of the last execution are on demand.
 */
export const testCaseLine = (test: MatrixTestCase): CellLine => {
  const { last } = test;
  return {
    text: [test.name, test.mark === undefined ? last?.result : MARK_WORDS[test.mark], last?.date.slice(0, 10)]
      .filter((part): part is string => part !== undefined)
      .join(" · "),
    accent: test.mark !== undefined,
    title: [
      test.className === undefined ? test.name : `${test.className} › ${test.name}`,
      ...(last === undefined ? [] : [`item ${last.item ?? "—"}`, `version ${last.version}`]),
    ].join("\n"),
  };
};

/**
 * The status cell (SR-126 AK1, AK3): the status word, `failed` and `outdated` in the accent colour,
 * with how many acceptance criteria are verified when core counts them (SR-031 AK5, `open · 2 of 3`, the criteria not verified on demand);
 * an open requirement names how many of its children are missing on demand (SR-034).
 */
export const statusLine = (entry: DataExportVerificationEntry): CellLine => ({
  text:
    entry.criteria === undefined
      ? entry.status
      : `${entry.status} · ${String(entry.criteria.verified)} of ${String(entry.criteria.total)}`,
  accent: entry.status === "failed" || entry.status === "outdated",
  title:
    entry.missingChildren !== undefined
      ? `${String(entry.missingChildren.length)} missing child${entry.missingChildren.length === 1 ? "" : "ren"}`
      : entry.criteria?.notVerified === undefined
        ? ""
        : `${entry.criteria.notVerified.map((n) => `AK${String(n)}`).join(", ")} not verified`,
});
