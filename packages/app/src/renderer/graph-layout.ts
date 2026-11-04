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
// - in a levelled layout, a link between two nodes of one level (#500): it would stack a level into
//   many layers and cost dagre most of SR-111 AK6's second. A graph is levelled above
//   `LEVEL_LAYERS_ABOVE` nodes, or when the links of its ranked layout would cross more than
//   `CROSSED_LAYERS_ABOVE` layers (#211: long chains within a level cost time with few nodes too).
// In a ranked layout the drawn layers are dagre's ranks, not the levels: a node stands one layer under
// each node it links to, also across levels (a diamond). In a levelled one, the layers follow the
// levels (every node of a level in one layer, in the order of the levels) when every node links to a
// node one level nearer the element; with cycles through the element a node may stand a layer off its
// level. Either way every node of a level below 0 stands above the element and every node of a level
// above 0 below it (AK1): a node whose links do not put it on its side (its walk reached it through a
// node that took its level from the other walk) gets an invisible layout link from the element, or to
// it, which is never drawn.
// With evidence (SR-111 AK3, `withEvidence`), each summary is one muted box below its node, joined to it
// by a layout link, so dagre makes room for it in the layer under the node. The boxes are no nodes: they
// are not in `nodes`, `byKey` or `layers`, so the keys never select them (AK5), and they do not count
// for the bounds of the levelled layout.
import type { TraceGraphOutput } from "@reqseq/core";
import type { Point } from "./dagre.js";
import { layoutGraphOf, runLayout } from "./dagre.js";
import type { GraphEdge, GraphEvidence, GraphNode } from "./graph.js";
import { keyOfNode, nodeKey } from "./graph.js";

/** The size of a node in CSS pixels; `styles.css` gives `.graph-node` the same, so no node is measured. */
export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 86;
/** The height of an evidence box (`.graph-evidence` in `styles.css`): up to three lines of muted text. */
export const EVIDENCE_HEIGHT = 64;
/** The space between two nodes of a layer, and between two layers. */
export const NODE_SEP = 24;
export const RANK_SEP = 56;
/**
 * Above this many nodes, the links between two nodes of one level are drawn after the layout, so the
 * layers follow the levels (#500). It is above every graph of `spec/` today, so those keep their ranked
 * layout. The 200 nearest nodes of the N-036 chains take about 0.4 of the layout time of their 500-node
 * graph; the time of a ranked graph is not bounded by its size, though (#211, `CROSSED_LAYERS_ABOVE`).
 */
export const LEVEL_LAYERS_ABOVE = 200;
/**
 * A graph of up to `LEVEL_LAYERS_ABOVE` nodes is levelled too when the links of its ranked layout would
 * cross more than this many layers in all (`crossedLayers`, #211). dagre lays out each crossed layer
 * with dummy nodes, so its time grows with the crossed layers, not with the nodes: 199 nodes whose
 * members derive from each other in chains of 20 within one level cross 1,863 layers and took about
 * 0.5 s ranked, chains of 40 about 1 s. At the bound a ranked graph of 200 nodes takes under half a second (chains of 5 whose members
 * derive from every member before them, 790). The most of any graph of `spec/` is 462 (the whole chain
 * of D-038, 196 nodes, on 2026-11-04), so those keep their ranked layout.
 */
export const CROSSED_LAYERS_ABOVE = 800;
/** Parents above, children below (D-063); the ports and `route` assume it. */
const RANK_DIRECTION = "TB";
/** How far a link leaves and enters a node straight up or down before it bends. */
const GUIDE = RANK_SEP / 4;
/** The ends of a node's links keep this far from its corners. */
const PORT_INSET = 12;

export type { Point } from "./dagre.js";

/** A box and its place: `x` and `y` are its top left corner; every box is `NODE_WIDTH` wide. */
interface PlacedBox {
  readonly key: string;
  readonly x: number;
  readonly y: number;
}

/** A node and its place; `layer` counts the drawn layers of nodes from the top. */
export interface PlacedNode extends PlacedBox {
  readonly node: GraphNode;
  readonly layer: number;
}

/** The evidence box of a node (`evidence:<repository>:<id>`), its place, and the line from its node. */
export interface PlacedEvidence extends PlacedBox {
  /** The key of its node. */
  readonly node: string;
  readonly evidence: GraphEvidence;
  /** The SVG path from its node down to it. */
  readonly d: string;
}

/** The key of the evidence box of the node `key`; never a node's key, which is `<repository>:<id>`. */
export const evidenceKey = (key: string): string => `evidence:${key}`;

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

const centreX = (node: PlacedBox): number => node.x + NODE_WIDTH / 2;

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
const route = (from: PlacedBox, to: PlacedBox, bends: readonly Point[], ports: Ports): Point[] => {
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

/**
 * A drawn line: its upper box (`target`, where a link points) and its lower one (`source`), and dagre's
 * bend points from its target to its source.
 */
interface Bent {
  readonly target: PlacedBox;
  readonly source: PlacedBox;
  /** None for a link drawn after the layout. */
  readonly bends: readonly Point[];
}

/** A drawn line and its ports. */
type Ported<B extends Bent> = B & { from: number; to: number };

/**
 * Where a curve without bends (drawn after the layout) is half a layer gap from the edge of `node`, the
 * height of a bend next to it: on the straight line between the centres of the two nodes. For an arch
 * (both nodes in one layer), the other node's centre. Two nodes of different layers are at least a layer
 * gap apart, so the point is never past the other node.
 */
const lean = (node: PlacedBox, other: PlacedBox): number => {
  if (node.y === other.y) {
    return centreX(other);
  }
  const gap = Math.abs(node.y - other.y) - NODE_HEIGHT;
  return centreX(node) + (centreX(other) - centreX(node)) * (RANK_SEP / 2 / gap);
};

/**
 * Where a bent curve passes the height of its bend next to `node`: a uniform B-spline does not pass
 * through a bend but through (previous + 4 · bend + next) / 6 of the points around it. The previous point
 * is the port, which is not known yet, so the node's centre stands for it.
 */
const near = (node: PlacedBox, bend: Point, next: number): number => (centreX(node) + 4 * bend.x + next) / 6;

/**
 * The ports of the drawn links, each from its target (above) to its source (below), the way dagre's
 * layout edge runs. The ends on one edge of a node (top or bottom) are spread along it in the order of
 * where each curve is half a layer gap from that edge (#555): a bent curve where it passes its first bend
 * (its last at the `to` end), a curve without bends on the straight line to the other node. So bent and
 * straight curves are compared at one height. Ties go by the same at the link's other end, so two links
 * between the same two nodes keep one order at both ends; then by the order of the output. Ordered so,
 * the curves of one edge seldom cross near it, but a curve that swings back after that height still can.
 * A node with one link on an edge meets it in the middle.
 */
const portsOf = <B extends Bent>(links: readonly B[]): Ported<B>[] => {
  interface End {
    readonly link: Ported<B>;
    readonly end: keyof Ports;
    readonly node: PlacedBox;
    readonly heading: number;
    readonly far: number;
  }
  const edges = new Map<string, End[]>();
  const add = (side: string, end: End): void => {
    const edge = `${side}:${end.node.key}`;
    const ends = edges.get(edge);
    if (ends === undefined) {
      edges.set(edge, [end]);
    } else {
      ends.push(end);
    }
  };
  const ported = links.map((bent): Ported<B> => {
    const { target: from, source: to, bends } = bent;
    const link = { ...bent, from: centreX(from), to: centreX(to) };
    const first = bends[0];
    const last = bends.at(-1);
    const atFrom = first === undefined ? lean(from, to) : near(from, first, bends[1]?.x ?? centreX(to));
    const atTo = last === undefined ? lean(to, from) : near(to, last, bends.at(-2)?.x ?? centreX(from));
    const down = from.y < to.y;
    add(down ? "bottom" : "top", { link, end: "from", node: from, heading: atFrom, far: atTo });
    add(down || from.y === to.y ? "top" : "bottom", {
      link,
      end: "to",
      node: to,
      heading: atTo,
      far: atFrom,
    });
    return link;
  });
  for (const ends of edges.values()) {
    ends.sort((a, b) => a.heading - b.heading || a.far - b.far);
    for (const [index, { link, end, node }] of ends.entries()) {
      link[end] = node.x + PORT_INSET + ((index + 0.5) * (NODE_WIDTH - 2 * PORT_INSET)) / ends.length;
    }
  }
  return ported;
};

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
  /** The drawn layers of nodes from the top, each from left to right. */
  readonly layers: readonly (readonly PlacedNode[])[];
  /** The evidence boxes, in the order of their nodes; none without the output's `evidence`. */
  readonly evidence: readonly PlacedEvidence[];
  /** Whether the links within a level are drawn after the layout, so the layers follow the levels. */
  readonly levelled: boolean;
  readonly paths: readonly EdgePath[];
}

/** The links of one node to another (`T` is how a node is known here: the output's node or its place). */
interface Pair<T> {
  readonly source: T;
  readonly target: T;
  /**
   * The links are left out of the ranking and drawn after the layout: they run against the levels of the
   * output (the target is farther down than the source), or the layout is levelled and both ends are of
   * one level.
   */
  readonly drawnAfter: boolean;
  readonly links: GraphEdge[];
}

/**
 * The links between two different nodes, one entry per ordered pair, in the order of the output; `nodes`
 * gives a node by its key, `level` its level in the output, `levelled` whether the layout is levelled.
 */
const pairsOf = <T>(
  output: TraceGraphOutput,
  nodes: ReadonlyMap<string, T>,
  level: (node: T) => number,
  levelled: boolean,
): Pair<T>[] => {
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

/** An invisible layout link from `from` (above) to `to` (below). */
interface Anchor {
  readonly from: string;
  readonly to: string;
}

/**
 * Keeps every node on its side of the element (SR-111 AK1, #519). A node of a level above 0 stands below
 * the element when a chain of layout links between levels leads down to it from the element, and a node
 * of a level below 0 above it when one leads from it up to the element. Such a link joins two different
 * levels, so it is in no cycle and dagre never reverses it; a link within a level can be, so it does not
 * count. A node without such a chain (the walk reached it through a node that took its level from the
 * other walk, in a cycle through the element) gets an invisible layout link from the element, or to it:
 * `minlen` 1 puts it on its side, `weight` 0 does not pull it nearer, and it is never drawn. Nodes are
 * taken nearest first, and an anchored node carries what hangs on it, so anchors are few. A graph whose
 * nodes all have such a chain gets none and keeps its layout. Links within a level do not count, so the
 * anchors are the same for a ranked and a levelled layout.
 */
const anchorsOf = (nodes: readonly GraphNode[], ranked: readonly Pair<GraphNode>[]): Anchor[] => {
  const [first] = nodes;
  if (first === undefined) {
    return [];
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
  const anchors: Anchor[] = [];
  for (const node of nodes) {
    const key = keyOfNode(node);
    if (node.level > 0 && !below.has(key)) {
      anchors.push({ from: root, to: key });
      reach(below, down, key);
    } else if (node.level < 0 && !above.has(key)) {
      anchors.push({ from: key, to: root });
      reach(above, up, key);
    }
  }
  return anchors;
};

/** A layout link from its upper node to its lower one. */
interface Link {
  readonly from: string;
  readonly to: string;
}

/**
 * The layout links split the way dagre's default acyclicer breaks cycles (only links within a level can
 * close one): a depth-first walk from each node in the order of `keys` reverses a link back to a node on
 * its path (`back`) and keeps the others (`forward`, by upper node). `order` has the nodes in reverse post
 * order, so every forward link runs from an earlier node to a later one.
 */
const acyclic = (
  keys: readonly string[],
  links: readonly Link[],
): { order: string[]; forward: Map<string, string[]>; back: Link[] } => {
  const next = new Map<string, string[]>(keys.map((key) => [key, []]));
  for (const { from, to } of links) {
    next.get(from)?.push(to);
  }
  // 1 while on the walk's path, 2 when done.
  const state = new Map<string, 1 | 2>();
  const order: string[] = [];
  const forward = new Map<string, string[]>(keys.map((key) => [key, []]));
  const back: Link[] = [];
  for (const start of keys) {
    if (state.has(start)) {
      continue;
    }
    const path = [{ key: start, index: 0 }];
    state.set(start, 1);
    for (let top = path.at(-1); top !== undefined; top = path.at(-1)) {
      const to = next.get(top.key)?.[top.index];
      top.index += 1;
      if (to === undefined) {
        state.set(top.key, 2);
        order.push(top.key);
        path.pop();
      } else if (state.get(to) === 1) {
        back.push({ from: top.key, to });
      } else {
        forward.get(top.key)?.push(to);
        if (!state.has(to)) {
          state.set(to, 1);
          path.push({ key: to, index: 0 });
        }
      }
    }
  }
  return { order: order.reverse(), forward, back };
};

/**
 * The crossed-layer count of a ranked layout of the layout links `links` between `keys`, counted in
 * O(V + E) before dagre runs (#211): a link from rank r to rank r + n crosses n - 1 layers. It estimates
 * the size of dagre's ranking, which places dummy nodes on each crossed layer (twice as many as this
 * count plus one per link, since dagre doubles `minlen`). Cycles are broken as dagre does (`acyclic`).
 * Each node takes the longest chain of links above it as its rank; a node that no link enters then moves
 * down to just above the highest node it links to. dagre's `tight-tree` ranker ranks differently, so the
 * estimate can err both ways (on random graphs up to about 2.2 times under).
 */
export const crossedLayers = (keys: readonly string[], links: readonly Link[]): number => {
  const { order, forward, back } = acyclic(keys, links);
  const below = (key: string): readonly string[] => forward.get(key) ?? [];
  const rank = new Map<string, number>();
  for (const key of order) {
    for (const to of below(key)) {
      rank.set(to, Math.max(rank.get(to) ?? 0, (rank.get(key) ?? 0) + 1));
    }
  }
  for (const key of order.filter((other) => !rank.has(other) && below(other).length > 0)) {
    rank.set(key, Math.min(...below(key).map((to) => rank.get(to) ?? 0)) - 1);
  }
  const span = ({ from, to }: Link): number => Math.abs((rank.get(to) ?? 0) - (rank.get(from) ?? 0)) - 1;
  let crossed = back.reduce((sum, link) => sum + span(link), 0);
  for (const from of order) {
    crossed += below(from).reduce((sum, to) => sum + span({ from, to }), 0);
  }
  return crossed;
};

/**
 * Whether the layout follows the levels (#500, #211): above `LEVEL_LAYERS_ABOVE` nodes, or when the
 * layout links of a ranked layout (`ranked` and `anchors`) would cross more than `CROSSED_LAYERS_ABOVE`
 * layers.
 */
const isLevelled = (
  output: TraceGraphOutput,
  ranked: readonly Pair<GraphNode>[],
  anchors: readonly Anchor[],
): boolean => {
  if (output.nodes.length > LEVEL_LAYERS_ABOVE) {
    return true;
  }
  const links = [
    ...ranked.map((pair) => ({ from: keyOfNode(pair.target), to: keyOfNode(pair.source) })),
    ...anchors,
  ];
  return crossedLayers(output.nodes.map(keyOfNode), links) > CROSSED_LAYERS_ABOVE;
};

/** Places the nodes of `output` and draws its links; deterministic: the same output gives the same layout. */
export const layoutGraph = (output: TraceGraphOutput): GraphLayout => {
  const nodes = new Map(output.nodes.map((node) => [keyOfNode(node), node]));
  const graph = layoutGraphOf();
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
  const rankedAll = pairsOf(output, nodes, (node) => node.level, false).filter((pair) => !pair.drawnAfter);
  const anchors = anchorsOf(output.nodes, rankedAll);
  const levelled = isLevelled(output, rankedAll, anchors);
  const ranked = levelled ? rankedAll.filter((pair) => pair.source.level !== pair.target.level) : rankedAll;
  for (const pair of ranked) {
    graph.setEdge(keyOfNode(pair.target), keyOfNode(pair.source), { minlen: 1, weight: 1 });
  }
  for (const { from, to } of anchors) {
    graph.setEdge(from, to, { minlen: 1, weight: 0 });
  }
  // Each evidence box below its node; a summary of a node that is not shown has no box.
  const summaries = new Map(
    (output.evidence ?? [])
      .map((evidence) => [nodeKey(evidence.repository, evidence.id), evidence] as const)
      .filter(([node]) => nodes.has(node)),
  );
  for (const node of summaries.keys()) {
    graph.setNode(evidenceKey(node), { width: NODE_WIDTH, height: EVIDENCE_HEIGHT });
    graph.setEdge(node, evidenceKey(node), { minlen: 1, weight: 1 });
  }
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
  // The bends first: the ports on a node's edge follow where each curve heads.
  const bent = pairsOf(output, byKey, (placedNode) => placedNode.node.level, levelled).map((pair) => ({
    target: pair.target,
    source: pair.source,
    links: pair.links,
    bends: pair.drawnAfter ? [] : graph.edge(pair.target.key, pair.source.key).points.slice(1, -1),
  }));
  const boxes = placed.flatMap((from) => {
    const evidence = summaries.get(from.key);
    if (evidence === undefined) {
      return [];
    }
    const key = evidenceKey(from.key);
    const centre = graph.node(key);
    const box = { key, x: centre.x - NODE_WIDTH / 2, y: centre.y - EVIDENCE_HEIGHT / 2 };
    return [{ target: from, source: box, evidence, bends: graph.edge(from.key, key).points.slice(1, -1) }];
  });
  // One port order for both: an evidence line leaves its node's bottom edge among the node's links.
  const lines = portsOf<Bent & { links?: GraphEdge[]; evidence?: GraphEvidence }>([...bent, ...boxes]);
  const paths = lines.flatMap((line): EdgePath[] =>
    line.links === undefined
      ? []
      : [
          {
            source: line.source.key,
            target: line.target.key,
            links: line.links,
            d: edgePath(route(line.target, line.source, line.bends, line)),
          },
        ],
  );
  const evidence = lines.flatMap((line): PlacedEvidence[] =>
    line.evidence === undefined
      ? []
      : [
          {
            ...line.source,
            node: line.target.key,
            evidence: line.evidence,
            d: edgePath(route(line.target, line.source, line.bends, line)),
          },
        ],
  );
  return {
    width: label.width,
    height: label.height,
    nodes: placed,
    byKey,
    layers,
    evidence,
    levelled,
    paths,
  };
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
