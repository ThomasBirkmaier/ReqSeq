import { describe, expect, it } from "vitest";
import { renderHuman } from "../present.js";
import { lines, node } from "../present.test-helper.js";

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

  it("[SR-205/AK-npsp] [SR-205/AK-wyyz] shows each criterion of element get with its number, key and reference, and resolve's criterion", () => {
    const properties = {
      "acceptance-criteria": [{ key: "kred", text: "Given a reading." }, "Given none."],
      "requirement-type": "functional",
    };
    const criterionReferences = {
      property: "acceptance-criteria",
      criteria: [
        { criterion: 1, key: "kred", text: "Given a reading.", reference: "[SR-036/AK-kred]" },
        { criterion: 2, text: "Given none." },
      ],
    };
    const shown = { ...element, relations: [], problems: [], properties };
    const output = renderHuman({ element: shown, criterionReferences });
    expect(output).toContain(
      lines(
        "  properties:",
        "    acceptance-criteria:",
        "      AK1 (kred) [SR-036/AK-kred]: Given a reading.",
        "      AK2: Given none.",
        "    requirement-type: functional",
      ),
    );
    expect(output).not.toContain("criterionReferences");
    expect(
      renderHuman({ element: shown, criterion: criterionReferences.criteria[0], current: null }, false),
    ).toBe(
      lines(
        "SR-1  draft  Show wind",
        "criterion: AK1 (kred) [SR-036/AK-kred]: Given a reading.",
        "current: null",
      ),
    );
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

  it("[SR-031/AK-fnvr] shows the verification status per view after the title, apart from the element's own status", () => {
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
  it("[SR-031/AK-yscc] shows how many acceptance criteria are verified and which are not", () => {
    const elements = [
      requirement("1", [
        {
          view: "core",
          status: "open",
          criteria: { verified: 2, total: 3, notVerified: [{ criterion: 3 }] },
        },
        { view: "v1", status: "verified", criteria: { verified: 3, total: 3 } },
      ]),
      requirement("2", [
        {
          view: "core",
          status: "failed",
          criteria: { verified: 0, total: 2, notVerified: [{ criterion: 1 }, { criterion: 2 }] },
        },
      ]),
      { id: "v1", shortId: "VAR-1", title: "Pro", status: "draft" },
    ];
    expect(renderHuman({ elements, total: 3 })).toBe(
      lines(
        "elements:",
        "  SR-1  approved  Title 1  [verification: core open, 2 of 3 criteria, AK3 not verified, VAR-1 verified, 3 of 3 criteria]",
        "  SR-2  approved  Title 2  [verification: core failed, 0 of 2 criteria, AK1, AK2 not verified]",
        "  VAR-1  draft  Pro",
        "total: 3",
      ),
    );
  });
});

describe("renderHuman: indirect verification (SR-034)", () => {
  it("[SR-034/AK-hk8z] names the missing children after the status of their view: short ID from the list, else from the relations, else UUID", () => {
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

  it("[SR-034/AK-kkxv] shows indirect on the line of one element", () => {
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

  it("[SR-036/AK-xbxh] prints the elements behind the coverage numbers by short ID, identifier and title, not names itself", () => {
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

  it("[SR-034/AK-hk8z] names missing children and variants in the verification status by short ID and identifier", () => {
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
  it("[SR-038/AK-w0j6] shows the validation status in its own bracket after the verification status", () => {
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

  it("[SR-172/AK-j3vg] shows an inconclusive validation with its reason on one line, cut when long, not again in the details", () => {
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

  it("[SR-037/AK-zxtb] shows the share of a verification degree as 60 % and the count per status", () => {
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
  it("[SR-035/AK-k81y] shows [emergent] after the title, before the verification status, and only for a marked element", () => {
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
