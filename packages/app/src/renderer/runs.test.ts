import type { DataExportEvidenceRecord, DataExportTestCase } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { isTestCase, runRows, testCaseLines } from "./runs.js";

const run = (fields: Partial<DataExportEvidenceRecord>): DataExportEvidenceRecord => ({
  element: "uuid-1",
  version: "n1:1111111111111111",
  kind: "verification",
  method: "test",
  result: "passed",
  date: "2026-11-19T09:00:00Z",
  ...fields,
});

const TITLES: Readonly<Record<string, string>> = { "uuid-mac": "macOS", "uuid-win": "Windows" };
const title = (id: string): string | undefined => TITLES[id];

const test = (executions: DataExportEvidenceRecord[]): DataExportTestCase => ({
  name: "test_speed",
  className: "tests.test_wind",
  elements: ["uuid-1"],
  executed: executions.length > 0,
  executions,
});

const shown = (lines: ReturnType<typeof testCaseLines>): string[] =>
  lines.map(
    (line) =>
      `${"  ".repeat(line.depth)}${line.label}|${line.text}${line.detail === true ? " (detail)" : ""}`,
  );

describe("the executions of a test case as runs (SR-223 AK4)", () => {
  it("shows the runs of one date with one result as one row with date, result and views", () => {
    const executions = [
      run({ item: "mac", evidenceSource: "ci/mac.xml:3" }),
      run({ variant: "uuid-mac", item: "mac", evidenceSource: "ci/mac.xml:3" }),
      run({ item: "win", evidenceSource: "ci/win.xml:3" }),
      run({ variant: "uuid-win", item: "win", evidenceSource: "ci/win.xml:3" }),
      run({ date: "2026-11-18T09:00:00Z", variant: "uuid-x", result: "failed" }),
    ];
    expect(shown(testCaseLines(test(executions), 0, title, false))).toEqual([
      "test case|tests.test_wind › test_speed",
      "  |2026-11-19T09:00:00Z · passed · Core, macOS, Windows",
      // A variant the output does not name by its UUID.
      "  |2026-11-18T09:00:00Z · failed · uuid-x",
    ]);
    // "Show details" shows each execution with its view, item under test and evidence document.
    expect(shown(testCaseLines(test(executions), 0, title, true)).slice(1, 6)).toEqual([
      "  |2026-11-19T09:00:00Z · passed · Core, macOS, Windows",
      "    |Core · mac · ci/mac.xml:3 (detail)",
      "    |macOS · mac · ci/mac.xml:3 (detail)",
      "    |Core · win · ci/win.xml:3 (detail)",
      "    |Windows · win · ci/win.xml:3 (detail)",
    ]);
  });

  it("gives each view of a run its own row when a result differs, and each execution of a view that differs in itself", () => {
    const executions = [
      run({}),
      run({ variant: "uuid-mac" }),
      run({ result: "failed" }),
      run({ variant: "uuid-win", result: "failed" }),
      run({ variant: "uuid-win", result: "failed" }),
    ];
    expect(shown(testCaseLines(test(executions), 1, title, false))).toEqual([
      "  test case|tests.test_wind › test_speed",
      "    |2026-11-19T09:00:00Z · passed · Core",
      "    |2026-11-19T09:00:00Z · failed · Core",
      "    |2026-11-19T09:00:00Z · passed · macOS",
      "    |2026-11-19T09:00:00Z · failed · Windows",
    ]);
    expect(runRows(executions, title).map((row) => row.length)).toEqual([1, 1, 1, 2]);
  });

  it("names no view in a test case of the core alone, and keeps the whole reason as the row's title", () => {
    const long = `First\n${"x".repeat(300)}`;
    const { className: _className, ...plain } = test([
      run({ kind: "validation", result: "inconclusive", reason: long }),
      run({ date: "d" }),
    ]);
    const lines = testCaseLines(plain, 0, title, true);
    expect(lines.map((line) => line.text)).toEqual([
      "test_speed",
      expect.stringMatching(/^2026-11-19T09:00:00Z · inconclusive: First x+…?$/u),
      "",
      "d · passed",
      "",
    ]);
    expect(lines[1]?.title).toBe(long);
    expect(lines[3]?.title).toBeUndefined();
    expect(testCaseLines(test([]), 0, title, false).map((line) => line.text)).toEqual([
      "tests.test_wind › test_speed · not executed",
    ]);
  });

  it("knows a test case by its shape", () => {
    expect(isTestCase(test([run({})]))).toBe(true);
    expect(isTestCase({ ...test([]), executed: "yes" })).toBe(false);
    expect(isTestCase({ ...test([]), executions: [{ result: "passed" }] })).toBe(false);
    expect(isTestCase({ ...test([]), executions: "none" })).toBe(false);
    expect(isTestCase({ ...test([]), name: 1 })).toBe(false);
    expect(isTestCase([test([])])).toBe(false);
    expect(isTestCase(null)).toBe(false);
  });
});
