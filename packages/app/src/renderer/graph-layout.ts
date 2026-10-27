// Where the nodes of a graph stand and how its links are drawn (SR-111, D-063): pure display, the only
// thing outside the catalog (ADR-0002 rule 3, SR-080 AK1). The nodes, levels, edges and marks are the
// output of `trace.graph`; this module gives them places. dagre (the layout of Mermaid's flowcharts)
// ranks and orders them in layers from the top down, each link's target above its source (ADR-0004),
// with the `tight-tree` ranker. Some links are left out of the ranking and drawn afterwards between the
// placed nodes:
// - a link that runs against the levels of the output (its target is farther down than its source, such
//   as a decision above the element whose text references the element). dagre's own cycle breaking
//   would reverse a link of the walks instead (its `greedy` acyclicer fails or misplaces such graphs in
//   3.1.1);
// - above `LEVEL_LAYERS_ABOVE` nodes, a link between two nodes of one level (#500): it would stack a
//   level into many layers and cost dagre most of SR-111 AK6's second.
// Up to `LEVEL_LAYERS_ABOVE` nodes the drawn layers are dagre's ranks, not the levels: a node stands one
// layer under each node it links to, also across levels (a diamond). Above it, the layers follow the
// levels (every node of a level in one layer, in the order of the levels) when every node links to a
// node one level nearer the element; with cycles through the element a node may stand a layer off its
// level. Either way every node of a level below 0 stands above the element and every node of a level
// above 0 below it (AK1): a node whose links do not put it on its side (its walk reached it through a
// node that took its level from the other walk) gets an invisible layout link from the element, or to
// it, which is never drawn.
import { Graph, layout } from "@dagrejs/dagre";
import type { TraceGraphOutput } from "@logreq/core";
import type { GraphEdge, GraphNode } from "./graph.js";
import { keyOfNode, nodeKey } from "./graph.js";

/** The size of a node in CSS pixels; `styles.css` gives `.graph-node` the same, so no node is measured. */
export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 86;
/** The space between two nodes of a layer, and between two layers. */
export const NODE_SEP = 24;
export const RANK_SEP = 56;
/**
 * Above this many nodes, the links between two nodes of one level are drawn after the layout, so the
 * layers follow the levels (#500). It is above every graph of `spec/` today, so those keep their ranked
 * layout. The 200 nearest nodes of the N-036 chains take about 0.4 of the layout time of their 500-node
 * graph; the time of a ranked graph is not bounded by its size, though (#538).
 */
export const LEVEL_LAYERS_ABOVE = 200;
/** Parents above, children below (D-063); the ports and `route` assume it. */
const RANK_DIRECTION = "TB";
/** How far a link leaves and enters a node straight up or down before it bends. */
const GUIDE = RANK_SEP / 4;
/** The ends of a node's links keep this far from its corners. */
const PORT_INSET = 12;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A node and its place: `x` and `y` are its top left corner; `layer` counts the drawn layers from the top. */
export interface PlacedNode {
  readonly key: string;
  readonly node: GraphNode;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
}

const coordinate = (value: number): string => String(Math.round(value * 10) / 10);
const at = (point: Point): string => `${coordinate(point.x)},${coordinate(point.y)}`;

/** One cubic piece of a uniform B-spline through the points a, b and c. */
const piece = (a: Point, b: Point, c: Point): string =>
  `C${at({ x: (2 * a.x + b.x) / 3, y: (2 * a.y + b.y) / 3 })} ${at({
    x: (a.x + 2 * b.x) / 3,
    y: (a.y + 2 * b.y) / 3,
  })} ${at({ x: (a.x + 4 * b.x + c.x) / 6, y: (a.y + 4 * b.y + c.y) / 6 })}`;

/**
 * A soft curve along the points (D-063 „weich geschwungen“): the uniform B-spline that Mermaid draws
 * (d3's `curveBasis`), from the first point to the last one.
 */
export const edgePath = (points: readonly Point[]): string => {
  const [first, second, ...rest] = points;
  if (first === undefined) {
    return "";
  }
  if (second === undefined) {
    return `M${at(first)}`;
  }
  if (rest.length === 0) {
    return `M${at(first)}L${at(second)}`;
  }
  let d = `M${at(first)}L${at({ x: (5 * first.x + second.x) / 6, y: (5 * first.y + second.y) / 6 })}`;
  let a = first;
  let b = second;
  for (const c of rest) {
    d += piece(a, b, c);
    a = b;
    b = c;
  }
  return `${d}${piece(a, b, b)}L${at(b)}`;
};

const centreX = (node: PlacedNode): number => node.x + NODE_WIDTH / 2;

/** The x of the ends of one link: where it leaves `from` and where it enters `to`. */
interface Ports {
  readonly from: number;
  readonly to: number;
}

/**
 * The points of a link's curve from node `from` to node `to`: it leaves `from` straight down (or up)
 * from its port on the edge, passes dagre's bend points and enters `to` straight. Two nodes of one
 * layer are joined by an arch above them.
 */
const route = (from: PlacedNode, to: PlacedNode, bends: readonly Point[], ports: Ports): Point[] => {
  if (from.y === to.y) {
    const top = from.y - RANK_SEP / 2;
    return [
      { x: ports.from, y: from.y },
      { x: ports.from, y: top },
      { x: ports.to, y: top },
      { x: ports.to, y: to.y },
    ];
  }
  const down = from.y < to.y;
  const step = down ? GUIDE : -GUIDE;
  const start = { x: ports.from, y: down ? from.y + NODE_HEIGHT : from.y };
  const end = { x: ports.to, y: down ? to.y : to.y + NODE_HEIGHT };
  return [start, { x: start.x, y: start.y + step }, ...bends, { x: end.x, y: end.y - step }, end];
};

/** The ports of one drawn link, and the nodes it leaves and enters. */
interface Ported {
  readonly pair: Pair<PlacedNode>;
  from: number;
  to: number;
}

/**
 * The ports of the drawn links, each from its target (above) to its source (below), the way dagre's
 * layout edge runs: the ends on one edge of a node (top or bottom) are spread along it in the x-order of
 * the nodes at their other ends (ties in the order of the output), so the curves of a fan leave apart
 * and do not cross near the node. A node with one link on an edge meets it in the middle.
 */
const portsOf = (pairs: readonly Pair<PlacedNode>[]): Ported[] => {
  const edges = new Map<
    string,
    {
      readonly link: Ported;
      readonly end: keyof Ports;
      readonly node: PlacedNode;
      readonly other: PlacedNode;
    }[]
  >();
  const add = (side: string, node: PlacedNode, end: keyof Ports, link: Ported, other: PlacedNode): void => {
    const edge = `${side}:${node.key}`;
    edges.set(edge, [...(edges.get(edge) ?? []), { link, end, node, other }]);
  };
  const ported = pairs.map((pair): Ported => {
    const { target: from, source: to } = pair;
    const link = { pair, from: centreX(from), to: centreX(to) };
    const down = from.y < to.y;
    add(down ? "bottom" : "top", from, "from", link, to);
    add(down || from.y === to.y ? "top" : "bottom", to, "to", link, from);
    return link;
  });
  for (const ends of edges.values()) {
    ends.sort((a, b) => a.other.x - b.other.x);
    for (const [index, { link, end, node }] of ends.entries()) {
      link[end] = node.x + PORT_INSET + ((index + 0.5) * (NODE_WIDTH - 2 * PORT_INSET)) / ends.length;
    }
  }
  return ported;
};

/**
 * The part of dagre's graph this module uses. The types of dagre 3.1.1 do not resolve under NodeNext
 * (graphlib's declarations import `./lib/graph` without an extension), so they are written here.
 */
interface LayoutGraph {
  setGraph(label: Readonly<Record<string, string | number>>): void;
  setNode(key: string, label: { readonly width: number; readonly height: number }): void;
  setEdge(v: string, w: string, label: { readonly minlen: number; readonly weight: number }): void;
  graph(): { readonly width: number; readonly height: number };
  node(key: string): Point;
  edge(v: string, w: string): { readonly points: readonly Point[] };
}

const LayoutGraphOf = Graph as unknown as new () => LayoutGraph;
const runLayout = layout as unknown as (graph: LayoutGraph) => void;

/** The links of one node to another, drawn as one curve. */
export interface EdgePath {
  /** The node whose file stores the links, and the node they point at, as `<repository>:<id>`. */
  readonly source: string;
  readonly target: string;
  readonly links: readonly GraphEdge[];
  /** The SVG path. */
  readonly d: string;
}

export interface GraphLayout {
  readonly width: number;
  readonly height: number;
  /** In the order of the output: the element first. */
  readonly nodes: readonly PlacedNode[];
  readonly byKey: ReadonlyMap<string, PlacedNode>;
  /** The drawn layers from the top, each from left to right. */
  readonly layers: readonly (readonly PlacedNode[])[];
  readonly paths: readonly EdgePath[];
}

/** The links of one node to another (`T` is how a node is known here: the output's node or its place). */
interface Pair<T> {
  readonly source: T;
  readonly target: T;
  /**
   * The links are left out of the ranking and drawn after the layout: they run against the levels of the
   * output (the target is farther down than the source), or the graph has more than
   * `LEVEL_LAYERS_ABOVE` nodes and both ends are of one level.
   */
  readonly drawnAfter: boolean;
  readonly links: GraphEdge[];
}

/**
 * The links between two different nodes, one entry per ordered pair, in the order of the output; `nodes`
 * gives a node by its key, `level` its level in the output.
 */
const pairsOf = <T>(
  output: TraceGraphOutput,
  nodes: ReadonlyMap<string, T>,
  level: (node: T) => number,
): Pair<T>[] => {
  const levelled = output.nodes.length > LEVEL_LAYERS_ABOVE;
  const pairs = new Map<string, Pair<T>>();
  for (const edge of output.edges) {
    const sourceKey = nodeKey(edge.sourceRepository, edge.source);
    const targetKey = nodeKey(edge.targetRepository, edge.target);
    const source = nodes.get(sourceKey);
    const target = nodes.get(targetKey);
    if (sourceKey === targetKey || source === undefined || target === undefined) {
      continue;
    }
    const pairKey = `${sourceKey}>${targetKey}`;
    const pair = pairs.get(pairKey);
    if (pair === undefined) {
      const [from, to] = [level(target), level(source)];
      pairs.set(pairKey, {
        source,
        target,
        drawnAfter: from > to || (levelled && from === to),
        links: [edge],
      });
    } else {
      pair.links.push(edge);
    }
  }
  return [...pairs.values()];
};

/**
 * Keeps every node on its side of the element (SR-111 AK1, #519). A node of a level above 0 stands below
 * the element when a chain of layout links between levels leads down to it from the element, and a node
 * of a level below 0 above it when one leads from it up to the element. Such a link joins two different
 * levels, so it is in no cycle and dagre never reverses it; a link within a level can be, so it does not
 * count. A node without such a chain (the walk reached it through a node that took its level from the
 * other walk, in a cycle through the element) gets an invisible layout link from the element, or to it:
 * `minlen` 1 puts it on its side, `weight` 0 does not pull it nearer, and it is never drawn. Nodes are
 * taken nearest first, and an anchored node carries what hangs on it, so anchors are few. A graph whose
 * nodes all have such a chain gets none and keeps its layout.
 */
const anchor = (
  graph: LayoutGraph,
  nodes: readonly GraphNode[],
  ranked: readonly Pair<GraphNode>[],
): void => {
  const [first] = nodes;
  if (first === undefined) {
    return;
  }
  const root = keyOfNode(first);
  const down = new Map<string, string[]>();
  const up = new Map<string, string[]>();
  const add = (next: Map<string, string[]>, from: string, to: string): void => {
    const list = next.get(from);
    if (list === undefined) {
      next.set(from, [to]);
    } else {
      list.push(to);
    }
  };
  for (const { source, target } of ranked) {
    if (source.level !== target.level) {
      add(down, keyOfNode(target), keyOfNode(source));
      add(up, keyOfNode(source), keyOfNode(target));
    }
  }
  const reach = (seen: Set<string>, next: ReadonlyMap<string, readonly string[]>, from: string): void => {
    const stack = [from];
    seen.add(from);
    for (let key = stack.pop(); key !== undefined; key = stack.pop()) {
      for (const other of next.get(key) ?? []) {
        if (!seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
  };
  const below = new Set<string>();
  const above = new Set<string>();
  reach(below, down, root);
  reach(above, up, root);
  for (const node of nodes) {
    const key = keyOfNode(node);
    if (node.level > 0 && !below.has(key)) {
      graph.setEdge(root, key, { minlen: 1, weight: 0 });
      reach(below, down, key);
    } else if (node.level < 0 && !above.has(key)) {
      graph.setEdge(key, root, { minlen: 1, weight: 0 });
      reach(above, up, key);
    }
  }
};

/** Places the nodes of `output` and draws its links; deterministic: the same output gives the same layout. */
export const layoutGraph = (output: TraceGraphOutput): GraphLayout => {
  const nodes = new Map(output.nodes.map((node) => [keyOfNode(node), node]));
  const graph = new LayoutGraphOf();
  graph.setGraph({
    rankdir: RANK_DIRECTION,
    ranker: "tight-tree",
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    marginx: 0,
    marginy: 0,
  });
  for (const key of nodes.keys()) {
    graph.setNode(key, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  // One layout edge per ordered pair, from the target (above) to the source (below).
  const ranked = pairsOf(output, nodes, (node) => node.level).filter((pair) => !pair.drawnAfter);
  for (const pair of ranked) {
    graph.setEdge(keyOfNode(pair.target), keyOfNode(pair.source), { minlen: 1, weight: 1 });
  }
  anchor(graph, output.nodes, ranked);
  runLayout(graph);
  const label = graph.graph();
  const tops = [...new Set([...nodes.keys()].map((key) => graph.node(key).y))].sort((a, b) => a - b);
  const placed = [...nodes].map(([key, node]): PlacedNode => {
    const centre = graph.node(key);
    return {
      key,
      node,
      x: centre.x - NODE_WIDTH / 2,
      y: centre.y - NODE_HEIGHT / 2,
      layer: tops.indexOf(centre.y),
    };
  });
  const byKey = new Map(placed.map((node) => [node.key, node]));
  const layers = tops.map((_, layer) =>
    placed.filter((node) => node.layer === layer).sort((a, b) => a.x - b.x),
  );
  const paths = portsOf(pairsOf(output, byKey, (placedNode) => placedNode.node.level)).map(
    (link): EdgePath => {
      const { source, target } = link.pair;
      const points = link.pair.drawnAfter ? [] : graph.edge(target.key, source.key).points.slice(1, -1);
      return {
        source: source.key,
        target: target.key,
        links: link.pair.links,
        d: edgePath(route(target, source, points, link)),
      };
    },
  );
  return { width: label.width, height: label.height, nodes: placed, byKey, layers, paths };
};

/**
 * Where the view starts along one axis when a graph opens (SR-111 AK1), in the coordinates of the
 * scrolled sheet: the node at `centre` in the middle of the view, unless that shows more than `margin` of
 * empty sheet beyond the drawing (`start`, `size`); then the drawing's edge stays `margin` from the
 * view's. A drawing that fits the view with its margins stands in the middle. So the node is always in
 * view, and in its middle whenever the drawing reaches half a view beyond it on both sides.
 */
export const viewStart = (
  centre: number,
  start: number,
  size: number,
  view: number,
  margin: number,
): number => {
  const low = start - margin;
  const high = start + size + margin - view;
  return high < low ? start + (size - view) / 2 : Math.min(Math.max(centre - view / 2, low), high);
};
