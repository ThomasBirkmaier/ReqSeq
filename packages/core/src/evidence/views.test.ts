// The evidence of one element as commands show it (SR-033): its test cases in a view (`testCasesIn`)
// and the evidence below it in the chain (`chainEvidenceOf`). The commands: evidence.list and
// trace.chain (commands/evidence/list.test.ts, commands/trace/chain.test.ts).
import { describe, expect, it } from "vitest";
import type { View } from "../variants/index.js";
import { evidenceIndex } from "./by-element.js";
import type { EvidenceRecord, SkippedTestCase } from "./record.js";
import { withoutShadowedCore } from "./holds.js";
import { chainEvidenceOf, listedRecords, recordHoldsIn, testCasesIn } from "./views.js";

const P = "5e535a7d-2b4f-4c61-9d08-0";
const A = `${P}a0000000001`;
const B = `${P}a0000000002`;
const COAST = `${P}c0000000001`;
const CORE: View = { kind: "core" };
const COAST_VIEW: View = { kind: "variant", variant: { id: COAST, repository: "system" } };

const record = (date: string, more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  element: A,
  version: "n1:1111111111111111",
  kind: "verification",
  method: "test",
  item: "build-1",
  result: "passed",
  date,
  ...more,
});

const run = (date: string, more: Partial<EvidenceRecord> = {}): EvidenceRecord =>
  record(date, { testCase: "test_wind", className: "tests.Wind", ...more });

const skipped: SkippedTestCase = {
  name: "test_gusts",
  className: "tests.Wind",
  elements: [A],
  repository: "ci",
  file: "results.xml",
  line: 9,
};

describe("recordHoldsIn", () => {
  it("takes every record without a view, those without a variant in the core and a variant's own in it", () => {
    const core = record("2026-01-01T10:00:00Z");
    const coast = record("2026-01-01T10:00:00Z", { variant: COAST });
    expect([core, coast].map((r) => recordHoldsIn(r, undefined, false))).toEqual([true, true]);
    expect([core, coast].map((r) => recordHoldsIn(r, CORE, false))).toEqual([true, false]);
    expect([core, coast].map((r) => recordHoldsIn(r, COAST_VIEW, false))).toEqual([false, true]);
    // A marked repository (SR-173) lets a verification record without a variant hold in a variant,
    // never a validation record, which counts only in the core (D-007, SR-038).
    const validation = record("2026-01-01T10:00:00Z", { kind: "validation" });
    expect([core, validation].map((r) => recordHoldsIn(r, COAST_VIEW, true))).toEqual([true, false]);
    expect(recordHoldsIn(validation, CORE, true)).toBe(true);
  });
});

describe("testCasesIn", () => {
  it("gives the index's own array when nothing is filtered out", () => {
    const index = evidenceIndex([run("2026-01-02T10:00:00Z"), run("2026-01-01T10:00:00Z")], [skipped]);
    const all = index.testCasesOf(A);
    expect(testCasesIn(index, A, undefined, false)).toBe(all);
    expect(testCasesIn(index, A, CORE, false, ["verification"])).toBe(all);
    expect(all.map((t) => [t.name, t.executed, t.executions.length])).toEqual([
      ["test_gusts", false, 0],
      ["test_wind", true, 2],
    ]);
  });

  it("keeps the executions of the view, recomputes the last and leaves out a test case with none left", () => {
    const newer = run("2026-01-03T10:00:00Z", { variant: COAST, item: "coast-2" });
    const older = run("2026-01-02T10:00:00Z", { item: "core-1" });
    const coastOnly = run("2026-01-01T10:00:00Z", { testCase: "test_coast", variant: COAST });
    const index = evidenceIndex([newer, older, coastOnly], [skipped]);
    const inCore = testCasesIn(index, A, CORE, false);
    expect(inCore.map((t) => [t.name, t.executed, t.executions, t.last])).toEqual([
      // Only skipped: shown in every view (a skipped test case carries no variant).
      ["test_gusts", false, [], undefined],
      ["test_wind", true, [older], older],
    ]);
    expect(testCasesIn(index, A, COAST_VIEW, false).map((t) => [t.name, t.executions])).toEqual([
      ["test_coast", [coastOnly]],
      ["test_gusts", []],
      ["test_wind", [newer]],
    ]);
  });

  it("keeps only the records of the kinds asked for", () => {
    const validation = run("2026-01-02T10:00:00Z", { kind: "validation", testCase: "pilot survey" });
    const verification = run("2026-01-01T10:00:00Z");
    const index = evidenceIndex([validation, verification]);
    expect(testCasesIn(index, A, undefined, false).map((t) => t.name)).toEqual(["pilot survey", "test_wind"]);
    expect(testCasesIn(index, A, undefined, false, ["verification"]).map((t) => t.name)).toEqual([
      "test_wind",
    ]);
  });

  it("gives none for an element no test case names", () => {
    expect(testCasesIn(evidenceIndex([run("2026-01-01T10:00:00Z")]), B, CORE, false)).toEqual([]);
  });
});

describe("one execution for the core and a variant (SR-093 AK5)", () => {
  const DATE = "2026-01-02T10:00:00Z";
  const at = (line: number, more: Partial<EvidenceRecord> = {}): EvidenceRecord =>
    run(DATE, { repository: "ci", file: "results.xml", line, ...more });
  // One test case at line 4 for the core and Coast; one at line 9 for the core only.
  const core = at(4);
  const coast = at(4, { variant: COAST });
  const coreOnly = at(9);
  const index = evidenceIndex([coreOnly, coast, core]);

  it("lists each execution once in a variant of a marked repository, both records without a view", () => {
    const none = (): readonly string[] => [];
    expect(listedRecords([core, coast, coreOnly], COAST_VIEW, true, none)).toEqual(
      [coast, coreOnly].map((r) => ({ ...r, baselines: [] })),
    );
    expect(listedRecords([core, coast, coreOnly], undefined, true, none)).toHaveLength(3);
    expect(listedRecords([core, coast, coreOnly], COAST_VIEW, false, none)).toEqual([
      { ...coast, baselines: [] },
    ]);
    expect(testCasesIn(index, A, COAST_VIEW, true).map((t) => t.executions)).toEqual([[coast, coreOnly]]);
    expect(testCasesIn(index, A, CORE, true).map((t) => t.executions)).toEqual([[core, coreOnly]]);
    // The index order puts the record without variant first on a tie (`newestFirst`).
    expect(testCasesIn(index, A, undefined, true).map((t) => t.executions)).toEqual([
      [core, coast, coreOnly],
    ]);
  });

  it("withoutShadowedCore gives the same array when no record is left out", () => {
    const records = [core, coreOnly];
    expect(withoutShadowedCore(records, COAST)).toBe(records);
    const other = [at(5, { variant: COAST }), core];
    expect(withoutShadowedCore(other, COAST)).toBe(other);
    // Another run at the same place (another date) is another execution.
    const rerun = [at(4, { variant: COAST, date: "2026-01-03T10:00:00Z" }), core];
    expect(withoutShadowedCore(rerun, COAST)).toBe(rerun);
    expect(withoutShadowedCore([core, coast], COAST)).toEqual([coast]);
    // Another test case at the same place and date (pytest writes a whole file on line 1).
    const otherName = [at(4, { variant: COAST }), at(4, { testCase: "test_gusts" })];
    expect(withoutShadowedCore(otherName, COAST)).toBe(otherName);
    const otherClass = [at(4, { variant: COAST }), at(4, { className: "tests.Gusts" })];
    expect(withoutShadowedCore(otherClass, COAST)).toBe(otherClass);
  });
});

describe("chainEvidenceOf", () => {
  it("gives the test cases and the verification records without a test case that hold in the view", () => {
    const tested = run("2026-01-03T10:00:00Z");
    const inspection = record("2026-01-02T10:00:00Z", { method: "inspection", item: "sample" });
    const coast = record("2026-01-01T10:00:00Z", { method: "inspection", variant: COAST });
    const validation = record("2026-01-04T10:00:00Z", { kind: "validation" });
    const index = evidenceIndex([tested, inspection, coast, validation]);
    const all = chainEvidenceOf(index, A, undefined, false);
    expect(all?.testCases.map((t) => t.executions)).toEqual([[tested]]);
    expect(all?.records).toEqual([inspection, coast]);
    expect(chainEvidenceOf(index, A, CORE, false)?.records).toEqual([inspection]);
    expect(chainEvidenceOf(index, A, COAST_VIEW, false)).toEqual({ testCases: [], records: [coast] });
    // A marked repository (SR-173): the records without a variant hold in the variant too.
    expect(chainEvidenceOf(index, A, COAST_VIEW, true)).toEqual({
      testCases: [{ ...all?.testCases[0], executions: [tested], last: tested }],
      records: [inspection, coast],
    });
    expect(chainEvidenceOf(index, A, CORE, true)?.records).toEqual([inspection]);
    expect(recordHoldsIn(inspection, COAST_VIEW, true)).toBe(true);
  });

  it("gives undefined for an element without evidence, or with validation records only", () => {
    const index = evidenceIndex([record("2026-01-01T10:00:00Z", { element: B, kind: "validation" })]);
    expect(chainEvidenceOf(index, A, undefined, false)).toBeUndefined();
    expect(chainEvidenceOf(index, B, undefined, false)).toBeUndefined();
  });
});
