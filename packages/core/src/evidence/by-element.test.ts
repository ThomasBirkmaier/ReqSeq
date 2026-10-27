// The evidence index (ADR-0012 "Block and state"): records by element, test cases seen from one element
// (`$defs/testCase`), and the one rule of "has a verification record" that the filter, the chain and
// the coverage share. Enabler tests of the evidence block (#535).
import { describe, expect, it } from "vitest";
import { evidenceIndex, hasVerificationRecord, newestFirst, sortNewestFirst } from "./by-element.js";
import type { EvidenceRecord, SkippedTestCase } from "./record.js";
import { testCaseKey } from "./record.js";

const P = "5e535a7d-2b4f-4c61-9d08-0";
const A = `${P}a0000000001`;
const B = `${P}a0000000002`;
const C = `${P}a0000000003`;
const V = `${P}c0000000001`;
const W = `${P}c0000000002`;

const record = (element: string, date: string, more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  element,
  version: "n1:1111111111111111",
  kind: "verification",
  method: "test",
  item: "build-1",
  result: "passed",
  date,
  ...more,
});

/** A record of a JUnit test case of `tests.Wind` in `file`. */
const junit = (element: string, date: string, file: string, name = "test_wind", line = 3): EvidenceRecord =>
  record(element, date, {
    testCase: name,
    className: "tests.Wind",
    source: "junit",
    repository: "ci",
    file,
    line,
  });

describe("evidenceIndex", () => {
  it("evidenceIndex groups the records by element, newest first", () => {
    const old = record(A, "2026-01-01T10:00:00Z", { repository: "system", file: "evidence/a.md", line: 1 });
    const sameB = record(A, "2026-01-02T10:00:00Z", { repository: "system", file: "evidence/b.md", line: 1 });
    const sameA = record(A, "2026-01-02T12:00:00+02:00", {
      repository: "system",
      file: "evidence/a.md",
      line: 1,
    });
    const otherRepo = record(A, "2026-01-02T10:00:00Z", { repository: "ci", file: "z.xml", line: 9 });
    const lowerLine = record(A, "2026-01-02T10:00:00Z", { repository: "ci", file: "z.xml", line: 4 });
    const unreadable = record(A, "not a date");
    const newest = record(A, "2026-01-03T00:00:00Z");
    const other = record(B, "2026-01-01T00:00:00Z", { kind: "validation" });
    const index = evidenceIndex([old, sameB, unreadable, other, otherRepo, newest, lowerLine, sameA]);
    expect(index.byElement.get(A)).toEqual([newest, lowerLine, otherRepo, sameA, sameB, old, unreadable]);
    expect(index.byElement.get(B)).toEqual([other]);
    expect(index.byElement.get(C)).toBeUndefined();
    expect(index.testCases.size).toBe(0);
    expect(index.testCasesOf(A)).toEqual([]);
    expect(newestFirst(record(A, "2026-01-01T00:00:00Z"), record(A, "2026-01-01T00:00:00Z"))).toBe(0);
    const all = [old, sameB, unreadable, other, otherRepo, newest, lowerLine, sameA];
    expect(sortNewestFirst(all)).toEqual([...all].sort(newestFirst));
  });

  it("evidenceIndex shows a test case that names many elements to each with its own records only, built once", () => {
    // One integration test naming 200 requirements, run in 50 files: 10,000 records.
    const elements = Array.from({ length: 200 }, (_, i) => `${P}b${String(i).padStart(10, "0")}`);
    const runs = Array.from({ length: 50 }, (_, run) =>
      elements.map((id) =>
        junit(id, `2026-01-01T10:${String(run).padStart(2, "0")}:00Z`, `runs/${String(run)}.xml`),
      ),
    ).flat();
    const index = evidenceIndex(runs);
    const entry = index.testCases.get(testCaseKey("test_wind", "tests.Wind"));
    expect(entry?.records).toHaveLength(10_000);
    expect(entry?.elements).toEqual(elements);
    for (const id of [elements[0] ?? "", elements[199] ?? ""]) {
      const [only] = index.testCasesOf(id);
      expect(only?.executions).toHaveLength(50);
      expect(only?.executions.every((r) => r.element === id)).toBe(true);
      expect(only?.executions).toBe(entry?.recordsOf.get(id));
      expect(only?.last?.file).toBe("runs/49.xml");
      // A second call gives the same test cases without building them again.
      expect(index.testCasesOf(id)).toBe(index.testCasesOf(id));
    }
  });

  it("evidenceIndex counts each test case element of a JUnit file as one execution, also twice in one file", () => {
    // A rerun (pytest-rerunfailures) writes the test case twice into one file: two executions (ADR-0012).
    const first = junit(A, "2026-01-01T10:00:00Z", "runs/1.xml", "test_wind", 3);
    const rerun = junit(A, "2026-01-01T10:00:00Z", "runs/1.xml", "test_wind", 9);
    const [both] = evidenceIndex([rerun, first]).testCasesOf(A);
    expect(both?.executions).toEqual([first, rerun]);
  });

  it("evidenceIndex forms one test case per class name and name across files, executions newest first", () => {
    const run1a = junit(A, "2026-01-01T10:00:00Z", "runs/1.xml");
    const run1b = junit(B, "2026-01-01T10:00:00Z", "runs/1.xml");
    const run2a = junit(A, "2026-01-02T10:00:00Z", "runs/2.xml");
    // Same name in another class: another test case.
    const otherClass = record(A, "2026-01-02T10:00:00Z", { testCase: "test_wind", className: "tests.Gusts" });
    // A Markdown record names its test case by `test-case` alone.
    const manual = record(B, "2026-01-03T10:00:00Z", { testCase: "TC-17", source: "markdown" });
    const index = evidenceIndex([run1a, manual, run1b, otherClass, run2a]);
    const wind = testCaseKey("test_wind", "tests.Wind");
    expect([...index.testCases.keys()]).toEqual([
      testCaseKey("TC-17", undefined),
      testCaseKey("test_wind", "tests.Gusts"),
      wind,
    ]);
    expect(index.testCases.get(wind)).toEqual({
      key: wind,
      name: "test_wind",
      className: "tests.Wind",
      elements: [A, B],
      records: [run2a, run1a, run1b],
      recordsOf: new Map([
        [A, [run2a, run1a]],
        [B, [run1b]],
      ]),
    });
    // Seen from A: A's records only; the test case still names both elements (SR-033 AK2).
    expect(index.testCasesOf(A)).toEqual([
      {
        name: "test_wind",
        className: "tests.Gusts",
        elements: [A],
        executed: true,
        executions: [otherClass],
        last: otherClass,
      },
      {
        name: "test_wind",
        className: "tests.Wind",
        elements: [A, B],
        executed: true,
        executions: [run2a, run1a],
        last: run2a,
      },
    ]);
    expect(index.testCasesOf(B)).toEqual([
      { name: "TC-17", elements: [B], executed: true, executions: [manual], last: manual },
      {
        name: "test_wind",
        className: "tests.Wind",
        elements: [A, B],
        executed: true,
        executions: [run1b],
        last: run1b,
      },
    ]);
  });

  it("evidenceIndex keeps a skipped test case as a test case without execution", () => {
    const skipped: SkippedTestCase[] = [
      {
        name: "test_gusts",
        className: "tests.Wind",
        elements: [A, C],
        repository: "ci",
        file: "runs/1.xml",
        line: 7,
      },
      { name: "TC-9", elements: [C], repository: "system", file: "runs/2.xml", line: 3 },
      // Skipped in one run, executed in another: one test case, executed for A.
      {
        name: "test_wind",
        className: "tests.Wind",
        elements: [A, C],
        repository: "ci",
        file: "runs/0.xml",
        line: 3,
      },
    ];
    const run = junit(A, "2026-01-01T10:00:00Z", "runs/1.xml");
    const index = evidenceIndex([run], skipped);
    expect(index.testCasesOf(C)).toEqual([
      { name: "TC-9", elements: [C], executed: false, executions: [] },
      { name: "test_gusts", className: "tests.Wind", elements: [A, C], executed: false, executions: [] },
      { name: "test_wind", className: "tests.Wind", elements: [A, C], executed: false, executions: [] },
    ]);
    expect(index.testCasesOf(A).map((t) => [t.name, t.executed])).toEqual([
      ["test_gusts", false],
      ["test_wind", true],
    ]);
    expect(index.byElement.get(C)).toBeUndefined();
  });
});

describe("hasVerificationRecord", () => {
  const core = { kind: "core" } as const;
  const variant = (id: string) => ({ kind: "variant", variant: { id, repository: "system" } }) as const;

  it("counts a verification record without a variant in the core and one for the variant in that variant", () => {
    const index = evidenceIndex([
      record(A, "2026-01-01T00:00:00Z"),
      record(B, "2026-01-01T00:00:00Z", { variant: V, result: "failed" }),
      record(C, "2026-01-01T00:00:00Z", { kind: "validation" }),
    ]);
    expect(hasVerificationRecord(index, A, core)).toBe(true);
    expect(hasVerificationRecord(index, A, variant(V))).toBe(false);
    // Result and version do not count (spec question #527); a record for one variant counts only there (SR-047 AK1).
    expect(hasVerificationRecord(index, B, variant(V))).toBe(true);
    expect(hasVerificationRecord(index, B, variant(W))).toBe(false);
    expect(hasVerificationRecord(index, B, core)).toBe(false);
    // Validation is not Nachweis (D-007).
    expect(hasVerificationRecord(index, C, core)).toBe(false);
    expect(hasVerificationRecord(index, `${P}a0000000099`, core)).toBe(false);
  });
});
