// The Markdown reader of the evidence block (SR-028, ADR-0012 "Manual record"): one record per
// Markdown file whose frontmatter has the key `reqseq-record`, checked against
// `evidence-record.schema.json` (D-026).
//
// - The bytes are parsed as an element file is (`parseFileBytes` of the files block: strict UTF-8, BOM,
//   CRLF, conflict markers, YAML 1.2 with lines). A file that does not parse gives the problem of the
//   files block (`file.invalid-yaml`, `file.conflict-markers`, `file.unreadable`) and no record; the
//   element store reports the same file too, so `evidenceProblemsState` shows such a problem once.
// - A file without frontmatter, or whose frontmatter is no mapping with `reqseq-record`, is no record
//   (a README in an evidence folder) and gives nothing, not even its YAML warnings.
// - A key the format does not know is read with a warning `evidence.invalid-record` naming it, and
//   the record counts (spec question #533 Q1, assumption: as D-012 does for elements). Every other
//   violation of the schema is an error `evidence.invalid-record` at the line of the failing key,
//   and the file gives no record. So is a validation record with `variant` (SR-038 AK4: „... weist
//   das Tool ihn ab, nennt den Grund und er zählt für keinen Status“; D-007 names only the item
//   under test for a validation), whose message gives that reason.
// - The record is `$defs/evidenceRecord` of `data-export.schema.json`: the frontmatter without
//   `reqseq-record`, `test-case` as `testCase`, and where it lies (`source: markdown`, line 1).
import type { Problem } from "../catalog.js";
import { parseFileBytes } from "../files/index.js";
import type { EvidenceRecordFile } from "../generated/types.js";
import { keyLinesOf } from "../model/index.js";
import type { SchemaViolation } from "../runtime/contracts.js";
import { describeViolations, fileSchemaValidator, schemaViolations } from "../runtime/contracts.js";
import type { EvidenceFile } from "./folders.js";
import type { EvidenceRecord } from "./record.js";
import type { EvidenceFileRead, EvidenceReader } from "./state.js";

/** The key that makes a Markdown file a record (ADR-0012). */
export const RECORD_KEY = "reqseq-record";

/** The file format schema of a Markdown record. */
const SCHEMA = "evidence-record.schema.json";

const NOTHING: EvidenceFileRead = { records: [] };

const isMapping = (data: unknown): data is Readonly<Record<string, unknown>> =>
  typeof data === "object" && data !== null && !Array.isArray(data);

/** The key a violation of `additionalProperties` names; undefined for every other violation. */
const unknownKey = (violation: SchemaViolation): string | undefined => {
  const name = violation.params["additionalProperty"];
  return violation.keyword === "additionalProperties" && typeof name === "string" ? name : undefined;
};

/** Why a validation record must not name a variant (SR-038 AK4), for the `false` subschema of `variant`. */
export const VALIDATION_VARIANT_REASON =
  "a validation record names no variant, it holds for the core (D-007, SR-038 AK4)";

/** What a violation says, with the reason of SR-038 AK4 for a validation record with `variant`. */
const violationText = (violation: SchemaViolation): string =>
  violation.keyword === "false schema" && violation.path === "/variant"
    ? `/variant: ${VALIDATION_VARIANT_REASON}`
    : describeViolations([violation]);

/**
 * The top-level key a violation is about: the unknown key it names, or the key of its path (the
 * schema is flat, so a path is `""` or `/<key>`); undefined for the record as a whole (a missing key).
 */
const keyOf = (violation: SchemaViolation): string | undefined =>
  unknownKey(violation) ?? (violation.path === "" ? undefined : violation.path.slice(1));

/** The record of a frontmatter that matches the schema (keys it does not know are left out). */
const recordOf = (data: EvidenceRecordFile, file: EvidenceFile): EvidenceRecord => ({
  element: data.element,
  version: data.version,
  kind: data.kind,
  ...(data.method === undefined ? {} : { method: data.method }),
  ...(data.variant === undefined ? {} : { variant: data.variant }),
  ...(data.item === undefined ? {} : { item: data.item }),
  result: data.result,
  date: data.date,
  ...(data.evidence === undefined ? {} : { evidence: data.evidence }),
  ...(data["test-case"] === undefined ? {} : { testCase: data["test-case"] }),
  source: "markdown",
  repository: file.repository,
  file: file.file,
  line: 1,
});

/**
 * The record of one Markdown file of an evidence folder (see the file comment): `{ records: [] }`
 * for a file that is no record, the record with warnings for keys the format does not know, or
 * the problems of a faulty record without it.
 */
export const readMarkdownRecord = (file: EvidenceFile, bytes: Uint8Array): EvidenceFileRead => {
  const at = (problem: Problem): Problem => ({ ...problem, repository: file.repository, file: file.file });
  const parsed = parseFileBytes(file.file, bytes);
  if (parsed.kind === "problem") {
    return { records: [], problems: [at(parsed.problem)] };
  }
  if (parsed.kind === "no-frontmatter") {
    return NOTHING;
  }
  const { data, warnings } = parsed.content;
  if (!isMapping(data) || !Object.hasOwn(data, RECORD_KEY)) {
    return NOTHING;
  }
  const validate = fileSchemaValidator(SCHEMA);
  const valid = validate(data);
  // `if` repeats the violation of its `then` (a verification record without `method` or `item`).
  const violations = valid ? [] : schemaViolations(validate.errors).filter((v) => v.keyword !== "if");
  const faulty = violations.some((v) => unknownKey(v) === undefined);
  // The lines of the keys in one pass (linear also for a record with thousands of unknown keys).
  const keyLines = violations.length === 0 ? new Map<string, number>() : keyLinesOf(parsed.content);
  const lineOf = (key: string | undefined): number => (key === undefined ? 1 : (keyLines.get(key) ?? 1));
  // A YAML warning always has its line (`files/parse.ts`).
  const found: { readonly line: number; readonly problem: Problem }[] = warnings.map(
    ({ line = 1, ...w }) => ({
      line,
      problem: at({ ...w, line }),
    }),
  );
  for (const violation of violations) {
    const key = unknownKey(violation);
    const line = lineOf(keyOf(violation));
    const problem: Problem =
      key === undefined
        ? {
            code: "evidence.invalid-record",
            severity: "error",
            line,
            message: `Invalid evidence record, not counted: ${violationText(violation)}`,
          }
        : {
            code: "evidence.invalid-record",
            severity: "warning",
            line,
            message: `The evidence record has the key ${JSON.stringify(key)}, which the format does not know; ${
              faulty ? "the record is not counted for its other errors" : "the record is read without it"
            }`,
          };
    found.push({ line, problem: at(problem) });
  }
  // In the order of the file (`sort` is stable: Ajv's order on one line).
  const problems = found.sort((x, y) => x.line - y.line).map((f) => f.problem);
  return {
    records: faulty ? [] : [recordOf(data as unknown as EvidenceRecordFile, file)],
    ...(problems.length === 0 ? {} : { problems }),
  };
};

/** The reader of Markdown records, registered in `EVIDENCE_READERS`. */
export const MARKDOWN_READER: EvidenceReader = { extension: "md", read: readMarkdownRecord };
