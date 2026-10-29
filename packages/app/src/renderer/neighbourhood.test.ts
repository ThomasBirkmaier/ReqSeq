import type { TraceNeighbourhoodOutput } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { NO_ROW, elementBuffer, neighbourhoodBuffer } from "./buffers.js";
import {
  fetchDepth,
  incomingGroups,
  incomingInput,
  parentLevels,
  parentsInput,
  treeInput,
  treeRows,
} from "./neighbourhood.js";

// The data of fixtures/SR-107/neighbourhood: needs N1 and N2; requirements S1 and S2 derive from N1, S2
// also from N2; the component requirement C1 derives from S1 and S2.
const node = (name: string, depth: number, extra: object = {}) => ({
  id: `uuid-${name}`,
  shortId: `X-${name}`,
  identifier: name,
  type: "t",
  title: `Title ${name}`,
  status: "draft",
  repository: "spec",
  file: `${name}.md`,
  depth,
  expanded: true,
  ...extra,
});

const edge = (source: string, target: string, extra: object = {}) => ({
  source: `uuid-${source}`,
  sourceRepository: "spec",
  target: `uuid-${target}`,
  targetRepository: "spec",
  link: "relation",
  kind: "derives-from",
  meaning: "derivation",
  direction: "down",
  cyclic: false,
  repeated: false,
  outdated: false,
  ...extra,
});

const answer = (
  nodes: object[],
  edges: object[],
  extra: Partial<TraceNeighbourhoodOutput> = {},
): TraceNeighbourhoodOutput =>
  ({
    root: (nodes[0] as { id: string }).id,
    nodes,
    total: nodes.length,
    edges,
    incomplete: false,
    ...extra,
  }) as unknown as TraceNeighbourhoodOutput;

const up = (extra: object = {}) => ({ direction: "up", ...extra });

/** The children of N1 as `trace.neighbourhood` gives them for two levels. */
const children = (): TraceNeighbourhoodOutput =>
  answer(
    [
      node("N1", 0),
      node("S1", 1, { direction: "down" }),
      node("S2", 1, { direction: "down" }),
      node("C1", 2, { direction: "down", expanded: false }),
    ],
    [edge("S1", "N1"), edge("S2", "N1"), edge("C1", "S1"), edge("C1", "S2", { repeated: true })],
  );

const summary = (rows: ReturnType<typeof treeRows>["rows"]) =>
  rows.map((row) => [
    row.row.label,
    row.level,
    row.row.depth,
    row.repeated,
    row.expandable,
    row.opened,
    row.parent,
  ]);

describe("the inputs", () => {
  const subject = { id: "uuid-N1", repository: "spec" };

  it("name the element by its UUID and repository, so a UUID in two repositories is not ambiguous", () => {
    expect(parentsInput(subject)).toEqual({
      ref: "uuid-N1",
      repository: "spec",
      direction: "up",
      meanings: ["derivation"],
      allLevels: true,
      limit: 200,
    });
    expect(treeInput(subject, 3)).toEqual({
      ref: "uuid-N1",
      repository: "spec",
      direction: "down",
      meanings: ["derivation"],
      maxDepth: 3,
      limit: 5000,
    });
    expect(incomingInput(subject)).toEqual({
      ref: "uuid-N1",
      repository: "spec",
      direction: "down",
      maxDepth: 1,
      limit: 5000,
    });
  });

  it("make the buffer of a neighbourhood with its own key and name", () => {
    expect(neighbourhoodBuffer("uuid-N1", "spec", "N1 Title N1")).toEqual({
      kind: "neighbourhood",
      key: "neighbourhood:spec:uuid-N1",
      id: "uuid-N1",
      repository: "spec",
      name: "N1 Title N1",
      open: [],
      cursor: NO_ROW,
    });
  });
});

describe("parentLevels", () => {
  const parents = (extra: object = {}): TraceNeighbourhoodOutput =>
    answer(
      [node("C1", 0), node("S1", 1, up()), node("S2", 1, up()), node("N1", 2, up()), node("N2", 2, up())],
      [
        edge("C1", "S1", up()),
        edge("C1", "S2", up()),
        edge("S1", "N1", up()),
        edge("S2", "N1", up({ repeated: true })),
        edge("S2", "N2", up()),
      ],
      extra,
    );

  it("[SR-107/AK1] lists the parents level by level, from the top needs down to the direct parents", () => {
    const { levels, more } = parentLevels(parents());
    expect(levels.map((level) => level.map((parent) => parent.name))).toEqual([
      ["Title N1", "Title N2"],
      ["Title S1", "Title S2"],
    ]);
    expect(levels[0]?.map((parent) => parent.label)).toEqual(["N1", "N2"]);
    expect(levels[0]?.[0]?.open).toEqual(elementBuffer("uuid-N1", "spec", "N1 Title N1"));
    expect(more).toBe(false);
  });

  it("has no levels for an element without parents, and leaves out the element itself", () => {
    expect(parentLevels(answer([node("N1", 0)], [])).levels).toEqual([]);
  });

  it("names a parent without a title by its ID, and marks that more parents exist than were asked for", () => {
    const output = answer([node("C1", 0), node("S1", 1, up({ title: "", identifier: undefined }))], [], {
      total: 300,
    });
    const { levels, more } = parentLevels(output);
    expect(levels[0]?.[0]?.name).toBe("X-S1");
    expect(more).toBe(true);
  });

  it("[SR-107/AK4] marks a parent whose link from the element is outdated, and no other", () => {
    const { levels } = parentLevels(
      answer(
        [node("C1", 0), node("S1", 1, up()), node("N1", 2, up())],
        [edge("C1", "S1", up({ outdated: true })), edge("S1", "N1", up({ outdated: true }))],
      ),
    );
    expect(levels.map((level) => level.map((parent) => parent.outdated))).toEqual([[false], [true]]);
  });
});

describe("treeRows", () => {
  it("[SR-107/AK2] shows the direct children, and the next level only below an opened row, indented by level", () => {
    const closed = treeRows(children(), []);
    expect(summary(closed.rows)).toEqual([
      ["S1", 1, 0, false, true, false, undefined],
      ["S2", 1, 0, false, true, false, undefined],
    ]);
    const opened = treeRows(children(), ["spec:uuid-S1"]);
    expect(summary(opened.rows)).toEqual([
      ["S1", 1, 0, false, true, true, undefined],
      // The tree was cut below this level: whether C1 has children is not known yet.
      ["C1", 2, 1, false, undefined, false, 0],
      ["S2", 1, 0, false, true, false, undefined],
    ]);
    expect(opened.rows[1]?.row.open).toEqual(elementBuffer("uuid-C1", "spec", "C1 Title C1"));
    expect(opened.cut).toBe(false);
  });

  it("[SR-107/AK3] shows a child under each parent, marks the second one repeated and never opens it", () => {
    const both = treeRows(children(), ["spec:uuid-S1", "spec:uuid-S2", "spec:uuid-C1"]);
    expect(summary(both.rows)).toEqual([
      ["S1", 1, 0, false, true, true, undefined],
      ["C1", 2, 1, false, undefined, true, 0],
      ["S2", 1, 0, false, true, true, undefined],
      ["C1", 2, 1, true, false, false, 2],
    ]);
  });

  it("[SR-107/AK4] marks an outdated link as outdated", () => {
    const output = answer(
      [node("N1", 0), node("S1", 1, { direction: "down" })],
      [edge("S1", "N1", { outdated: true })],
    );
    expect(treeRows(output, []).rows.map((row) => row.outdated)).toEqual([true]);
    expect(treeRows(children(), []).rows.map((row) => row.outdated)).toEqual([false, false]);
  });

  it("knows a row without children as a leaf, and shows nothing for an element without children", () => {
    const output = answer([node("N1", 0), node("S1", 1, { direction: "down" })], [edge("S1", "N1")]);
    expect(treeRows(output, []).rows.map((row) => row.expandable)).toEqual([false]);
    expect(treeRows(answer([node("N1", 0)], []), []).rows).toEqual([]);
  });

  it("keeps the order of the walk, with no sort of its own", () => {
    const output = answer(
      [
        node("N1", 0),
        node("S9", 1, { direction: "down" }),
        node("S1", 1, { direction: "down" }),
        node("S5", 1, { direction: "down" }),
      ],
      [edge("S9", "N1"), edge("S1", "N1"), edge("S5", "N1")],
    );
    expect(treeRows(output, []).rows.map((row) => row.row.label)).toEqual(["S9", "S1", "S5"]);
  });

  it("says when the answer holds only the first nodes, and skips an edge whose node is not on the page", () => {
    const output = answer(
      [node("N1", 0), node("S1", 1, { direction: "down" })],
      [edge("S1", "N1"), edge("S2", "N1")],
      { total: 5000 + 2 },
    );
    const tree = treeRows(output, []);
    expect(tree.cut).toBe(true);
    expect(tree.rows.map((row) => row.row.label)).toEqual(["S1"]);
  });
});

describe("fetchDepth", () => {
  it("[SR-107/AK2] asks for two levels, and for one more than the deepest opened row has", () => {
    expect(fetchDepth([])).toBe(2);
    expect(fetchDepth(treeRows(children(), []).rows)).toBe(2);
    expect(fetchDepth(treeRows(children(), ["spec:uuid-S1"]).rows)).toBe(3);
    expect(fetchDepth(treeRows(children(), ["spec:uuid-S1", "spec:uuid-C1"]).rows)).toBe(4);
  });

  it("does not count a row that is open but hidden below a closed one", () => {
    expect(fetchDepth(treeRows(children(), ["spec:uuid-C1"]).rows)).toBe(2);
  });
});

describe("incomingGroups", () => {
  const incoming = (): TraceNeighbourhoodOutput =>
    answer(
      [
        node("S1", 0),
        node("C1", 1, { direction: "down" }),
        node("V1", 1, { direction: "down" }),
        node("E", 1, { direction: "down" }),
      ],
      [
        edge("C1", "S1"),
        edge("V1", "S1", { kind: "excludes", meaning: "exclusion" }),
        edge("E", "S1", { link: "reference", kind: undefined, meaning: "reference" }),
        edge("E", "S1", { kind: "excludes", meaning: "exclusion" }),
      ],
    );

  it("[SR-107/AK2] groups the incoming relations and references by kind and leaves out the derivations", () => {
    const { groups, cut } = incomingGroups(incoming());
    expect(groups.map((group) => [group.heading, group.entries.map((entry) => entry.row.label)])).toEqual([
      ["← excludes", ["V1", "E"]],
      ["← inline reference", ["E"]],
    ]);
    expect(cut).toBe(false);
  });

  it("[SR-107/AK2] lists the members of a package under ← packages", () => {
    const output = answer(
      [node("P1", 0), node("S1", 1, { direction: "down" }), node("S2", 1, { direction: "down" })],
      [
        edge("S1", "P1", { kind: "packages", meaning: undefined, property: true }),
        edge("S2", "P1", { kind: "packages", meaning: undefined, property: true }),
      ],
    );
    const { groups } = incomingGroups(output);
    expect(groups.map((group) => [group.heading, group.entries.map((entry) => entry.row.label)])).toEqual([
      ["← packages", ["S1", "S2"]],
    ]);
  });

  it("[SR-107/AK4] marks an outdated relation and an outdated reference", () => {
    const output = answer(
      [node("D2", 0), node("E", 1, { direction: "down" }), node("S1", 1, { direction: "down" })],
      [
        edge("E", "D2", { link: "reference", kind: undefined, meaning: "reference", outdated: true }),
        edge("S1", "D2", { kind: "based-on", meaning: undefined }),
      ],
    );
    const { groups } = incomingGroups(output);
    expect(groups.map((group) => group.entries.map((entry) => entry.outdated))).toEqual([[true], [false]]);
  });

  it("has no groups for an element nothing points at, and says when the answer is cut", () => {
    expect(incomingGroups(answer([node("S1", 0)], [])).groups).toEqual([]);
    // The node of the edge is not on the page of a cut answer.
    const cut = answer([node("S1", 0)], [edge("V1", "S1", { kind: "excludes", meaning: "exclusion" })], {
      total: 6000,
    });
    expect(incomingGroups(cut)).toEqual({ groups: [], cut: true });
  });
});
