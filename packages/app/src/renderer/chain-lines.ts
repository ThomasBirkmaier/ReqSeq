// The lines of the result buffer of `trace.chain` (SR-033): the lines of its output by shape
// (`result.ts`), with the `evidence` of the chain under the element rows it belongs to instead of a list of
// its own, as the CLI shows it. Under a requirement, each test case is a line "test case <class name> ›
// <name>" (" · not executed" for one that has no execution, AK3), with its executions below it as runs
// (`runs.ts`, SR-223 AK4): "<date> · <result>" and the views where a variant is involved (AK1); the item under
// test and the evidence document only with "Show details" (SR-223 AK2). A record without a test case is a line
// "record <date> · <method> · <result> · <item> · <evidence document>"; a record of a variant ends in "variant
// <title>", the title `names` gives (else its UUID). The evidence document is text, never opened (offline): the
// record's `evidenceSource` as core gives it (#821). An evidence item names its element by UUID
// and repository and belongs to a child (core gives none for a parent): it goes under the last row of that
// element among the nodes, since the parents come before the children (an element of a cycle is both); one
// whose element has no row (cut by the line limit) is not shown. The root's `validationRecords` (#646) are lines
// "validation <date> · <result> · <item> · <evidence document> · version <version>" under the root row, none when the
// root is not on the page. Layout only: core gives the test cases, their executions and
// the records (ADR-0002).
import type { DataExportEvidenceRecord, DataExportTestCase } from "@reqseq/core";
import { wholeReasonOf } from "./evidence-lines.js";
import type { OutputField, ResultLine } from "./result.js";
import { resultLines } from "./result.js";
import type { VariantTitle } from "./runs.js";
import { joinedParts as joined, resultOf, testCaseLines } from "./runs.js";

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

const text = (depth: number, label: string, line: string, title?: string): ResultLine => ({
  kind: "text",
  depth,
  label,
  text: line,
  ...(title === undefined ? {} : { title }),
});

/** The titles of the variants the output names (`names`), by UUID. */
const variantTitles = (output: Readonly<Record<string, unknown>>): VariantTitle => {
  const names = Array.isArray(output["names"]) ? (output["names"] as readonly unknown[]) : [];
  const byId = new Map<string, string>();
  for (const name of names) {
    if (isRecord(name) && typeof name["id"] === "string" && typeof name["title"] === "string") {
      byId.set(name["id"], name["title"]);
    }
  }
  return (id) => byId.get(id);
};

/** The lines of one element's evidence, at `depth`; `details`: with the details of each execution. */
const evidenceLines = (
  evidence: ChainEvidence,
  depth: number,
  title: VariantTitle,
  details: boolean,
): ResultLine[] => [
  ...evidence.testCases.flatMap((test) => testCaseLines(test, depth, title, details)),
  ...evidence.records.map((record) =>
    text(
      depth,
      "record",
      joined([
        record.date,
        record.method,
        resultOf(record),
        record.item,
        record.evidenceSource,
        record.variant === undefined ? undefined : `variant ${title(record.variant) ?? record.variant}`,
      ]),
      wholeReasonOf(record),
    ),
  ),
];

/**
 * The lines of an output of `trace.chain`, its fields under their titles (`fields`, `result.ts`), its details
 * with `details` ("Show details", SR-223 AK2); an output
 * without a list `evidence` is laid out by shape alone.
 */
export const chainLines = (
  output: unknown,
  fields: readonly OutputField[] = [],
  details = false,
  unfolded: readonly string[] = [],
): ResultLine[] => {
  if (!isRecord(output) || !Array.isArray(output["evidence"])) {
    return resultLines(output, fields, details, unfolded);
  }
  const { evidence, validationRecords, ...rest } = output;
  // The root's validation records (#646), as records under the root row, labelled "validation".
  const validation = (
    Array.isArray(validationRecords) ? validationRecords : []
  ) as DataExportEvidenceRecord[];
  const byElement = new Map<string, ChainEvidence>();
  for (const item of evidence as readonly unknown[]) {
    if (isChainEvidence(item)) {
      byElement.set(keyOf(item.id, item.repository), item);
    }
  }
  const lines = resultLines(rest, fields, details, unfolded);
  const title = variantTitles(output);
  // The last row of each element among the nodes: the lines under the top-level key "nodes".
  const rowOf = new Map<string, number>();
  let rootRow: number | undefined;
  let inNodes = false;
  lines.forEach((line, at) => {
    if (line.depth === 0) {
      inNodes = line.field === "nodes";
    } else if (inNodes && line.open !== undefined) {
      rowOf.set(keyOf(line.open.id, line.open.repository), at);
      rootRow ??= line.open.id === output["root"] ? at : undefined;
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
    const validated =
      at === rootRow
        ? validation.map((record) =>
            text(
              line.depth + 1,
              "validation",
              joined([
                record.date,
                resultOf(record),
                record.item,
                record.evidenceSource,
                `version ${record.version}`,
              ]),
              wholeReasonOf(record),
            ),
          )
        : [];
    return [
      line,
      ...(item === undefined ? [] : evidenceLines(item, line.depth + 1, title, details)),
      ...validated,
    ];
  });
};
