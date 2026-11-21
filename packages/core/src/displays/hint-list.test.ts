import { describe, expect, it } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { CHECK_HINT_CODES } from "../hints/list.js";
import { problemTitle } from "../problem-titles.js";
import { MESSAGE_START, hintListDisplay, hintReason, messageStart } from "./index.js";

type Hint = CommandOutput<"hint.list">["hints"][number];

/** A code that is no problem kind, as an output of another core version could give one. */
const UNTITLED = "no.such-kind" as Hint["code"];

const VARIANT = "9a7c2fca-3edf-43ab-8b68-7771b9666d08";

const outdated: Hint = {
  code: "relation.outdated",
  severity: "warning",
  message:
    "Relation Based on (based-on) of System Requirement SR-3c90b0 points to an older version of D-71cf7f",
  elementId: "uuid-1",
  elementShortId: "SR-3c90b0",
  elementIdentifier: "SR-036",
  elementTitle: "Compute the coverage",
  repository: "spec",
  key: "based-on",
  targetId: "uuid-9",
  targetRepository: "spec",
  targetShortId: "D-71cf7f",
  targetIdentifier: "D-044",
  targetTitle: "Statuses can be invalid",
};

const tooFew: Hint = {
  code: "relation.too-few",
  severity: "warning",
  message:
    "System Requirement SR-f53b9d has 0 relations Derives from (derives-from) to Need (need); at least 1",
  elementId: "uuid-2",
  elementShortId: "SR-f53b9d",
  elementTitle: "Ship an AppArmor profile",
  repository: "spec",
  key: "derives-from",
  targetType: "need",
  count: 0,
  limit: 1,
};

const evidence = (view: string): Hint => ({
  code: "evidence.outdated",
  severity: "warning",
  message: "The newest verification record of System Requirement SR-bc163c is for an older version",
  elementId: "uuid-3",
  elementShortId: "SR-bc163c",
  elementIdentifier: "SR-052",
  elementTitle: "Export a package as ReqIF",
  repository: "evidence",
  elementRepository: "spec",
  view,
});

describe("the display model of the hint list (ADR-0019)", () => {
  it("heads a group by the title of its kind from the problem codes, in the order of kinds with the counts of all hints", () => {
    const display = hintListDisplay(
      {
        kinds: [
          { code: "relation.outdated", count: 1 },
          { code: "relation.too-few", count: 1 },
          { code: "evidence.outdated", count: 4 },
        ],
        hints: [outdated, tooFew, evidence("core"), evidence(VARIANT)],
        total: 6,
        incomplete: false,
      },
      new Map([[VARIANT, "VAR-666d08 (VAR-002)"]]),
    );
    expect(display).toMatchObject({ total: 6, listed: 4, incomplete: false });
    expect(display.groups.map((group) => [group.code, group.title, group.count, group.rows.length])).toEqual([
      ["relation.outdated", "Outdated relation", 1, 1],
      ["relation.too-few", "Too few relations", 1, 1],
      ["evidence.outdated", "Outdated verification", 4, 2],
    ]);
    expect(display.groups[2]?.rows.map((row) => row.reason)).toEqual([
      "view: Core",
      "view: VAR-666d08 (VAR-002)",
    ]);
    expect(display.groups[2]?.rows[0]).toEqual({
      hint: evidence("core"),
      element: "SR-bc163c (SR-052)",
      title: "Export a package as ReqIF",
      name: "SR-bc163c (SR-052) Export a package as ReqIF",
      reason: "view: Core",
      message: evidence("core").message,
      // The element's own repository, not that of the evidence record.
      target: { kind: "element", id: "uuid-3", repository: "spec" },
    });
  });

  it("has a title for every kind the whole-workspace path of hint.list gives, the since-baseline kinds too", () => {
    const untitled = [...CHECK_HINT_CODES].filter((code) => problemTitle(code) === undefined);
    expect(CHECK_HINT_CODES.size).toBeGreaterThan(20);
    expect(untitled).toEqual([]);
  });

  it("heads a kind without a title by its code, and a hint about no element leads nowhere", () => {
    const display = hintListDisplay(
      {
        kinds: [
          { code: UNTITLED, count: 1 },
          { code: "trace.no-parent", count: 2 },
        ],
        hints: [
          { code: UNTITLED, severity: "warning", message: "m", file: "a.md" },
          { code: "trace.no-parent", severity: "warning", message: "n", elementIdentifier: "SR-1" },
          { code: "trace.no-parent", severity: "warning", message: "o", elementId: "uuid-4" },
        ],
        total: 3,
        incomplete: true,
      },
      new Map(),
    );
    expect(display.groups.map((group) => group.title)).toEqual([
      "no.such-kind",
      "Requirement without parent",
    ]);
    expect(display.groups[0]?.rows[0]).toMatchObject({
      element: "a.md",
      title: "",
      name: "a.md",
      target: undefined,
    });
    expect(display.groups[1]?.rows.map((row) => [row.element, row.target])).toEqual([
      ["SR-1", undefined],
      ["uuid-4", undefined],
    ]);
    expect(
      hintListDisplay(
        {
          kinds: [{ code: "trace.cycle", count: 1 }],
          hints: [{ code: "trace.cycle", severity: "warning", message: "c" }],
          total: 1,
          incomplete: false,
        },
        new Map(),
      ).groups[0]?.rows[0]?.element,
    ).toBe("");
    // A kind with no hint on the page keeps its count and has no rows.
    expect(
      hintListDisplay(
        { kinds: [{ code: "trace.cycle", count: 2 }], hints: [], total: 2, incomplete: false },
        new Map(),
      ).groups[0],
    ).toEqual({ code: "trace.cycle", title: "Cycle of derivations", count: 2, rows: [] });
  });

  it("builds the reason from the fields: relation kind and target, count and limit, the view, else the start of the message", () => {
    const views = new Map([[VARIANT, "VAR-666d08 (VAR-002)"]]);
    expect(hintReason(outdated, views)).toBe("based-on → D-71cf7f (D-044) Statuses can be invalid");
    expect(hintReason(tooFew, views)).toBe("derives-from → need · 0 of at least 1");
    expect(hintReason({ ...tooFew, code: "relation.too-many", count: 3, limit: 2 }, views)).toBe(
      "derives-from → need · 3 of at most 2",
    );
    expect(
      hintReason(
        { code: "element.too-many-items", severity: "warning", message: "m", count: 0, limit: 1 },
        views,
      ),
    ).toBe("0 of at most 1");
    expect(hintReason(evidence(VARIANT), new Map())).toBe(`view: ${VARIANT}`);
    const plain: Hint = { code: "trace.no-parent", severity: "warning", message: "x".repeat(200) };
    expect(hintReason(plain, views)).toBe(`${"x".repeat(MESSAGE_START - 1)}…`);
    // A target without a relation kind stands before the message; an unresolved one by its UUID or identifier.
    expect(hintReason({ ...plain, message: "short", targetId: "uuid-7" }, views)).toBe("→ uuid-7 · short");
    expect(
      hintReason({ ...plain, message: "short", targetIdentifier: "D-1", targetId: "uuid-7" }, views),
    ).toBe("→ D-1 · short");
    // A relation whose target did not resolve to one element keeps what is wrong with it.
    expect(
      hintReason(
        {
          code: "relation.missing-target",
          severity: "warning",
          message: "No target",
          key: "refines",
          targetId: "uuid-7",
        },
        views,
      ),
    ).toBe("refines → uuid-7 · No target");
    expect(messageStart("short")).toBe("short");
  });
});
