// The cycle one new derivation relation closes (SR-067 AK3, SR-090, D-012), for `relation.add`.
// A relation from the child to the parent closes a cycle exactly when the walk up from the parent
// reaches the child (hand-over of #102); a relation of an element to itself is a cycle on its own.
// The hint names that one cycle, the shortest way back through the new relation (breadth first),
// not every element of the strongly connected component it joins (`workspace.check` lists those).
// A walk up follows each element's own relations (`parentsOf`), so `upwardGraph` builds the graph
// without the incoming relation index of the whole store: the walk reads the elements above the
// parent and nothing else (N-036).
import type { CommandName } from "../catalog.js";
import type { ElementRecord } from "../model/index.js";
import type { DerivationGraph, DerivationLink, TraceContext } from "./graph.js";
import { derivationGraph, parentsOf, walkDerivation } from "./graph.js";
import type { Cycle, GraphEdge, Step } from "./walk.js";
import { pathTo } from "./walk.js";

/**
 * The derivation graph for walks up only (`walkDerivation` with `direction: "up"`, `parentsOf`),
 * with an empty incoming index instead of the one of the whole store: a walk down (`childrenOf`)
 * on it finds no children. Throws `metamodel.meaning-unassigned` naming `command` like
 * `derivationGraph` (SR-013 AK3).
 */
export const upwardGraph = (context: Omit<TraceContext, "incoming">, command: CommandName): DerivationGraph =>
  derivationGraph(
    {
      ...context,
      incoming: {
        store: context.store,
        metamodel: context.metamodel,
        relationsById: new Map(),
        referencesById: new Map(),
      },
    },
    command,
  );

/** Whether `a` and `b` are records of the same file. */
const sameFile = (a: ElementRecord, b: ElementRecord): boolean =>
  a.repository === b.repository && a.file === b.file;

/** The cycle the step `child -> step.to` closes, as a list of one (empty when it closes none). */
const cycleThrough = (
  graph: DerivationGraph,
  child: ElementRecord,
  step: Step<DerivationLink>,
): Cycle<GraphEdge<DerivationLink>>[] => {
  const up = walkDerivation(graph, [step.to], { direction: "up" });
  // The child as the store of `graph` holds it, so that the edges of the cycle meet in it.
  const reached = up.nodes.find((node) => sameFile(node.element, child));
  if (reached === undefined) {
    return [];
  }
  const from = reached.element;
  // From the parent up to the child; none when the child is the parent.
  const path = pathTo(up, from);
  return [
    {
      elements: [from, ...path.map((edge) => edge.from)],
      edges: [{ from, to: step.to, link: { ...step.link, source: from } }, ...path],
    },
  ];
};

/**
 * The cycle of derivations that the relation of `child` under `key` at position `index` closes, as
 * a list of one or none: its elements from the child on (child, parent, then up to the child again)
 * and its edges, the relation itself first, for `cycleFindings`. `child` may be any record of the
 * element's file (one just written); the cycle holds the records of `graph`'s store. None when the
 * relation closes no cycle, or does not name one available element (a missing or ambiguous target
 * is no edge, SR-090).
 */
export const closedCycle = (
  graph: DerivationGraph,
  child: ElementRecord,
  key: string,
  index: number,
): Cycle<GraphEdge<DerivationLink>>[] =>
  parentsOf(graph, child)
    .steps.filter((step) => step.link.key === key && step.link.index === index)
    .flatMap((step) => cycleThrough(graph, child, step));
