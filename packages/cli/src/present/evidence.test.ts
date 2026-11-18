import { describe, expect, it } from "vitest";
import { renderHuman } from "../present.js";
import { lines, node } from "../present.test-helper.js";

describe("renderHuman: evidence records and test cases (#275)", () => {
  const record = {
    element: "e",
    kind: "verification",
    method: "test",
    item: "build-513",
    result: "failed",
    date: "2026-10-22T09:00:00Z",
    repository: "system",
    file: "evidence/ci/run-2.xml",
    line: 4,
    evidenceSource: "system/evidence/ci/run-2.xml:4",
    baselines: [],
  };
  it("prints one line per record and per test case, with the last result and the number of executions", () => {
    const validation = {
      ...record,
      kind: "validation",
      method: "review",
      result: "passed",
      evidence: "notes.md",
      evidenceSource: "notes.md",
      version: "n1:ab",
      baselines: ["v1", "v2"],
    };
    expect(
      renderHuman({
        records: [record, validation, { ...record, criteria: [1, 3] }],
        testCases: [
          {
            name: "test_speed",
            className: "tests.test_wind",
            executed: true,
            executions: [record, record],
            last: record,
          },
          { name: "manual check", executed: false, executions: [] },
        ],
        problems: [],
      }),
    ).toBe(
      [
        "records:",
        "  2026-10-22T09:00:00Z  test  failed  build-513  system/evidence/ci/run-2.xml:4",
        "  validation  2026-10-22T09:00:00Z  review  passed  build-513  notes.md  [version n1:ab]  [baselines: v1, v2]",
        // The criteria a record names (D-072, SR-028 AK4).
        "  2026-10-22T09:00:00Z  test  failed  build-513  system/evidence/ci/run-2.xml:4  [criteria 1, 3]",
        "testCases:",
        "  tests.test_wind › test_speed  last: failed  2026-10-22T09:00:00Z  executions: 2",
        "  manual check  [not executed]  executions: 0",
        "No problems.",
        "",
      ].join("\n"),
    );
  });
});

describe("renderHuman: a graph with evidence (SR-111 AK3)", () => {
  const graphNode = (id: string, shortId: string, level: number): Record<string, unknown> => {
    const { depth: _depth, ...rest } = node(id, shortId, 0);
    return { ...rest, level, marks: [] };
  };
  it("[SR-111/AK-h6n9] prints the evidence summary of a node on the line below it", () => {
    expect(
      renderHuman({
        root: "a",
        nodes: [
          graphNode("a", "SR-00000a", 0),
          graphNode("b", "N-00000b", -1),
          graphNode("c", "CR-00000c", 1),
        ],
        evidence: [
          {
            id: "a",
            repository: "system",
            level: 1,
            testCases: 2,
            records: 1,
            results: { passed: 2, failed: 1 },
          },
          { id: "c", repository: "system", level: 2, testCases: 1, records: 0, results: { skipped: 1 } },
          { id: "c", repository: "other", level: 2, testCases: 0, records: 2, results: {} },
        ],
        problems: [],
      }),
    ).toBe(
      lines(
        "nodes:",
        "  SR-00000a  draft  Title SR-00000a",
        "    evidence: 2 test cases, 1 record · 2 passed, 1 failed",
        "  N-00000b  draft  Title N-00000b",
        "  CR-00000c  draft  Title CR-00000c",
        "    evidence: 1 test case · 1 skipped",
        "root: a",
        "No problems.",
      ),
    );
  });

  it("[SR-111/AK-h6n9] counts records alone, and shows nodes without evidence as a list", () => {
    const summary = { id: "a", repository: "system", level: 1, testCases: 0, records: 2, results: {} };
    expect(renderHuman({ nodes: [graphNode("a", "SR-00000a", 0)], evidence: [summary] })).toBe(
      lines("nodes:", "  SR-00000a  draft  Title SR-00000a", "    evidence: 2 records"),
    );
    expect(renderHuman({ nodes: [graphNode("a", "SR-00000a", 0)] })).toBe(
      lines("nodes:", "  SR-00000a  draft  Title SR-00000a"),
    );
    expect(renderHuman({ nodes: [], evidence: [] })).toBe(lines("nodes: none", "evidence: none"));
  });
});

describe("renderHuman: a graph with verification (SR-136)", () => {
  it("[SR-136/AK-h2xg] prints the status of a requirement node and the degree of a need node", () => {
    expect(
      renderHuman({
        nodes: [
          {
            ...node("a", "SR-00000a", 0),
            verification: [
              {
                view: "core",
                status: "open",
                criteria: { verified: 2, total: 3, notVerified: [{ criterion: 3 }] },
              },
            ],
            criteria: { verified: 2, total: 3, notVerified: [{ criterion: 3 }] },
          },
          {
            ...node("b", "N-00000b", 0),
            degree: {
              share: 0.6,
              total: 10,
              counts: { open: 2, verified: 6, indirect: 0, failed: 1, outdated: 1 },
            },
          },
          { ...node("c", "N-00000c", 0), degree: { total: 0, counts: {} } },
        ],
      }),
    ).toContain(
      lines(
        "  SR-00000a  draft  Title SR-00000a  [verification: core open 2 of 3 criteria (AK3 not verified)]",
        "  N-00000b  draft  Title N-00000b  [degree: 60 % of 10]",
        "  N-00000c  draft  Title N-00000c",
      ).trimEnd(),
    );
  });
});
