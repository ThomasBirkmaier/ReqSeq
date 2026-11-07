import { stripVTControlCharacters, styleText } from "node:util";
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

describe("renderHuman: findings left out (ThomasBirkmaier/ReqSeq-archive#304)", () => {
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

  it("writes a value that appears twice in full both times, without YAML anchors (an execution and last)", () => {
    const run = { item: "build-1" };
    expect(renderHuman({ testCases: [{ executions: [run], last: run }] })).toBe(
      lines("testCases:", "  - executions:", "      - item: build-1", "    last:", "      item: build-1"),
    );
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

  it("shows a list with texts compactly: numbered criteria, relations one line each, no relation targets twice (#397)", () => {
    const pkg = {
      kind: "packages",
      property: true,
      direction: "out",
      shortId: "PKG-1",
      identifier: "Stufe-1",
      title: "Stage 1",
    };
    const elements = [
      {
        shortId: "SR-1",
        identifier: "SR-001",
        status: "approved",
        title: "One",
        id: "u1",
        file: "sr/SR-1.md",
        properties: {
          "acceptance-criteria": ["Given a, then b.", "Given c, then d."],
          packages: [{ id: "p" }],
        },
        relations: [
          {
            kind: "based-on",
            direction: "out",
            shortId: "D-1",
            identifier: "D-017",
            title: "Decision",
            storedVersion: "n1:x",
          },
          pkg,
        ],
        text: "The tool must work.\n",
      },
      { shortId: "SR-2", title: "Two", properties: {}, relations: [], text: "" },
    ];
    expect(renderHuman({ elements, total: 2 })).toBe(
      lines(
        "elements:",
        "  SR-1 (SR-001)  approved  One",
        "    properties:",
        "      acceptance-criteria:",
        "        1: Given a, then b.",
        "        2: Given c, then d.",
        "    relations:",
        "      - -> based-on  D-1 (D-017)  Decision",
        "      - -> packages  PKG-1 (Stufe-1)  Stage 1",
        "    text: |",
        "      The tool must work.",
        "",
        "  SR-2  Two",
        '    text: ""',
        "total: 2",
      ),
    );
  });

  it("[SR-075/AK2] shows a tree list indented by depth, naming a parent that is not shown before", () => {
    const element = (id: string, title: string): Record<string, unknown> => ({
      id,
      repository: "system",
      shortId: `SR-${id}`,
      status: "draft",
      title,
    });
    const at = (id: string, depth: number, parent?: string): Record<string, unknown> => ({
      id,
      repository: "system",
      depth,
      ...(parent === undefined ? {} : { parent: { id: parent, repository: "system" } }),
    });
    expect(
      renderHuman({
        elements: [element("b1", "One"), element("f1", "Two"), element("b2", "Three"), element("n2", "Four")],
        tree: [at("b1", 1, "n1"), at("f1", 2, "b1"), at("b2", 1, "n1"), at("n2", 0)],
        total: 9,
        incomplete: false,
      }),
    ).toBe(
      lines(
        "elements:",
        "    SR-b1  draft  One  [under n1]",
        "      SR-f1  draft  Two",
        "    SR-b2  draft  Three  [under n1]",
        "  SR-n2  draft  Four",
        "total: 9",
        "Showing 4 of 9; ask for more with --offset and --limit.",
      ),
    );
    expect(renderHuman({ elements: [], tree: [], total: 0 })).toBe(lines("elements: none", "total: 0"));
  });

  it("shows the texts of a tree list at each element's depth (#397)", () => {
    const element = (id: string, body: string | undefined): Record<string, unknown> => ({
      id,
      repository: "system",
      shortId: `SR-${id}`,
      title: id,
      properties: { "acceptance-criteria": ["Given x, then y."] },
      ...(body === undefined ? {} : { text: body }),
    });
    expect(
      renderHuman({
        elements: [element("a", "A.\n"), element("b", undefined)],
        tree: [
          { id: "a", repository: "system", depth: 0 },
          { id: "b", repository: "system", depth: 1, parent: { id: "a", repository: "system" } },
        ],
        total: 2,
      }),
    ).toBe(
      lines(
        "elements:",
        "  SR-a  a",
        "    properties:",
        "      acceptance-criteria:",
        "        1: Given x, then y.",
        "    text: |",
        "      A.",
        "",
        "    SR-b  b",
        "      properties:",
        "        acceptance-criteria:",
        "          1: Given x, then y.",
        "total: 2",
      ),
    );
  });

  it("[SR-149/AK1] shows a grouped list under a heading per group with its value and count", () => {
    const element = (id: string, title: string): Record<string, unknown> => ({
      id,
      repository: "system",
      shortId: `SR-${id}`,
      status: "draft",
      title,
    });
    expect(
      renderHuman({
        elements: [element("b1", "One"), element("b1", "One"), element("b2", "Two"), element("n1", "Three")],
        groups: [
          { value: "PKG-d2", title: "alarms", count: 2, offset: 0 },
          { value: "PKG-d1", identifier: "R1", title: "Wind", count: 2, offset: 2 },
          { value: "draft", name: "Draft", count: 1, offset: 4 },
          { value: "custom", count: 1, offset: 5 },
          { count: 2, offset: 6 },
          { value: "unseen", count: 1, offset: 8 },
        ],
        offset: 1,
        rows: 9,
        total: 7,
      }),
    ).toBe(
      lines(
        "elements:",
        "  PKG-d2  alarms · 2, continued",
        "    SR-b1  draft  One",
        "  PKG-d1 (R1)  Wind · 2",
        "    SR-b1  draft  One",
        "    SR-b2  draft  Two",
        "  Draft (draft) · 1",
        "    SR-n1  draft  Three",
        "total: 7",
        "Showing 4 of 9; ask for more with --offset and --limit.",
      ),
    );
    expect(renderHuman({ elements: [], groups: [], offset: 0, rows: 0, total: 0 })).toBe(
      lines("elements: none", "total: 0"),
    );
    // Without `offset` the page starts at the first row; the last group is `(no value)`.
    expect(
      renderHuman({
        elements: [element("x", "X")],
        groups: [
          { value: 3, count: 1, offset: 0 },
          { count: 1, offset: 1 },
        ],
      }),
    ).toBe(lines("elements:", "  3 · 1", "    SR-x  draft  X"));
    expect(
      renderHuman({ elements: [element("x", "X")], groups: [{ count: 1, offset: 0 }], offset: 0, rows: 1 }),
    ).toBe(lines("elements:", "  (no value) · 1", "    SR-x  draft  X"));
  });

  it("shows the elements of a list narrowed by fields (#982) as elements, grouped and as a tree", () => {
    const part = (id: string, title?: string): Record<string, unknown> => ({
      id,
      repository: "system",
      shortId: `SR-${id}`,
      ...(title === undefined ? {} : { title }),
    });
    expect(
      renderHuman({
        partial: [part("b1", "One"), part("b2", "Two")],
        groups: [{ value: "draft", name: "Draft", count: 2, offset: 0 }],
        offset: 0,
        rows: 2,
        total: 2,
      }),
    ).toBe(lines("partial:", "  Draft (draft) · 2", "    SR-b1  One", "    SR-b2  Two", "total: 2"));
    expect(
      renderHuman({
        partial: [part("b1", "One"), part("b2", "Two")],
        tree: [
          { id: "b1", repository: "system", depth: 0 },
          { id: "b2", repository: "system", depth: 1, parent: { id: "b1", repository: "system" } },
        ],
        total: 3,
      }),
    ).toBe(
      lines(
        "partial:",
        "  SR-b1  One",
        "    SR-b2  Two",
        "total: 3",
        "Showing 2 of 3; ask for more with --offset and --limit.",
      ),
    );
    expect(renderHuman({ partial: [], groups: [], offset: 0, rows: 0, total: 0 })).toBe(
      lines("partial: none", "total: 0"),
    );
    // Without a title a row is no element line: the list stays YAML.
    const yaml = renderHuman({ partial: [part("b1")], total: 2 });
    expect(yaml).toContain("shortId: SR-b1");
    expect(yaml).toContain("Showing 1 of 2; ask for more with --offset and --limit.");
  });

  it("[SR-149/AK1] shows each group of a grouped tree as its own tree, with texts", () => {
    const element = (id: string, body?: string): Record<string, unknown> => ({
      id,
      repository: "system",
      shortId: `SR-${id}`,
      title: id,
      ...(body === undefined ? {} : { text: body }),
    });
    const at = (id: string, depth: number, parent?: string): Record<string, unknown> => ({
      id,
      repository: "system",
      depth,
      ...(parent === undefined ? {} : { parent: { id: parent, repository: "system" } }),
    });
    expect(
      renderHuman({
        elements: [element("a"), element("b"), element("b"), element("c")],
        tree: [at("a", 0), at("b", 1, "a"), at("b", 1, "a"), at("c", 0)],
        groups: [
          { value: "x", count: 2, offset: 0 },
          { value: "y", count: 2, offset: 2 },
        ],
        offset: 0,
        rows: 4,
        total: 3,
      }),
    ).toBe(
      lines(
        "elements:",
        "  x · 2",
        "    SR-a  a",
        "      SR-b  b",
        "  y · 2",
        "      SR-b  b  [under SR-a]",
        "    SR-c  c",
        "total: 3",
      ),
    );
    expect(
      renderHuman({
        elements: [element("a", "A.\n"), element("b", "B.\n")],
        groups: [
          { value: "x", count: 1, offset: 0 },
          { unavailable: 1, count: 1, offset: 1 },
        ],
        offset: 0,
        rows: 2,
        total: 2,
      }),
    ).toBe(
      lines(
        "elements:",
        "  x · 1",
        "    SR-a  a",
        "      text: |",
        "        A.",
        // A blank line between a group's last element and the next heading too.
        "",
        "  (no value) · 1, 1 with targets not available",
        "    SR-b  b",
        "      text: |",
        "        B.",
        "total: 2",
      ),
    );
  });

  it("shows groups that do not fit as they are", () => {
    expect(renderHuman({ elements: [{ shortId: "SR-1", title: "One" }], groups: [{ count: "1" }] })).toBe(
      lines("elements:", "  SR-1  One", "groups:", '  - count: "1"'),
    );
  });

  it("shows a tree that does not fit the elements as it is", () => {
    const one = { shortId: "SR-1", title: "One" };
    expect(renderHuman({ elements: [one], tree: [] })).toBe(lines("elements:", "  SR-1  One", "tree: none"));
    expect(renderHuman({ elements: [one], tree: [{ depth: "1" }] })).toBe(
      lines("elements:", "  SR-1  One", "tree:", '  - depth: "1"'),
    );
    expect(renderHuman({ elements: ["SR-1"], tree: [{ depth: 0 }] })).toBe(
      lines("elements:", "  SR-1", "tree:", "  - depth: 0"),
    );
  });

  it("renders a list of strings one per line", () => {
    expect(renderHuman({ files: ["a.md", "b.md"], problems: [] })).toBe(
      lines("files:", "  a.md", "  b.md", "No problems."),
    );
  });

  it("renders hints one line each: element → target or file, kind, message, hint ID (#252)", () => {
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
          // The target by its short ID and identifier when core named it (#172).
          {
            code: "relation.target-superseded",
            severity: "warning",
            message: "Points to a superseded decision",
            file: "c.md",
            elementShortId: "D-589cf2",
            elementIdentifier: "D-017",
            targetShortId: "D-fd8f46",
            targetIdentifier: "D-011",
          },
          // A hint whose element is not in the store names its file, else only its target (#252).
          {
            code: "evidence.kind-mismatch",
            severity: "warning",
            message: "Wrong kind",
            file: "d.md",
            targetShortId: "SR-2",
          },
          {
            code: "evidence.kind-mismatch",
            severity: "warning",
            message: "Wrong kind",
            targetShortId: "SR-2",
          },
        ],
        incomplete: false,
      }),
    ).toBe(
      lines(
        "hints:",
        "  SR-1  relation.outdated  Points to an older version  hint: relation.outdated/x",
        "  b.md  element.unknown-property  Unknown",
        "  D-589cf2 (D-017) → D-fd8f46 (D-011)  relation.target-superseded  Points to a superseded decision",
        "  d.md → SR-2  evidence.kind-mismatch  Wrong kind",
        "  → SR-2  evidence.kind-mismatch  Wrong kind",
      ),
    );
  });

  it("notes a page of hints shorter than total (#146)", () => {
    const hint = { code: "element.unknown-property", severity: "warning", message: "Unknown", file: "b.md" };
    expect(renderHuman({ hints: [hint], total: 3, incomplete: false })).toContain(
      "Showing 1 of 3; ask for more with --offset and --limit.",
    );
    expect(renderHuman({ hints: [hint], total: 1, incomplete: false })).not.toContain("Showing");
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
        repository: "platform",
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
        "warning  relation.outdated  Older  SR-1.md:3",
      ),
    );
  });

  it("numbers the items of a list of texts in the properties from 1 (#401)", () => {
    const properties = {
      "acceptance-criteria": ["Erstes Kriterium.", "Zweites:\nmit Zeilenumbruch."],
      tags: [],
      mixed: ["a", 2],
      validity: [{ id: "u9" }],
      "requirement-type": "functional",
    };
    const output = renderHuman({ element: { ...element, relations: [], problems: [], properties } });
    expect(output).toContain(
      lines(
        "  properties:",
        "    acceptance-criteria:",
        "      1: Erstes Kriterium.",
        "      2: |-",
        "        Zweites:",
        "        mit Zeilenumbruch.",
        "    tags: []",
        "    mixed:",
        "      - a",
        "      - 2",
        "    validity:",
        "      - id: u9",
        "    requirement-type: functional",
      ),
    );
    // Properties that are no object stay as they are.
    expect(renderHuman({ element: { ...element, properties: "odd" } })).toContain("  properties: odd\n");
  });

  it("shows a written element as its line only, with the files and its problems once", () => {
    expect(renderHuman({ element, files: ["SR-1.md"], problems: element.problems }, false)).toBe(
      lines("SR-1  draft  Show wind", "files:", "  SR-1.md", "warning  relation.outdated  Older  SR-1.md:3"),
    );
    const { problems: _none, relations: _relations, ...plain } = element;
    expect(renderHuman({ element: plain, problems: [] }, false)).toBe(
      lines("SR-1  draft  Show wind", "No problems."),
    );
    expect(renderHuman({ element: plain })).toContain("  relations: []\n");
  });
});

describe("renderHuman: verification status (SR-031)", () => {
  const requirement = (id: string, verification?: unknown): Record<string, unknown> => ({
    id,
    shortId: `SR-${id}`,
    status: "approved",
    title: `Title ${id}`,
    ...(verification === undefined ? {} : { verification }),
  });

  it("[SR-031/AK2] shows the verification status per view after the title, apart from the element's own status", () => {
    const elements = [
      requirement("1", [
        { view: "core", status: "verified" },
        { view: "v1", status: "open" },
        { view: "v9", status: "failed" },
      ]),
      requirement("2", []),
      requirement("3"),
      { id: "v1", shortId: "VAR-1", title: "Pro", status: "draft" },
    ];
    expect(renderHuman({ elements, total: 4 })).toBe(
      lines(
        "elements:",
        "  SR-1  approved  Title 1  [verification: core verified, VAR-1 open, v9 failed]",
        "  SR-2  approved  Title 2",
        "  SR-3  approved  Title 3",
        "  VAR-1  draft  Pro",
        "total: 4",
      ),
    );
  });

  it("shows it on the line of one element, not again in its details", () => {
    const element = {
      ...requirement("1", [
        { view: "core", status: "outdated" },
        { view: "v2", status: "open" },
      ]),
      type: "system-requirement",
      relations: [
        { kind: "validity", direction: "out", id: "v2", shortId: "VAR-2", title: "Basic", property: true },
      ],
    };
    expect(renderHuman({ element })).toBe(
      lines(
        "SR-1  approved  Title 1  [verification: core outdated, VAR-2 open]",
        '  id: "1"',
        "  type: system-requirement",
        '  file: ":"',
        "  relations:",
        "    - -> validity  VAR-2  Basic",
      ),
    );
  });
  it("[SR-031/AK5] shows how many acceptance criteria are verified and which are not", () => {
    const elements = [
      requirement("1", [
        { view: "core", status: "open", criteria: { verified: 2, total: 3, notVerified: [3] } },
        { view: "v1", status: "verified", criteria: { verified: 3, total: 3 } },
      ]),
      requirement("2", [
        { view: "core", status: "failed", criteria: { verified: 0, total: 2, notVerified: [1, 2] } },
      ]),
      { id: "v1", shortId: "VAR-1", title: "Pro", status: "draft" },
    ];
    expect(renderHuman({ elements, total: 3 })).toBe(
      lines(
        "elements:",
        "  SR-1  approved  Title 1  [verification: core open 2 of 3 criteria (AK3 not verified), VAR-1 verified 3 of 3 criteria]",
        "  SR-2  approved  Title 2  [verification: core failed 0 of 2 criteria (AK1, AK2 not verified)]",
        "  VAR-1  draft  Pro",
        "total: 3",
      ),
    );
  });
});

describe("renderHuman: indirect verification (SR-034)", () => {
  it("[SR-034/AK2] names the missing children after the status of their view: short ID from the list, else from the relations, else UUID", () => {
    const elements = [
      {
        id: "p",
        shortId: "SR-P",
        status: "approved",
        title: "Parent",
        verification: [
          { view: "core", status: "open", missingChildren: ["c1", "c2", "c3"] },
          { view: "v1", status: "indirect" },
        ],
        relations: [{ kind: "derives-from", direction: "in", id: "c2", shortId: "SR-C2", title: "Two" }],
      },
      {
        id: "c1",
        shortId: "SR-C1",
        status: "draft",
        title: "One",
        verification: [{ view: "core", status: "failed" }],
      },
      { id: "v1", shortId: "VAR-1", status: "draft", title: "Pro" },
    ];
    expect(renderHuman({ elements, total: 3 })).toBe(
      lines(
        "elements:",
        "  SR-P  approved  Parent  [verification: core open (missing SR-C1, SR-C2, c3), VAR-1 indirect]",
        "  SR-C1  draft  One  [verification: core failed]",
        "  VAR-1  draft  Pro",
        "total: 3",
      ),
    );
  });

  it("[SR-034/AK1] shows indirect on the line of one element", () => {
    const element = {
      id: "p",
      shortId: "SR-P",
      status: "approved",
      title: "Parent",
      verification: [{ view: "core", status: "indirect" }],
    };
    expect(renderHuman({ element }).split("\n")[0]).toBe(
      "SR-P  approved  Parent  [verification: core indirect]",
    );
  });
});

describe("renderHuman: elements named by UUID only (ThomasBirkmaier/ReqSeq-archive#588)", () => {
  const C1 = "58858858-0000-4000-8000-0000000000b1";
  const C2 = "58858858-0000-4000-8000-0000000000b2";
  const V1 = "58858858-0000-4000-8000-0000000000c1";
  const UNNAMED = "58858858-0000-4000-8000-0000000000ff";
  const names = [
    { id: C1, repository: "system", shortId: "SR-0000b1", identifier: "SR-001", title: "Measure wind" },
    { id: C2, repository: "system", shortId: "SR-0000b2", title: "Measure rain" },
    { id: V1, repository: "system", shortId: "VAR-0000c1", title: "Pro" },
  ];

  it("[SR-036/AK2] prints the elements behind the coverage numbers by short ID, identifier and title, not names itself", () => {
    const levels = [
      {
        type: "system-requirement",
        total: 3,
        withChildren: 1,
        elements: { withChildren: [C1], withoutChildren: [C2, UNNAMED] },
      },
    ];
    expect(renderHuman({ levels, incomplete: false, names })).toBe(
      lines(
        "levels:",
        "  - type: system-requirement",
        "    total: 3",
        "    withChildren: 1",
        "    elements:",
        "      withChildren:",
        "        - SR-0000b1 (SR-001)  Measure wind",
        "      withoutChildren:",
        "        - SR-0000b2  Measure rain",
        `        - ${UNNAMED}`,
      ),
    );
  });

  it("[SR-034/AK2] names missing children and variants in the verification status by short ID and identifier", () => {
    const elements = [
      {
        id: "p",
        shortId: "SR-P",
        status: "approved",
        title: "Parent",
        verification: [
          { view: "core", status: "open", missingChildren: [C1, C2, UNNAMED] },
          { view: V1, status: "indirect" },
        ],
      },
    ];
    expect(renderHuman({ elements, total: 1, names })).toBe(
      lines(
        "elements:",
        `  SR-P  approved  Parent  [verification: core open (missing SR-0000b1 (SR-001), SR-0000b2, ${UNNAMED}), VAR-0000c1 indirect]`,
        "total: 1",
      ),
    );
    // One element, and a page that is not all of the selection: `names` is never the page.
    const element = elements[0];
    expect(renderHuman({ element, names }).split("\n")[0]).toContain(
      "(missing SR-0000b1 (SR-001), SR-0000b2",
    );
    expect(renderHuman({ elements, total: 2, names })).toContain("Showing 1 of 2;");
  });

  it("names the variant of a view printed as YAML (SR-037, SR-126)", () => {
    const counts = { open: 1, verified: 0, indirect: 0, failed: 0, outdated: 0 };
    expect(renderHuman({ degree: { share: 0, total: 1, counts }, view: V1, names })).toContain(
      "view: VAR-0000c1  Pro\n",
    );
    expect(renderHuman({ evidence: { view: V1, degree: { total: 0, counts } }, rows: [], names })).toContain(
      "evidence:\n  view: VAR-0000c1  Pro\n",
    );
    // A page past the last row (a matrix in a variant view): `names` is never the page.
    expect(renderHuman({ rows: [], total: 6, names })).not.toContain("Showing");
  });

  it("names the UUIDs of a list one per line and of its rows (variant.diff)", () => {
    const output = { added: [C2, UNNAMED], replaced: [{ core: C1, replacement: C2 }], excluded: [C1], names };
    expect(renderHuman(output)).toBe(
      lines(
        "added:",
        "  SR-0000b2  Measure rain",
        `  ${UNNAMED}`,
        "replaced:",
        "  - core: SR-0000b1 (SR-001)  Measure wind",
        "    replacement: SR-0000b2  Measure rain",
        "excluded:",
        "  SR-0000b1 (SR-001)  Measure wind",
      ),
    );
  });

  it("prints a names value that is not a list of names as it is", () => {
    expect(renderHuman({ view: V1, names: ["x"] })).toBe(lines(`view: ${V1}`, "names:", "  x"));
  });
});

describe("renderHuman: validation status (SR-038)", () => {
  it("[SR-038/AK1] shows the validation status in its own bracket after the verification status", () => {
    const elements = [
      { id: "n", shortId: "N-1", status: "approved", title: "Need", validation: "validated" },
      {
        id: "r",
        shortId: "SR-1",
        status: "draft",
        title: "Requirement",
        verification: [{ view: "core", status: "failed" }],
        validation: "validated",
      },
      {
        id: "s",
        shortId: "SR-2",
        status: "draft",
        title: "Other",
        verification: [{ view: "core", status: "open" }],
      },
    ];
    expect(renderHuman({ elements, total: 3 })).toBe(
      lines(
        "elements:",
        "  N-1  approved  Need  [validation: validated]",
        "  SR-1  draft  Requirement  [verification: core failed]  [validation: validated]",
        "  SR-2  draft  Other  [verification: core open]",
        "total: 3",
      ),
    );
  });

  it("shows it on the line of one element, not again in its details", () => {
    const element = {
      id: "n",
      shortId: "N-1",
      status: "approved",
      title: "Need",
      type: "need",
      validation: "outdated",
    };
    const out = renderHuman({ element });
    expect(out.split("\n")[0]).toBe("N-1  approved  Need  [validation: outdated]");
    expect(out.split("\n").filter((line) => line.trimStart().startsWith("validation:"))).toEqual([]);
  });

  it("[SR-172/AK2] shows an inconclusive validation with its reason on one line, cut when long, not again in the details", () => {
    const element = {
      id: "n",
      shortId: "N-1",
      status: "approved",
      title: "Need",
      type: "need",
      validation: "inconclusive",
      validationReason: "No frost\n\tyet,\u0007 see notes",
    };
    const out = renderHuman({ element });
    expect(out.split("\n")[0]).toBe(
      "N-1  approved  Need  [validation: inconclusive — No frost yet, see notes]",
    );
    expect(out).not.toContain("validationReason");
    const long = renderHuman({ elements: [{ ...element, validationReason: "x".repeat(200) }] });
    expect(long).toContain(`[validation: inconclusive — ${"x".repeat(119)}…]`);
    // Cut by graphemes: an emoji, also one of several code points, is never split.
    const emoji = renderHuman({ elements: [{ ...element, validationReason: "👍🏽".repeat(200) }] });
    expect(emoji).toContain(`[validation: inconclusive — ${"👍🏽".repeat(119)}…]`);
    // Longer than the limit in code units, but not in graphemes: not cut.
    const fits = renderHuman({ elements: [{ ...element, validationReason: "👍🏽".repeat(120) }] });
    expect(fits).toContain(`[validation: inconclusive — ${"👍🏽".repeat(120)}]`);
  });

  it("shows the reason of an inconclusive record in a list of records", () => {
    const record = {
      kind: "validation",
      element: "n",
      version: "n1:ab",
      result: "inconclusive",
      reason: "No frost yet",
      date: "2026-11-02T09:00:00Z",
    };
    expect(renderHuman({ records: [record] }).split("\n")[1]).toBe(
      "  validation  2026-11-02T09:00:00Z  inconclusive  No frost yet  [version n1:ab]",
    );
  });
});

describe("renderHuman: verification degree (SR-037)", () => {
  const counts = { open: 2, verified: 6, indirect: 0, failed: 1, outdated: 1 };

  it("[SR-037/AK1] shows the share of a verification degree as 60 % and the count per status", () => {
    expect(renderHuman({ degree: { share: 0.6, total: 10, counts }, view: "core", incomplete: false })).toBe(
      lines(
        "degree:",
        "  share: 60 %",
        "  total: 10",
        "  counts:",
        "    open: 2",
        "    verified: 6",
        "    indirect: 0",
        "    failed: 1",
        "    outdated: 1",
        "view: core",
      ),
    );
  });

  it("rounds the share down to one decimal (ThomasBirkmaier/ReqSeq-archive#592 Q3)", () => {
    const shown = (share: number): string | undefined =>
      renderHuman({ degree: { share, total: 1, counts } })
        .split("\n")
        .find((line) => line.startsWith("  share:"));
    expect([2 / 3, 9 / 14, 0.29, 1].map(shown)).toEqual([
      "  share: 66.6 %",
      "  share: 64.2 %",
      "  share: 29 %",
      "  share: 100 %",
    ]);
  });

  it("shows no percentage without a share, and a share without counts stays a number", () => {
    expect(renderHuman({ degree: { total: 0, counts }, view: "core" })).toContain("degree:\n  total: 0\n");
    expect(renderHuman({ result: { share: 0.6, total: 10 } })).toBe(
      lines("result:", "  share: 0.6", "  total: 10"),
    );
  });

  it("finds a degree at any depth, in nested objects and in lists", () => {
    const degree = { share: 0.5, total: 2, counts };
    expect(renderHuman({ evidence: { view: "core", degree } })).toContain("    share: 50 %\n");
    expect(renderHuman({ rows: [{ degree }, { degree: { ...degree, share: 0.25 } }] })).toContain(
      "  - degree:\n      share: 50 %\n",
    );
    expect(renderHuman({ rows: [{ degree }, { degree: { ...degree, share: 0.25 } }] })).toContain(
      "      share: 25 %\n",
    );
  });
});

describe("renderHuman: the mark emergent (SR-035)", () => {
  it("[SR-035/AK2] shows [emergent] after the title, before the verification status, and only for a marked element", () => {
    const elements = [
      {
        id: "e",
        shortId: "SR-1",
        status: "approved",
        title: "Forecast",
        emergent: true,
        verification: [{ view: "core", status: "open" }],
      },
      {
        id: "p",
        shortId: "SR-2",
        status: "approved",
        title: "Wind",
        verification: [{ view: "core", status: "indirect" }],
      },
    ];
    expect(renderHuman({ elements, total: 2 })).toBe(
      lines(
        "elements:",
        "  SR-1  approved  Forecast  [emergent]  [verification: core open]",
        "  SR-2  approved  Wind  [verification: core indirect]",
        "total: 2",
      ),
    );
  });

  it("shows it on the line of one element, not again in its details; the property stays", () => {
    const element = {
      id: "e",
      shortId: "SR-1",
      status: "approved",
      title: "Forecast",
      type: "system-requirement",
      emergent: true,
      properties: { emergent: "yes" },
      verification: [{ view: "core", status: "open" }],
    };
    const out = renderHuman({ element }).split("\n");
    expect(out[0]).toBe("SR-1  approved  Forecast  [emergent]  [verification: core open]");
    expect(out.filter((line) => line.trimStart().startsWith("emergent: true"))).toEqual([]);
    expect(out).toContain("    emergent: yes");
  });
});

describe("renderHuman: identifiers (ThomasBirkmaier/ReqSeq-archive#305)", () => {
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

describe("renderHuman: a graph with evidence (SR-111 AK3)", () => {
  const graphNode = (id: string, shortId: string, level: number): Record<string, unknown> => {
    const { depth: _depth, ...rest } = node(id, shortId, 0);
    return { ...rest, level, marks: [] };
  };
  it("[SR-111/AK3] prints the evidence summary of a node on the line below it", () => {
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

  it("[SR-111/AK3] counts records alone, and shows nodes without evidence as a list", () => {
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

describe("renderHuman: on a terminal (#988)", () => {
  const terminal = { columns: 60, colors: true };
  const style = (format: Parameters<typeof styleText>[0], text: string): string =>
    styleText(format, text, { validateStream: false });
  /** The text as a terminal shows it, without the styles. */
  const seen = (styled: string): string => stripVTControlCharacters(styled);
  const element = (
    id: string,
    title: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id,
    repository: "system",
    shortId: `SR-${id}`,
    status: "draft",
    title,
    ...extra,
  });
  const at = (id: string, depth: number, parent?: string): Record<string, unknown> => ({
    id,
    repository: "system",
    depth,
    ...(parent === undefined ? {} : { parent: { id: parent, repository: "system" } }),
  });

  it("puts the identifier first, the status in a column and cuts the title to the width", () => {
    const output = {
      elements: [
        element("3c90b0", "Show wind", { identifier: "SR-36", status: "approved" }),
        element("a1", "A title much longer than the terminal is wide, so it ends cut"),
      ],
      total: 2,
    };
    const styled = renderHuman(output, true, terminal);
    expect(seen(styled)).toBe(
      lines(
        "elements:",
        "  SR-36 SR-3c90b0  approved  Show wind",
        "  SR-a1            draft     A title much longer than the t…",
        "total: 2",
      ),
    );
    expect(
      seen(styled)
        .split("\n")
        .every((line) => line.length <= terminal.columns),
    ).toBe(true);
    // The identifier strong, the short ID faint.
    expect(styled).toContain(`${style("bold", "SR-36")} ${style("dim", "SR-3c90b0")}`);
    // Plain text is never cut and keeps its form.
    expect(renderHuman(output)).toBe(
      lines(
        "elements:",
        "  SR-3c90b0 (SR-36)  approved  Show wind",
        "  SR-a1  draft  A title much longer than the terminal is wide, so it ends cut",
        "total: 2",
      ),
    );
  });

  it("shows the snippet of a search hit below its line, the marks core gives strong (SR-174)", () => {
    const output = {
      hits: [
        element("a1", "Show a dial", {
          snippet: { field: "text", text: "The dial shows wind.", marks: [{ start: 4, end: 8 }] },
        }),
        element("a2", "Warn", {
          snippet: {
            field: "properties",
            property: "checks",
            propertyName: "Checks",
            text: "It warns of a storm.",
            marks: [{ start: 14, end: 19 }],
          },
        }),
        element("a3", "Survive icing", { titleMarks: [{ start: 8, end: 13 }] }),
      ],
      total: 3,
    };
    const styled = renderHuman(output, true, terminal);
    expect(seen(styled)).toBe(
      lines(
        "hits:",
        "  SR-a1  draft  Show a dial",
        "    text: The dial shows wind.",
        "  SR-a2  draft  Warn",
        "    Checks: It warns of a storm.",
        "  SR-a3  draft  Survive icing",
        "total: 3",
      ),
    );
    expect(styled).toContain(`${style("dim", "text:")} The ${style("bold", "dial")} shows wind.`);
    // The marked words of the title strong too.
    expect(styled).toContain(`Survive ${style("bold", "icing")}`);
    // Cut to the width, a mark the cut ends strong up to it.
    const long = renderHuman(
      {
        hits: [
          element("a4", "Long", {
            snippet: {
              field: "text",
              text: `${"word ".repeat(9)}needle${"x".repeat(40)}`,
              marks: [{ start: 45, end: 91 }],
            },
          }),
        ],
      },
      true,
      terminal,
    );
    const line = seen(long).split("\n")[2] ?? "";
    expect(line).toBe(`    text: ${"word ".repeat(9)}need…`);
    expect(line.length).toBe(terminal.columns);
    expect(long).toContain(`${style("bold", "need")}…`);
    expect(renderHuman(output)).toBe(
      lines(
        "hits:",
        "  SR-a1  draft  Show a dial",
        "    text: The dial shows wind.",
        "  SR-a2  draft  Warn",
        "    Checks: It warns of a storm.",
        "  SR-a3  draft  Survive icing",
        "total: 3",
      ),
    );
  });

  it("keeps the title whole when even a cut one would not fit beside the marks", () => {
    const marks = { emergent: true, validation: "x".repeat(60) };
    expect(
      seen(renderHuman({ elements: [element("a1", "A long title of the element", marks)] }, true, terminal)),
    ).toBe(
      lines(
        "elements:",
        `  SR-a1  draft  A long title of the element  [emergent]  [validation: ${"x".repeat(60)}]`,
      ),
    );
  });

  it("never cuts the title of an element whose details follow, which do not repeat it", () => {
    const title = "A title much longer than the terminal is wide, so it would be cut";
    const one = { ...element("a1", title), file: "SR-1.md", text: "T.\n" };
    // element get: one element with its details.
    expect(seen(renderHuman({ element: one }, true, terminal)).split("\n")[0]).toBe(`SR-a1  draft  ${title}`);
    // A write command shows the line only: cut.
    expect(seen(renderHuman({ element: one }, false, terminal))).toBe(
      lines("SR-a1  draft  A title much longer than the terminal is wide…"),
    );
    // A list with texts (--with-text).
    expect(seen(renderHuman({ elements: [one] }, true, terminal)).split("\n")[1]).toBe(
      `  SR-a1  draft  ${title}`,
    );
  });

  it("shows one element on its line with its details below, as in plain text", () => {
    const one = { ...element("a1", "Show wind", { identifier: "SR-1" }), file: "SR-1.md", text: "T.\n" };
    expect(seen(renderHuman({ element: one }, true, terminal))).toBe(
      lines("SR-1 SR-a1  draft  Show wind", ...renderHuman({ element: one }).split("\n").slice(1, -1)),
    );
  });

  it("draws a tree list with tree lines, a parent not shown named after the title", () => {
    expect(
      seen(
        renderHuman(
          {
            elements: [
              element("a", "A"),
              element("b", "B"),
              element("c", "C"),
              element("d", "D"),
              element("e", "E"),
            ],
            tree: [at("a", 0), at("b", 1, "a"), at("c", 2, "b"), at("d", 1, "a"), at("e", 1, "x")],
          },
          true,
          terminal,
        ),
      ),
    ).toBe(
      lines(
        "elements:",
        "  SR-a      draft  A",
        "  ├ SR-b    draft  B",
        "  │ └ SR-c  draft  C",
        // A parent that is not shown starts a tree of its own: no line from the rows above.
        "  └ SR-d    draft  D",
        "  SR-e      draft  E  [under x]",
      ),
    );
  });

  it("draws an element whose parent is shown earlier under that parent, and the tree line beside details", () => {
    expect(
      seen(
        renderHuman(
          {
            elements: [
              element("a", "A", { text: "" }),
              element("b", "B", { text: "T.\n" }),
              element("x", "X", { text: "" }),
              element("d", "D", { text: "" }),
            ],
            tree: [at("a", 0), at("b", 1, "a"), at("x", 1, "y"), at("d", 1, "a")],
          },
          true,
          terminal,
        ),
      ),
    ).toBe(
      lines(
        "elements:",
        "  SR-a    draft  A",
        '    text: ""',
        "",
        "  ├ SR-b  draft  B",
        "  │   text: |",
        "  │     T.",
        "",
        "  SR-x    draft  X  [under y]",
        '    text: ""',
        "",
        "  └ SR-d  draft  D",
        '      text: ""',
      ),
    );
    // Places with a depth only: the parent is the nearest element a level above.
    expect(
      seen(
        renderHuman(
          {
            elements: [element("a", "A"), element("b", "B"), element("c", "C")],
            tree: [{ depth: 0 }, { depth: 1 }, { depth: 1 }],
          },
          true,
          terminal,
        ),
      ),
    ).toBe(lines("elements:", "  SR-a    draft  A", "  ├ SR-b  draft  B", "  └ SR-c  draft  C"));
  });

  it("heads each group at the left with a blank line before it, the columns as wide as the page", () => {
    const styled = renderHuman(
      {
        elements: [
          element("b1", "One", { identifier: "SR-168" }),
          element("b2", "Two", { status: "approved" }),
          element("n1", "Three", { text: "T.\n" }),
          element("n2", "Four"),
        ],
        tree: [at("b1", 0), at("b2", 0), at("n1", 0), at("n2", 1, "n1")],
        groups: [
          { value: "PKG-d1", identifier: "R1", title: "Wind", count: 2, offset: 0 },
          { value: "draft", name: "Draft", count: 1, offset: 2 },
          { value: "x", count: 3, offset: 3 },
          { value: "PKG-d2", identifier: "P2", count: 1, offset: 6 },
        ],
        offset: 0,
        rows: 7,
      },
      true,
      terminal,
    );
    expect(seen(styled)).toBe(
      lines(
        "Wind  R1 PKG-d1 · 2",
        "  SR-168 SR-b1  draft     One",
        "  SR-b2         approved  Two",
        "",
        "Draft  draft · 1",
        "  SR-n1         draft     Three",
        "    text: |",
        "      T.",
        "",
        "x  3",
        // Its parent is in another group: it starts a tree of its own.
        "  SR-n2         draft     Four  [under SR-n1]",
        "Showing 4 of 7; ask for more with --offset and --limit.",
      ),
    );
    expect(styled).toContain(`${style("bold", "Wind")}  ${style("dim", "R1 PKG-d1 · 2")}`);
    // A group by identifier only; the last group, continued, with targets not available.
    const groups = [
      { value: "PKG-d2", identifier: "P2", count: 1, offset: 0 },
      { unavailable: 1, count: 2, offset: 1 },
    ];
    expect(seen(renderHuman({ elements: [element("a", "A")], groups }, true, terminal))).toBe(
      lines("P2  PKG-d2 · 1", "  SR-a  draft  A"),
    );
    expect(seen(renderHuman({ elements: [element("b", "B")], groups, offset: 2 }, true, terminal))).toBe(
      lines("(no value)  2, 1 with targets not available, continued", "  SR-b  draft  B"),
    );
  });

  it("shows the severity of hints and problems first, coloured by it", () => {
    const hint = {
      code: "relation.too-few",
      severity: "warning",
      message: "Too few",
      elementShortId: "SR-a1",
      elementIdentifier: "SR-1",
      targetShortId: "N-b2",
      hintId: "h1",
    };
    const styled = renderHuman(
      {
        hints: [hint],
        problems: [
          { code: "x.error", severity: "error", message: "Broken" },
          { code: "x.info", severity: "info", message: "Note" },
          { code: "x.odd", severity: "odd", message: "Other" },
        ],
      },
      true,
      terminal,
    );
    expect(seen(styled)).toBe(
      lines(
        "hints:",
        "  warning  SR-1 SR-a1 → N-b2  relation.too-few  Too few  hint: h1",
        "error  x.error  Broken",
        "info  x.info  Note",
        "odd  x.odd  Other",
      ),
    );
    expect(styled).toContain(style("yellow", "warning"));
    expect(styled).toContain(style(["bold", "red"], "error"));
    expect(styled).toContain(style("cyan", "info"));
    expect(styled).toContain("\nodd  x.odd");
    expect(renderHuman({ hints: [hint] })).toBe(
      lines("hints:", "  SR-a1 (SR-1) → N-b2  relation.too-few  Too few  hint: h1"),
    );
    expect(renderHuman({ ok: true, problems: [] }, true, terminal)).toBe(
      `ok: true\n${style("dim", "No problems.")}\n`,
    );
  });

  it("leaves the shapes that #988 does not cover as in plain text", () => {
    const graph = {
      nodes: [element("a", "A", { level: 0 })],
      evidence: [{ id: "a", testCases: 1, records: 0, results: {} }],
    };
    expect(renderHuman(graph, true, terminal)).toBe(renderHuman(graph));
  });
});
