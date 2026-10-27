import { describe, expect, it } from "vitest";
import type { TraceGraphOutput } from "@logreq/core";
import type { GraphEdge } from "./graph.js";
import type { EdgePath, GraphLayout, PlacedNode } from "./graph-layout.js";
import {
  LEVEL_LAYERS_ABOVE,
  NODE_HEIGHT,
  NODE_WIDTH,
  RANK_SEP,
  edgePath,
  layoutGraph,
  viewStart,
} from "./graph-layout.js";
import { BASED_ON, REFERENCE, S1_GRAPH, graphEdge, graphNode, graphOutput, key } from "./graph-test-data.js";

const at = (layout: GraphLayout, name: string): PlacedNode => {
  const placed = layout.byKey.get(key(name));
  if (placed === undefined) {
    throw new Error(`no node ${name}`);
  }
  return placed;
};

/** `output` with level-1 children of the element added until it has `size` nodes. */
const padded = (output: TraceGraphOutput, size: number): TraceGraphOutput => {
  const extra = Array.from({ length: size - output.nodes.length }, (_, index) => `PAD${String(index)}`);
  return graphOutput(
    [...output.nodes, ...extra.map((name) => graphNode(name, 1))],
    [...output.edges, ...extra.map((name) => graphEdge(name, "S1"))],
  );
};

/** Every node of a level below 0 stands above the element, every node of a level above 0 below it. */
const offSide = (layout: GraphLayout): string[] => {
  const [root] = layout.nodes;
  return layout.nodes
    .filter(
      (placed) =>
        (placed.node.level < 0 && placed.y >= (root?.y ?? 0)) ||
        (placed.node.level > 0 && placed.y <= (root?.y ?? 0)),
    )
    .map((placed) => placed.key);
};

/** A small deterministic random generator (mulberry32), so a generated output is the same every run. */
const random = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * A `trace.graph` output of `size` elements, built the way core builds it: elements with links (each
 * planned on a level from -2 to 2 and linked to one element a level nearer the element, plus `extra`
 * random links: within a level, against the levels, long ones, some to or from the element), then the
 * up walk along the stored links and the down walk along the links pointing at an element, each element
 * once at the smaller distance (the up walk on a tie), and every link between two of them.
 */
const generated = (seed: number, size: number, extra: number): TraceGraphOutput => {
  const next = random(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const planned = new Map<number, string[]>([[0, ["S1"]]]);
  const links: [string, string][] = [];
  for (let index = 1; index < size; index += 1) {
    const level = pick([-2, -1, -1, 1, 1, 2, 2, 2]);
    const name = `G${String(index)}`;
    const nearer = planned.get(level - Math.sign(level)) ?? ["S1"];
    // A node below the element links to one a level nearer; one above is linked from one.
    links.push(level > 0 ? [name, pick(nearer)] : [pick(nearer), name]);
    planned.set(level, [...(planned.get(level) ?? []), name]);
  }
  const names = [...planned.values()].flat();
  for (let index = 0; index < extra; index += 1) {
    links.push([pick(names), pick(names)]);
  }
  const walk = (step: (name: string) => string[]): Map<string, number> => {
    const distance = new Map([["S1", 0]]);
    for (let queue = ["S1"]; queue.length > 0;) {
      const following: string[] = [];
      for (const name of queue) {
        for (const other of step(name)) {
          if (!distance.has(other)) {
            distance.set(other, (distance.get(name) ?? 0) + 1);
            following.push(other);
          }
        }
      }
      queue = following;
    }
    return distance;
  };
  const up = walk((name) => links.filter(([source]) => source === name).map(([, target]) => target));
  const down = walk((name) => links.filter(([, target]) => target === name).map(([source]) => source));
  const levels = names.flatMap((name): [string, number][] => {
    const [above, below] = [up.get(name), down.get(name)];
    if (above === undefined && below === undefined) {
      return [];
    }
    return [[name, above !== undefined && (below === undefined || above <= below) ? -above : (below ?? 0)]];
  });
  const kept = new Map(levels);
  levels.sort(([, a], [, b]) => Math.abs(a) - Math.abs(b) || a - b);
  return graphOutput(
    levels.map(([name, level]) => graphNode(name, level)),
    links
      .filter(([source, target]) => source !== target && kept.has(source) && kept.has(target))
      .map(([source, target]) => graphEdge(source, target, pick([REFERENCE, BASED_ON, {}]))),
  );
};

interface Spot {
  readonly x: number;
  readonly y: number;
}

/** A curve that `edgePath` drew, as a line through 12 points of each cubic piece. */
const lineOf = (d: string): Spot[] => {
  const spots: Spot[] = [];
  for (const [, command = "", numbers = ""] of d.matchAll(/([MLC])([^MLC]*)/g)) {
    const values = numbers.trim().split(/[ ,]/).map(Number);
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0] = values;
    const last = spots.at(-1) ?? { x: x1, y: y1 };
    if (command === "C") {
      for (let step = 1; step <= 12; step += 1) {
        const t = step / 12;
        const u = 1 - t;
        spots.push({
          x: u * u * u * last.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          y: u * u * u * last.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        });
      }
    } else {
      spots.push({ x: x1, y: y1 });
    }
  }
  return spots;
};

/** Where the segments a–b and c–d cross each other (not where one only touches the other). */
const crossing = (a: Spot, b: Spot, c: Spot, d: Spot): Spot | undefined => {
  const side = (p: Spot, q: Spot, r: Spot): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const [ca, cb, ac, ad] = [side(c, d, a), side(c, d, b), side(a, b, c), side(a, b, d)];
  if (ca * cb >= 0 || ac * ad >= 0) {
    return undefined;
  }
  const t = ca / (ca - cb);
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
};

/** Every place where two drawn curves cross, as "<source>><target> x <source>><target>". */
const crossingsOf = (layout: GraphLayout): { readonly curves: string; readonly at: Spot }[] => {
  const lines = layout.paths.map((path) => ({ path, line: lineOf(path.d) }));
  const name = (path: EdgePath): string =>
    `${path.source.replace("spec:uuid-", "")}>${path.target.replace("spec:uuid-", "")}`;
  return lines.flatMap(({ path, line }, index) =>
    lines.slice(index + 1).flatMap((other) =>
      line.slice(1).flatMap((b, i) =>
        other.line.slice(1).flatMap((d, j) => {
          const at = crossing(line[i] ?? b, b, other.line[j] ?? d, d);
          return at === undefined ? [] : [{ curves: `${name(path)} x ${name(other.path)}`, at }];
        }),
      ),
    ),
  );
};

/** The crossings of two curves of one box within half a layer gap of that box. */
const crossingsAtABox = (layout: GraphLayout): string[] =>
  crossingsOf(layout).flatMap(({ curves, at: spot }) => {
    const boxes = curves
      .split(" x ")
      .map((pair) => pair.split(">"))
      .reduce((a, b) => a.filter((box) => b.includes(box)));
    return boxes.flatMap((box) => {
      const node = at(layout, box);
      const dx = Math.max(node.x - spot.x, 0, spot.x - node.x - NODE_WIDTH);
      const dy = Math.max(node.y - spot.y, 0, spot.y - node.y - NODE_HEIGHT);
      return Math.hypot(dx, dy) <= RANK_SEP / 2 ? [`${curves} at ${box}`] : [];
    });
  });

describe("layoutGraph", () => {
  it("[SR-111/AK1] puts what the element links to above it and what links to it below, also with links against the levels", () => {
    const layout = layoutGraph(S1_GRAPH);
    const root = at(layout, "S1");
    for (const node of S1_GRAPH.nodes) {
      const placed = at(layout, node.identifier ?? "PKG");
      if (node.level < 0) {
        expect(placed.y, node.title).toBeLessThan(root.y);
      } else if (node.level > 0) {
        expect(placed.y, node.title).toBeGreaterThan(root.y);
      }
    }
    // Every link whose target is not farther down than its source has its target above its source:
    // D1 references S1 (S1 is in a cycle with D1) and D2 references C1, both against the levels.
    for (const edge of S1_GRAPH.edges) {
      const source = layout.byKey.get(`spec:${edge.source}`);
      const target = layout.byKey.get(`spec:${edge.target}`);
      if ((target?.node.level ?? 0) <= (source?.node.level ?? 0)) {
        expect(target?.y ?? 0, `${edge.source} > ${edge.target}`).toBeLessThan(source?.y ?? 0);
      }
    }
    // A diamond: C3 derives from S1 and from C1, so it stands a layer under C1.
    expect(at(layout, "C3").layer).toBe(at(layout, "C1").layer + 1);
  });

  it("[SR-111/AK1] keeps the levels when a node is in a cycle with the element and two nodes are linked both ways", () => {
    const layout = layoutGraph(
      graphOutput(
        [graphNode("S1", 0), graphNode("P", -1), graphNode("C", 1), graphNode("Q", -1)],
        [
          graphEdge("S1", "P"),
          graphEdge("P", "S1", REFERENCE),
          graphEdge("C", "S1"),
          graphEdge("S1", "C", REFERENCE),
          graphEdge("P", "C", REFERENCE),
          graphEdge("S1", "Q", BASED_ON),
          graphEdge("Q", "P", BASED_ON),
          graphEdge("P", "Q", BASED_ON),
        ],
      ),
    );
    expect(at(layout, "P").y).toBeLessThan(at(layout, "S1").y);
    expect(at(layout, "Q").y).toBeLessThan(at(layout, "S1").y);
    expect(at(layout, "C").y).toBeGreaterThan(at(layout, "S1").y);
    // One curve per ordered pair, in the order of the links: P and Q are linked both ways.
    expect(layout.paths.map((path) => `${path.source}>${path.target}`)).toEqual(
      ["S1>P", "P>S1", "C>S1", "S1>C", "P>C", "S1>Q", "Q>P", "P>Q"].map((pair) =>
        pair
          .split(">")
          .map((name) => key(name))
          .join(">"),
      ),
    );
  });

  it("[SR-111/AK1] keeps a child of the element below it when its walk parent took its level from the other walk", () => {
    // The whole chain of GL-f81ba9 in spec/ (#519): S1 and K link to each other, so K is on level -1 (a
    // tie, the up walk wins); G links to K and is on level 2 from the down walk. Nothing but the side of
    // its level puts G below S1.
    const output = graphOutput(
      [graphNode("S1", 0), graphNode("K", -1), graphNode("G", 2)],
      [graphEdge("S1", "K", BASED_ON), graphEdge("K", "S1", BASED_ON), graphEdge("G", "K", REFERENCE)],
    );
    for (const graph of [output, padded(output, LEVEL_LAYERS_ABOVE + 1)]) {
      const layout = layoutGraph(graph);
      expect(offSide(layout), String(graph.nodes.length)).toEqual([]);
      expect(at(layout, "G").y).toBeGreaterThan(at(layout, "S1").y);
      expect(at(layout, "K").y).toBeLessThan(at(layout, "S1").y);
      // The invisible link that keeps G down is not drawn: one curve per pair of the output.
      expect(layout.paths.map((path) => `${path.source}>${path.target}`).slice(0, 3)).toEqual([
        `${key("S1")}>${key("K")}`,
        `${key("K")}>${key("S1")}`,
        `${key("G")}>${key("K")}`,
      ]);
    }
  });

  it("[SR-111/AK1] keeps a parent of the element above it when its walk child took its level from the other walk", () => {
    // S1 links to A, A to P, P to S1 and to V: P is on level 1 from the down walk, A on level -1, and V,
    // on level -3 from the up walk through P, is linked only from P, which stands below S1.
    const output = graphOutput(
      [graphNode("S1", 0), graphNode("A", -1), graphNode("P", 1), graphNode("V", -3)],
      [graphEdge("S1", "A"), graphEdge("A", "P"), graphEdge("P", "S1"), graphEdge("P", "V")],
    );
    for (const graph of [output, padded(output, LEVEL_LAYERS_ABOVE + 1)]) {
      const layout = layoutGraph(graph);
      expect(offSide(layout), String(graph.nodes.length)).toEqual([]);
      expect(at(layout, "V").y).toBeLessThan(at(layout, "S1").y);
      expect(layout.paths).toHaveLength(graph.edges.length);
    }
  });

  it("[SR-111/AK1] keeps a parent of the element above it when only a link within its level joins it to the nodes above", () => {
    // The mirror case above, with a chain S1 > A > B > W and V and W linked both ways on level -3. dagre
    // breaks the cycle of V and W by reversing one of their links (W comes before V, as core gives it
    // when A lists B before P), so that link puts V nowhere: V needs its anchor to stay above S1.
    const output = graphOutput(
      [
        graphNode("S1", 0),
        graphNode("A", -1),
        graphNode("P", 1),
        graphNode("B", -2),
        graphNode("W", -3),
        graphNode("V", -3),
      ],
      [
        graphEdge("S1", "A"),
        graphEdge("A", "P"),
        graphEdge("P", "S1"),
        graphEdge("P", "V"),
        graphEdge("A", "B"),
        graphEdge("B", "W"),
        graphEdge("V", "W", REFERENCE),
        graphEdge("W", "V", REFERENCE),
      ],
    );
    const layout = layoutGraph(output);
    expect(offSide(layout)).toEqual([]);
    expect(at(layout, "V").y).toBeLessThan(at(layout, "S1").y);
  });

  it("keeps the layout of a graph of up to 200 nodes that needs no invisible link, as before #500 and #519", () => {
    // The places of main before this change (dagre 3.1.1 is pinned): a change here moves the graphs of
    // spec/, which must stay as they are (an upgrade of dagre makes it visible on purpose, ADR-0015).
    const layout = layoutGraph(S1_GRAPH);
    expect([layout.width, layout.height]).toEqual([1246, 512]);
    expect(layout.nodes.map((placed) => [placed.node.identifier ?? "PKG", placed.x, placed.y])).toEqual([
      ["S1", 526, 142],
      ["N1", 1022, 0],
      ["D1", 248, 0],
      ["PKG", 774, 0],
      ["O1", 526, 0],
      ["D2", 0, 0],
      ["C1", 144, 284],
      ["C2", 392, 284],
      ["C3", 335, 426],
      ["E", 804, 284],
    ]);
  });

  it("[SR-111/AK1] ranks the links within a level of a graph of up to 200 nodes, so a node stands under the node it links to", () => {
    // The diamond: C3 derives from S1 and from C1, all three children of S1 on level 1.
    const diamond = graphOutput(
      [graphNode("S1", 0), graphNode("P", -1), graphNode("C1", 1), graphNode("C3", 1)],
      [graphEdge("S1", "P"), graphEdge("C1", "S1"), graphEdge("C3", "S1"), graphEdge("C3", "C1")],
    );
    const ranked = layoutGraph(padded(diamond, LEVEL_LAYERS_ABOVE));
    expect(ranked.nodes).toHaveLength(LEVEL_LAYERS_ABOVE);
    expect(offSide(ranked)).toEqual([]);
    expect(at(ranked, "C3").layer).toBe(at(ranked, "C1").layer + 1);
    // One node more: the levels are the layers, and C3 stands beside C1, joined by an arch above them.
    const levelled = layoutGraph(padded(diamond, LEVEL_LAYERS_ABOVE + 1));
    expect(offSide(levelled)).toEqual([]);
    expect(at(levelled, "C3").y).toBe(at(levelled, "C1").y);
    expect(levelled.layers.map((layer) => layer.length)).toEqual([1, 1, LEVEL_LAYERS_ABOVE - 1]);
    const arch = levelled.paths.find((path) => path.source === key("C3") && path.target === key("C1"));
    expect(arch?.d).toContain(`,${String(at(levelled, "C1").y - RANK_SEP / 2)}`);
  });

  it("[SR-111/AK1] lays out a graph of more than 200 nodes in the layers of its levels: parents above, children below, a link within a level drawn between its two nodes", () => {
    // Generated outputs of 240 nodes on levels -2 to 2, with links within a level, against the levels,
    // long ones and cycles through the element (some nodes then take their level from the other walk).
    let regular = 0;
    for (const [seed, extra] of [
      [1, 0],
      [2, 40],
      [3, 120],
      [4, 240],
      [5, 400],
    ] as const) {
      const output = generated(seed, 240, extra);
      expect(output.nodes.length).toBeGreaterThan(LEVEL_LAYERS_ABOVE);
      const layout = layoutGraph(output);
      const name = `seed ${String(seed)}`;
      expect(offSide(layout), name).toEqual([]);
      const pairs = new Set<string>();
      for (const edge of output.edges) {
        const source = layout.byKey.get(`spec:${edge.source}`);
        const target = layout.byKey.get(`spec:${edge.target}`);
        if (source === undefined || target === undefined) {
          throw new Error(`no node of ${edge.source} > ${edge.target}`);
        }
        pairs.add(`${source.key}>${target.key}`);
        // A link to a lower level has its target above its source; a link against the levels or within
        // a level is drawn afterwards, between the two placed nodes.
        if (target.node.level < source.node.level) {
          expect(target.y, `${name}: ${edge.source} > ${edge.target}`).toBeLessThan(source.y);
        }
      }
      // Each linked pair is one curve; two nodes of one layer are joined by an arch above them.
      expect(layout.paths.map((path) => `${path.source}>${path.target}`).sort()).toEqual([...pairs].sort());
      for (const path of layout.paths) {
        const [source, target] = [layout.byKey.get(path.source), layout.byKey.get(path.target)];
        if (source?.y === target?.y) {
          expect(path.d, `${name}: arch`).toContain(`,${String((source?.y ?? 0) - RANK_SEP / 2)}`);
        }
      }
      // When every node links to a node one level nearer the element the way the walks go (a node of
      // level d > 0 stores a link to one of level d - 1, a node of level d < 0 is linked from one of
      // level d + 1), the layers are the levels.
      const levelOf = new Map(output.nodes.map((node) => [node.id, node.level]));
      const nearer = new Set(
        output.edges.flatMap((edge: GraphEdge): string[] => {
          const [source, target] = [levelOf.get(edge.source) ?? 0, levelOf.get(edge.target) ?? 0];
          if (source > 0 && target === source - 1) {
            return [edge.source];
          }
          return target < 0 && source === target + 1 ? [edge.target] : [];
        }),
      );
      if (output.nodes.every((node) => node.level === 0 || nearer.has(node.id))) {
        regular += 1;
        const levels = [...new Set(output.nodes.map((node) => node.level))].sort((a, b) => a - b);
        expect(
          layout.nodes
            .filter((placed) => placed.layer !== levels.indexOf(placed.node.level))
            .map((p) => p.key),
          name,
        ).toEqual([]);
      }
    }
    // All but seed 2, which has a node whose walk parent took its level from the other walk.
    expect(regular).toBe(4);
  });

  it("draws one curve per pair of nodes, none for a link to itself or to an element that is no node", () => {
    const layout = layoutGraph(
      graphOutput(
        [graphNode("S1", 0), graphNode("C", 1)],
        [
          graphEdge("C", "S1"),
          graphEdge("C", "S1", BASED_ON),
          graphEdge("C", "C", REFERENCE),
          graphEdge("C", "gone"),
          graphEdge("gone", "S1"),
        ],
      ),
    );
    expect(layout.paths).toHaveLength(1);
    expect(layout.paths[0]?.links).toHaveLength(2);
    // The curve leaves the parent's bottom and enters the child's top, both in the middle.
    const root = at(layout, "S1");
    const child = at(layout, "C");
    expect(
      layout.paths[0]?.d.startsWith(`M${String(root.x + NODE_WIDTH / 2)},${String(root.y + NODE_HEIGHT)}`),
    ).toBe(true);
    expect(layout.paths[0]?.d.endsWith(`L${String(child.x + NODE_WIDTH / 2)},${String(child.y)}`)).toBe(true);
  });

  it("joins two nodes of one layer that a link against the levels connects by an arch above them", () => {
    // S links to the element and to V (a sibling, so S stands under V); T derives from U: S and T share
    // the second layer below the element, and S's link to T (one level farther down) is drawn afterwards.
    const layout = layoutGraph(
      graphOutput(
        [graphNode("S1", 0), graphNode("U", 1), graphNode("V", 1), graphNode("S", 1), graphNode("T", 2)],
        [
          graphEdge("U", "S1"),
          graphEdge("V", "S1"),
          graphEdge("S", "S1"),
          graphEdge("S", "V"),
          graphEdge("S", "T", REFERENCE),
          graphEdge("T", "U"),
        ],
      ),
    );
    const s = at(layout, "S");
    const t = at(layout, "T");
    expect(s.y).toBe(t.y);
    const arch = layout.paths.find((path) => path.source === key("S") && path.target === key("T"));
    // It leaves T's top edge (shared with T's link to U, so off its middle), rises above the layer and
    // enters S's top edge.
    const [, x0 = "", y0 = ""] = /^M([\d.-]+),([\d.-]+)/.exec(arch?.d ?? "") ?? [];
    const [, x1 = "", y1 = ""] = /L([\d.-]+),([\d.-]+)$/.exec(arch?.d ?? "") ?? [];
    expect(Number(y0)).toBe(t.y);
    expect(Number(x0)).toBeGreaterThan(t.x);
    expect(Number(x0)).toBeLessThan(t.x + NODE_WIDTH);
    expect(Number(y1)).toBe(s.y);
    expect(Number(x1)).toBeGreaterThan(s.x);
    expect(Number(x1)).toBeLessThan(s.x + NODE_WIDTH);
    expect(arch?.d).toContain(`,${String(t.y - RANK_SEP / 2)}`);
  });

  it("gives the layers from the top, each from left to right, and the same layout for the same output", () => {
    const layout = layoutGraph(S1_GRAPH);
    expect(layout.nodes.map((node) => node.key)).toEqual(S1_GRAPH.nodes.map((node) => `spec:${node.id}`));
    expect(layout.layers.flat()).toHaveLength(S1_GRAPH.nodes.length);
    for (const [index, layer] of layout.layers.entries()) {
      expect(layer.every((node) => node.layer === index)).toBe(true);
      expect(layer.map((node) => node.x)).toEqual([...layer.map((node) => node.x)].sort((a, b) => a - b));
    }
    expect(layout.width).toBeGreaterThan(NODE_WIDTH);
    expect(layout.height).toBeGreaterThan(NODE_HEIGHT);
    expect(JSON.stringify(layoutGraph(S1_GRAPH))).toBe(JSON.stringify(layout));
  });

  it("spreads the ends of a fan along the node's edge, apart and off its corners, and meets a lone link in the middle", () => {
    const layout = layoutGraph(
      graphOutput(
        [graphNode("S1", 0), graphNode("A", 1), graphNode("B", 1), graphNode("C", 1), graphNode("P", -1)],
        [graphEdge("A", "S1"), graphEdge("B", "S1"), graphEdge("C", "S1"), graphEdge("S1", "P")],
      ),
    );
    const root = at(layout, "S1");
    const start = (d: string): { x: number; y: number } => {
      const [x = "", y = ""] = /^M([\d.-]+),([\d.-]+)/.exec(d)?.slice(1) ?? [];
      return { x: Number(x), y: Number(y) };
    };
    const fan = layout.paths
      .filter((path) => path.target === key("S1"))
      .map((path) => ({ child: at(layout, path.source.slice("spec:uuid-".length)), from: start(path.d) }))
      .sort((a, b) => a.child.x - b.child.x);
    expect(fan).toHaveLength(3);
    const xs = fan.map((end) => end.from.x);
    // Apart, within the bottom edge and off its corners.
    expect(new Set(xs).size).toBe(3);
    for (const end of fan) {
      expect(end.from.y).toBe(root.y + NODE_HEIGHT);
      expect(end.from.x).toBeGreaterThan(root.x + 12);
      expect(end.from.x).toBeLessThan(root.x + NODE_WIDTH - 12);
    }
    // The one link on the top edge leaves from its middle.
    const up = layout.paths.find((path) => path.target === key("P"));
    expect(up?.d.endsWith(`L${String(root.x + NODE_WIDTH / 2)},${String(root.y)}`)).toBe(true);
  });

  it("orders the ends on each edge of a node by where their curves are half a layer gap from it, so the curves of S1's graph do not cross at a box", () => {
    // Ordered by the boxes at their other ends, C3's curve would cross C2's at S1's bottom edge (C3
    // stands left of C2, but its curve heads right of C2's). Ordered by dagre's first bend against the
    // other box's centre for a link without bends (#555, a7e640c), D1's two links would cross above S1,
    // and the outdated reference to D2, which swings out right from its bend under D2, would cross the
    // reference from D2 to C1 under D2.
    const layout = layoutGraph(S1_GRAPH);
    expect(crossingsAtABox(layout)).toEqual([]);
    // One crossing is left, away from the boxes: the outdated reference from S1 up to D2 and the link
    // from C1 up to D1 cross between the layers.
    expect(crossingsOf(layout).map(({ curves }) => curves)).toEqual(["S1>D2 x C1>D1"]);
    // Both kinds of ends are in it: bent curves and curves drawn after the layout (four points without
    // bends, so three cubic pieces).
    const pieces = layout.paths.map((path) => path.d.split("C").length - 1);
    expect(pieces).toContain(3);
    expect(pieces.some((count) => count > 3)).toBe(true);
  });

  it("draws the two links between two nodes that link each other side by side, the one against the levels too", () => {
    // The whole chain of the glossary term GL-f81ba9: A links to K and K to A (one ranked, one drawn
    // after the layout), and C, two levels down, links to K.
    const layout = layoutGraph(
      graphOutput(
        [graphNode("A", 0), graphNode("K", -1), graphNode("C", 2)],
        [graphEdge("A", "K", REFERENCE), graphEdge("K", "A", REFERENCE), graphEdge("C", "K", REFERENCE)],
      ),
    );
    expect(layout.paths).toHaveLength(3);
    expect(crossingsOf(layout)).toEqual([]);
  });

  it("places a lone element, and nothing for an output without nodes", () => {
    const layout = layoutGraph(graphOutput([graphNode("S1", 0)], []));
    expect(layout.layers).toEqual([[at(layout, "S1")]]);
    expect(layout.paths).toEqual([]);
    const empty = layoutGraph(graphOutput([], []));
    expect([empty.nodes, empty.layers, empty.paths]).toEqual([[], [], []]);
  });
});

describe("edgePath", () => {
  it("draws the uniform B-spline through the points, as Mermaid's basis curve", () => {
    expect(edgePath([])).toBe("");
    expect(edgePath([{ x: 1, y: 2 }])).toBe("M1,2");
    expect(
      edgePath([
        { x: 0, y: 0 },
        { x: 0, y: 12 },
      ]),
    ).toBe("M0,0L0,12");
    expect(
      edgePath([
        { x: 0, y: 0 },
        { x: 0, y: 6 },
        { x: 6, y: 12 },
      ]),
    ).toBe("M0,0L0,1C0,2 0,4 1,6C2,8 4,10 5,11L6,12");
  });
});

describe("viewStart", () => {
  // A view of 400 px over a drawing from 1000 to 3000 px, with a margin of 50 px.
  const start = (centre: number): number => viewStart(centre, 1000, 2000, 400, 50);

  it("[SR-111/AK1] puts the node in the middle of the view where the drawing reaches half a view beyond it", () => {
    expect(start(2000)).toBe(1800);
    expect(start(1150)).toBe(950);
    expect(start(2850)).toBe(2650);
  });

  it("[SR-111/AK1] keeps the drawing's edge a margin from the view's edge, and the node in view", () => {
    // Near the start of the drawing (a node without parents): the drawing begins 50 px into the view.
    expect(start(1100)).toBe(950);
    // Near its end (a node without children): it ends 50 px before the view's end.
    expect(start(2950)).toBe(2650);
  });

  it("[SR-111/AK1] centres a drawing that fits the view with its margins", () => {
    expect(viewStart(1100, 1000, 300, 400, 50)).toBe(950);
    expect(viewStart(1100, 1000, 200, 400, 50)).toBe(900);
  });
});
