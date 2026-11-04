// The lines of the result buffer of `trace.chain` (SR-033): the lines of its output by shape
// (`result.ts`), with the `evidence` of the chain under the element rows it belongs to instead of a list of
// its own, as the CLI shows it. Under a requirement, each test case is a line "test case <class name> ›
// <name>" (" · not executed" for one that has no execution, AK3), with one line per execution below it,
// in core's order (newest first): "<date> · <result> · <item> · <Beleg>" (AK1); a record without a test
// case is a line "record <date> · <method> · <result> · <item> · <Beleg>"; a record of a variant ends in
// "variant <UUID>" (the output names no variants). The Beleg is text, never opened (offline): the record's
// `evidence`, or else the place of its record file (`belegOf`). An evidence item names its element by UUID
// and repository and belongs to a child (core gives none for a parent): it goes under the last row of that
// element among the nodes, since the parents come before the children (an element of a cycle is both); one
// whose element has no row (cut by the line limit) is not shown. Layout only: core gives the test cases, their executions and
// the records (ADR-0002).
import type { DataExportEvidenceRecord, DataExportTestCase } from "@reqseq/core";
import { belegOf } from "./evidence-lines.js";
import type { ResultLine } from "./result.js";
import { resultLines } from "./result.js";
import { reasonLine } from "./variant-lines.js";

/** An item of `evidence` of `trace.chain`: the test cases and the records without test case of one element. */
interface ChainEvidence {
  readonly id: string;
  readonly repository: string;
  readonly testCases: readonly DataExportTestCase[];
  readonly records: readonly DataExportEvidenceRecord[];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isChainEvidence = (value: unknown): value is ChainEvidence =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["repository"] === "string" &&
  Array.isArray(value["testCases"]) &&
  Array.isArray(value["records"]);

const keyOf = (id: string, repository: string): string => `${repository}\u0000${id}`;

/** The given parts of a line, joined by " · ". */
const joined = (parts: readonly (string | undefined)[]): string =>
  parts.filter((part): part is string => part !== undefined).join(" · ");

const resultOf = (record: DataExportEvidenceRecord): string =>
  record.reason === undefined ? record.result : `${record.result}: ${reasonLine(record.reason)}`;

const variantOf = (record: DataExportEvidenceRecord): string | undefined =>
  record.variant === undefined ? undefined : `variant ${record.variant}`;

const text = (depth: number, label: string, line: string): ResultLine => ({
  kind: "text",
  depth,
  label,
  text: line,
});

/** The lines of one element's evidence, at `depth`. */
const evidenceLines = (evidence: ChainEvidence, depth: number): ResultLine[] => [
  ...evidence.testCases.flatMap((test) => [
    text(
      depth,
      "test case",
      joined([
        test.className === undefined ? test.name : `${test.className} › ${test.name}`,
        test.executed ? undefined : "not executed",
      ]),
    ),
    ...test.executions.map((execution) =>
      text(
        depth + 1,
        "",
        joined([
          execution.date,
          resultOf(execution),
          execution.item,
          belegOf(execution),
          variantOf(execution),
        ]),
      ),
    ),
  ]),
  ...evidence.records.map((record) =>
    text(
      depth,
      "record",
      joined([record.date, record.method, resultOf(record), record.item, belegOf(record), variantOf(record)]),
    ),
  ),
];

/** The lines of an output of `trace.chain`; an output without a list `evidence` is laid out by shape alone. */
export const chainLines = (output: unknown): ResultLine[] => {
  if (!isRecord(output) || !Array.isArray(output["evidence"])) {
    return resultLines(output);
  }
  const { evidence, ...rest } = output;
  const byElement = new Map<string, ChainEvidence>();
  for (const item of evidence as readonly unknown[]) {
    if (isChainEvidence(item)) {
      byElement.set(keyOf(item.id, item.repository), item);
    }
  }
  const lines = resultLines(rest);
  // The last row of each element among the nodes: the lines under the top-level key "nodes".
  const rowOf = new Map<string, number>();
  let inNodes = false;
  lines.forEach((line, at) => {
    if (line.depth === 0) {
      inNodes = line.label === "nodes";
    } else if (inNodes && line.open !== undefined) {
      rowOf.set(keyOf(line.open.id, line.open.repository), at);
    }
  });
  const under = new Map<number, ChainEvidence>();
  for (const [key, item] of byElement) {
    const at = rowOf.get(key);
    if (at !== undefined) {
      under.set(at, item);
    }
  }
  return lines.flatMap((line, at) => {
    const item = under.get(at);
    return item === undefined ? [line] : [line, ...evidenceLines(item, line.depth + 1)];
  });
};
