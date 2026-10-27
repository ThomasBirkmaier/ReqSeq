// The evidence of one element as commands show it (SR-033): its test cases in a view (`testCasesIn`)
// and the evidence below it in the chain (`chainEvidenceOf`). The commands: evidence.list and
// trace.chain (commands/evidence/list.test.ts, commands/trace/chain.test.ts).
import { describe, expect, it } from "vitest";
import type { View } from "../variants/index.js";
import { evidenceIndex } from "./by-element.js";
import type { EvidenceRecord, SkippedTestCase } from "./record.js";
import { chainEvidenceOf, recordHoldsIn, testCasesIn } from "./views.js";

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
    expect([core, coast].map((r) => recordHoldsIn(r, undefined))).toEqual([true, true]);
    expect([core, coast].map((r) => recordHoldsIn(r, CORE))).toEqual([true, false]);
    expect([core, coast].map((r) => recordHoldsIn(r, COAST_VIEW))).toEqual([false, true]);
  });
});

describe("testCasesIn", () => {
  it("gives the index's own array when nothing is filtered out", () => {
    const index = evidenceIndex([run("2026-01-02T10:00:00Z"), run("2026-01-01T10:00:00Z")], [skipped]);
    const all = index.testCasesOf(A);
    expect(testCasesIn(index, A, undefined)).toBe(all);
    expect(testCasesIn(index, A, CORE, ["verification"])).toBe(all);
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
    const inCore = testCasesIn(index, A, CORE);
    expect(inCore.map((t) => [t.name, t.executed, t.executions, t.last])).toEqual([
      // Only skipped: shown in every view (a skipped test case carries no variant).
      ["test_gusts", false, [], undefined],
      ["test_wind", true, [older], older],
    ]);
    expect(testCasesIn(index, A, COAST_VIEW).map((t) => [t.name, t.executions])).toEqual([
      ["test_coast", [coastOnly]],
      ["test_gusts", []],
      ["test_wind", [newer]],
    ]);
  });

  it("keeps only the records of the kinds asked for", () => {
    const validation = run("2026-01-02T10:00:00Z", { kind: "validation", testCase: "pilot survey" });
    const verification = run("2026-01-01T10:00:00Z");
    const index = evidenceIndex([validation, verification]);
    expect(testCasesIn(index, A, undefined).map((t) => t.name)).toEqual(["pilot survey", "test_wind"]);
    expect(testCasesIn(index, A, undefined, ["verification"]).map((t) => t.name)).toEqual(["test_wind"]);
  });

  it("gives none for an element no test case names", () => {
    expect(testCasesIn(evidenceIndex([run("2026-01-01T10:00:00Z")]), B, CORE)).toEqual([]);
  });
});

describe("chainEvidenceOf", () => {
  it("gives the test cases and the verification records without a test case that hold in the view", () => {
    const tested = run("2026-01-03T10:00:00Z");
    const inspection = record("2026-01-02T10:00:00Z", { method: "inspection", item: "sample" });
    const coast = record("2026-01-01T10:00:00Z", { method: "inspection", variant: COAST });
    const validation = record("2026-01-04T10:00:00Z", { kind: "validation" });
    const index = evidenceIndex([tested, inspection, coast, validation]);
    const all = chainEvidenceOf(index, A, undefined);
    expect(all?.testCases.map((t) => t.executions)).toEqual([[tested]]);
    expect(all?.records).toEqual([inspection, coast]);
    expect(chainEvidenceOf(index, A, CORE)?.records).toEqual([inspection]);
    expect(chainEvidenceOf(index, A, COAST_VIEW)).toEqual({ testCases: [], records: [coast] });
  });

  it("gives undefined for an element without evidence, or with validation records only", () => {
    const index = evidenceIndex([record("2026-01-01T10:00:00Z", { element: B, kind: "validation" })]);
    expect(chainEvidenceOf(index, A, undefined)).toBeUndefined();
    expect(chainEvidenceOf(index, B, undefined)).toBeUndefined();
  });
});
