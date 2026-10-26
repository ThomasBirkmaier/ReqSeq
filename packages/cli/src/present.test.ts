import { describe, expect, it } from "vitest";
import { renderHuman } from "./present.js";

const lines = (...all: readonly string[]): string => all.map((line) => `${line}\n`).join("");

const node = (
  id: string,
  shortId: string,
  depth: number,
  direction?: "up" | "down",
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  shortId,
  type: "need",
  title: `Title ${shortId}`,
  status: "draft",
  repository: "system",
  file: `${shortId}.md`,
  depth,
  expanded: true,
  ...(direction === undefined ? {} : { direction }),
  ...extra,
});

/** A derivation from `child` to `parent`, followed in `direction`. */
const edge = (child: string, parent: string, direction: "up" | "down", cyclic = false) => ({
  source: child,
  sourceRepository: "system",
  target: parent,
  targetRepository: "system",
  kind: "derives-from",
  direction,
  cyclic,
});

describe("renderHuman: findings left out (#304)", () => {
  it("says how many findings severity left out instead of No problems, and does not show hidden as YAML", () => {
    expect(
      renderHuman({
        ok: true,
        problems: [],
        hidden: { below: "error", warning: 4, info: 1 },
        checkedElements: 9,
      }),
    ).toBe(
      lines(
        "ok: true",
        "checkedElements: 9",
        "No problems at or above error; 4 warnings and 1 info not shown.",
      ),
    );
    const problem = { code: "trace.cycle", severity: "warning", message: "Cycle" };
    expect(
      renderHuman({ ok: true, problems: [problem], hidden: { below: "warning", warning: 0, info: 2 } }),
    ).toBe(lines("ok: true", "warning  trace.cycle  Cycle", "2 info below warning not shown."));
  });

  it("shows a field named hidden of another shape as YAML", () => {
    expect(renderHuman({ hidden: true, problems: [] })).toBe(lines("hidden: true", "No problems."));
  });
});

describe("renderHuman: values", () => {
  it("renders scalars and other values as YAML, and non-object outputs whole", () => {
    expect(renderHuman({ ok: true, checkedElements: 0, problems: [] })).toBe(
      lines("ok: true", "checkedElements: 0", "No problems."),
    );
    expect(renderHuman({ text: "line 1\nline 2" })).toBe("text: |-\n  line 1\n  line 2\n");
    expect(renderHuman({ metamodel: { valid: true }, list: [1, "a"] })).toBe(
      lines("metamodel:", "  valid: true", "list:", "  - 1", "  - a"),
    );
    expect(renderHuman({})).toBe("");
    expect(renderHuman(undefined)).toBe("");
    expect(renderHuman(["a", "b"])).toBe("- a\n- b\n");
  });

  it("shows incomplete only when it is true, and an empty list as none", () => {
    expect(renderHuman({ incomplete: false, files: [] })).toBe(lines("files: none"));
    expect(renderHuman({ incomplete: true })).toBe(
      lines("incomplete: true (a repository of the workspace is not on this machine)"),
    );
  });

  it("renders a list of elements one line each, with distance and how each points along its path when it has them", () => {
    expect(
      renderHuman({
        elements: [
          { shortId: "SR-1", status: "draft", title: "One" },
          {
            id: "u2",
            repository: "system",
            shortId: "SR-2",
            title: "Two",
            distance: 1,
            via: { kind: "relation", key: "refines" },
            path: [
              { id: "u0", repository: "system" },
              { id: "u2", repository: "system" },
            ],
          },
          {
            id: "u3",
            repository: "system",
            shortId: "SR-3",
            title: "Three",
            distance: 2,
            via: { kind: "reference" },
            path: [
              { id: "u0", repository: "system" },
              { id: "u2", repository: "system" },
              { id: "u3", repository: "system" },
            ],
          },
          {
            shortId: "SR-4",
            title: "Four",
            distance: 3,
            via: { kind: "relation", key: "refines" },
            path: [{ id: "u0" }, { id: "u3", repository: "system" }, { id: "u9", repository: "system" }, {}],
          },
        ],
        total: 3,
      }),
    ).toBe(
      lines(
        "elements:",
        "  SR-1  draft  One",
        "  1  SR-2  Two  [via refines]",
        "  2  SR-3  Three  [via reference from SR-2]",
        "  3  SR-4  Four  [via refines from u9]",
        "total: 3",
      ),
    );
  });

  it("says when a list is one page of more", () => {
    expect(renderHuman({ elements: [{ shortId: "SR-1", title: "One" }], total: 4 })).toBe(
      lines(
        "elements:",
        "  SR-1  One",
        "total: 4",
        "Showing 1 of 4; ask for more with --offset and --limit.",
      ),
    );
    expect(renderHuman({ total: 4 })).toBe(lines("total: 4"));
  });

  it("renders a list of strings one per line", () => {
    expect(renderHuman({ files: ["a.md", "b.md"], problems: [] })).toBe(
      lines("files:", "  a.md", "  b.md", "No problems."),
    );
  });

  it("renders hints one line each: element short ID or file, kind, message, hint ID", () => {
    expect(
      renderHuman({
        hints: [
          {
            code: "relation.outdated",
            severity: "warning",
            message: "Points to an older version",
            file: "a.md",
            elementShortId: "SR-1",
            hintId: "relation.outdated/x",
          },
          { code: "element.unknown-property", severity: "warning", message: "Unknown", file: "b.md" },
        ],
        incomplete: false,
      }),
    ).toBe(
      lines(
        "hints:",
        "  SR-1  relation.outdated  Points to an older version  hint: relation.outdated/x",
        "  b.md  element.unknown-property  Unknown",
      ),
    );
  });
});

describe("renderHuman: one element", () => {
  const element = {
    id: "u1",
    shortId: "SR-1",
    type: "system-requirement",
    status: "draft",
    title: "Show wind",
    text: "Text.\n",
    version: "n1:0000000000000000",
    repository: "system",
    file: "SR-1.md",
    properties: { "requirement-type": "functional" },
    relations: [
      {
        kind: "derives-from",
        direction: "out",
        id: "u2",
        shortId: "N-2",
        title: "Wind",
        targetState: "available",
      },
      { kind: "refines", direction: "in", id: "u3", shortId: "SR-3", title: "Gust" },
      { kind: "derives-from", direction: "out", id: "u4", targetState: "missing" },
      "odd",
    ],
    problems: [
      { code: "relation.outdated", severity: "warning", message: "Older", file: "SR-1.md", line: 3 },
    ],
  };

  it("shows a read element with its details and its hints once, as problems", () => {
    const hint = element.problems[0];
    expect(renderHuman({ element, problems: [hint] })).toBe(
      lines(
        "SR-1  draft  Show wind",
        "  id: u1",
        "  type: system-requirement",
        "  file: system:SR-1.md",
        "  version: n1:0000000000000000",
        "  properties:",
        "    requirement-type: functional",
        "  relations:",
        "    - -> derives-from  N-2  Wind",
        "    - <- refines  SR-3  Gust",
        "    - -> derives-from  u4  [missing]",
        "  text: |",
        "    Text.",
        "warning  relation.outdated  SR-1.md:3  Older",
      ),
    );
  });

  it("shows a written element as its line only, with the files and its problems once", () => {
    expect(renderHuman({ element, files: ["SR-1.md"], problems: element.problems }, false)).toBe(
      lines("SR-1  draft  Show wind", "files:", "  SR-1.md", "warning  relation.outdated  SR-1.md:3  Older"),
    );
    const { problems: _none, relations: _relations, ...plain } = element;
    expect(renderHuman({ element: plain, problems: [] }, false)).toBe(
      lines("SR-1  draft  Show wind", "No problems."),
    );
    expect(renderHuman({ element: plain })).toContain("  relations: []\n");
  });
});

describe("renderHuman: identifiers (#305)", () => {
  it("shows the identifier next to the short ID of an element, its relations, a hint and a chain node", () => {
    const element = {
      id: "u1",
      shortId: "SR-0b0036",
      identifier: "SR-036",
      type: "system-requirement",
      status: "draft",
      title: "Accept identifiers",
      repository: "spec",
      file: "SR-0b0036.md",
      properties: { "spec-id": "SR-036" },
      relations: [
        {
          kind: "derives-from",
          direction: "out",
          id: "u2",
          shortId: "N-0a0001",
          identifier: "N-001",
          title: "Name",
        },
      ],
    };
    expect(renderHuman({ element })).toBe(
      lines(
        "SR-0b0036 (SR-036)  draft  Accept identifiers",
        "  id: u1",
        "  type: system-requirement",
        "  file: spec:SR-0b0036.md",
        "  properties:",
        "    spec-id: SR-036",
        "  relations:",
        "    - -> derives-from  N-0a0001 (N-001)  Name",
      ),
    );
    expect(
      renderHuman({
        hints: [
          {
            code: "element.duplicate-identifier",
            severity: "warning",
            message: "Also on SR-x.md",
            elementShortId: "SR-0b0036",
            elementIdentifier: "SR-036",
          },
        ],
      }),
    ).toBe(lines("hints:", "  SR-0b0036 (SR-036)  element.duplicate-identifier  Also on SR-x.md"));
    expect(
      renderHuman({
        root: "r",
        nodes: [node("r", "N-0a0001", 0, undefined, { identifier: "N-001" })],
        total: 1,
        edges: [],
        gaps: [],
        unresolved: [
          {
            direction: "down",
            from: "r",
            fromRepository: "system",
            kind: "derives-from",
            id: "c",
            shortId: "SR-0b0037",
            identifier: "SR-037",
            title: "Child",
            targetState: "ambiguous",
          },
        ],
      }),
    ).toBe(
      lines(
        "N-0a0001 (N-001)  draft  Title N-0a0001",
        "unresolved:",
        "  down from N-0a0001  derives-from  SR-0b0037 (SR-037)  Child  [ambiguous]",
        "total: 1",
      ),
    );
  });
});

describe("renderHuman: a chain", () => {
  /** A chain output, its keys in the order of trace.chain. */
  const chain = (extra: Record<string, unknown>) => ({
    root: "r",
    nodes: [],
    total: 0,
    edges: [],
    gaps: [],
    unresolved: [],
    incomplete: false,
    problems: [],
    ...extra,
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
