// Part of the CLI output for people (`../present.ts`, whose comment describes the layout): a matrix
// (trace.matrix).
import { minimumHeadText } from "@reqseq/core";
import type { Names, Rec } from "./common.js";
import { isElement, isRecord, join, listOf, namerOf, text, withIdentifier } from "./common.js";
import { elementLine, viewNamerOf } from "./element.js";

/** A column of a matrix (trace.matrix `columns`): a name and a direction. */
const isMatrixColumn = (value: unknown): value is Rec =>
  isRecord(value) && typeof value["name"] === "string" && typeof value["direction"] === "string";

/** A matrix: `columns`, and `rows` of elements whose `cells` hold one list per column (#629). */
export const isMatrix = (output: Rec): boolean => {
  const { columns, rows } = output;
  return (
    Array.isArray(columns) &&
    columns.every(isMatrixColumn) &&
    Array.isArray(rows) &&
    rows.every(
      (row) => isElement(row) && Array.isArray(row["cells"]) && row["cells"].length === columns.length,
    )
  );
};

/** A relation in a cell: the other end by short ID (else its UUID), `[outdated]` when it is. */
const cellItem = (relation: unknown): string => {
  if (!isRecord(relation)) {
    return "";
  }
  const shortId = text(relation["shortId"]);
  const state = text(relation["targetState"]);
  return join(
    shortId === "" ? text(relation["id"]) : withIdentifier(shortId, relation["identifier"]),
    state === "" || state === "available" ? "" : `[${state}]`,
    relation["outdated"] === true ? "[outdated]" : "",
  );
};

/**
 * The head of a matrix column (SR-153): with minima `met of expected · share` (core's `minimumHeadText`),
 * else the count of the rows with a relation.
 */
const columnHead = (column: Rec): string => {
  const { count, expected, met, share } = column;
  if (typeof share === "number" && typeof expected === "number" && typeof met === "number") {
    return minimumHeadText(met, expected, share);
  }
  return typeof count === "number" ? String(count) : "";
};

/** The columns of a matrix (#629), numbered, with their heads. */
export const matrixColumnLines = (output: Rec): string[] => {
  const columns = listOf(output["columns"]).filter(isRecord);
  const lines = columns.length === 0 ? ["columns: none"] : ["columns:"];
  for (const [index, column] of columns.entries()) {
    lines.push(
      `  ${join(
        `${String(index + 1)}:`,
        text(column["name"]),
        `(${text(column["kind"])}, ${text(column["direction"])})`,
        columnHead(column),
      )}`,
    );
  }
  return lines;
};

/** The indexes of the columns that the row's `gaps` names (SR-153). */
const gapColumns = (row: Rec): ReadonlySet<number> =>
  new Set(
    listOf(row["gaps"])
      .filter(isRecord)
      .map((gap) => gap["column"])
      .filter((column): column is number => typeof column === "number"),
  );

/**
 * The rows of a matrix (#629): per row its element line and one line of cells, `n: SHORT-ID, ...` per
 * column, `–` for an empty cell, the target state when it is not available, `[gap]` after a cell below a
 * minimum (SR-153), and its test cases when the row has them (SR-126).
 */
export const matrixRowLines = (output: Rec, names: Names): string[] => {
  const rows = listOf(output["rows"]).filter(isElement);
  if (rows.length === 0) {
    return ["rows: none"];
  }
  const lines = ["rows:"];
  const name = namerOf(rows);
  const view = viewNamerOf(rows, names);
  for (const row of rows) {
    const depth = row["depth"];
    lines.push(`  ${typeof depth === "number" ? "  ".repeat(depth) : ""}${elementLine(row, name, view)}`);
    const gaps = gapColumns(row);
    const cells = listOf(row["cells"]).map((cell, index) => {
      const items = listOf(cell).map(cellItem);
      return `${String(index + 1)}: ${items.length === 0 ? "–" : items.join(", ")}${gaps.has(index) ? " [gap]" : ""}`;
    });
    const tests = row["testCases"];
    const testText = Array.isArray(tests)
      ? `tests: ${
          tests.length === 0
            ? "–"
            : listOf(tests)
                .filter(isRecord)
                .map((t) => text(t["name"]))
                .join(", ")
        }`
      : "";
    const cellLine = join(...cells, testText);
    if (cellLine !== "") {
      lines.push(`    ${cellLine}`);
    }
  }
  return lines;
};
