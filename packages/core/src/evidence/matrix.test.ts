// The evidence columns of the traceability matrix (SR-126): the mark of a test case (`testCaseMark`),
// the test case cell (`matrixTestCases`), when the columns show (`showsEvidence`) and the fields of a
// row (`matrixEvidence`). The command on fixtures/SR-126/matrix: commands/trace/matrix.test.ts.
import { describe, expect, it } from "vitest";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import type { View } from "../variants/index.js";
import { evidenceIndex } from "./by-element.js";
import { matrixEvidence, matrixTestCases, showsEvidence, testCaseMark } from "./matrix.js";
import type { EvidenceRecord, SkippedTestCase, TestCase } from "./record.js";
import { recordStatusOf } from "./status.js";
import type { WorkspaceStatus } from "./verification.js";

const P = "5e126a7d-2b4f-4c61-9d08-0";
const A = `${P}a0000000001`;
const CHILD = `${P}a0000000002`;
const COAST = `${P}c0000000001`;
const CURRENT = "n1:1111111111111111";
const OLDER = "n1:0000000000000000";
const CORE: View = { kind: "core" };
const COAST_VIEW: View = { kind: "variant", variant: { id: COAST, repository: "system" } };

const run = (date: string, more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  element: A,
  version: CURRENT,
  kind: "verification",
  method: "test",
  item: "build-1",
  result: "passed",
  date,
  testCase: "test_wind",
  className: "tests.Wind",
  source: "junit",
  repository: "system",
  file: "evidence/results.xml",
  line: 4,
  ...more,
});

/** A Markdown record of A: no class name, and no test case unless given. */
const markdown = (date: string, more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  element: A,
  version: CURRENT,
  kind: "verification",
  method: "inspection",
  item: "sample 1",
  result: "passed",
  date,
  source: "markdown",
  repository: "system",
  file: `evidence/${date.slice(0, 10)}-record.md`,
  line: 1,
  ...more,
});

const skipped: SkippedTestCase = {
  name: "test_gusts",
  className: "tests.Wind",
  elements: [A],
  repository: "system",
  file: "evidence/results.xml",
  line: 9,
};

/** The test case `test_wind` of A with `executions`, newest first. */
const testCase = (...executions: EvidenceRecord[]): TestCase => {
  const [found] = evidenceIndex(executions, []).testCasesOf(A);
  if (found === undefined) {
    throw new Error("no test case");
  }
  return found;
};

const NOT_EXECUTED: TestCase = {
  name: "test_gusts",
  className: "tests.Wind",
  elements: [A],
  executed: false,
  executions: [],
};

describe("testCaseMark (SR-126 AK2, spec questions #528 Q1/Q2, #593 Q2)", () => {
  it("marks a test case without execution as not executed", () => {
    expect(testCaseMark(NOT_EXECUTED, CURRENT)).toBe("not-executed");
  });

  it("a passed last execution of the current version has no mark", () => {
    expect(testCaseMark(testCase(run("2026-01-01T10:00:00Z")), CURRENT)).toBeUndefined();
  });

  it("marks a failed last execution of the current version as failed, an older passed one does not matter", () => {
    const test = testCase(run("2026-01-02T10:00:00Z", { result: "failed" }), run("2026-01-01T10:00:00Z"));
    expect(testCaseMark(test, CURRENT)).toBe("failed");
  });

  it("outdated wins over failed", () => {
    expect(
      testCaseMark(testCase(run("2026-01-01T10:00:00Z", { result: "failed", version: OLDER })), CURRENT),
    ).toBe("outdated");
  });

  it("a test case whose newest run is of an older version is outdated while the status is verified", () => {
    const ofCurrent = run("2026-01-01T10:00:00Z");
    const newestOlder = run("2026-01-02T10:00:00Z", { version: OLDER, item: "build-old" });
    const test = testCase(ofCurrent, newestOlder);
    expect(test.last).toEqual(newestOlder);
    expect(testCaseMark(test, CURRENT)).toBe("outdated");
    expect(recordStatusOf([newestOlder, ofCurrent], "verification", CURRENT, CORE)).toBe("passed");
  });

  it("an unknown current version marks every executed test case outdated", () => {
    expect(testCaseMark(testCase(run("2026-01-01T10:00:00Z")), undefined)).toBe("outdated");
    expect(testCaseMark(NOT_EXECUTED, undefined)).toBe("not-executed");
  });
});

describe("matrixTestCases (SR-126 AK1)", () => {
  it("gives each test case of the view compact: name, class name, executed, last execution and mark", () => {
    const newest = run("2026-01-03T10:00:00Z", { result: "failed", item: "build-3" });
    const older = run("2026-01-02T10:00:00Z", { item: "build-2" });
    const coast = run("2026-01-04T10:00:00Z", { variant: COAST, item: "coast-4" });
    const manual = markdown("2026-01-01T10:00:00Z", { method: "test", testCase: "wind tunnel check" });
    const validation = run("2026-01-05T10:00:00Z", { kind: "validation", testCase: "pilot survey" });
    const inspection = markdown("2026-01-05T10:00:00Z");
    const index = evidenceIndex([newest, older, coast, manual, validation, inspection], [skipped]);
    // By class name, then name: a Markdown test case has none, so it comes first.
    expect(matrixTestCases(index, A, CORE, CURRENT)).toEqual([
      { name: "wind tunnel check", executed: true, last: manual },
      { name: "test_gusts", className: "tests.Wind", executed: false, mark: "not-executed" },
      { name: "test_wind", className: "tests.Wind", executed: true, last: newest, mark: "failed" },
    ]);
    expect(matrixTestCases(index, A, COAST_VIEW, CURRENT)).toEqual([
      { name: "test_gusts", className: "tests.Wind", executed: false, mark: "not-executed" },
      { name: "test_wind", className: "tests.Wind", executed: true, last: coast },
    ]);
  });

  it("gives an empty cell to an element without test case", () => {
    expect(matrixTestCases(evidenceIndex([], []), A, CORE, CURRENT)).toEqual([]);
  });
});

describe("showsEvidence (spec question #593 Q1)", () => {
  const metamodel = (valid: boolean): Metamodel =>
    ({
      valid,
      effectiveTypes: [
        { key: "need", meaning: "need" },
        { key: "system-requirement", meaning: "requirement" },
        { key: "safety-requirement", meaning: "requirement" },
      ],
    }) as unknown as Metamodel;
  const element = (type: string): ElementRecord => ({ type }) as unknown as ElementRecord;
  const located = { file: { evidence: [{ repository: "system", path: "evidence" }] } };

  it("shows the columns with an evidence location, a valid metamodel and a requirement in the selection", () => {
    expect(showsEvidence(located, metamodel(true), [element("need"), element("safety-requirement")])).toBe(
      true,
    );
  });

  it("shows none without an evidence location, with an invalid metamodel or without a requirement", () => {
    const some = [element("need"), element("system-requirement")];
    expect(showsEvidence({ file: {} }, metamodel(true), some)).toBe(false);
    expect(showsEvidence({ file: { evidence: [] } }, metamodel(true), some)).toBe(false);
    expect(showsEvidence(located, metamodel(false), some)).toBe(false);
    expect(showsEvidence(located, metamodel(true), [element("need")])).toBe(false);
    expect(showsEvidence(located, metamodel(true), [])).toBe(false);
  });
});

describe("matrixEvidence (SR-126 AK1, AK3)", () => {
  const record = { id: A, type: "system-requirement" } as unknown as ElementRecord;
  const index = evidenceIndex([run("2026-01-01T10:00:00Z")], []);

  it("gives a requirement its test cases and one status entry for the view, measured against the version read", () => {
    const asked: unknown[] = [];
    const status: Pick<WorkspaceStatus, "evaluate"> = {
      evaluate: (element, view, shown) => {
        asked.push([element.id, view, shown]);
        return { status: "open", missingChildren: [CHILD] };
      },
    };
    const fields = matrixEvidence({ status, index, view: COAST_VIEW })(record, OLDER);
    expect(fields).toEqual({
      testCases: [],
      verification: [{ view: COAST, status: "open", missingChildren: [CHILD] }],
    });
    expect(asked).toEqual([[A, COAST_VIEW, { current: OLDER }]]);
    const core = matrixEvidence({ status: { evaluate: () => ({ status: "indirect" }) }, index, view: CORE });
    expect(core(record, CURRENT)).toEqual({
      testCases: [
        { name: "test_wind", className: "tests.Wind", executed: true, last: run("2026-01-01T10:00:00Z") },
      ],
      verification: [{ view: "core", status: "indirect" }],
    });
  });

  it("a requirement that does not apply in the view gets no verification field and no test cases", () => {
    const fields = matrixEvidence({ status: { evaluate: () => undefined }, index, view: CORE })(
      record,
      CURRENT,
    );
    expect(fields).toEqual({});
  });
});
