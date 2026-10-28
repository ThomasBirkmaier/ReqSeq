// The evidence of one element as commands show it. Pure: the records come from the index, the
// baselines from the caller.
//
// - `evidence.list` (SR-032): each record with its version, item (Prüfling), date, result and
//   evidence (Beleg) as read (AK1), and the baselines that contain its version (AK2, `baselines`).
// - The test cases of an element in a view (SR-033, `testCasesIn`) for `evidence.list`, the chain and
//   the matrix (`verificationTestCasesIn`, SR-126), and the evidence below an element of the chain
//   (`chainEvidenceOf`, `trace.chain` `evidence`).
import type { View } from "../variants/index.js";
import type { EvidenceIndex } from "./by-element.js";
import type { EvidenceRecord, TestCase } from "./record.js";
import { holdsIn } from "./status.js";

/**
 * Whether `record` holds for `view`: in the core a record without a variant, in a variant a record
 * for that variant (SR-047 AK1, AK2; `holdsIn` of the status), as `hasVerificationRecord` counts; without a view
 * every record.
 */
export const recordHoldsIn = (record: EvidenceRecord, view: View | undefined): boolean =>
  view === undefined || holdsIn(record, view);

/**
 * `records` (newest first, as the index keeps them) that hold for `view`, each with the names of the
 * baselines that contain its version (`containing`, SR-032 AK2): an empty list when none does.
 */
export const listedRecords = (
  records: readonly EvidenceRecord[],
  view: View | undefined,
  containing: (id: string, version: string) => readonly string[],
): EvidenceRecord[] =>
  records
    .filter((record) => recordHoldsIn(record, view))
    .map((record) => ({ ...record, baselines: [...containing(record.element, record.version)] }));

/** The kind of a record: verification (Nachweis) or validation (D-007). */
export type RecordKind = EvidenceRecord["kind"];

/**
 * The test cases that name the element `id` (`index.testCasesOf`, class name then name), each with
 * only the executions that hold for `view` (`recordHoldsIn`) and, when `kinds` is given, are of one
 * of those kinds; `last` is the newest of them. A test case that had executions and has none left
 * is left out; one that was only skipped (`executed` false, SR-033 AK3) stays in every view, since a
 * skipped JUnit test case carries no variant. When nothing is filtered out (the usual case: JUnit
 * records are always verification) the index's own array is returned, without a copy.
 */
export const testCasesIn = (
  index: EvidenceIndex,
  id: string,
  view: View | undefined,
  kinds?: readonly RecordKind[],
): readonly TestCase[] => {
  const cases = index.testCasesOf(id);
  const keep = (record: EvidenceRecord): boolean =>
    recordHoldsIn(record, view) && (kinds === undefined || kinds.includes(record.kind));
  if (cases.every((test) => test.executions.every(keep))) {
    return cases;
  }
  const kept: TestCase[] = [];
  for (const test of cases) {
    const executions = test.executions.filter(keep);
    const [last] = executions;
    if (last !== undefined) {
      kept.push({ ...test, executions, last });
    } else if (!test.executed) {
      kept.push(test);
    }
  }
  return kept;
};

/** The evidence below an element of the chain: its test cases and its records without a test case. */
export interface ElementEvidence {
  readonly testCases: readonly TestCase[];
  readonly records: readonly EvidenceRecord[];
}

const VERIFICATION: readonly RecordKind[] = ["verification"];

/**
 * The test cases of the element `id` in `view` with their verification executions only
 * (`testCasesIn(…, ["verification"])`): what the chain shows below the element and the matrix in its
 * test case column (SR-126), so both show the same test cases in the same view.
 */
export const verificationTestCasesIn = (
  index: EvidenceIndex,
  id: string,
  view: View | undefined,
): readonly TestCase[] => testCasesIn(index, id, view, VERIFICATION);

/**
 * The evidence below the element `id` in the chain (SR-022 AK1, SR-033 AK1 to AK3): its test cases
 * with their verification executions (`testCasesIn`), and its verification records without a test
 * case (inspection, analysis, demonstration, a manual record without `test-case`), newest first;
 * only those that hold for `view` (every one without a view, as `evidence.list`). Validation records
 * are not Nachweise (D-007) and stay out. Undefined when the element has neither.
 */
export const chainEvidenceOf = (
  index: EvidenceIndex,
  id: string,
  view: View | undefined,
): ElementEvidence | undefined => {
  const testCases = verificationTestCasesIn(index, id, view);
  const records = (index.byElement.get(id) ?? []).filter(
    (record) =>
      record.kind === "verification" && record.testCase === undefined && recordHoldsIn(record, view),
  );
  return testCases.length === 0 && records.length === 0 ? undefined : { testCases, records };
};
