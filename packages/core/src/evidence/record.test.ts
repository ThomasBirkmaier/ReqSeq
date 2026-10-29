// The record and test case shapes of the evidence block against `data-export.schema.json` (a
// data-export file has no place for records or test cases, so the schema examples cannot check the
// defs; they are checked here with the contracts' Ajv), and the identity of a test case (ADR-0012).
import { describe, expect, it } from "vitest";
import { fileSchemaValidator } from "../runtime/contracts.js";
import type { EvidenceRecord, TestCase } from "./record.js";
import { testCaseKey, testCaseKeyOf } from "./record.js";

const isRecord = fileSchemaValidator("data-export.schema.json#/$defs/evidenceRecord");
const isTestCase = fileSchemaValidator("data-export.schema.json#/$defs/testCase");

const SR = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const OTHER = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";

const junit: EvidenceRecord = {
  element: SR,
  version: "n1:11335f109ffb1a19",
  kind: "verification",
  method: "test",
  item: "build-512",
  result: "passed",
  date: "2026-10-21T09:00:00Z",
  testCase: "test_shows_wind_speed[SR-e88fb3]",
  className: "tests.test_wind",
  source: "junit",
  repository: "system",
  file: "evidence/ci/results.xml",
  line: 4,
  baselines: ["baselines/release-1.0.yaml"],
};

const markdown: EvidenceRecord = {
  element: SR,
  version: "n1:11335f109ffb1a19",
  kind: "validation",
  result: "failed",
  date: "2026-10-20T14:00:00Z",
  evidence: "//fileserver/qa/ws/inspection-2026-10-20.docx",
  source: "markdown",
  repository: "system",
  file: "evidence/2026-10-20-SR-e88fb3-validation.md",
  line: 1,
};

describe("evidence record model", () => {
  it("the record and test case shapes match data-export.schema.json", () => {
    expect([isRecord(junit), isRecord.errors]).toEqual([true, null]);
    expect([isRecord(markdown), isRecord.errors]).toEqual([true, null]);
    const executed: TestCase = {
      name: "test_shows_wind_speed[SR-e88fb3]",
      className: "tests.test_wind",
      elements: [SR, OTHER],
      executed: true,
      executions: [junit],
      last: junit,
    };
    const skipped: TestCase = { name: "test_shows_gusts", elements: [SR], executed: false, executions: [] };
    expect([isTestCase(executed), isTestCase.errors]).toEqual([true, null]);
    expect([isTestCase(skipped), isTestCase.errors]).toEqual([true, null]);
  });

  it("the schema refuses records with unknown fields and test cases whose execution fields disagree", () => {
    expect(isRecord({ ...junit, source: "csv" })).toBe(false);
    expect(isRecord({ ...junit, line: 0 })).toBe(false);
    expect(isRecord({ ...junit, extra: 1 })).toBe(false);
    const base = { name: "t", elements: [SR] };
    expect(isTestCase({ ...base, executed: false, executions: [junit] })).toBe(false);
    expect(isTestCase({ ...base, executed: false, executions: [], last: junit })).toBe(false);
    expect(isTestCase({ ...base, executed: true, executions: [] })).toBe(false);
    expect(isTestCase({ ...base, executed: true, executions: [junit] })).toBe(false);
    expect(isTestCase({ name: "t", elements: [], executed: false, executions: [] })).toBe(false);
  });

  it("testCaseKey names a test case by class name and name, or by the test case of a Markdown record", () => {
    expect(testCaseKey("test_a", "tests.test_wind")).toBe('["tests.test_wind","test_a"]');
    expect(testCaseKey("TC-17", undefined)).toBe('[null,"TC-17"]');
    expect(testCaseKeyOf(junit)).toBe(testCaseKey("test_shows_wind_speed[SR-e88fb3]", "tests.test_wind"));
    expect(testCaseKeyOf({ testCase: "TC-17" })).toBe(testCaseKey("TC-17", undefined));
    // A name with a line break never passes for a class name and a name.
    expect(testCaseKey("a\nb", undefined)).not.toBe(testCaseKey("b", "a"));
    expect(testCaseKey("", "a")).not.toBe(testCaseKey("a", undefined));
    expect(testCaseKeyOf(markdown)).toBeUndefined();
  });
});
