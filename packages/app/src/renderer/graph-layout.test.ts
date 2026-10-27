import { describe, expect, it } from "vitest";
import type { GraphLayout, PlacedNode } from "./graph-layout.js";
import { NODE_HEIGHT, NODE_WIDTH, RANK_SEP, edgePath, layoutGraph, viewStart } from "./graph-layout.js";
import { BASED_ON, REFERENCE, S1_GRAPH, graphEdge, graphNode, graphOutput, key } from "./graph-test-data.js";

const at = (layout: GraphLayout, name: string): PlacedNode => {
  const placed = layout.byKey.get(key(name));
  if (placed === undefined) {
    throw new Error(`no node ${name}`);
  }
  return placed;
};

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

  it("spreads the ends of a fan along the node's edge, in the x-order of the other ends", () => {
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
    // Apart, left to right as their children, within the bottom edge and off its corners.
    expect(new Set(xs).size).toBe(3);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    for (const end of fan) {
      expect(end.from.y).toBe(root.y + NODE_HEIGHT);
      expect(end.from.x).toBeGreaterThan(root.x + 12);
      expect(end.from.x).toBeLessThan(root.x + NODE_WIDTH - 12);
    }
    // The one link on the top edge leaves from its middle.
    const up = layout.paths.find((path) => path.target === key("P"));
    expect(up?.d.endsWith(`L${String(root.x + NODE_WIDTH / 2)},${String(root.y)}`)).toBe(true);
  });

  it("places a lone element", () => {
    const layout = layoutGraph(graphOutput([graphNode("S1", 0)], []));
    expect(layout.layers).toEqual([[at(layout, "S1")]]);
    expect(layout.paths).toEqual([]);
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
