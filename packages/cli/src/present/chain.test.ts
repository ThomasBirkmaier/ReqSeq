import { describe, expect, it } from "vitest";
import { renderHuman } from "../present.js";
import { edge, lines, node } from "../present.test-helper.js";

describe("renderHuman: a chain", () => {
  /** A chain output, its keys in the order of trace.chain. */
  const chain = (extra: Record<string, unknown>) => ({
    root: "r",
    nodes: [],
    total: 0,
    edges: [],
    gaps: [],
    evidence: [],
    validationRecords: [],
    unresolved: [],
    incomplete: false,
    problems: [],
    ...extra,
  });

  it("shows the validation records of the root below it, each with its version, and nothing without them (#646)", () => {
    const record = (more: Record<string, unknown>) => ({
      element: "r",
      version: "n1:1111111111111111",
      kind: "validation",
      item: "Pilot test",
      date: "2026-10-25T09:00:00Z",
      ...more,
    });
    const shown = renderHuman(
      chain({
        nodes: [node("r", "N-r", 0)],
        total: 1,
        validationRecords: [
          record({ result: "inconclusive", reason: "No wind on the test day" }),
          record({ result: "passed", date: "2026-10-10T09:00:00Z", version: "n1:2222222222222222" }),
        ],
      }),
    );
    expect(shown.split("\n").slice(0, 3)).toEqual([
      "N-r  draft  Title N-r",
      expect.stringMatching(
        /^ {2}1 {2}validation {2}2026-10-25T09:00:00Z {2}inconclusive .*No wind on the test day.*\[version n1:1111111111111111\]$/,
      ),
      expect.stringMatching(
        /^ {2}1 {2}validation {2}2026-10-10T09:00:00Z {2}passed .*\[version n1:2222222222222222\]$/,
      ),
    ]);
    expect(renderHuman(chain({ nodes: [node("r", "N-r", 0)], total: 1 }))).not.toContain("validation");
  });

  it("shows parents and children as indented trees with the depth in front, gaps and cut ends marked", () => {
    const output = chain({
      nodes: [
        node("r", "SR-r", 0),
        node("p1", "N-p1", 1, "up"),
        node("p2", "N-p2", 2, "up"),
        node("c1", "CR-c1", 1, "down"),
        node("c2", "CR-c2", 2, "down", { expanded: false }),
        node("c3", "CR-c3", 1, "down"),
      ],
      total: 6,
      edges: [
        edge("r", "p1", "up"),
        edge("p1", "p2", "up"),
        edge("c1", "r", "down"),
        edge("c3", "r", "down"),
        edge("c2", "c1", "down"),
      ],
      gaps: [
        { id: "c3", repository: "system", kind: "no-evidence" },
        { id: "r", repository: "system", kind: "no-child" },
        { id: "r", repository: "system", kind: "no-evidence" },
      ],
    });
    expect(renderHuman(output)).toBe(
      lines(
        "SR-r  draft  Title SR-r  [gap: no child]  [gap: no evidence]",
        "parents:",
        "  1  N-p1  draft  Title N-p1",
        "  2    N-p2  draft  Title N-p2",
        "children:",
        "  1  CR-c1  draft  Title CR-c1",
        "  2    CR-c2  draft  Title CR-c2  [not expanded]",
        "  1  CR-c3  draft  Title CR-c3  [gap: no evidence]",
        "total: 6",
        "No problems.",
      ),
    );
  });

  it("marks a requirement the view does not hold as not in view, with the views that hold it, not as a gap (#674)", () => {
    const shown = (views: readonly string[]): string =>
      renderHuman(
        chain({
          nodes: [node("r", "SR-r", 0)],
          total: 1,
          gaps: [{ id: "r", repository: "system", kind: "not-in-view", views }],
          names: [{ id: "v1", repository: "system", shortId: "VAR-v1", title: "Gusty" }],
        }),
      );
    expect(shown(["core", "v1", "v2"])).toBe(
      lines("SR-r  draft  Title SR-r  [not in view, holds in core, VAR-v1, v2]", "total: 1", "No problems."),
    );
    expect(shown([])).toContain("[not in view, holds in no view]");
  });

  it("names the kind of a neighbourhood relation that is no derivation, and heads its direction so (#643)", () => {
    const output = chain({
      nodes: [node("r", "STK-r", 0), node("n", "N-n", 1, "down"), node("p", "N-p", 1, "up")],
      total: 3,
      edges: [
        { ...edge("n", "r", "down"), link: "relation", kind: "has-stakeholder" },
        { ...edge("r", "p", "up"), link: "relation", meaning: "derivation" },
      ],
    });
    expect(renderHuman(output)).toBe(
      lines(
        "STK-r  draft  Title STK-r",
        "parents:",
        "  1  N-p  draft  Title N-p",
        "downward:",
        "  1  N-n  draft  Title N-n  [has-stakeholder]",
        "total: 3",
        "No problems.",
      ),
    );
  });

  it("marks an edge to an element shown elsewhere, and a cycle, where the edge starts", () => {
    const output = chain({
      nodes: [node("r", "SR-r", 0), node("a", "SR-a", 1, "down"), node("b", "SR-b", 1, "down")],
      total: 3,
      edges: [
        edge("a", "r", "down"),
        edge("b", "r", "down"),
        edge("b", "a", "down"),
        edge("r", "b", "down", true),
      ],
      problems: [{ code: "trace.cycle", severity: "warning", message: "Cycle" }],
    });
    expect(renderHuman(output)).toBe(
      lines(
        "SR-r  draft  Title SR-r",
        "children:",
        "  1  SR-a  draft  Title SR-a",
        "  2    SR-b  [listed elsewhere]",
        "  1  SR-b  draft  Title SR-b",
        "  2    SR-r  [cycle]",
        "total: 3",
        "warning  trace.cycle  Cycle",
      ),
    );
  });

  it("shows a later page: an element whose parent is on another page is not nested and names its parent", () => {
    const output = chain({
      nodes: [node("c2", "CR-c2", 2, "down"), node("c4", "CR-c4", 3, "down")],
      total: 12,
      edges: [
        edge("c2", "c1", "down"),
        edge("c2", "c0", "down"),
        edge("c4", "c2", "down"),
        edge("c5", "c2", "down"),
        edge("c4", "c9", "down", true),
      ],
      unresolved: [
        {
          direction: "down",
          from: "c2",
          fromRepository: "system",
          kind: "derives-from",
          id: "x",
          targetState: "ambiguous",
        },
        {
          direction: "up",
          from: "zz",
          fromRepository: "system",
          kind: "derives-from",
          id: "y",
          shortId: "UNKNOWN-y",
          title: "Far",
          targetState: "unknown-repository",
        },
      ],
      incomplete: true,
    });
    expect(renderHuman(output)).toBe(
      lines(
        "children:",
        "  2  CR-c2  draft  Title CR-c2  [under c1]  [also under c0]",
        "  3    CR-c4  draft  Title CR-c4  [cycle from c9]",
        "  3    c5  [listed elsewhere]",
        "unresolved:",
        "  down from CR-c2  derives-from  x  [ambiguous]",
        "  up from zz  derives-from  UNKNOWN-y  Far  [unknown-repository]",
        "total: 12",
        "incomplete: true (a repository of the workspace is not on this machine)",
        "Showing 2 of 12; ask for more with --offset and --limit.",
        "No problems.",
      ),
    );
  });

  it("marks an edge into the root from another page as a cycle, never as the root's parent", () => {
    const output = chain({
      nodes: [node("r", "SR-r", 0)],
      total: 4,
      edges: [edge("p3", "r", "up", true)],
    });
    expect(renderHuman(output).split("\n")[0]).toBe("SR-r  draft  Title SR-r  [cycle from p3]");
  });

  it("prints the test cases, executions and records below an element of a chain", () => {
    const junit = {
      date: "2026-10-22T09:00:00Z",
      result: "failed",
      item: "build-513",
      repository: "system",
      file: "evidence/ci/run-2.xml",
      line: 4,
      evidenceSource: "system/evidence/ci/run-2.xml:4",
    };
    const inspection = {
      date: "2026-10-20T14:00:00Z",
      method: "inspection",
      result: "passed",
      item: "Sample",
      evidence: "reports/b4.pdf",
      evidenceSource: "reports/b4.pdf",
      variant: "v1",
    };
    const output = chain({
      nodes: [
        node("r", "SR-r", 0),
        node("p", "N-p", 1, "up"),
        node("c", "CR-c", 1, "down"),
        node("d", "CR-d", 2, "down"),
      ],
      total: 4,
      edges: [edge("r", "p", "up"), edge("c", "r", "down")],
      evidence: [
        // The root's own evidence, one level below it.
        {
          id: "r",
          repository: "system",
          depth: 1,
          testCases: [],
          records: [{ ...inspection, variant: undefined }],
        },
        // Not shown below the parent of the same UUID: evidence belongs to the downward chain.
        { id: "p", repository: "system", depth: 2, testCases: [], records: [inspection] },
        {
          id: "c",
          repository: "system",
          depth: 2,
          testCases: [
            {
              className: "tests.test_wind",
              name: "test_speed",
              executed: true,
              executions: [
                junit,
                {
                  ...junit,
                  line: undefined,
                  evidenceSource: "system/evidence/ci/run-2.xml",
                  result: "passed",
                },
              ],
            },
            { name: "manual check", executed: false, executions: [] },
          ],
          records: [inspection],
        },
        // CR-d is not nested (its parent is on another page): its evidence follows it all the same.
        {
          id: "d",
          repository: "system",
          depth: 3,
          testCases: [],
          records: [{ date: "2026-10-01T10:00:00Z", result: "passed" }],
        },
      ],
    });
    expect(renderHuman(output)).toBe(
      lines(
        "SR-r  draft  Title SR-r",
        "  1  record  2026-10-20T14:00:00Z  inspection  passed  Sample  reports/b4.pdf",
        "parents:",
        "  1  N-p  draft  Title N-p",
        "children:",
        "  1  CR-c  draft  Title CR-c",
        "  2    test case  tests.test_wind › test_speed",
        "         2026-10-22T09:00:00Z  failed  build-513  system/evidence/ci/run-2.xml:4",
        "         2026-10-22T09:00:00Z  passed  build-513  system/evidence/ci/run-2.xml",
        "  2    test case  manual check  [not executed]",
        "  2    record  2026-10-20T14:00:00Z  inspection  passed  Sample  reports/b4.pdf  [variant v1]",
        "  2  CR-d  draft  Title CR-d",
        "  3    record  2026-10-01T10:00:00Z  passed",
        "total: 4",
        "No problems.",
      ),
    );
    // With `names` the variant is named by short ID and title, and `names` is not printed (#676).
    const named = renderHuman({
      ...output,
      names: [{ id: "v1", repository: "system", shortId: "VAR-v1", title: "Gusty" }],
    });
    expect(named).toContain("reports/b4.pdf  [variant VAR-v1  Gusty]");
    expect(named).not.toContain("names:");
  });

  it("is a chain only when every node has a depth; else its lists are shown as they are", () => {
    const {
      gaps: _gaps,
      unresolved: _unresolved,
      ...bare
    } = chain({
      nodes: [node("r", "SR-r", 0)],
      edges: [],
    });
    expect(renderHuman({ ...bare, total: 1 })).toBe(
      lines("SR-r  draft  Title SR-r", "total: 1", "No problems."),
    );
    expect(renderHuman({ nodes: [{ shortId: "SR-r", title: "R" }], edges: [] })).toBe(
      lines("nodes:", "  SR-r  R", "edges: none"),
    );
  });
});
