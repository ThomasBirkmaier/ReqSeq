// The read-back of an enriched file (SR-029, ADR-0007 pattern; `enrich.ts`): the bytes outside the
// changed test cases unchanged, and each changed test case read as intended, or `internal`.
import { CommandError } from "../catalog.js";
import { criteriaOf, enrichmentOf, NOT_IN_VIEW, notInViewOf } from "./junit.js";
import type { JunitTestCase } from "./junit-model.js";
import { junitTestCases } from "./junit-model.js";
import { CORE, sameViews } from "./enrich-model.js";
import { criteriaText } from "./enrich-criteria.js";

/** What a test case changed by this call must read back as (`readsBackAs`): enriched, or left out (AK12). */
export type Intended = EnrichedIntended | LeftOutIntended;

/** Where a changed test case lies in the file as read, and what it must keep. */
interface IntendedTestCase {
  readonly name: string;
  readonly className: string;
  readonly outcome: JunitTestCase["outcome"];
  /** The `<` of `<testcase` and the byte after the test case, in the file as read. */
  readonly start: number;
  readonly end: number;
}

/** A test case enriched by this call. */
export interface EnrichedIntended extends IntendedTestCase {
  readonly kind?: "enriched";
  readonly pairs: ReadonlyMap<string, string>;
  readonly item: string;
  readonly date: string;
  /** Its views (`core` or a variant's UUID), each once, as enrich writes them; undefined compares as the core alone. */
  readonly views?: readonly string[] | undefined;
  /** Its criteria as `criteriaText` gives them; undefined for none checked. */
  readonly criteria?: string | undefined;
}

/** A test case left out whose marks this call wrote (AK12). */
export interface LeftOutIntended extends IntendedTestCase {
  readonly kind: "left-out";
  /** The given views its marks name (`core` or a variant's UUID), each once. */
  readonly marks: readonly string[];
  /** Its other properties as name and value, in file order: they stay as they were. */
  readonly properties: readonly (readonly [name: string, value: string])[];
}

/** The properties of `testCase` other than its marks, as name and value (`LeftOutIntended`). */
export const unmarkedOf = (testCase: JunitTestCase): LeftOutIntended["properties"] =>
  testCase.properties.filter((p) => p.name !== NOT_IN_VIEW).map((p) => [p.name, p.value] as const);

/**
 * Whether a test case left out reads back as `wanted`: one mark per given view and no other, and its
 * other properties as they were (so still no `reqseq:version`).
 */
const leftOutReadsBack = (testCase: JunitTestCase, wanted: LeftOutIntended): boolean => {
  const marks = notInViewOf(testCase);
  return (
    marks.error === undefined &&
    marks.properties.length === wanted.marks.length &&
    sameViews(marks.views, wanted.marks) &&
    JSON.stringify(unmarkedOf(testCase)) === JSON.stringify(wanted.properties)
  );
};

const NOT_READ_BACK = "Enrich produced a file that does not read back; nothing written";

const SUITE_START = Buffer.from("<testsuite>");
const SUITE_END = Buffer.from("</testsuite>");

/** Whether the criteria of `testCase` read back, as `wanted` (`criteriaText`) when it is given. */
const criteriaReadBack = (
  testCase: JunitTestCase,
  pairs: ReadonlyMap<string, string>,
  wanted: string | undefined,
): boolean => {
  const criteria = criteriaOf(testCase, new Set(pairs.keys()));
  return !("error" in criteria) && (wanted === undefined || criteriaText(criteria) === wanted);
};

/**
 * Whether `testCase`, the bytes of one changed `<testcase>` element of the result, reads back as
 * `wanted` says: one test case with the same name, class name and outcome that gives exactly the
 * intended pairs, item, date and view by the reader's checks (`enrichmentOf`), or, left out, the
 * intended marks and its other properties unchanged (`leftOutReadsBack`).
 */
export const readsBackAs = (testCase: Uint8Array, wanted: Intended): boolean => {
  const read = junitTestCases(Buffer.concat([SUITE_START, testCase, SUITE_END]));
  const cases = read.kind === "junit" ? read.file.testCases : [];
  const [a] = cases;
  if (
    cases.length !== 1 ||
    a?.name !== wanted.name ||
    a.className !== wanted.className ||
    a.outcome !== wanted.outcome
  ) {
    return false;
  }
  if (wanted.kind === "left-out") {
    return leftOutReadsBack(a, wanted);
  }
  const got = enrichmentOf(a);
  return (
    !("error" in got) &&
    criteriaReadBack(a, got.pairs, wanted.criteria) &&
    got.item === wanted.item.trim() &&
    got.date === wanted.date &&
    // Exactly the views enrich writes, in any order (the core alone without the property).
    sameViews(got.views, wanted.views ?? [CORE]) &&
    got.pairs.size === wanted.pairs.size &&
    [...wanted.pairs].every(([id, version]) => got.pairs.get(id) === version)
  );
};

/**
 * Reads the result back (B3 of the plan review) without a model of the whole result (S1 of the PR
 * review): the bytes outside the changed test cases must be those of `input` (the file as read, which
 * scanned), so the test cases not to be changed are unchanged (N1), and each changed `<testcase>`
 * element, enriched or marked (AK12), must read back as intended (`readsBackAs`). `intended` is in
 * file order; `moved` gives where an offset of `input` lies in `out` and is called with offsets in
 * ascending order. Throws `internal`
 * on any difference.
 */
export const checkReadBack = (
  input: Uint8Array,
  out: Uint8Array,
  moved: (offset: number) => number,
  intended: readonly Intended[],
): void => {
  const same = (a: Uint8Array, b: Uint8Array): void => {
    if (Buffer.compare(a, b) !== 0) {
      throw new CommandError("internal", NOT_READ_BACK);
    }
  };
  let from = 0;
  let outFrom = 0;
  for (const wanted of intended) {
    const start = moved(wanted.start);
    same(input.subarray(from, wanted.start), out.subarray(outFrom, start));
    const end = moved(wanted.end);
    if (!readsBackAs(out.subarray(start, end), wanted)) {
      throw new CommandError("internal", NOT_READ_BACK);
    }
    from = wanted.end;
    outFrom = end;
  }
  same(input.subarray(from), out.subarray(outFrom));
};
