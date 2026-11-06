// Where the evidence (Beleg, SR-032 AK1) of a record is, as a person reads it: the one rule every
// adapter shows (`evidenceSource` of `data-export.schema.json#/$defs/evidenceRecord`, #821). Not an
// evidence location, which is a folder of the workspace file. It is set on copies where records
// leave core, never on the records of the index, so an answer copies only its own records and the
// index holds nothing more (N-036).
import type { EvidenceRecord, TestCase } from "./record.js";

/**
 * The evidence source of `record`: its `evidence` when given and not empty; else its record file,
 * `<repository>/<file>` (`<file>` alone without a repository) and `:<line>` when `line` is given;
 * undefined when it has neither. Text only, never opened.
 */
export const evidenceSourceOf = (record: EvidenceRecord): string | undefined => {
  if (record.evidence !== undefined && record.evidence !== "") {
    return record.evidence;
  }
  if (record.file === undefined) {
    return undefined;
  }
  const place = record.repository === undefined ? record.file : `${record.repository}/${record.file}`;
  return record.line === undefined ? place : `${place}:${String(record.line)}`;
};

/**
 * A copy of `record` with its `evidenceSource` (`evidenceSourceOf`), without one when it has none;
 * `record` is not changed.
 */
export const withEvidenceSource = (record: EvidenceRecord): EvidenceRecord => {
  const { evidenceSource: _given, ...rest } = record;
  const source = evidenceSourceOf(rest);
  return source === undefined ? rest : { ...rest, evidenceSource: source };
};

/** A copy of `test` whose executions and `last` are copies with their `evidenceSource`. */
export const testCaseWithEvidenceSource = (test: TestCase): TestCase => ({
  ...test,
  executions: test.executions.map(withEvidenceSource),
  ...(test.last === undefined ? {} : { last: withEvidenceSource(test.last) }),
});
