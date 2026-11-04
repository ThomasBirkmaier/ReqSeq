import type { DataExportEvidenceRecord } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { chainLines } from "./chain-lines.js";
import { resultLines } from "./result.js";

const node = (id: string, shortId: string, title: string, repository = "system") => ({
  id,
  shortId,
  title,
  type: "system-requirement",
  status: "draft",
  repository,
  file: `requirements/${shortId}.md`,
  depth: 1,
  direction: "down",
  expanded: true,
});

const execution = (fields: Partial<DataExportEvidenceRecord>): DataExportEvidenceRecord => ({
  element: "uuid-1",
  version: "n1:1111111111111111",
  kind: "verification",
  method: "test",
  result: "passed",
  date: "2026-10-21T09:00:00Z",
  ...fields,
});

const shown = (output: unknown): string[] =>
  chainLines(output).map((line) => `${"  ".repeat(line.depth)}${line.label}|${line.text}`);

describe("the lines of a trace chain", () => {
  it("shows each element's test cases with their executions and its records without test case under its row", () => {
    const output = {
      root: "uuid-1",
      nodes: [
        // An element of a cycle is a parent too: its evidence goes under its row as a child.
        { ...node("uuid-2", "SR-2", "Show gusts"), direction: "up" },
        node("uuid-1", "SR-1", "Show wind speed"),
        node("uuid-2", "SR-2", "Show gusts"),
        node("uuid-3", "SR-3", "Show it"),
      ],
      total: 3,
      evidence: [
        {
          id: "uuid-1",
          repository: "system",
          depth: 2,
          testCases: [
            {
              name: "test_speed",
              className: "tests.test_wind",
              elements: ["uuid-1"],
              executed: true,
              executions: [
                execution({
                  result: "failed",
                  item: "build-513",
                  date: "2026-10-22T09:00:00Z",
                  repository: "system",
                  file: "evidence/ci/run-2.xml",
                  line: 4,
                }),
                execution({
                  item: "build-512",
                  repository: "system",
                  file: "evidence/ci/run-1.xml",
                  line: 4,
                }),
              ],
            },
          ],
          records: [],
        },
        {
          id: "uuid-2",
          repository: "system",
          depth: 2,
          testCases: [{ name: "test_gusts", elements: ["uuid-2"], executed: false, executions: [] }],
          records: [
            execution({
              method: "inspection",
              item: "Sample B4",
              variant: "uuid-v",
              evidence: "reports/b4.pdf",
              date: "2026-10-20T14:00:00Z",
            }),
            execution({ kind: "validation", result: "inconclusive", reason: "no\n pilot" }),
          ],
        },
        // An element without a row, and an item of another shape, show nothing.
        { id: "uuid-9", repository: "system", depth: 2, testCases: [], records: [execution({})] },
        { id: "uuid-3" },
      ],
    };
    expect(shown(output)).toEqual([
      "root|uuid-1",
      "nodes|4",
      "  SR-2|Show gusts",
      "  SR-1|Show wind speed",
      "    test case|tests.test_wind › test_speed",
      "      |2026-10-22T09:00:00Z · failed · build-513 · system/evidence/ci/run-2.xml:4",
      "      |2026-10-21T09:00:00Z · passed · build-512 · system/evidence/ci/run-1.xml:4",
      "  SR-2|Show gusts",
      "    test case|test_gusts · not executed",
      "    record|2026-10-20T14:00:00Z · inspection · passed · Sample B4 · reports/b4.pdf · variant uuid-v",
      "    record|2026-10-21T09:00:00Z · test · inconclusive: no pilot",
      "  SR-3|Show it",
    ]);
  });

  it("gives a record line that cuts its reason the whole reason as its title (#862)", () => {
    const long = `First\n${"x".repeat(300)}`;
    const lines = chainLines({
      nodes: [{ id: "uuid-1", repository: "system", shortId: "SR-1", title: "Show wind speed", depth: 0 }],
      evidence: [
        {
          id: "uuid-1",
          repository: "system",
          testCases: [
            {
              name: "test_speed",
              executed: true,
              executions: [execution({ result: "inconclusive", reason: long })],
            },
          ],
          records: [execution({ result: "inconclusive", reason: long }), execution({ reason: "short" })],
        },
      ],
    });
    expect(lines.filter((line) => line.title !== undefined).map((line) => line.title)).toEqual([long, long]);
  });

  it("lays out an output without a list of evidence by shape alone", () => {
    const output = { root: "uuid-1", nodes: [node("uuid-1", "SR-1", "Show wind speed")], evidence: "none" };
    expect(chainLines(output)).toEqual(resultLines(output));
    expect(chainLines(undefined)).toEqual([]);
    // A row of the chain ends with the element's status, as every element row does (#276).
    expect(chainLines({ ...output, evidence: [] }).find((line) => line.kind === "element")?.status).toBe(
      "draft",
    );
  });

  it("puts evidence only under a row of the nodes, not under the same element elsewhere", () => {
    const evidence = [
      { id: "uuid-1", repository: "system", testCases: [], records: [execution({ item: "b1" })] },
    ];
    const output = { other: [node("uuid-1", "SR-1", "Show wind speed")], nodes: [], evidence };
    expect(shown(output)).toEqual(["other|1", "  SR-1|Show wind speed", "nodes|0"]);
  });
});
