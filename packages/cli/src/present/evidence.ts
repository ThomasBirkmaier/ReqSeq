// Part of the CLI output for people (`../present.ts`, whose comment describes the layout): evidence
// records, test cases, and the nodes of a graph with their evidence summaries.
import type { Names, Rec } from "./common.js";
import { isElement, isRecord, join, listOf, nodeKey, reasonText, text, variantName } from "./common.js";
import { elementLine, nameOfCriterion } from "./element.js";

/**
 * The acceptance criteria a record names (D-072), `[criteria 1, k7f3]` as written, or as
 * `criterionNames` name them (`[criteria AK1 (k7f3), AK-m2x9]`, SR-205 AK2); empty for one that
 * holds for all.
 */
const criteriaText = (criteria: unknown, names: unknown): string => {
  const named = listOf(names).filter(isRecord).map(nameOfCriterion);
  const given = listOf(criteria)
    .filter((n) => typeof n === "number" || typeof n === "string")
    .map(String);
  const shown = named.length > 0 ? named : given;
  return shown.length === 0 ? "" : `[criteria ${shown.join(", ")}]`;
};

/**
 * A record as one line: date, method (`withMethod`), result, the reason of an inconclusive one (SR-172),
 * item, Beleg, variant and criteria (D-072), the variant by
 * its short ID when `names` has it (#676).
 */
export const recordLine = (record: Rec, withMethod: boolean, names: Names): string =>
  join(
    text(record["date"]),
    withMethod ? text(record["method"]) : "",
    text(record["result"]),
    reasonText(record["reason"]),
    text(record["item"]),
    // Where the Beleg is, as core gives it (#821).
    text(record["evidenceSource"]),
    text(record["variant"]) === "" ? "" : `[variant ${variantName(text(record["variant"]), names)}]`,
    criteriaText(record["criteria"], record["criterionNames"]),
  );

/** An evidence record (`data-export.schema.json#/$defs/evidenceRecord`), as far as a line reads it. */
export const isEvidenceRecord = (value: unknown): value is Rec =>
  isRecord(value) && ["kind", "date", "result"].every((key) => typeof value[key] === "string");

/** A test case with its executions (`data-export.schema.json#/$defs/testCase`). */
export const isTestCase = (value: unknown): value is Rec =>
  isRecord(value) && typeof value["name"] === "string" && Array.isArray(value["executions"]);

/**
 * A record of a list of records (evidence.list, trace.affected, #275): `recordLine`, its kind when it
 * is no verification, the version it was recorded against and the baselines that hold that version.
 */
export const listedRecordLine = (record: Rec): string => {
  const baselines = listOf(record["baselines"]).map(text);
  return join(
    record["kind"] === "verification" ? "" : text(record["kind"]),
    recordLine(record, true, new Map()),
    text(record["version"]) === "" ? "" : `[version ${text(record["version"])}]`,
    baselines.length === 0 ? "" : `[baselines: ${baselines.join(", ")}]`,
  );
};

/** A test case of a list as one line (#275): its name, then its last result and date and the number of executions. */
export const testCaseLine = (test: Rec): string => {
  const className = text(test["className"]);
  const name = className === "" ? text(test["name"]) : `${className} › ${text(test["name"])}`;
  const last = test["last"];
  const executions = listOf(test["executions"]).length;
  return join(
    name,
    isRecord(last) ? `last: ${join(text(last["result"]), text(last["date"]))}` : "",
    test["executed"] === false ? "[not executed]" : "",
    `executions: ${String(executions)}`,
  );
};

/**
 * The evidence below an element of a chain (SR-033): per test case `test case  CLASS › NAME`, marked
 * `[not executed]` when it has no execution, with one line per execution below it (date, result,
 * item, Beleg); then one line per record without a test case, `record  DATE  METHOD  RESULT  ITEM
 * BELEG`. `item` gives the lines of the test cases and records, `under` those of the executions.
 */
export const evidenceLines = (item: Rec, at: string, under: string, names: Names): string[] => {
  const lines: string[] = [];
  for (const test of listOf(item["testCases"]).filter(isRecord)) {
    const className = text(test["className"]);
    const name = className === "" ? text(test["name"]) : `${className} › ${text(test["name"])}`;
    lines.push(`${at}${join("test case", name, test["executed"] === false ? "[not executed]" : "")}`);
    for (const execution of listOf(test["executions"]).filter(isRecord)) {
      lines.push(`${under}${recordLine(execution, false, names)}`);
    }
  }
  for (const record of listOf(item["records"]).filter(isRecord)) {
    lines.push(`${at}${join("record", recordLine(record, true, names))}`);
  }
  return lines;
};

/** A summary of the evidence below a node of a graph (trace.graph `evidence`). */
type EvidenceSummary = Rec & { readonly testCases: number; readonly records: number; readonly results: Rec };

const isEvidenceSummary = (value: unknown): value is EvidenceSummary =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["testCases"] === "number" &&
  typeof value["records"] === "number" &&
  isRecord(value["results"]);

/** A graph with evidence: `nodes` of elements with a `level`, and `evidence` summaries. */
export const isGraphWithEvidence = (output: Rec): boolean => {
  const { nodes, evidence } = output;
  return (
    Array.isArray(nodes) &&
    nodes.length > 0 &&
    nodes.every((n) => isElement(n) && typeof n["level"] === "number") &&
    Array.isArray(evidence) &&
    evidence.every(isEvidenceSummary)
  );
};

/** `n thing`, `n things`. */
const counted = (n: number, thing: string): string => `${String(n)} ${thing}${n === 1 ? "" : "s"}`;

/** `evidence: 2 test cases, 1 record · 2 passed, 1 failed` (a count of 0 left out). */
const evidenceSummaryLine = (summary: EvidenceSummary): string => {
  const kinds = [
    summary.testCases > 0 ? counted(summary.testCases, "test case") : "",
    summary.records > 0 ? counted(summary.records, "record") : "",
  ]
    .filter((part) => part !== "")
    .join(", ");
  const results = Object.entries(summary.results)
    .map(([result, n]) => `${String(n)} ${result}`)
    .join(", ");
  return `evidence: ${[kinds, results].filter((part) => part !== "").join(" · ")}`;
};

/** The nodes of a graph, each with the summary of its evidence on the line below (SR-111 AK3). */
export const graphNodeLines = (output: Rec): string[] => {
  const nodes = listOf(output["nodes"]).filter(isElement);
  const summaries = new Map(
    listOf(output["evidence"])
      .filter(isEvidenceSummary)
      .map((summary) => [nodeKey("", text(summary["repository"]), text(summary["id"])), summary]),
  );
  const lines = ["nodes:"];
  for (const node of nodes) {
    lines.push(`  ${elementLine(node)}`);
    const summary = summaries.get(nodeKey("", text(node["repository"]), text(node["id"])));
    if (summary !== undefined) {
      lines.push(`    ${evidenceSummaryLine(summary)}`);
    }
  }
  return lines;
};
