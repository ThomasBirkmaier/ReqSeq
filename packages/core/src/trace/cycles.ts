// Cycles in the derivations (SR-090, D-012) for `workspace.check` (SR-019). When relations with the
// meaning derivation form a cycle, the check reports the cycle with every element in it. A cycle is
// a strongly connected component of the derivation edges of the whole store (`cyclesOf` over
// `derivationEdges`, #258) with more than one element, or one element that derives from itself.
//
// - One problem per element of a cycle, so that every element is named with its own repository,
//   file and UUID (SR-019 AK2: "Art, Datei und Element"), as SR-088 names every file of a shared
//   UUID. Its target is the element's first derivation among the cycle's own edges (relation kinds
//   in metamodel order, then the items in file order), and its line the line of that item: the
//   edges that found the cycle name the target, so both always agree. The message names every
//   element of the cycle by type name and short ID (SR-084), the first `CYCLE_NAMES_SHOWN` of a
//   longer one, so that the output stays linear in the size of a cycle.
// - Severity `warning`: SR-022 AK4 calls a cycle a "Hinweis", and SR-019 AK2 ends the check with
//   exit code 1 for it, which a warning does (`ok` false, ADR-0009). No status changes.
// - Order: the cycles by their first element in store order, the elements of each in store order.
// - What the derivation edges leave out cannot close a cycle: a target that is missing (SR-089),
//   ambiguous (SR-088) or in a repository that is not on this machine (SR-006), inline references
//   and relations of other meanings (ADR-0004). Cycles across the repositories that are here count.
// - Without a relation kind with the meaning derivation there is no derivation to check: one `info`
//   names the missing assignment (SR-013 AK3; assumption, spec question #270 option 1), so `ok`
//   stays true. Against a metamodel that is not valid nothing is reported (#208, #220).
// - Cost (N-036): the incoming index of the store (shared with the other trace commands), one linear
//   pass for the cycles, and only for elements in a cycle short IDs, messages and lines. Lines are
//   looked up by reading the files of the elements in a cycle again (`locateFindings`): a cycle of
//   all 50,000 elements takes about 30 s, still within SR-020's 60 s.
// - `cycleFindings` makes the findings of any cycle of derivation edges, also one a command finds
//   itself (SR-067 AK3: a walk up from the parent of a new relation that reaches its child).
// - `elementCycleFindings` gives the hint of one element for its view (SR-026 AK3) without the
//   whole-store pass (below).
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { meaningUnassignedMessage, metamodelState } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, LocatableFinding, ShortIds } from "../model/index.js";
import {
  elementLabel,
  elementStoreState,
  locateFindings,
  relationPath,
  shortIdState,
} from "../model/index.js";
import { settledValue } from "../runtime/settled.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { DerivationGraph, DerivationLink } from "./graph.js";
import { derivationEdges, derivationGraph, parentsOf, traceContext, walkDerivation } from "./graph.js";
import { upwardGraph } from "./new-cycle.js";
import type { Cycle, GraphEdge } from "./walk.js";
import { cyclesOf } from "./walk.js";

/** The elements of a cycle a message names at most; the rest are counted (every one has its own problem). */
export const CYCLE_NAMES_SHOWN = 20;

/** The elements of `cycle` as a message names them: type name and short ID, the first ones of a long cycle (also `trace.chain`). */
export const cycleNames = (cycle: Cycle<unknown>, label: (element: ElementRecord) => string): string => {
  const shown = cycle.elements.slice(0, CYCLE_NAMES_SHOWN).map(label).join(", ");
  const more = cycle.elements.length - CYCLE_NAMES_SHOWN;
  return more > 0 ? `${shown}, and ${String(more)} more` : shown;
};

/** Where an edge's relation lies: the position of its kind in the metamodel order, then of its item. */
const rank = (graph: DerivationGraph, { link }: GraphEdge<DerivationLink>): readonly [number, number] => [
  graph.kinds.findIndex((kind) => kind.key === link.key),
  link.index ?? -1,
];

/** Whether the relation of `a` comes before the one of `b` (`rank`). */
const before = (
  graph: DerivationGraph,
  a: GraphEdge<DerivationLink>,
  b: GraphEdge<DerivationLink>,
): boolean => {
  const [kindA, itemA] = rank(graph, a);
  const [kindB, itemB] = rank(graph, b);
  return kindA !== kindB ? kindA < kindB : itemA < itemB;
};

/**
 * The findings `trace.cycle` of one cycle of derivation edges, one per element in the order of its
 * elements, before their lines are known (`locateFindings` adds them). The target of each element is
 * its first edge of `cycle.edges` (`rank`); an element without one (a cycle a caller put together)
 * is named without a target, at its `id`.
 */
export const cycleFindings = (
  graph: DerivationGraph,
  shortIds: ShortIds,
  cycle: Cycle<GraphEdge<DerivationLink>>,
): LocatableFinding[] => {
  const label = (element: ElementRecord): string =>
    elementLabel({ metamodel: graph.metamodel, shortIds }, element);
  const first = new Map<ElementRecord, GraphEdge<DerivationLink>>();
  for (const edge of cycle.edges) {
    const current = first.get(edge.from);
    if (current === undefined || before(graph, edge, current)) {
      first.set(edge.from, edge);
    }
  }
  const count = cycle.elements.length;
  const within = `is in a cycle of derivations with ${String(count)} elements (${cycleNames(cycle, label)})`;
  return cycle.elements.map((element): LocatableFinding => {
    const problem: Problem = {
      code: "trace.cycle",
      severity: "warning",
      message: `${label(element)} ${within}`,
      repository: element.repository,
      file: element.file,
      elementId: element.id,
    };
    const edge = first.get(element);
    if (edge === undefined) {
      return { element, path: ["id"], problem };
    }
    const kind = graph.kindByKey.get(edge.link.key)?.name ?? edge.link.key;
    const message =
      count === 1
        ? `${label(element)} derives from itself through its relation ${kind}`
        : `${problem.message}: its relation ${kind} to ${label(edge.to)} leads back to it`;
    return { element, path: relationPath(edge.link), problem: { ...problem, message, targetId: edge.to.id } };
  });
};

/**
 * The cycles of the derivation edges of the whole store as findings `trace.cycle` (see the file
 * comment), before their lines are known (`locateFindings` adds them).
 */
export const derivationCycleFindings = (graph: DerivationGraph, shortIds: ShortIds): LocatableFinding[] => {
  const out: LocatableFinding[] = [];
  for (const cycle of cyclesOf(graph.store.elements, derivationEdges(graph))) {
    // Appended one by one: a cycle of every element would overflow the stack as `push` arguments.
    for (const finding of cycleFindings(graph, shortIds, cycle)) {
      out.push(finding);
    }
  }
  return out;
};

/**
 * Every element of the workspace that lies in a cycle of derivations, as a problem with repository,
 * file, line, element and target (SR-090 AK1), for `workspace.check` (SR-019). Reads only the files
 * of elements in a cycle again, for the lines. Kept until the element store or the metamodel is
 * reset; no `carry` hook (ADR-0008): a change of one relation can close or open a cycle anywhere,
 * so the next check after a save or a watcher batch looks at all edges again.
 */
export const derivationCycleProblemsState = defineWorkspaceState(
  "derivation-cycles",
  async (workspace): Promise<readonly Problem[]> => {
    const metamodel = await workspace.get(metamodelState);
    // Nothing against a metamodel that is not valid: its errors are the findings (#208, #220).
    if (!metamodel.valid) {
      return [];
    }
    if (metamodel.meanings.derivation.length === 0) {
      return [
        {
          code: "metamodel.meaning-unassigned",
          severity: "info",
          message: meaningUnassignedMessage("derivation", "workspace.check"),
        },
      ];
    }
    const graph = derivationGraph(await traceContext(workspace), "workspace.check");
    const findings = derivationCycleFindings(graph, await workspace.get(shortIdState));
    return findings.length === 0 ? [] : locateFindings(await workspace.get(workspaceLayoutState), findings);
  },
  { dependsOn: [elementStoreState, metamodelState, shortIdState] },
);

/** What the cycle hint of one element reads: the states `element.get` works on. */
export interface ElementCycleContext {
  readonly workspace: Workspace;
  readonly layout: Pick<WorkspaceLayout, "repositories">;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
}

/**
 * The kept hints `trace.cycle` of `element` at the relation they name as its file holds it now: the
 * first relation of a derivation kind to the hint's target (as `cycleFindings` picks it), so its
 * line comes from that file; at the kept line where the file no longer has one.
 */
const keptAtElement = (
  graph: DerivationGraph,
  element: ElementRecord,
  kept: readonly Problem[],
): LocatableFinding[] => {
  const { steps } = parentsOf(graph, element);
  return kept.map((problem): LocatableFinding => {
    const step = steps.find((s) => s.to.id === problem.targetId);
    return step === undefined
      ? { element, path: [], at: "line", problem }
      : { element, path: relationPath(step.link), problem };
  });
};

/**
 * The hint `trace.cycle` of one element shown (SR-026 AK3), as `derivationCycleProblemsState` has
 * it: from that state when its build has ended (`settledValue`; the line from the file as it is now, `keptAtElement`), else
 * from a walk up from this element alone (ADR-0008: a single element never builds the incoming
 * index or the cycles of the whole store). The element lies in a cycle exactly when one of the
 * elements above it (its ancestors, reached through each one's own relations, `upwardGraph`) has a
 * derivation to it; the strongly connected component of the element is then the same in the graph
 * of these ancestors as in the whole store (every element on a way back to it is above it), so
 * `cyclesOf` and `cycleFindings` on that graph give the same hint as the whole-store pass, before
 * its line is known. `element` may be the element as its file holds it now; it is looked up in the
 * store by repository and file. None without a relation kind with the meaning `derivation` (the
 * check gives an info then, not a hint).
 */
export const elementCycleFindings = async (
  context: ElementCycleContext,
  element: ElementRecord,
): Promise<LocatableFinding[]> => {
  const { workspace, metamodel, store, shortIds } = context;
  if (metamodel.meanings.derivation.length === 0) {
    return [];
  }
  const sameFile = (p: Pick<Problem, "repository" | "file">): boolean =>
    p.repository === element.repository && p.file === element.file;
  const kept = await settledValue(workspace.peek(derivationCycleProblemsState));
  if (kept !== undefined) {
    const own = kept.filter((p) => p.code === "trace.cycle" && p.elementId === element.id && sameFile(p));
    return own.length === 0 ? [] : keptAtElement(upwardGraph(context, "element.get"), element, own);
  }
  const record = (store.byId.get(element.id) ?? []).find(sameFile);
  if (record === undefined) {
    return [];
  }
  const graph = upwardGraph(context, "element.get");
  const up = walkDerivation(graph, [record], { direction: "up" });
  if (!up.edges.some((edge) => edge.to === record)) {
    return [];
  }
  const above = new Set(up.nodes.map((node) => node.element));
  return cyclesOf(
    store.elements.filter((e) => above.has(e)),
    up.edges,
  )
    .filter((cycle) => cycle.elements.includes(record))
    .flatMap((cycle) => cycleFindings(graph, shortIds, cycle))
    .filter((finding) => finding.element === record)
    .map((finding) => ({ ...finding, element }));
};
