// The graph walk of the trace block (ADR-0008: "Chains and coverage are graph walks with cycle
// detection"): breadth first from one element or a set, over a function that gives the next steps of
// an element. The derivation graph (`graph.ts`) gives parents or children; SR-024 may give its own
// steps (every incoming relation and reference first, then along the chain) to the same walk.
//
// - Each element is reached once, at its shortest depth from the nearest start (SR-023 AK2), with
//   the edge it was first reached through (`via`; `pathTo` gives the whole way, SR-024 AK1). A start
//   stays a start: depth 0 and no `via`, also when another start leads to it (the edge into it is
//   still in `edges`; SR-023 can find it there).
// - Every step from an element the walk expands is an edge, also one into an element reached
//   before (a diamond, a cycle): the walk does not expand that element again, so it never loops.
// - Cycles: the strongly connected components of the walked subgraph that have more than one
//   element or an edge from an element to itself (SR-022 AK4, SR-090 AK1). A back edge "on the
//   current path" of the breadth-first tree is not enough: with S -> A -> C, S -> B, B -> C and
//   C -> B, C is reached through A, so the edge C -> B leaves C's tree path and the cycle B, C would
//   be missed. The components see every cycle the walk entered, with all its elements.
// - `maxDepth`: elements at that depth are reached but not expanded (SR-023 AK1); `expanded` says
//   which were, so a node without steps that was expanded is a real end (SR-022 AK3). The cycles
//   are those of the walked subgraph: a cycle that runs below `maxDepth` and closes only through an
//   element that was not expanded is not reported.
// - What the steps could not follow is collected (`unresolved`), and `incomplete` is set when a
//   step says so (SR-006 AK2).
// - Leaves (evidence seam, ADR-0012): `leaves(element)` gives what hangs below each reached element,
//   for example the evidence records of stage 4 (SR-028); stage 2 passes none. The walk only collects
//   them; what a missing leaf means (SR-022 AK3) is the command's.
import type { ElementRecord, TargetState } from "../model/index.js";

/** A target state other than `available`: why a step could not be taken. */
export type UnresolvedState = Exclude<TargetState, { readonly kind: "available" }>;

/** One step from an element to the next one, through `link` (what joins them, e.g. a relation). */
export interface Step<E> {
  readonly to: ElementRecord;
  readonly link: E;
}

/** A link of an element that leads to no element the walk can reach, and where its target is. */
export interface Unresolved<E> {
  readonly link: E;
  readonly state: UnresolvedState;
}

/** What one element leads to. */
export interface Expansion<E> {
  /** The next elements, in the order the walk visits them. */
  readonly steps: readonly Step<E>[];
  readonly unresolved: readonly Unresolved<E>[];
  /** Some part of what the element leads to cannot be read here (SR-006 AK2). */
  readonly incomplete: boolean;
}

/** The steps from `element`, reached at `depth` (0 for a start). Called once per expanded element. */
export type Expand<E> = (element: ElementRecord, depth: number) => Expansion<E>;

export interface WalkOptions<L> {
  /**
   * The deepest depth to reach (a whole number; 1: the direct steps only, 0: the starts only).
   * Undefined walks as far as the graph goes.
   */
  readonly maxDepth?: number;
  /** What hangs below each reached element (evidence records, stage 4). Default: none. */
  readonly leaves?: (element: ElementRecord) => readonly L[];
}

/** An edge between two elements. */
export interface GraphEdge<E> {
  readonly from: ElementRecord;
  readonly to: ElementRecord;
  readonly link: E;
}

/** A step the walk took: from an expanded element to `to`. */
export interface WalkEdge<E> extends GraphEdge<E> {
  /** Both ends lie in one cycle of `WalkResult.cycles` (also an edge from an element to itself). */
  readonly cyclic: boolean;
}

/** An element the walk reached. */
export interface WalkNode<E, L> {
  readonly element: ElementRecord;
  /** The shortest number of steps from a start; 0 for a start. */
  readonly depth: number;
  /** The edge it was first reached through, from an element one level up; undefined for a start. */
  readonly via: WalkEdge<E> | undefined;
  /** Its steps were asked for (`expand`): false only for an element at `maxDepth`. */
  readonly expanded: boolean;
  /** What `WalkOptions.leaves` gave for it, in that order; none without `leaves`. */
  readonly leaves: readonly L[];
}

/** A cycle: a strongly connected component with more than one element or an edge to itself. */
export interface Cycle<G> {
  /** Its elements, in the order of the elements of the graph. */
  readonly elements: readonly ElementRecord[];
  /** The edges between its elements, in the order of the edges of the graph. */
  readonly edges: readonly G[];
}

/** A cycle in the walked graph, in the walk's order. */
export type WalkCycle<E> = Cycle<WalkEdge<E>>;

/** A link that could not be followed, with the element whose expansion gave it. */
export interface WalkUnresolved<E> extends Unresolved<E> {
  readonly from: ElementRecord;
}

export interface WalkResult<E, L> {
  /** Every reached element once, breadth first: the starts in the given order, then level by level. */
  readonly nodes: readonly WalkNode<E, L>[];
  /** The node of each reached element (by record). */
  readonly byElement: ReadonlyMap<ElementRecord, WalkNode<E, L>>;
  /** Every step taken, in the order the walk took them. */
  readonly edges: readonly WalkEdge<E>[];
  /** The cycles of the walked graph, in the order of their first element among the nodes. */
  readonly cycles: readonly WalkCycle<E>[];
  /** What the expanded elements could not follow, in walk order. */
  readonly unresolved: readonly WalkUnresolved<E>[];
  /** Some expanded element said that part of its steps cannot be read here (SR-006 AK2). */
  readonly incomplete: boolean;
}
/** A cycle while it is collected. */
interface OpenCycle<G> {
  readonly elements: ElementRecord[];
  /** The same elements, to test an edge's ends. */
  readonly members: Set<ElementRecord>;
  readonly edges: G[];
}

/**
 * A vertex of the graph: an element with the vertices its edges lead to (`out`), the number of
 * edges into it, the fields of Tarjan's algorithm, and for the walk its depth and the edge it was
 * first reached through.
 */
interface Vertex<G> {
  readonly element: ElementRecord;
  readonly depth: number;
  readonly via: G | undefined;
  readonly out: Vertex<G>[];
  /** The edges into it from vertices not peeled yet (`findCycles`). */
  incoming: number;
  /** Visit number; -1 while not visited. */
  index: number;
  low: number;
  onStack: boolean;
  /** The cycle it lies in, if any. */
  cycle: OpenCycle<G> | undefined;
}

const vertex = <G>(element: ElementRecord, depth: number, via: G | undefined): Vertex<G> => ({
  element,
  depth,
  via,
  out: [],
  incoming: 0,
  index: -1,
  low: 0,
  onStack: false,
  cycle: undefined,
});

/** Adds the edge from `from` to `to`. */
const link = <G>(from: Vertex<G>, to: Vertex<G>): void => {
  from.out.push(to);
  to.incoming += 1;
};

/**
 * Sets `cycle` on every vertex of a strongly connected component of `vertices` that is a cycle (more
 * than one vertex, or an edge from its vertex to itself), with its members but no elements yet:
 * Tarjan's algorithm with an explicit stack, no recursion. Every edge of `vertices` must lead to one
 * of them. A component that is no cycle allocates nothing.
 */
const findComponents = <G>(vertices: readonly Vertex<G>[]): void => {
  let counter = 0;
  const stack: Vertex<G>[] = [];
  const visit = (v: Vertex<G>): { readonly v: Vertex<G>; readonly out: Iterator<Vertex<G>, undefined> } => {
    v.index = counter;
    v.low = counter;
    counter += 1;
    stack.push(v);
    v.onStack = true;
    return { v, out: v.out.values() };
  };
  const close = (root: Vertex<G>): void => {
    let member = stack.pop();
    if (member === root && !root.out.includes(root)) {
      root.onStack = false;
      return;
    }
    const cycle: OpenCycle<G> = { elements: [], members: new Set(), edges: [] };
    for (; member !== undefined; member = member === root ? undefined : stack.pop()) {
      member.onStack = false;
      member.cycle = cycle;
      cycle.members.add(member.element);
    }
  };
  for (const root of vertices) {
    if (root.index !== -1) {
      continue;
    }
    const frames = [visit(root)];
    for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
      const { v } = frame;
      const step = frame.out.next();
      if (step.done !== true) {
        const to = step.value;
        if (to.index === -1) {
          frames.push(visit(to));
        } else if (to.onStack) {
          v.low = Math.min(v.low, to.index);
        }
        continue;
      }
      frames.pop();
      const parent = frames.at(-1);
      if (parent !== undefined) {
        parent.v.low = Math.min(parent.v.low, v.low);
      }
      if (v.low === v.index) {
        close(v);
      }
    }
  }
};

/**
 * Finds the cycles of the graph of `vertices` (every edge leads to one of them), sets `cycle` on each
 * vertex that lies in one, and gives the cycles with their elements in the order of `vertices`,
 * without edges yet. First the vertices without an edge in are peeled off, again and again (Kahn):
 * they lie on no cycle, and in a chain that is most of them. Tarjan's algorithm then runs on the
 * rest only (the cycles and what lies below them); no edge leads from the rest to a peeled vertex.
 */
const findCycles = <G>(vertices: readonly Vertex<G>[]): OpenCycle<G>[] => {
  const peel = vertices.filter((v) => v.incoming === 0);
  for (let v = peel.pop(); v !== undefined; v = peel.pop()) {
    for (const to of v.out) {
      to.incoming -= 1;
      if (to.incoming === 0) {
        peel.push(to);
      }
    }
  }
  const rest = vertices.filter((v) => v.incoming > 0);
  findComponents(rest);
  const cycles: OpenCycle<G>[] = [];
  for (const { cycle, element } of rest) {
    if (cycle !== undefined) {
      if (cycle.elements.length === 0) {
        cycles.push(cycle);
      }
      cycle.elements.push(element);
    }
  }
  return cycles;
};

/** A cycle as the functions here give it: elements and edges. */
const closed = <G>({ elements, edges }: OpenCycle<G>): Cycle<G> => ({ elements, edges });

/**
 * The cycles of the graph of `elements` and `edges` (`Cycle`), linear in elements and edges. Edges
 * with an end outside `elements` are ignored. Each cycle names its elements in the order of
 * `elements` and its edges (the objects passed) in the order of `edges`; the cycles come in the order
 * of their first element. SR-090 passes the derivation edges of the whole store
 * (`derivationEdges`).
 */
export const cyclesOf = <G extends GraphEdge<unknown>>(
  elements: readonly ElementRecord[],
  edges: readonly G[],
): Cycle<G>[] => {
  const vertices = new Map<ElementRecord, Vertex<G>>();
  for (const element of elements) {
    if (!vertices.has(element)) {
      vertices.set(element, vertex<G>(element, 0, undefined));
    }
  }
  for (const edge of edges) {
    const from = vertices.get(edge.from);
    const to = vertices.get(edge.to);
    if (from !== undefined && to !== undefined) {
      link(from, to);
    }
  }
  const cycles = findCycles([...vertices.values()]);
  for (const edge of edges) {
    const cycle = vertices.get(edge.from)?.cycle;
    if (cycle?.members.has(edge.to) === true) {
      cycle.edges.push(edge);
    }
  }
  return cycles.map(closed);
};

const NO_LEAVES: readonly never[] = Object.freeze([]);

/** A walk edge while the walk does not know yet whether it lies in a cycle. */
type OpenEdge<E> = GraphEdge<E> & { cyclic: boolean };

/**
 * Marks the edges of `edges` whose ends lie in the same cycle as `cyclic` and adds them to that
 * cycle, in the order of `edges`. Only the elements of cycles are looked up.
 */
const markCycleEdges = <E>(
  cycles: readonly OpenCycle<OpenEdge<E>>[],
  edges: readonly OpenEdge<E>[],
): void => {
  if (cycles.length === 0) {
    return;
  }
  const cycleOf = new Map(
    cycles.flatMap((cycle) => cycle.elements.map((element) => [element, cycle] as const)),
  );
  for (const edge of edges) {
    const cycle = cycleOf.get(edge.from);
    if (cycle?.members.has(edge.to) === true) {
      edge.cyclic = true;
      cycle.edges.push(edge);
    }
  }
};

/**
 * Walks breadth first from `starts` (each record once, in the given order) along `expand`. See the
 * file comment for depth, edges, cycles, `maxDepth`, `unresolved`, `incomplete` and leaves. One
 * lookup by record per step; the cycles are found on the vertices the walk built, without another.
 */
export const walk = <E, L = never>(
  starts: readonly ElementRecord[],
  expand: Expand<E>,
  options: WalkOptions<L> = {},
): WalkResult<E, L> => {
  const { maxDepth, leaves } = options;
  const expands = (depth: number): boolean => maxDepth === undefined || depth < maxDepth;
  const reached = new Map<ElementRecord, Vertex<OpenEdge<E>>>();
  for (const element of starts) {
    if (!reached.has(element)) {
      reached.set(element, vertex<OpenEdge<E>>(element, 0, undefined));
    }
  }
  const edges: OpenEdge<E>[] = [];
  const unresolved: WalkUnresolved<E>[] = [];
  let incomplete = false;
  // A Map iterates the entries added while it is read: breadth first, level by level.
  for (const from of reached.values()) {
    if (!expands(from.depth)) {
      continue;
    }
    const expansion = expand(from.element, from.depth);
    incomplete ||= expansion.incomplete;
    for (const { link: unfollowed, state } of expansion.unresolved) {
      unresolved.push({ from: from.element, link: unfollowed, state });
    }
    for (const step of expansion.steps) {
      const edge: OpenEdge<E> = { from: from.element, to: step.to, link: step.link, cyclic: false };
      edges.push(edge);
      let to = reached.get(step.to);
      if (to === undefined) {
        to = vertex(step.to, from.depth + 1, edge);
        reached.set(step.to, to);
      }
      link(from, to);
    }
  }
  const vertices = [...reached.values()];
  const cycles = findCycles(vertices);
  markCycleEdges(cycles, edges);
  const nodes = vertices.map(({ element, depth, via }): WalkNode<E, L> => ({
    element,
    depth,
    via,
    expanded: expands(depth),
    leaves: leaves?.(element) ?? NO_LEAVES,
  }));
  return {
    nodes,
    byElement: new Map(nodes.map((n) => [n.element, n])),
    edges,
    cycles: cycles.map(closed),
    unresolved,
    incomplete,
  };
};

/**
 * The way from a start to the reached `element` along the edges each element was first reached
 * through (a shortest way): its edges from the start on; none for a start or an element not reached.
 */
export const pathTo = <E, L>(result: WalkResult<E, L>, element: ElementRecord): readonly WalkEdge<E>[] => {
  const path: WalkEdge<E>[] = [];
  let node = result.byElement.get(element);
  while (node?.via !== undefined) {
    path.push(node.via);
    node = result.byElement.get(node.via.from);
  }
  return path.reverse();
};
