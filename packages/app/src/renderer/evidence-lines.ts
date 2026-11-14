// The lines of an element's evidence records on its page (SR-032), from `evidence.list` as it is
// (ADR-0002: core computes, the app lays out). One line per record, in core's order (newest first):
// "<date> · <kind> · <method> · <result>: <reason> · <item> · <evidence document> · <variant> · version <version> ·
// baselines <name>, <name>", with the parts of the CLI's line (SR-080), a reason on one line as on the
// validation line (`reasonLine`). The kind is named only when it is no verification; the evidence document (SR-032
// AK1) is the record's `evidenceSource` as core gives it (#821), text never opened (offline); the
// variant (SR-047 AK2) is a link named by `names` of `element.get`, or its UUID; the baselines are the files that hold the record's version (SR-032 AK2), left out when none
// does. A part that is absent is left out with its separator. After the records, one note per problem of
// `evidence.list` (a baseline file that cannot be read names no baseline) and one when the answer is
// incomplete (a repository not on this machine), so a line without baselines is not taken for a sure one.
// The section is laid out from `display` of `evidence.list` (`displayLines`, SR-032 AK3 to AK5): the values
// the open records share once, then one fold line per acceptance criterion ("AK2 · failed in Windows · 4
// tests", coloured when failed or outdated), opening to one line per test case, opening to the record
// lines above; then one fold line per older run, opening to its records.
import type { DataExportEvidenceRecord, ElementName, EvidenceListOutput } from "@reqseq/core";
import { criterionLabel } from "@reqseq/core/criterion-items";
import { elementBufferOf } from "./buffers.js";
import type { LinePart } from "./variant-lines.js";
import { joined, reasonLine, wholeReason } from "./variant-lines.js";

/** The note of an incomplete answer (SR-006 AK2). */
export const INCOMPLETE_NOTE =
  "Incomplete: records or baselines in a repository that is not on this machine are not shown";

const part = (text: string | undefined): LinePart[] => (text === undefined ? [] : [{ text }]);

/** The parts of one record's line; `byId` names its variant. */
const recordLine = (record: DataExportEvidenceRecord, byId: ReadonlyMap<string, ElementName>): LinePart[] => {
  const variant = record.variant === undefined ? undefined : byId.get(record.variant);
  const groups: LinePart[][] = [
    part(record.date),
    part(record.kind === "verification" ? undefined : record.kind),
    part(record.method),
    part(record.reason === undefined ? record.result : `${record.result}: ${reasonLine(record.reason)}`),
    part(record.item),
    part(record.evidenceSource),
    record.variant === undefined
      ? []
      : variant === undefined
        ? part(record.variant)
        : [{ text: variant.title, id: variant.id, open: elementBufferOf(variant) }],
    part(`version ${record.version}`),
    part(
      record.baselines === undefined || record.baselines.length === 0
        ? undefined
        : `baselines ${record.baselines.join(", ")}`,
    ),
  ];
  return joined(groups.filter((group) => group.length > 0));
};

/** One line per record of `output`, in its order; `names` (of `element.get`) names the variants. */
export const evidenceLines = (
  output: Pick<EvidenceListOutput, "records">,
  names: readonly ElementName[] | undefined,
): LinePart[][] => {
  const byId = new Map((names ?? []).map((name) => [name.id, name]));
  return output.records.map((record) => recordLine(record, byId));
};

/** The whole reason of `record` when its line cuts it (#862), else undefined. */
export const wholeReasonOf = (record: DataExportEvidenceRecord): string | undefined =>
  record.reason === undefined ? undefined : wholeReason(record.reason);

/** A record's line with what keys it among the others and the whole reason it cuts (#862). */
export interface EvidenceRow {
  readonly key: string;
  readonly parts: LinePart[];
  readonly whole: string | undefined;
}

/** One row per record of `output`, in its order; a key per record, so an open reason stays at its record. */
export const evidenceRows = (
  output: Pick<EvidenceListOutput, "records">,
  names: readonly ElementName[] | undefined,
): EvidenceRow[] => {
  const lines = evidenceLines(output, names);
  return output.records.map((record, at) => ({
    key: [record.date, record.repository, record.file, record.line, record.version, at].join("\u0000"),
    parts: lines[at] ?? [],
    whole: wholeReasonOf(record),
  }));
};

/** The notes under the records: each problem as "<severity> · <code> · <message>", then the incomplete note. */
export const evidenceNotes = (output: Pick<EvidenceListOutput, "problems" | "incomplete">): string[] => [
  ...output.problems.map((problem) => `${problem.severity} · ${problem.code} · ${problem.message}`),
  ...(output.incomplete ? [INCOMPLETE_NOTE] : []),
];

type Display = EvidenceListOutput["display"];
type DisplayRow = Display["rows"][number];
type DisplayCase = DisplayRow["cases"][number];

/** A fold line of the Evidence section (SR-032 AK4): its head, the colour of a failed or outdated one, and what it folds. */
export interface FoldRow<T> {
  readonly key: string;
  readonly head: string;
  readonly status?: "failed" | "outdated";
  readonly children: readonly T[];
}

/** The Evidence section at a glance (`display` of `evidence.list`, SR-032 AK3 to AK5), as text. */
export interface DisplayLines {
  /** AK5: the values the open records share, once; undefined when they share none. */
  readonly shared: string | undefined;
  /** AK4: one line per criterion (and validation), each folding its test cases, each its records. */
  readonly rows: readonly FoldRow<FoldRow<EvidenceRow>>[];
  /** AK3: one line per older run, each folding its records. */
  readonly older: readonly FoldRow<EvidenceRow>[];
}

/**
 * "2026-11-09 08:48 UTC" for a date in UTC as CI writes it, with its seconds when they are not 0
 * ("2026-11-09 08:48:05 UTC"), else the date as written.
 */
export const shortDate = (date: string): string => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?Z$/.exec(date);
  if (match === null) {
    return date;
  }
  const seconds = match[3] === undefined || match[3] === "00" ? "" : `:${match[3]}`;
  return `${String(match[1])} ${String(match[2])}${seconds} UTC`;
};

/** "1 test", "7 tests", "no tests". */
const tests = (count: number): string =>
  count === 0 ? "no tests" : count === 1 ? "1 test" : `${String(count)} tests`;

/** The name of a view: "core", or the variant's title from `names`, else its UUID. */
const viewTitle = (view: string, byId: ReadonlyMap<string, ElementName>): string =>
  view === "core" ? "core" : (byId.get(view)?.title ?? view);

/**
 * A row's head (AK4): "AK2 (k7f3) · passed · 7 tests" (its key where it has one, SR-205 AK2), "AK2 · failed in Windows · 4 tests", "AK1 · passed · outdated · 1 test".
 * A verification row gives the worst result of its records, its first case's (core sorts the cases worst first),
 * or "open" without cases; a failed or outdated row names the views where it is so when there are several. A
 * validation row gives its status.
 */
const rowHead = (row: DisplayRow, byId: ReadonlyMap<string, ElementName>): string => {
  const label =
    row.criterion !== undefined
      ? criterionLabel(row)
      : row.kind === "validation"
        ? "Validation"
        : "Verification";
  const views = row.views ?? [];
  const named =
    views.length > 1
      ? ` in ${views
          .filter((view) => view.status === row.status)
          .map((view) => viewTitle(view.view, byId))
          .join(", ")}`
      : "";
  const result = row.kind === "validation" ? row.status : (row.cases[0]?.result ?? "open");
  const state =
    row.status === "failed"
      ? `failed${named}`
      : row.status === "outdated"
        ? `${result} · outdated${named}`
        : result;
  return `${label} · ${state} · ${tests(row.cases.length)}`;
};

/** A case's head: its name (or the method and item, else the date, of a record without test case), result and views. */
const caseHead = (
  test: DisplayCase,
  records: readonly DataExportEvidenceRecord[],
  byId: ReadonlyMap<string, ElementName>,
): string => {
  const first = records[test.records[0] ?? -1];
  // A record without test case by its method and item, else (a validation record may have neither) its date.
  const parts = [first?.method, first?.item].filter((part) => part !== undefined);
  const name =
    test.testCase ?? (parts.length > 0 || first === undefined ? parts.join(" · ") : shortDate(first.date));
  const views =
    test.views.length === 1 && test.views[0] === "core"
      ? []
      : [test.views.map((view) => viewTitle(view, byId)).join(", ")];
  return [name, test.result, ...views].join(" · ");
};

/** The text of `display` (SR-032 AK3 to AK5), each record line as `evidenceRows` gives it (AK1, AK2). */
export const displayLines = (
  output: Pick<EvidenceListOutput, "records" | "display">,
  names: readonly ElementName[] | undefined,
): DisplayLines => {
  const byId = new Map((names ?? []).map((name) => [name.id, name]));
  const rows = evidenceRows(output, names);
  const pick = (positions: readonly number[]): EvidenceRow[] =>
    positions.flatMap((at) => {
      const row = rows[at];
      return row === undefined ? [] : [row];
    });
  const { shared } = output.display;
  const sharedParts = [
    shared.date === undefined ? undefined : shortDate(shared.date),
    shared.item,
    shared.version === undefined ? undefined : `version ${shared.version}`,
    shared.baselines === undefined || shared.baselines.length === 0
      ? undefined
      : `baselines ${shared.baselines.join(", ")}`,
  ].filter((part) => part !== undefined);
  return {
    shared: sharedParts.length === 0 ? undefined : sharedParts.join(" · "),
    rows: output.display.rows.map((row, at) => ({
      key: `${row.kind}\u0000${String(row.criterion ?? at)}`,
      head: rowHead(row, byId),
      ...(row.status === "failed" || row.status === "outdated" ? { status: row.status } : {}),
      children: row.cases.map((test) => ({
        key: test.records.join(","),
        head: caseHead(test, output.records, byId),
        ...(test.result === "failed" ? { status: "failed" as const } : {}),
        children: pick(test.records),
      })),
    })),
    older: output.display.older.map((run) => ({
      key: `${run.date}\u0000${run.version}`,
      head: `${shortDate(run.date)} · version ${run.version} · ${String(run.records.length)} ${run.records.length === 1 ? "record" : "records"}`,
      children: pick(run.records),
    })),
  };
};
