// The lines of an element's evidence records on its page (SR-032), from `evidence.list` as it is
// (ADR-0002: core computes, the app lays out). One line per record, in core's order (newest first):
// "<date> · <kind> · <method> · <result>: <reason> · <item> · <Beleg> · <variant> · version <version> ·
// baselines <name>, <name>", with the parts of the CLI's line (SR-080), a reason on one line as on the
// validation line (`reasonLine`). The kind is named only when it is no verification; the Beleg (SR-032
// AK1) is the record's `evidence` as text, never opened (offline), or else the place of its record file,
// `<repository>/<file>:<line>`; the variant (SR-047 AK2) is a link named by `names` of `element.get`, or
// its UUID; the baselines are the files that hold the record's version (SR-032 AK2), left out when none
// does. A part that is absent is left out with its separator. After the records, one note per problem of
// `evidence.list` (a baseline file that cannot be read names no baseline) and one when the answer is
// incomplete (a repository not on this machine), so a line without baselines is not taken for a sure one.
import type { DataExportEvidenceRecord, ElementName, EvidenceListOutput } from "@reqseq/core";
import { elementBufferOf } from "./buffers.js";
import type { LinePart } from "./variant-lines.js";
import { joined, reasonLine, wholeReason } from "./variant-lines.js";

/** The note of an incomplete answer (SR-006 AK2). */
export const INCOMPLETE_NOTE =
  "Incomplete: records or baselines in a repository that is not on this machine are not shown";

/** Where the Beleg of `record` is: its `evidence` as given, or else the place of its record file. */
export const belegOf = (record: DataExportEvidenceRecord): string | undefined =>
  record.evidence !== undefined && record.evidence !== ""
    ? record.evidence
    : record.file === undefined
      ? undefined
      : `${record.repository === undefined ? "" : `${record.repository}/`}${record.file}${
          record.line === undefined ? "" : `:${String(record.line)}`
        }`;

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
    part(belegOf(record)),
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
