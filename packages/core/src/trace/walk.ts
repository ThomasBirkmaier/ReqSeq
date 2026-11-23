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
// - `maxNodes` (SR-111, the graph of at most `limit` nodes): once the walk has reached that many
//   elements besides the starts, it expands no further element; the elements it reached keep their
//   depth, the ones it did not expand say so (`expanded`), and `cut` is set when one of them lies
//   within `maxDepth`. The reached elements are the first ones of the whole walk, in its order, so
//   the nearest levels; the bound is `maxNodes` plus the steps of the last element expanded.
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
  /**
   * Once this many elements besides the starts are reached, no further element is expanded
   * (`WalkResult.cut`). Undefined: no bound.
   */
  readonly maxNodes?: number;
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
  /** Its steps were asked for (`expand`): false for an element at `maxDepth` or beyond `maxNodes`. */
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
  /** Every step taken, in the order the walk took them: by the node they start from, in node order. */
  readonly edges: readonly WalkEdge<E>[];
  /** The cycles of the walked graph, in the order of their first element among the nodes. */
  readonly cycles: readonly WalkCycle<E>[];
  /** What the expanded elements could not follow, in walk order. */
  readonly unresolved: readonly WalkUnresolved<E>[];
  /** Some expanded element said that part of its steps cannot be read here (SR-006 AK2). */
  readonly incomplete: boolean;
  /** `maxNodes` kept an element within `maxDepth` from being expanded: the walk is not whole. */
  readonly cut: boolean;
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
  /** The walk asked for its steps. */
  expanded: boolean;
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
  expanded: false,
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
  return cyclesAmong(vertices.filter((v) => v.incoming > 0));
};

/**
 * The cycles of `rest`, vertices whose edges all lead to one of them (what the peel of `findCycles`
 * leaves), with their elements in the order of `rest`; sets `cycle` on each vertex of one.
 */
const cyclesAmong = <G>(rest: readonly Vertex<G>[]): OpenCycle<G>[] => {
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

/**
 * The positions of the reached elements that the peel of `findCycles` leaves, in order, from the
 * edges as positions (`from[e]` to `to[e]`, ordered by `from`, as the walk takes them) of `count`
 * elements: typed arrays instead of a vertex with a list per element (SR-082 AK4, #2496).
 */
const unpeeled = (count: number, from: readonly number[], to: readonly number[]): number[] => {
  const incoming = new Int32Array(count);
  // The edges of position i are first[i] to first[i + 1] - 1.
  const first = new Int32Array(count + 1);
  for (let e = 0; e < to.length; e += 1) {
    const target = Number(to[e]);
    incoming[target] = Number(incoming[target]) + 1;
    const after = Number(from[e]) + 1;
    first[after] = Number(first[after]) + 1;
  }
  for (let i = 0; i < count; i += 1) {
    first[i + 1] = Number(first[i + 1]) + Number(first[i]);
  }
  const peel: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (incoming[i] === 0) {
      peel.push(i);
    }
  }
  for (let v = peel.pop(); v !== undefined; v = peel.pop()) {
    for (let e = Number(first[v]); e < Number(first[v + 1]); e += 1) {
      const next = Number(to[e]);
      const left = Number(incoming[next]) - 1;
      incoming[next] = left;
      if (left === 0) {
        peel.push(next);
      }
    }
  }
  const rest: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (Number(incoming[i]) > 0) {
      rest.push(i);
    }
  }
  return rest;
};

/**
 * The cycles of the walked graph of `elements` with the edges as positions (`fromAt[e]` to `toAt[e]`):
 * vertices only for what the peel leaves, the cycles and what lies below them, often none.
 */
const walkCycles = <G>(
  elements: readonly ElementRecord[],
  fromAt: readonly number[],
  toAt: readonly number[],
): OpenCycle<G>[] => {
  const rest = unpeeled(elements.length, fromAt, toAt);
  if (rest.length === 0) {
    return [];
  }
  const left = new Set(rest);
  const vertices = new Map<number, Vertex<G>>();
  elements.forEach((element, at) => {
    if (left.has(at)) {
      vertices.set(at, vertex<G>(element, 0, undefined));
    }
  });
  for (let e = 0; e < fromAt.length; e += 1) {
    const from = vertices.get(Number(fromAt[e]));
    const to = vertices.get(Number(toAt[e]));
    if (from !== undefined && to !== undefined) {
      link(from, to);
    }
  }
  return cyclesAmong([...vertices.values()]);
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
 * lookup by record per step; the reached elements are positions in arrays and the edges pairs of
 * positions, so the cycle search peels them without another lookup and builds vertices only for what
 * the peel leaves (`walkCycles`): a chain of 42,000 elements allocates one node per element and one
 * edge per step (SR-082 AK4, #2496).
 */
export const walk = <E, L = never>(
  starts: readonly ElementRecord[],
  expand: Expand<E>,
  options: WalkOptions<L> = {},
): WalkResult<E, L> => {
  const { maxDepth, leaves, maxNodes = Number.POSITIVE_INFINITY } = options;
  const expands = (depth: number): boolean => maxDepth === undefined || depth < maxDepth;
  // The reached elements by position, in walk order; no object per element until the nodes.
  const position = new Map<ElementRecord, number>();
  const elements: ElementRecord[] = [];
  const depths: number[] = [];
  const vias: (OpenEdge<E> | undefined)[] = [];
  const reach = (element: ElementRecord, depth: number, via: OpenEdge<E> | undefined): number => {
    const at = elements.length;
    position.set(element, at);
    elements.push(element);
    depths.push(depth);
    vias.push(via);
    return at;
  };
  for (const element of starts) {
    if (!position.has(element)) {
      reach(element, 0, undefined);
    }
  }
  const wasExpanded: number[] = [];
  const edges: OpenEdge<E>[] = [];
  // The ends of each edge as positions, for the cycle search.
  const fromAt: number[] = [];
  const toAt: number[] = [];
  const unresolved: WalkUnresolved<E>[] = [];
  let incomplete = false;
  let cut = false;
  // The elements besides the starts are counted against `maxNodes`.
  const startCount = elements.length;
  // Breadth first, level by level: the list grows while it is read.
  for (let at = 0, element = elements[0]; element !== undefined; at += 1, element = elements[at]) {
    const depth = Number(depths[at]);
    if (!expands(depth)) {
      continue;
    }
    if (elements.length - startCount >= maxNodes) {
      cut = true;
      break;
    }
    wasExpanded.push(at);
    const expansion = expand(element, depth);
    incomplete ||= expansion.incomplete;
    for (const { link: unfollowed, state } of expansion.unresolved) {
      unresolved.push({ from: element, link: unfollowed, state });
    }
    for (const step of expansion.steps) {
      const edge: OpenEdge<E> = { from: element, to: step.to, link: step.link, cyclic: false };
      edges.push(edge);
      fromAt.push(at);
      toAt.push(position.get(step.to) ?? reach(step.to, depth + 1, edge));
    }
  }
  const isExpanded = new Uint8Array(elements.length);
  for (const at of wasExpanded) {
    isExpanded[at] = 1;
  }
  const cycles = walkCycles<OpenEdge<E>>(elements, fromAt, toAt);
  markCycleEdges(cycles, edges);
  const nodes = elements.map((element, at): WalkNode<E, L> => ({
    element,
    depth: Number(depths[at]),
    via: vias[at],
    expanded: isExpanded[at] === 1,
    leaves: leaves?.(element) ?? NO_LEAVES,
  }));
  return walkResult({ nodes, edges, cycles: cycles.map(closed), unresolved, incomplete, cut });
};

/**
 * The result of `walk` with `byElement` built on first read (`pathTo`): a chain of 40,000 elements
 * does not need it (SR-082 AK4, ThomasBirkmaier/ReqSeq-archive#227). A function of its own, so that its
 * getter keeps only the nodes alive, not the arrays and the map of the walk (#2496).
 */
const walkResult = <E, L>(result: Omit<WalkResult<E, L>, "byElement">): WalkResult<E, L> => {
  let byElement: ReadonlyMap<ElementRecord, WalkNode<E, L>> | undefined;
  return {
    ...result,
    get byElement() {
      byElement ??= new Map(result.nodes.map((n) => [n.element, n]));
      return byElement;
    },
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
