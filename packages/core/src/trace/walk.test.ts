import { describe, expect, it } from "vitest";
import { makeSnapshot } from "../files/snapshot.js";
import type { ElementRecord } from "../model/index.js";
import type { Expand, Expansion, GraphEdge, UnresolvedState, WalkResult } from "./walk.js";
import { cyclesOf, pathTo, walk } from "./walk.js";

/** A record named `name` (its id), enough for the walk, which compares records by identity. */
const record = (name: string): ElementRecord => ({
  id: name,
  type: "need",
  repository: "system",
  file: `${name}.md`,
  data: {},
  eol: "\n",
  closingEol: "\n",
  bom: false,
  snapshot: makeSnapshot(`${name}.md`, 0, 0, ""),
});

type Graph = Readonly<Record<string, readonly string[]>>;

/** Records for the names of a graph and an `expand` that steps along its edges (link: "from>to"). */
const graphOf = (
  graph: Graph,
  extra: (name: string) => Partial<Expansion<string>> = () => ({}),
): {
  readonly r: (name: string) => ElementRecord;
  readonly expand: Expand<string>;
  readonly calls: string[];
} => {
  const records = new Map<string, ElementRecord>();
  const r = (name: string): ElementRecord => {
    let found = records.get(name);
    if (found === undefined) {
      found = record(name);
      records.set(name, found);
    }
    return found;
  };
  const calls: string[] = [];
  const expand: Expand<string> = (element, depth) => {
    calls.push(`${element.id}@${String(depth)}`);
    return {
      steps: (graph[element.id] ?? []).map((to) => ({ to: r(to), link: `${element.id}>${to}` })),
      unresolved: [],
      incomplete: false,
      ...extra(element.id),
    };
  };
  return { r, expand, calls };
};

const names = (result: WalkResult<string, unknown>): string[][] =>
  result.nodes.map((n) => [n.element.id, String(n.depth), n.via?.link ?? "-"]);

describe("trace walk (breadth first, ADR-0008)", () => {
  it("reaches each element once at its shortest depth, breadth first, with the edge it came through", () => {
    // S -> A -> C -> D and S -> B -> C (a diamond), D a leaf.
    const { r, expand, calls } = graphOf({ S: ["A", "B"], A: ["C"], B: ["C"], C: ["D"] });
    const result = walk([r("S")], expand);
    expect(names(result)).toEqual([
      ["S", "0", "-"],
      ["A", "1", "S>A"],
      ["B", "1", "S>B"],
      ["C", "2", "A>C"],
      ["D", "3", "C>D"],
    ]);
    // Every step, also the one into C reached before; none of them in a cycle.
    expect(result.edges.map((e) => [e.from.id, e.to.id, e.link, e.cyclic])).toEqual([
      ["S", "A", "S>A", false],
      ["S", "B", "S>B", false],
      ["A", "C", "A>C", false],
      ["B", "C", "B>C", false],
      ["C", "D", "C>D", false],
    ]);
    // Each element is expanded once, with its depth.
    expect(calls).toEqual(["S@0", "A@1", "B@1", "C@2", "D@3"]);
    expect(result.cycles).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.incomplete).toBe(false);
    expect(result.byElement.get(r("C"))?.depth).toBe(2);
    // The way to D, from the start; none for the start and for an element not reached.
    expect(pathTo(result, r("D")).map((e) => e.link)).toEqual(["S>A", "A>C", "C>D"]);
    expect(pathTo(result, r("S"))).toEqual([]);
    expect(pathTo(result, r("X"))).toEqual([]);
    // The node's `via` is the edge of `edges`.
    expect(result.byElement.get(r("A"))?.via).toBe(result.edges[0]);
  });

  it("starts from a set: each start once at depth 0, also one that another start reaches", () => {
    const { r, expand } = graphOf({ P: ["X", "Q"], Q: ["X"] });
    const result = walk([r("P"), r("Q"), r("P")], expand);
    expect(names(result)).toEqual([
      ["P", "0", "-"],
      ["Q", "0", "-"],
      ["X", "1", "P>X"],
    ]);
    // Q stays a start (depth 0, no via) although P leads to it; the edge P>Q is still there.
    expect(result.edges.map((e) => e.link)).toEqual(["P>X", "P>Q", "Q>X"]);
    expect(walk([], expand).nodes).toEqual([]);
  });

  it("stops at maxDepth: elements at that depth are reached, not expanded", () => {
    const { r, expand, calls } = graphOf({ S: ["A"], A: ["B"], B: ["C"] });
    const one = walk([r("S")], expand, { maxDepth: 1 });
    expect(names(one)).toEqual([
      ["S", "0", "-"],
      ["A", "1", "S>A"],
    ]);
    expect(one.nodes.map((n) => n.expanded)).toEqual([true, false]);
    expect(calls).toEqual(["S@0"]);
    const startsOnly = walk([r("S")], expand, { maxDepth: 0 });
    expect(names(startsOnly)).toEqual([["S", "0", "-"]]);
    expect(startsOnly.edges).toEqual([]);
    expect(calls).toEqual(["S@0"]);
    const all = walk([r("S")], expand, { maxDepth: 5 });
    expect(names(all)).toHaveLength(4);
    expect(all.nodes.every((n) => n.expanded)).toBe(true);
    expect(walk([r("S")], expand).nodes.every((n) => n.expanded)).toBe(true);
  });

  it("stops expanding once maxNodes elements besides the starts are reached (SR-111)", () => {
    // S -> A, B, C; A -> D; B -> E; D -> F.
    const { r, expand, calls } = graphOf({ S: ["A", "B", "C"], A: ["D"], B: ["E"], D: ["F"] });
    const cut = walk([r("S")], expand, { maxNodes: 4 });
    // S reaches three, A a fourth; then B is not expanded, nor anything after it.
    expect(calls).toEqual(["S@0", "A@1"]);
    expect(cut.nodes.map((n) => [n.element.id, n.depth, n.expanded])).toEqual([
      ["S", 0, true],
      ["A", 1, true],
      ["B", 1, false],
      ["C", 1, false],
      ["D", 2, false],
    ]);
    expect(cut.cut).toBe(true);
    // The last element expanded may go past the bound with all its steps.
    expect(walk([r("S")], expand, { maxNodes: 1 }).nodes).toHaveLength(4);
    // Reached exactly, with nothing left to expand within maxDepth: not cut.
    const deep = walk([r("S")], expand, { maxNodes: 3, maxDepth: 1 });
    expect([deep.nodes.length, deep.cut]).toEqual([4, false]);
    const whole = walk([r("S")], expand);
    expect([whole.nodes.length, whole.cut, whole.nodes.every((n) => n.expanded)]).toEqual([7, false, true]);
  });

  it("finds a cycle with all its elements and stops at it", () => {
    // A derives from B, B from C and C from A (SR-090 AK1), entered from S.
    const { r, expand, calls } = graphOf({ S: ["A"], A: ["B"], B: ["C"], C: ["A"] });
    const result = walk([r("S")], expand);
    expect(names(result).map(([name]) => name)).toEqual(["S", "A", "B", "C"]);
    expect(calls).toEqual(["S@0", "A@1", "B@2", "C@3"]);
    expect(result.cycles.map((c) => [c.elements.map((e) => e.id), c.edges.map((e) => e.link)])).toEqual([
      [
        ["A", "B", "C"],
        ["A>B", "B>C", "C>A"],
      ],
    ]);
    expect(result.edges.map((e) => [e.link, e.cyclic])).toEqual([
      ["S>A", false],
      ["A>B", true],
      ["B>C", true],
      ["C>A", true],
    ]);
    // The cycle's edges are the result's edges.
    expect(result.cycles[0]?.edges[0]).toBe(result.edges[1]);
  });

  it("names no element below a cycle, and no cycle that closes only beyond maxDepth", () => {
    // D and E lie below the cycle A, B; the cycle closes through B -> A.
    const { r, expand } = graphOf({ S: ["A"], A: ["B"], B: ["A", "D"], D: ["E"] });
    const result = walk([r("S")], expand);
    expect(result.cycles.map((c) => c.elements.map((e) => e.id))).toEqual([["A", "B"]]);
    expect(result.edges.filter((e) => e.cyclic).map((e) => e.link)).toEqual(["A>B", "B>A"]);
    // With maxDepth 2, B is reached but not expanded: B -> A is never seen, so there is no cycle.
    const cut = walk([r("S")], expand, { maxDepth: 2 });
    expect(cut.nodes.map((n) => [n.element.id, n.expanded])).toEqual([
      ["S", true],
      ["A", true],
      ["B", false],
    ]);
    expect(cut.cycles).toEqual([]);
  });

  it("finds a cycle that leaves the breadth-first path, a relation to itself and separate cycles", () => {
    // C is reached through A; C -> B is no back edge on C's path S, A, C, yet B and C form a cycle.
    const { r, expand } = graphOf({
      S: ["A", "B", "T"],
      A: ["C"],
      B: ["C"],
      C: ["B"],
      T: ["T", "U"],
      U: ["V"],
      V: ["U"],
    });
    const result = walk([r("S")], expand);
    expect(result.cycles.map((c) => [c.elements.map((e) => e.id), c.edges.map((e) => e.link)])).toEqual([
      [
        ["B", "C"],
        ["B>C", "C>B"],
      ],
      [["T"], ["T>T"]],
      [
        ["U", "V"],
        ["U>V", "V>U"],
      ],
    ]);
    expect(result.edges.filter((e) => e.cyclic).map((e) => e.link)).toEqual([
      "B>C",
      "T>T",
      "C>B",
      "U>V",
      "V>U",
    ]);
    expect(result.edges.filter((e) => !e.cyclic).map((e) => e.link)).toEqual([
      "S>A",
      "S>B",
      "S>T",
      "A>C",
      "T>U",
    ]);
  });

  it("collects what the steps cannot follow and whether the result is incomplete", () => {
    const missing: UnresolvedState = { kind: "missing", repository: "system" };
    const away: UnresolvedState = { kind: "inaccessible", repository: "away" };
    const { r, expand } = graphOf({ S: ["A"], A: ["B"] }, (name) =>
      name === "S"
        ? { unresolved: [{ link: "S>gone", state: missing }] }
        : name === "B"
          ? { unresolved: [{ link: "B>away", state: away }], incomplete: true }
          : {},
    );
    const result = walk([r("S")], expand);
    expect(result.unresolved.map((u) => [u.from.id, u.link, u.state])).toEqual([
      ["S", "S>gone", missing],
      ["B", "B>away", away],
    ]);
    expect(result.incomplete).toBe(true);
    // Not when the element that says so is not expanded.
    const shallow = walk([r("S")], expand, { maxDepth: 2 });
    expect(shallow.incomplete).toBe(false);
    expect(shallow.unresolved.map((u) => u.link)).toEqual(["S>gone"]);
  });

  it("gives each reached element its leaves (the evidence seam), none without a provider", () => {
    const { r, expand } = graphOf({ S: ["A"], A: ["B"] });
    const asked: string[] = [];
    const result = walk([r("S")], expand, {
      maxDepth: 1,
      leaves: (element) => {
        asked.push(element.id);
        return element.id === "A" ? [`record of ${element.id}`, "another"] : [];
      },
    });
    expect(result.nodes.map((n) => [n.element.id, n.leaves])).toEqual([
      ["S", []],
      ["A", ["record of A", "another"]],
    ]);
    expect(asked).toEqual(["S", "A"]);
    expect(walk([r("S")], expand).nodes.map((n) => n.leaves)).toEqual([[], [], []]);
  });
});

describe("cycles of a graph", () => {
  it("names each strongly connected component with more than one element or a relation to itself", () => {
    const [a, b, c, d, e, outside] = ["A", "B", "C", "D", "E", "O"].map(record) as [
      ElementRecord,
      ElementRecord,
      ElementRecord,
      ElementRecord,
      ElementRecord,
      ElementRecord,
    ];
    const edge = (from: ElementRecord, to: ElementRecord): GraphEdge<string> => ({
      from,
      to,
      link: `${from.id}>${to.id}`,
    });
    const edges = [
      edge(a, b),
      edge(b, a),
      edge(b, c),
      edge(c, d),
      edge(d, d),
      // Ends outside the elements are ignored.
      edge(outside, a),
      edge(a, outside),
      edge(e, c),
    ];
    // An element given twice counts once; the order of the elements sets the order of the cycles.
    const cycles = cyclesOf([d, c, b, a, e, d], edges);
    expect(cycles.map((cycle) => [cycle.elements.map((x) => x.id), cycle.edges.map((x) => x.link)])).toEqual([
      [["D"], ["D>D"]],
      [
        ["B", "A"],
        ["A>B", "B>A"],
      ],
    ]);
    expect(cycles[1]?.edges[0]).toBe(edges[0]);
    expect(cyclesOf([a, b, c], [edge(a, b), edge(b, c), edge(a, c)])).toEqual([]);
    expect(cyclesOf([], [])).toEqual([]);
  });

  it("handles long chains and large cycles without recursion", () => {
    const chain = Array.from({ length: 100_000 }, (_, i) => record(`E${String(i)}`));
    const edges: GraphEdge<number>[] = [];
    chain.reduce((from, to) => {
      edges.push({ from, to, link: edges.length });
      return to;
    });
    expect(cyclesOf(chain, edges)).toEqual([]);
    const [first] = chain;
    const last = chain.at(-1);
    if (first === undefined || last === undefined) {
      throw new Error("no chain");
    }
    const [cycle] = cyclesOf(chain, [...edges, { from: last, to: first, link: -1 }]);
    expect(cycle?.elements).toHaveLength(100_000);
    expect(cycle?.edges).toHaveLength(100_000);
  });
});
