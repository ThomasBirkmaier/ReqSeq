// The `trace` block (architecture README section 5, ADR-0008): the derivation graph over the element
// store and the walk the chain (SR-022), related elements (SR-023), affected elements (SR-024) and
// cycles (SR-090) share. It has no command of its own; the commands of those SRs build on it.
//
// Use (one consistent view, ADR-0008):
//   const graph = derivationGraph(await traceContext(workspace), "trace.chain"); // SR-013 AK3
// (`trace.chain` stands for the command of SR-022, which is not in the catalog yet)
//   const result = walkDerivation(graph, [element], { direction: "down", maxDepth, leaves });
// `result.nodes` (each element once, breadth first, with depth and `via`), `pathTo(result, element)`,
// `result.edges` (every step, `cyclic` inside a cycle), `result.cycles`, `result.unresolved` and
// `result.incomplete` (SR-006 AK2). `walk(starts, expand, options)` takes any steps (SR-024), and
// `cyclesOf(store.elements, derivationEdges(graph))` finds the cycles of the whole store (SR-090).
// Children come from the model's incoming relation index (`model/incoming.ts`).
export {
  CYCLE_NAMES_SHOWN,
  cycleFindings,
  derivationCycleFindings,
  derivationCycleProblemsState,
} from "./cycles.js";
export type { DerivationGraph, DerivationLink, DerivationWalkOptions, TraceContext } from "./graph.js";
export {
  childrenOf,
  derivationEdges,
  derivationGraph,
  parentsOf,
  traceContext,
  walkDerivation,
} from "./graph.js";
export type {
  Cycle,
  Expand,
  Expansion,
  GraphEdge,
  Step,
  Unresolved,
  UnresolvedState,
  WalkCycle,
  WalkEdge,
  WalkNode,
  WalkOptions,
  WalkResult,
  WalkUnresolved,
} from "./walk.js";
export { cyclesOf, pathTo, walk } from "./walk.js";
