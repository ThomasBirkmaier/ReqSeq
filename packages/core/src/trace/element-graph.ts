// The graph of an element (SR-111, D-063): "Das Tool muss das aktuelle Element und seine Beziehungen
// als geschichteten Graphen mit wählbarer Tiefe zeigen." The `trace.graph` command is `elementGraph`
// and `elementGraphOutput`. (`graph.ts` is the derivation graph.) The layout is the app's (ADR-0002
// rule 3): core gives the nodes with their levels and marks and the edges between them.
//
// - Walks: the two walks of the neighbourhood (`traceNeighbourhood`, neighbourhood.ts) from the
//   element, up along the links the files store and down along the links that point at it, over the
//   followed kinds, in the view, to `maxDepth`. Each walk stops expanding once it has reached `limit`
//   elements (`WalkOptions.maxNodes`), so the whole chain over every kind costs `limit` elements plus
//   the steps of one, not the tens of thousands of a large chain (SR-082 AK4).
// - Nodes: each element once. One that both walks reach is a node at the smaller distance, above on a
//   tie. Level 0 is the element, -d an element d steps up, +d one d steps down. Order: the element,
//   then for each distance from the nearest the elements above, then those below, each in walk order;
//   the first `limit` are kept (assumption: at most 500 nodes for "die ganze Kette", nearest levels
//   first, D-063 "zeigt nie den ganzen Bestand").
// - The bound loses nothing: a cut walk reached at least `limit` elements, and each of them is a
//   node candidate (in its walk, or nearer in the other) that comes before every element the walk did
//   not reach (those lie at its last depth or deeper, after the reached ones in walk order). So the
//   first `limit` nodes are those of the whole walks.
// - `expanded` (truncation contract): the node's links in the direction of its level were looked at
//   (both for the element), and every element they lead to is a node. `truncated`: a walk was cut,
//   or nodes were left out.
// - Edges: every followed link from a node to another node, by source in node order, then as the
//   source's file stores them (`outgoingOf`): every link a walk took, and links it did not take (one
//   between two parents, or from a child of the element to a parent). A link to itself is no edge.
//   `outdated` is the rule of SR-025 (`isOutdatedVersion`) against the current version of the target.
// - Marks (SR-111 AK4) come from the command (`MarksOf`): their rules live in the hints and in the
//   chain (`outdatedAmong`, `invalidStatuses`, `lacksEvidence`), and the hints import trace.
// - Cost: the two bounded walks; the output adds one short ID and one title per node, the stored
//   links of each node once more, and the current versions of the edge targets (`versionsOf`).
import type { TraceGraphOutput } from "../generated/types.js";
import type { ElementRecord, IncomingLink, ShortIds } from "../model/index.js";
import { isOutdatedVersion } from "../model/index.js";
import { chainNode, titles } from "./chain.js";
import type { Neighbourhood, NeighbourhoodContext, NeighbourhoodWalk, VersionsOf } from "./neighbourhood.js";
import { keyInfo, outgoingOf, traceNeighbourhood } from "./neighbourhood.js";
import type { WalkNode, WalkResult } from "./walk.js";

/** A mark of a node (SR-111 AK4), in the order the output lists them. */
export type GraphMark = TraceGraphOutput["nodes"][number]["marks"][number];

export interface ElementGraphOptions {
  /** The deepest level in each direction (0: the element only); undefined: as far as the links go. */
  readonly maxDepth?: number;
  /** Whether an element is part of the graph, e.g. it applies in a view (SR-040). Default: every one. */
  readonly includes?: (element: ElementRecord) => boolean;
  /** The most nodes, the element included (at least 1). */
  readonly limit: number;
}

/** A node of the graph. */
export interface GraphPlace {
  readonly element: ElementRecord;
  /** 0 for the element, negative above it, positive below it. */
  readonly level: number;
  readonly expanded: boolean;
}

export interface ElementGraph {
  readonly root: ElementRecord;
  /** The nodes in output order: the element, then by distance, above before below. */
  readonly nodes: readonly GraphPlace[];
  readonly truncated: boolean;
  /** Some part of the graph lies in a repository that is not on this machine (SR-006 AK2). */
  readonly incomplete: boolean;
}

type Walked = WalkResult<IncomingLink, never>;

/** One walk of the neighbourhood, as the nodes are placed. */
interface Side {
  readonly result: Walked;
  /** The position of the walk among the neighbourhood's walks (0 up, 1 down). */
  readonly side: number;
  /** -1 up, +1 down. */
  readonly sign: number;
  /** The elements each expanded element of the walk leads to. */
  readonly steps: ReadonlyMap<ElementRecord, readonly ElementRecord[]>;
}

/** An element one walk reached, as a candidate node. */
interface Candidate {
  readonly node: WalkNode<IncomingLink, never>;
  readonly walk: Side;
}

const NONE: readonly never[] = Object.freeze([]);

/** `walked` as the nodes are placed. */
const sideOf = (walked: NeighbourhoodWalk, side: number): Side => {
  const { direction, result } = walked;
  const steps = new Map<ElementRecord, ElementRecord[]>();
  for (const { from, to } of result.edges) {
    const list = steps.get(from);
    if (list === undefined) {
      steps.set(from, [to]);
    } else {
      list.push(to);
    }
  }
  return { result, side, sign: direction === "up" ? -1 : 1, steps };
};

/** The first `limit` nodes of `n` (see the file comment). */
const place = (n: Neighbourhood, limit: number): ElementGraph => {
  const sides = n.walks.map(sideOf);
  const best = new Map<ElementRecord, Candidate>();
  for (const walk of sides) {
    for (const node of walk.result.nodes) {
      const known = best.get(node.element);
      if (node.element !== n.root && (known === undefined || node.depth < known.node.depth)) {
        // Moved to the end: a node the down walk places nearer keeps the down walk's order.
        best.delete(node.element);
        best.set(node.element, { node, walk });
      }
    }
  }
  // Stable: within one distance and side, walk order.
  const ordered = [...best.values()].sort((a, b) => a.node.depth - b.node.depth || a.walk.side - b.walk.side);
  const kept = ordered.slice(0, limit - 1);
  const members = new Set<ElementRecord>([n.root, ...kept.map((c) => c.node.element)]);
  const whole = (walk: Side, element: ElementRecord): boolean =>
    (walk.steps.get(element) ?? NONE).every((to) => members.has(to));
  const nodes: GraphPlace[] = [
    { element: n.root, level: 0, expanded: n.rootExpanded && sides.every((walk) => whole(walk, n.root)) },
  ];
  for (const { node, walk } of kept) {
    nodes.push({
      element: node.element,
      level: walk.sign * node.depth,
      expanded: node.expanded && whole(walk, node.element),
    });
  }
  return {
    root: n.root,
    nodes,
    truncated: ordered.length > kept.length || sides.some(({ result }) => result.cut),
    incomplete: n.incomplete,
  };
};

/**
 * The graph of `root` (see the file comment): at most `options.limit` nodes, the nearest first, over
 * the links `context` follows.
 */
export const elementGraph = (
  context: NeighbourhoodContext,
  root: ElementRecord,
  options: ElementGraphOptions,
): ElementGraph => {
  const { maxDepth, includes, limit } = options;
  const n = traceNeighbourhood(context, root, {
    direction: "both",
    ...(maxDepth === undefined ? {} : { maxDepth }),
    ...(includes === undefined ? {} : { includes }),
    maxNodes: limit,
  });
  return place(n, limit);
};

/** The marks of each element of `elements` (SR-111 AK4), in output order; called once. */
export type MarksOf = (
  elements: readonly ElementRecord[],
) => Promise<(element: ElementRecord) => readonly GraphMark[]>;

/** What `elementGraphOutput` needs besides the graph: the followed links and short IDs. */
export interface ElementGraphOutputContext extends NeighbourhoodContext {
  readonly shortIds: ShortIds;
}

type GraphEdge = TraceGraphOutput["edges"][number];

/** A followed link between two nodes. */
interface Edge {
  readonly link: IncomingLink;
  readonly target: ElementRecord;
}

/**
 * The graph as `trace.graph` gives it (catalog output, without `problems`): the nodes with short
 * IDs, titles and marks (`marksOf`), and the edges between them with `outdated` (`versionsOf`).
 */
export const elementGraphOutput = async (
  graph: ElementGraph,
  context: ElementGraphOutputContext,
  versionsOf: VersionsOf,
  marksOf: MarksOf,
): Promise<Omit<TraceGraphOutput, "problems">> => {
  const { shortIds, metamodel } = context;
  const elements = graph.nodes.map((p) => p.element);
  const members = new Set(elements);
  const found: Edge[] = [];
  for (const source of elements) {
    for (const { to, link } of outgoingOf(context, source).steps) {
      if (to !== source && members.has(to)) {
        found.push({ link, target: to });
      }
    }
  }
  const [versionOf, marks] = await Promise.all([
    versionsOf([...new Set(found.map((e) => e.target))]),
    marksOf(elements),
  ]);
  const node = chainNode(shortIds, titles(metamodel));
  const nodes = graph.nodes.map(({ element, level, expanded }) => {
    const { depth: _depth, ...rest } = node(element, 0, expanded);
    return { ...rest, level, marks: [...marks(element)] };
  });
  const infoOf = keyInfo(metamodel);
  const edges = found.map(({ link, target }): GraphEdge => {
    const stored = link.kind === "relation" ? link.item["version"] : link.reference.version;
    return {
      source: link.source.id,
      sourceRepository: link.source.repository,
      target: target.id,
      targetRepository: target.repository,
      link: link.kind,
      ...(link.kind === "relation" ? { kind: link.key, ...infoOf(link.key) } : { meaning: "reference" }),
      outdated: isOutdatedVersion(stored, versionOf(target)),
    };
  });
  return { root: graph.root.id, nodes, edges, truncated: graph.truncated, incomplete: graph.incomplete };
};
