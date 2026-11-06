// The evidence source of a record (#821): one rule for every adapter, set on copies only.
import { describe, expect, it } from "vitest";
import { evidenceSourceOf, testCaseWithEvidenceSource, withEvidenceSource } from "./evidence-source.js";
import type { EvidenceRecord, TestCase } from "./record.js";

const record = (more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  element: "5e535a7d-2b4f-4c61-9d08-0a0000000001",
  version: "n1:1111111111111111",
  kind: "verification",
  method: "test",
  item: "build-1",
  result: "passed",
  date: "2026-11-06T10:00:00Z",
  ...more,
});

describe("evidenceSourceOf", () => {
  it("is the evidence when given, before the record file", () => {
    expect(
      evidenceSourceOf(record({ evidence: "reports/wind.pdf", repository: "ci", file: "r.md", line: 1 })),
    ).toBe("reports/wind.pdf");
  });

  it("is the record file when the evidence is empty", () => {
    expect(evidenceSourceOf(record({ evidence: "", repository: "ci", file: "records/a.md", line: 1 }))).toBe(
      "ci/records/a.md:1",
    );
  });

  it("names a Markdown record with its line 1", () => {
    expect(
      evidenceSourceOf(record({ source: "markdown", repository: "ci", file: "records/a.md", line: 1 })),
    ).toBe("ci/records/a.md:1");
  });

  it("names a JUnit execution with its line", () => {
    expect(
      evidenceSourceOf(record({ source: "junit", repository: "ci", file: "results.xml", line: 42 })),
    ).toBe("ci/results.xml:42");
  });

  it("is the file alone without a repository, and leaves out a missing line", () => {
    expect(evidenceSourceOf(record({ file: "results.xml", line: 7 }))).toBe("results.xml:7");
    expect(evidenceSourceOf(record({ repository: "ci", file: "results.xml" }))).toBe("ci/results.xml");
  });

  it("is undefined for a record with neither evidence nor file", () => {
    expect(evidenceSourceOf(record({ evidence: "" }))).toBeUndefined();
    expect(evidenceSourceOf(record())).toBeUndefined();
  });
});

describe("withEvidenceSource", () => {
  it("returns a copy with the field and leaves the record unchanged", () => {
    const original = record({ repository: "ci", file: "results.xml", line: 3 });
    const copy = withEvidenceSource(original);
    expect(copy).toEqual({ ...original, evidenceSource: "ci/results.xml:3" });
    expect(copy).not.toBe(original);
    expect(original).not.toHaveProperty("evidenceSource");
  });

  it("returns a copy without the field when the record has no source", () => {
    const original = record();
    const copy = withEvidenceSource(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy).not.toHaveProperty("evidenceSource");
  });

  it("drops a field the record already has and sets it again from its own rule", () => {
    expect(withEvidenceSource(record({ evidenceSource: "stale" }))).not.toHaveProperty("evidenceSource");
    expect(withEvidenceSource(record({ evidenceSource: "stale", file: "a.md" })).evidenceSource).toBe("a.md");
  });
});

describe("testCaseWithEvidenceSource", () => {
  it("copies the executions and the last one with their source", () => {
    const run = record({ testCase: "t", repository: "ci", file: "results.xml", line: 5 });
    const test: TestCase = {
      name: "t",
      elements: [run.element],
      executed: true,
      executions: [run],
      last: run,
    };
    const copy = testCaseWithEvidenceSource(test);
    expect(copy.executions).toEqual([{ ...run, evidenceSource: "ci/results.xml:5" }]);
    expect(copy.last).toEqual({ ...run, evidenceSource: "ci/results.xml:5" });
    expect(test.executions[0]).not.toHaveProperty("evidenceSource");
    expect(test.last).not.toHaveProperty("evidenceSource");
  });

  it("keeps a test case without execution without last", () => {
    const test: TestCase = { name: "t", elements: ["e"], executed: false, executions: [] };
    expect(testCaseWithEvidenceSource(test)).toEqual(test);
  });
});
