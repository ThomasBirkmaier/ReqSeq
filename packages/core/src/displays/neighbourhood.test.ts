import { describe, expect, it } from "vitest";
import type { NeighbourhoodAnswer } from "./neighbourhood.js";
import { neighbourhoodDisplay } from "./neighbourhood.js";

type Node = NeighbourhoodAnswer["nodes"][number];
type Edge = NeighbourhoodAnswer["edges"][number];

const METAMODEL = {
  relations: [{ key: "based-on", name: "Based on", "inverse-name": "Basis for" }],
  properties: [{ key: "packages", name: "Packages" }],
  statuses: [{ key: "obsolete", name: "Obsolete", invalid: true }],
};

const node = (name: string, depth: number, extra: Partial<Node> = {}): Node => ({
  id: name,
  shortId: `X-${name}`,
  type: "t",
  title: `Title ${name}`,
  repository: "spec",
  file: `${name}.md`,
  depth,
  expanded: true,
  ...(depth === 0 ? {} : { direction: "down" as const }),
  ...extra,
});

/** An edge; a field given as undefined is left out (an inline reference has no kind, a plain relation no meaning). */
const edge = (source: string, target: string, extra: Record<string, unknown> = {}): Edge => {
  const fields: Record<string, unknown> = {
    source,
    sourceRepository: "spec",
    target,
    targetRepository: "spec",
    link: "relation",
    kind: "derives-from",
    meaning: "derivation",
    direction: "down",
    cyclic: false,
    repeated: false,
    outdated: false,
    ...extra,
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as unknown as Edge;
};

const answer = (nodes: Node[], edges: Edge[], total = nodes.length): NeighbourhoodAnswer => ({
  nodes,
  edges,
  total,
});

const ALL = { bound: { parents: 100, children: 100, incoming: 100 }, open: "all" } as const;

describe("neighbourhoodDisplay, parents", () => {
  const up = { direction: "up" as const };
  it("[SR-107/AK-r2x1] gives the parents level by level, the topmost first, each level in node order", () => {
    const { parents } = neighbourhoodDisplay(
      {
        parents: answer(
          [node("E", 0), node("P1", 1, up), node("P2", 1, up), node("N", 2, up)],
          [edge("E", "P1", up), edge("E", "P2", up), edge("P1", "N", up)],
        ),
        metamodel: METAMODEL,
      },
      ALL,
    );
    expect(parents.rows.map((level) => level.map((parent) => [parent.ref.shortId, parent.depth]))).toEqual([
      [["X-N", 2]],
      [
        ["X-P1", 1],
        ["X-P2", 1],
      ],
    ]);
    expect(parents.more).toBe(false);
    expect(parents.rows[0]?.[0]?.key).toBe("spec:N");
  });

  it("[SR-107/AK-b9c5] notes every outdated link of a shown element to a parent, and none from an element not shown", () => {
    const { parents } = neighbourhoodDisplay(
      {
        parents: answer(
          [node("E", 0), node("P1", 1, up), node("N", 2, up)],
          [
            edge("E", "P1", { ...up, kind: "refines", outdated: true }),
            edge("E", "P1", { ...up, outdated: true }),
            edge("P1", "N", { ...up, outdated: true }),
            edge("Q", "N", { ...up, sourceRepository: "other", outdated: true }),
          ],
        ),
        metamodel: METAMODEL,
      },
      ALL,
    );
    expect(parents.rows.map((level) => level.map((parent) => parent.outdated))).toEqual([
      ["X-P1 points to an older version of X-N (derives-from)"],
      [
        "X-E points to an older version of X-P1 (refines); X-E points to an older version of X-P1 (derives-from)",
      ],
    ]);
  });

  it("[SR-232/AK-r9s3] shows the nearest parents within the bound and says when there are more", () => {
    const nodes = [node("E", 0), node("P1", 1, up), node("P2", 1, up), node("N", 2, up)];
    const bounded = neighbourhoodDisplay(
      { parents: answer(nodes, []), metamodel: METAMODEL },
      { ...ALL, bound: { ...ALL.bound, parents: 2 } },
    );
    expect(bounded.parents.rows.flat().map((parent) => parent.ref.id)).toEqual(["P1", "P2"]);
    expect(bounded.parents.more).toBe(true);
    // One page of a longer answer says so too.
    expect(
      neighbourhoodDisplay({ parents: answer(nodes, [], 9), metamodel: METAMODEL }, ALL).parents.more,
    ).toBe(true);
  });
});

describe("neighbourhoodDisplay, children", () => {
  /** E has the children S1 and S2; C1 is a child of both, D1 a child of C1 that the answer does not expand. */
  const tree = (): NeighbourhoodAnswer =>
    answer(
      [node("E", 0), node("S1", 1), node("S2", 1), node("C1", 2), node("D1", 3, { expanded: false })],
      [
        edge("S1", "E"),
        edge("S2", "E", { outdated: true }),
        edge("C1", "S1"),
        edge("C1", "S2", { repeated: true }),
        edge("D1", "C1"),
      ],
    );
  const summary = (rows: ReturnType<typeof neighbourhoodDisplay>["children"]["rows"]) =>
    rows.map((row) => [row.ref.id, row.level, row.repeated, row.expandable, row.opened, row.parent]);

  it("[SR-107/AK-bhct] [SR-107/AK-ntyw] shows the tree depth first, a repeated child as a leaf, every row open for the export", () => {
    const { children } = neighbourhoodDisplay({ children: tree(), metamodel: METAMODEL }, ALL);
    expect(summary(children.rows)).toEqual([
      ["S1", 1, false, true, true, undefined],
      ["C1", 2, false, true, true, 0],
      ["D1", 3, false, undefined, true, 1],
      ["S2", 1, false, true, true, undefined],
      ["C1", 2, true, false, false, 3],
    ]);
    expect(children.rows[3]?.outdated).toBe("X-S2 points to an older version of X-E (derives-from)");
    expect(children.more).toBe(false);
  });

  it("opens only the rows the reader opened, and draws only the shown elements", () => {
    const closed = neighbourhoodDisplay(
      { children: tree(), metamodel: METAMODEL },
      { ...ALL, open: ["spec:S2"] },
    );
    expect(summary(closed.children.rows)).toEqual([
      ["S1", 1, false, true, false, undefined],
      ["S2", 1, false, true, true, undefined],
      ["C1", 2, true, false, false, 1],
    ]);
    const bounded = neighbourhoodDisplay(
      { children: tree(), metamodel: METAMODEL },
      { ...ALL, bound: { ...ALL.bound, children: 2 } },
    );
    expect(summary(bounded.children.rows)).toEqual([
      ["S1", 1, false, false, true, undefined],
      ["S2", 1, false, false, true, undefined],
    ]);
    expect(bounded.children.more).toBe(true);
  });

  it("leaves out a link of another direction from the tree", () => {
    const { children } = neighbourhoodDisplay(
      {
        children: answer(
          [node("E", 0), node("S1", 1)],
          [edge("S1", "E"), edge("E", "S1", { direction: "up" })],
        ),
        metamodel: METAMODEL,
      },
      ALL,
    );
    expect(summary(children.rows)).toEqual([["S1", 1, false, false, true, undefined]]);
  });

  it("[SR-107/AK-ntyw] shows the element itself as a repeated leaf where a cycle of derivations leads back to it", () => {
    const { children } = neighbourhoodDisplay(
      {
        children: answer(
          [node("E", 0), node("S1", 1)],
          [edge("S1", "E"), edge("E", "S1", { repeated: true })],
        ),
        metamodel: METAMODEL,
      },
      ALL,
    );
    expect(summary(children.rows)).toEqual([
      ["S1", 1, false, true, true, undefined],
      ["E", 2, true, false, false, 0],
    ]);
  });

  it("[SR-232/AK-kycg] marks a child with an invalid status and goes on through it", () => {
    const { children } = neighbourhoodDisplay(
      {
        children: answer(
          [node("E", 0), node("G", 1, { status: "obsolete" }), node("A", 2)],
          [edge("G", "E"), edge("A", "G")],
        ),
        metamodel: METAMODEL,
      },
      ALL,
    );
    expect(children.rows.map((row) => [row.ref.id, row.ref.invalid, row.ref.status])).toEqual([
      ["G", true, "obsolete"],
      ["A", false, undefined],
    ]);
  });
});

describe("neighbourhoodDisplay, incoming", () => {
  it("[SR-107/AK-bhct] groups the incoming links by key in the order they first appear, headed by their names, without derivations", () => {
    const { incoming } = neighbourhoodDisplay(
      {
        incoming: answer(
          [node("E", 0), node("U", 1), node("V", 1), node("C", 1)],
          [
            edge("U", "E", { kind: "based-on", meaning: undefined, outdated: true }),
            edge("V", "E", { link: "reference", kind: undefined, meaning: "reference" }),
            edge("C", "E"),
            edge("V", "E", { kind: "based-on", meaning: undefined }),
            edge("U", "E", { kind: "packages", property: true, meaning: undefined }),
            edge("W", "E", { kind: "based-on", meaning: undefined }),
          ],
        ),
        metamodel: METAMODEL,
      },
      ALL,
    );
    expect(incoming.rows.map((group) => [group.label, group.entries.map((entry) => entry.ref.id)])).toEqual([
      ["← Basis for", ["U", "V"]],
      ["← inline reference", ["V"]],
      ["← Packages", ["U"]],
    ]);
    expect(incoming.rows[0]?.entries[0]?.outdated).toBe("X-U points to an older version of X-E (based-on)");
    expect(incoming.rows[0]?.key).toBe("kind:based-on");
  });

  it("[SR-107/AK-ngy7] keeps a reference of the element to itself as an incoming group", () => {
    const { incoming } = neighbourhoodDisplay(
      {
        incoming: answer(
          [node("E", 0)],
          [edge("E", "E", { link: "reference", kind: undefined, meaning: undefined })],
        ),
        metamodel: METAMODEL,
      },
      ALL,
    );
    expect(incoming.rows.map((group) => [group.label, group.entries.map((entry) => entry.ref.id)])).toEqual([
      ["← inline reference", ["E"]],
    ]);
  });

  it("names an end that is not on the page by its UUID, and is empty without an answer", () => {
    const { incoming } = neighbourhoodDisplay(
      {
        incoming: answer(
          [node("U", 1)],
          [
            edge("U", "E", { kind: "based-on", meaning: undefined, outdated: true }),
            edge("U", "E", { link: "reference", kind: undefined, meaning: undefined, outdated: true }),
          ],
        ),
        metamodel: METAMODEL,
      },
      ALL,
    );
    expect(incoming.rows[0]?.entries[0]?.outdated).toBe("X-U points to an older version of E (based-on)");
    expect(incoming.rows[1]?.entries[0]?.outdated).toBe(
      "X-U points to an older version of E (inline reference)",
    );
    expect(neighbourhoodDisplay({ metamodel: METAMODEL }, ALL)).toEqual({
      parents: { rows: [], more: false },
      children: { rows: [], more: false },
      incoming: { rows: [], more: false },
    });
  });
});

describe("neighbourhoodDisplay on a package page (SR-232 AK9)", () => {
  /** P is the package: M names it and refers to it, G (invalid status) names it, U is based on it. */
  const members = (others: boolean): NeighbourhoodAnswer =>
    answer(
      [node("P", 0), node("M", 1), node("G", 1, { status: "obsolete" }), node("U", 1)],
      [
        edge("M", "P", { kind: "packages", property: true, meaning: undefined, outdated: true }),
        edge("G", "P", { kind: "packages", property: true, meaning: undefined }),
        ...(others
          ? [
              edge("U", "P", { kind: "based-on", meaning: undefined }),
              edge("M", "P", { link: "reference", kind: undefined, meaning: "reference" }),
            ]
          : []),
      ],
    );
  const groups = (others: boolean, withoutPackageMembers: string | undefined) =>
    neighbourhoodDisplay(
      { incoming: members(others), metamodel: METAMODEL },
      { ...ALL, withoutPackageMembers },
    ).incoming.rows.map((group) => [group.label, group.entries.map((entry) => entry.ref.id)]);

  it("[SR-232/AK-chx5] leaves out the group of the packages property with its rows, also of an invalid status, and keeps every other group", () => {
    expect(groups(true, "packages")).toEqual([
      ["← Basis for", ["U"]],
      ["← inline reference", ["M"]],
    ]);
  });

  it("[SR-232/AK-chx5] has no incoming group when package membership is the only incoming link", () => {
    expect(groups(false, "packages")).toEqual([]);
  });

  it("[SR-232/AK-chx5] keeps the group without the option, as on the page of an element that is no package", () => {
    expect(groups(false, undefined)).toEqual([["← Packages", ["M", "G"]]]);
    expect(groups(true, "based-on")).toContainEqual(["← Packages", ["M", "G"]]);
  });
});
