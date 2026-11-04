// The lines of an element's evidence records on its page (SR-032), from `evidence.list` as it is
// (ADR-0002: core computes, the app lays out). One line per record, in core's order (newest first), with
// the parts the CLI gives (SR-080): "<date> · <kind> · <method> · <result>: <reason> · <item> · <Beleg> ·
// <variant> · version <version> · baselines <name>, <name>", a reason on one line as on the validation
// line (`reasonLine`). The kind is named only when it is no
// verification; the Beleg (SR-032 AK1) is the record's `evidence` as text, never opened (offline), or else
// the place of its record file, `<repository>/<file>:<line>`; the variant (SR-047 AK2) is a link named by
// `names` of `element.get`, or its UUID; the baselines are the files that hold the record's version
// (SR-032 AK2), left out when none does. A part that is absent is left out with its separator.
import type { DataExportEvidenceRecord, ElementName, EvidenceListOutput } from "@reqseq/core";
import { elementBufferOf } from "./buffers.js";
import type { LinePart } from "./variant-lines.js";
import { reasonLine } from "./variant-lines.js";

const SEPARATOR: LinePart = { text: " · " };

/** Where the Beleg of `record` is: its `evidence` as given, or else the place of its record file. */
export const belegOf = (record: DataExportEvidenceRecord): string | undefined =>
  record.evidence ??
  (record.file === undefined
    ? undefined
    : `${record.repository === undefined ? "" : `${record.repository}/`}${record.file}${
        record.line === undefined ? "" : `:${String(record.line)}`
      }`);

/** The parts of one record's line; `byId` names its variant. */
const recordLine = (record: DataExportEvidenceRecord, byId: ReadonlyMap<string, ElementName>): LinePart[] => {
  const variant = record.variant === undefined ? undefined : byId.get(record.variant);
  const beleg = belegOf(record);
  const groups: (LinePart | undefined)[] = [
    { text: record.date },
    record.kind === "verification" ? undefined : { text: record.kind },
    record.method === undefined ? undefined : { text: record.method },
    { text: record.reason === undefined ? record.result : `${record.result}: ${reasonLine(record.reason)}` },
    record.item === undefined ? undefined : { text: record.item },
    beleg === undefined ? undefined : { text: beleg },
    record.variant === undefined
      ? undefined
      : variant === undefined
        ? { text: record.variant }
        : { text: variant.title, id: variant.id, open: elementBufferOf(variant) },
    { text: `version ${record.version}` },
    record.baselines === undefined || record.baselines.length === 0
      ? undefined
      : { text: `baselines ${record.baselines.join(", ")}` },
  ];
  return groups
    .filter((part): part is LinePart => part !== undefined)
    .flatMap((part, at) => (at === 0 ? [part] : [SEPARATOR, part]));
};

/** One line per record of `output`, in its order; `names` (of `element.get`) names the variants. */
export const evidenceLines = (
  output: Pick<EvidenceListOutput, "records">,
  names: readonly ElementName[] | undefined,
): LinePart[][] => {
  const byId = new Map((names ?? []).map((name) => [name.id, name]));
  return output.records.map((record) => recordLine(record, byId));
};
