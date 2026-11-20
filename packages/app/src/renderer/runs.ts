// The executions of one test case as runs (SR-223 AK4, SR-033 AK1), for the trace chain and every output that
// gives a test case: the executions of one date are one run, in core's order (newest first). A run whose results
// agree is one row "<date> · <result> · <views>"; when a result differs, each view of the run has its own row, and a
// view whose own results differ one row per execution. The views are named only when the test case has an
// execution in a variant: "Core", then each variant by the title `names` gives it, else by its UUID. The item under
// test and the evidence document of each execution stand under its row only with "Show details" (SR-223 AK2), one
// detail line per execution. A run is taken to be the executions of one date: the records give no other mark of a
// run, and CI writes one date per run for the core and each variant. Layout only: core gives the test cases and
// their executions (ADR-0002).
import type { DataExportEvidenceRecord, DataExportTestCase } from "@reqseq/core";
import { wholeReasonOf } from "./evidence-lines.js";
import type { ResultLine } from "./result.js";
import { reasonLine } from "./variant-lines.js";
import { CORE_VIEW } from "./views.js";

type Execution = DataExportEvidenceRecord;

/** The title of a variant by its UUID; undefined when the output does not name it. */
export type VariantTitle = (id: string) => string | undefined;

/** The given parts of a line, joined by " · ". */
export const joinedParts = (parts: readonly (string | undefined)[]): string =>
  parts.filter((part): part is string => part !== undefined).join(" · ");

/** A record's result, with its reason on one line (SR-172). */
export const resultOf = (record: Execution): string =>
  record.reason === undefined ? record.result : `${record.result}: ${reasonLine(record.reason)}`;

/** The view a record holds for: "Core", or its variant by title, else by UUID. */
const viewOf = (record: Execution, title: VariantTitle): string =>
  record.variant === undefined ? CORE_VIEW.title : (title(record.variant) ?? record.variant);

/** The items of `all` grouped by `key`, the groups in the order of their first item. */
const groupedBy = <T>(all: readonly T[], key: (item: T) => string): T[][] => {
  const groups = new Map<string, T[]>();
  for (const item of all) {
    const group = groups.get(key(item));
    if (group === undefined) {
      groups.set(key(item), [item]);
    } else {
      group.push(item);
    }
  }
  return [...groups.values()];
};

/** All executions have the same result (and reason). */
const agree = (executions: readonly Execution[]): boolean => new Set(executions.map(resultOf)).size <= 1;

/**
 * The rows of a test case's executions: each run (one date) one row while its results agree, else a row per
 * view, and a row per execution of a view whose results differ.
 */
export const runRows = (executions: readonly Execution[], title: VariantTitle): Execution[][] =>
  groupedBy(executions, (execution) => execution.date).flatMap((run) =>
    agree(run)
      ? [run]
      : groupedBy(run, (execution) => viewOf(execution, title)).flatMap((view) =>
          agree(view) ? [view] : view.map((execution) => [execution]),
        ),
  );

const text = (depth: number, label: string, line: string, extra: Partial<ResultLine> = {}): ResultLine => ({
  kind: "text",
  depth,
  label,
  text: line,
  ...extra,
});

/**
 * The lines of a test case at `depth`: "test case <class name> › <name>" (" · not executed" for one without an
 * execution, SR-033 AK3), its rows of runs one level below, and with `details` under each row one detail line
 * per execution, "<view> · <item> · <evidence document>".
 */
export const testCaseLines = (
  test: DataExportTestCase,
  depth: number,
  title: VariantTitle,
  details: boolean,
): ResultLine[] => {
  const named = test.executions.some((execution) => execution.variant !== undefined);
  const views = (row: readonly Execution[]): string | undefined =>
    named ? [...new Set(row.map((execution) => viewOf(execution, title)))].join(", ") : undefined;
  return [
    text(
      depth,
      "test case",
      joinedParts([
        test.className === undefined ? test.name : `${test.className} › ${test.name}`,
        test.executed ? undefined : "not executed",
      ]),
    ),
    ...runRows(test.executions, title).flatMap((row) => {
      const [first] = row as [Execution, ...Execution[]];
      const whole = wholeReasonOf(first);
      return [
        text(
          depth + 1,
          "",
          joinedParts([first.date, resultOf(first), views(row)]),
          whole === undefined ? {} : { title: whole },
        ),
        ...(details
          ? row.map((execution) =>
              text(
                depth + 2,
                "",
                joinedParts([
                  named ? viewOf(execution, title) : undefined,
                  execution.item,
                  execution.evidenceSource,
                ]),
                { detail: true },
              ),
            )
          : []),
      ];
    }),
  ];
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An execution as outputs give it: a record with a result and a date. */
const isExecution = (value: unknown): boolean =>
  isRecord(value) && typeof value["result"] === "string" && typeof value["date"] === "string";

/** A test case as outputs give it (`testCase` of data-export.schema.json): a name, executed or not, executions. */
export const isTestCase = (value: unknown): value is DataExportTestCase =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["executed"] === "boolean" &&
  Array.isArray(value["executions"]) &&
  value["executions"].every(isExecution);
