import { describe, expect, it } from "vitest";
import { renderHuman } from "../present.js";

describe("renderHuman: a matrix (#629)", () => {
  it("numbers the columns and prints the cells of each row, a dash for an empty one and [gap] for a gap (SR-153)", () => {
    const row = (shortId: string, cells: unknown[][], extra: Record<string, unknown> = {}) => ({
      id: shortId,
      repository: "system",
      shortId,
      type: "system-requirement",
      status: "draft",
      title: `Title ${shortId}`,
      cells,
      ...extra,
    });
    expect(
      renderHuman({
        columns: [
          {
            type: "relation",
            kind: "derives-from",
            direction: "out",
            name: "Derives from",
            count: 1,
            expected: 3,
            met: 2,
            share: 2 / 3,
          },
          { type: "relation", kind: "derives-from", direction: "in", name: "Derived by", count: 1 },
          { type: "relation", kind: "refines", direction: "out", name: "Refines" },
        ],
        rows: [
          row(
            "SR-a",
            [
              [
                { shortId: "N-x", identifier: "N-001", outdated: true },
                { id: "0000-uuid", shortId: "", targetState: "missing" },
              ],
              [],
              [],
            ],
            { depth: 1, testCases: [], gaps: [{ column: 0 }, "no gap", { column: "1" }] },
          ),
          row("SR-b", [[], [], []], { testCases: [{ name: "test_b" }] }),
        ],
        total: 2,
        incomplete: false,
        problems: [],
      }),
    ).toBe(
      [
        "columns:",
        "  1:  Derives from  (derives-from, out)  2 of 3 · 66.6 %",
        "  2:  Derived by  (derives-from, in)  1",
        "  3:  Refines  (refines, out)",
        "rows:",
        "    SR-a  draft  Title SR-a",
        "    1: N-x (N-001)  [outdated], 0000-uuid  [missing] [gap]  2: –  3: –  tests: –",
        "  SR-b  draft  Title SR-b",
        "    1: –  2: –  3: –  tests: test_b",
        "total: 2",
        "No problems.",
        "",
      ].join("\n"),
    );
    expect(renderHuman({ columns: [], rows: [], total: 0, problems: [] })).toBe(
      ["columns: none", "rows: none", "total: 0", "No problems.", ""].join("\n"),
    );
  });
});
