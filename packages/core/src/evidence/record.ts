// The evidence record model (ADR-0012, "Block and state"): one record (Datensatz) as every reader
// gives it and every command returns it, a skipped JUnit test case, and the identity of a test case.
// The shapes are those of `data-export.schema.json` (`$defs/evidenceRecord`, `$defs/testCase`); this
// file only names them for the block and adds what the schema has no place for.
import type { DataExportEvidenceRecord, DataExportTestCase } from "../generated/types.js";

/**
 * One evidence record (`data-export.schema.json#/$defs/evidenceRecord`): from a Markdown record or
 * from one element of a JUnit test case alike. The readers always set `source`, `repository`,
 * `file` and `line`; records given through `evidenceRecordsState` (tests, #127 option 1) may leave
 * them out. `baselines` is filled by `evidence.list` alone (SR-032 AK2).
 */
export type EvidenceRecord = DataExportEvidenceRecord;

/** A test case seen from one element (`data-export.schema.json#/$defs/testCase`, SR-033). */
export type TestCase = DataExportTestCase;

/**
 * A JUnit test case marked `<skipped>` that names elements (ADR-0012: it gives no record). It is
 * kept so the test case is still listed, as one without execution (SR-033 AK3).
 */
export interface SkippedTestCase {
  /** The JUnit `name`. */
  readonly name: string;
  /** The JUnit `classname`. */
  readonly className?: string;
  /** The UUIDs of the elements it names, each once. */
  readonly elements: readonly string[];
  /** Workspace name of the repository of the JUnit file. */
  readonly repository: string;
  /** The JUnit file, relative to its repository. */
  readonly file: string;
  /** The line of the `<testcase>`. */
  readonly line: number;
}

/** What names a test case: the JUnit `name` (`testCase` of a record) and `classname`. */
export interface TestCaseName {
  readonly testCase?: string;
  readonly className?: string;
}

/**
 * The identity of a test case (ADR-0012): the JUnit `classname` and `name`, or the `test-case` of a
 * Markdown record alone (no class name). Records and skipped test cases with the same key are one
 * test case, whatever file they come from.
 */
export const testCaseKey = (name: string, className: string | undefined): string =>
  // JSON keeps the two parts apart whatever characters they hold (a line break in a name included).
  JSON.stringify([className ?? null, name]);

/** `testCaseKey` of a record; undefined for a record of no test case. */
export const testCaseKeyOf = (named: TestCaseName): string | undefined =>
  named.testCase === undefined ? undefined : testCaseKey(named.testCase, named.className);
