import { stripVTControlCharacters, styleText } from "node:util";
import { describe, expect, it } from "vitest";
import { renderHuman } from "./present.js";
import { lines } from "./present.test-helper.js";

describe("renderHuman: the answer (SR-224 AK2)", () => {
  it("[SR-224/AK-tjmm] prints the answer of core as the first line, before every other line, on a terminal too", () => {
    const output = {
      answer: "Created Need N-7fe707; 1 file written.",
      files: ["need/N-0000007fe707.md"],
      problems: [],
    };
    expect(renderHuman(output, false)).toBe(
      lines("Created Need N-7fe707; 1 file written.", "files:", "  need/N-0000007fe707.md", "No problems."),
    );
    const styled = renderHuman(output, false, { columns: 80, colors: true });
    expect(stripVTControlCharacters(styled).split("\n")[0]).toBe("Created Need N-7fe707; 1 file written.");
  });
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

  it("prints any number of lines, more than fit into the arguments of one call (#1786)", () => {
    const testCases = Array.from({ length: 300_000 }, (_, i) => `case ${String(i)}`);
    const shown = renderHuman({ testCases }).split("\n");
    expect(shown).toHaveLength(300_002);
    expect(shown.at(-2)).toBe("  case 299999");
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

  it("shows a list of counted elements on one line of short IDs, cut after 10, at any depth (SR-224 AK4)", () => {
    const counted = (n: number): { id: string; shortId: string; repository: string }[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `61061061-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
        shortId: `SR-0000${String(i).padStart(2, "0")}`,
        repository: "system",
      }));
    expect(renderHuman({ exported: 2, exportedElements: counted(2), unchangedElements: [] })).toBe(
      lines("exported: 2", "exportedElements: SR-000000, SR-000001", "unchangedElements: none"),
    );
    const cut = `${counted(10)
      .map((e) => e.shortId)
      .join(", ")} … and 2 more (--yaml lists them)`;
    expect(renderHuman({ exportedElements: counted(12) })).toBe(lines(`exportedElements: ${cut}`));
    expect(renderHuman({ baseline: { elements: 12, entries: counted(12) } })).toBe(
      lines("baseline:", "  elements: 12", `  entries: ${cut}`),
    );
    // Another field beside the three is no counted element; a nested empty list stays as YAML.
    expect(renderHuman({ baseline: { entries: [], more: [{ ...counted(1)[0], title: "T" }] } })).toContain(
      "  entries: []\n",
    );
    expect(renderHuman({ more: [{ id: "x", shortId: "SR-1", repository: 1 }] })).toBe(
      lines("more:", "  - id: x", "    shortId: SR-1", "    repository: 1"),
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

  it("[SR-084/AK-c2s2] prints the identifier in brackets behind the short ID, and the short ID alone without one", () => {
    expect(
      renderHuman({
        elements: [
          { shortId: "SR-3c90b0", identifier: "SR-036", status: "draft", title: "One" },
          { shortId: "SR-3c90b1", status: "draft", title: "Two" },
        ],
        total: 2,
      }),
    ).toBe(lines("elements:", "  SR-3c90b0 (SR-036)  draft  One", "  SR-3c90b1  draft  Two", "total: 2"));
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
          // A list with criterion keys shows each criterion as `AK2 (keyc)`, as element get does (SR-205 AK1),
          // and a key in another form as none.
          "acceptance-criteria": [
            "Given a, then b.",
            { key: "keyc", text: "Given c, then d." },
            { key: "BAD", text: "Given e, then f." },
          ],
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
        "        AK1: Given a, then b.",
        "        AK2 (keyc): Given c, then d.",
        "        AK3: Given e, then f.",
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

  it("[SR-075/AK-f889] shows a tree list indented by depth, naming a parent that is not shown before", () => {
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

  it("[SR-149/AK-yrzz] shows a grouped list under a heading per group with its value and count", () => {
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

  it("[SR-149/AK-byyt] shows grouped search hits under their headings, each with its snippet", () => {
    const hit = (id: string, title: string, snippet?: Record<string, unknown>): Record<string, unknown> => ({
      id,
      repository: "system",
      shortId: `SR-${id}`,
      type: "system-requirement",
      status: "draft",
      title,
      score: 1,
      fields: ["text"],
      terms: ["wind"],
      ...(snippet === undefined ? {} : { snippet }),
    });
    const snippet = { field: "text", text: "the wind blows", marks: [{ start: 4, end: 8 }] };
    expect(
      renderHuman({
        hits: [hit("b2", "Two", snippet), hit("b1", "One")],
        groups: [
          { value: "PKG-d1", title: "Wind", count: 1, offset: 0 },
          { count: 1, offset: 1 },
        ],
        offset: 0,
        rows: 2,
        total: 2,
        incomplete: false,
      }),
    ).toBe(
      lines(
        "hits:",
        "  PKG-d1  Wind · 1",
        "    SR-b2  draft  Two",
        "      text: the wind blows",
        "  (no value) · 1",
        "    SR-b1  draft  One",
        "total: 2",
      ),
    );
  });

  it("[SR-149/AK-yrzz] shows each group of a grouped tree as its own tree, with texts", () => {
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

  it("names the titles of element and target, after the counts per kind (SR-026 AK6)", () => {
    expect(
      renderHuman({
        kinds: [
          { code: "relation.target-superseded", count: 2 },
          { code: "trace.cycle", count: 0 },
        ],
        hints: [
          {
            code: "relation.target-superseded",
            severity: "warning",
            message: "Points to a superseded decision",
            file: "c.md",
            elementShortId: "D-589cf2",
            elementIdentifier: "D-017",
            elementTitle: "Log in",
            targetShortId: "D-fd8f46",
            targetTitle: "Old login",
          },
          {
            code: "relation.target-superseded",
            severity: "warning",
            message: "Points to a superseded decision",
            file: "d.md",
            elementShortId: "D-a1",
            elementTitle: "",
            targetShortId: "D-fd8f46",
            targetTitle: "Old login",
          },
          // The view of outdated evidence, and a title written over lines on one line.
          {
            code: "evidence.outdated",
            severity: "warning",
            message: "Outdated",
            file: "e.md",
            elementShortId: "SR-b2",
            elementTitle: "Warn\nof\tstorms ",
            view: "core",
          },
        ],
        total: 2,
        incomplete: false,
      }),
    ).toBe(
      lines(
        "kinds:",
        "  - code: relation.target-superseded",
        "    count: 2",
        "  - code: trace.cycle",
        "    count: 0",
        "hints:",
        "  D-589cf2 (D-017)  Log in → D-fd8f46  Old login  relation.target-superseded  Points to a superseded decision",
        "  D-a1 → D-fd8f46  Old login  relation.target-superseded  Points to a superseded decision",
        "  SR-b2  Warn of storms  evidence.outdated  Outdated  view: core",
        "total: 2",
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

  it("[SR-084/AK-c2s2] puts the identifier in brackets behind the short ID, the status in a column and cuts the title to the width", () => {
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
        "  SR-3c90b0 (SR-36)  approved  Show wind",
        "  SR-a1              draft     A title much longer than the…",
        "total: 2",
      ),
    );
    expect(
      seen(styled)
        .split("\n")
        .every((line) => line.length <= terminal.columns),
    ).toBe(true);
    // The short ID strong, the identifier faint.
    expect(styled).toContain(`${style("bold", "SR-3c90b0")} ${style("dim", "(SR-36)")}`);
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

  it("[SR-222/AK-h8py] names the number and key of the criterion a snippet stands in, the key strong when core marks it", () => {
    const criterion = (tail: string, found: Record<string, unknown>) =>
      element(tail, "Gust alarm", {
        snippet: {
          field: "properties",
          property: "acceptance-criteria",
          propertyName: "Acceptance Criteria",
          text: "Given a gust, then the alarm sounds.",
          marks: [],
          ...found,
        },
      });
    const output = {
      hits: [
        criterion("a1", { criterion: { criterion: 3, key: "rqjp", keyMarked: true } }),
        criterion("a2", { criterion: { criterion: 2, key: "k7f3" } }),
        criterion("a3", { criterion: { criterion: 1 } }),
      ],
      total: 3,
    };
    expect(renderHuman(output)).toBe(
      lines(
        "hits:",
        "  SR-a1  draft  Gust alarm",
        "    Acceptance Criteria AK3 (rqjp): Given a gust, then the alarm sounds.",
        "  SR-a2  draft  Gust alarm",
        "    Acceptance Criteria AK2 (k7f3): Given a gust, then the alarm sounds.",
        "  SR-a3  draft  Gust alarm",
        "    Acceptance Criteria AK1: Given a gust, then the alarm sounds.",
        "total: 3",
      ),
    );
    const styled = renderHuman(output, true, terminal);
    expect(styled).toContain(
      `${style("dim", "Acceptance Criteria AK3 (")}${style("bold", "rqjp")}${style("dim", "):")} Given`,
    );
    expect(styled).toContain(
      `${style("dim", "Acceptance Criteria AK2 (")}${style("dim", "k7f3")}${style("dim", "):")} Given`,
    );
    expect(styled).toContain(`${style("dim", "Acceptance Criteria AK1:")} Given`);
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
      lines("SR-a1 (SR-1)  draft  Show wind", ...renderHuman({ element: one }).split("\n").slice(1, -1)),
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
        "Wind  PKG-d1 (R1) · 2",
        "  SR-b1 (SR-168)  draft     One",
        "  SR-b2           approved  Two",
        "",
        "Draft  draft · 1",
        "  SR-n1           draft     Three",
        "    text: |",
        "      T.",
        "",
        "x  3",
        // Its parent is in another group: it starts a tree of its own.
        "  SR-n2           draft     Four  [under SR-n1]",
        "Showing 4 of 7; ask for more with --offset and --limit.",
      ),
    );
    expect(styled).toContain(`${style("bold", "Wind")}  ${style("dim", "PKG-d1 (R1) · 2")}`);
    // A group by identifier only; the last group, continued, with targets not available.
    const groups = [
      { value: "PKG-d2", identifier: "P2", count: 1, offset: 0 },
      { unavailable: 1, count: 2, offset: 1 },
    ];
    expect(seen(renderHuman({ elements: [element("a", "A")], groups }, true, terminal))).toBe(
      lines("PKG-d2 (P2)  1", "  SR-a  draft  A"),
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
        "  warning  SR-a1 (SR-1) → N-b2  relation.too-few  Too few  hint: h1",
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
