// The derivation graph (D-012, SR-013, ADR-0004): which elements are parents and children of which.
// The relation kinds come from the metamodel's meaning `derivation` (`requireMeaning`,
// `relationKindsWithMeaning`), never from fixed keys such as `derives-from` (SR-013 AK1, AK3).
// Direction (ADR-0004): the source of a derivation relation is the child, its target the parent.
// Inline references are no part of it (ADR-0004: they count for outdated checks and affected
// elements, not for the chain).
//
// - Parents: the element's own derivation items, each looked up with `targetState` (D-058), as the
//   element view and `followTargets` do. An `available` target is a step; every other target is
//   unresolved with its state. `inaccessible` (a repository of the workspace file that is not on
//   this machine) and `unknown-repository` mark the walk incomplete (SR-006 AK2, spec question #193);
//   `missing` (SR-089) and `ambiguous` (SR-088) are findings of their own and do not.
// - Children: the incoming derivation relations of the element (`incomingTo`, in the order of the
//   index). While several files of its repository share its UUID (SR-088), `targetState` calls
//   each such relation's target `ambiguous` and follows none upwards; downwards the same relations
//   are unresolved with that state (the element and its twins), so the chain shows the gap (SR-022
//   AK3) instead of an element without children. Relations are stored only in the child's file
//   (ADR-0004), so children in a repository that is not on this machine cannot be seen: while the
//   workspace file lists such a repository, every step down is incomplete (assumption, spec
//   question #262, option 1).
// - All edges (`derivationEdges`, SR-090): every derivation relation of the index whose target is
//   the one record of its UUID in the repository it points into, without a `targetState` each.
import type { CommandName } from "../catalog.js";
import type { MetamodelRelationKind } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState, relationKindsWithMeaning, requireMeaning } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, IncomingIndex, IncomingRelation } from "../model/index.js";
import { elementStoreState, hasId, incomingFor, targetState } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type {
  Expansion,
  GraphEdge,
  Step,
  Unresolved,
  UnresolvedState,
  WalkOptions,
  WalkResult,
} from "./walk.js";
import { walk } from "./walk.js";

/** The states a trace computation reads, each read once (ADR-0008), and the incoming index of the store. */
export interface TraceContext {
  readonly layout: Pick<WorkspaceLayout, "repositories">;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly incoming: IncomingIndex;
}

/** Reads layout, metamodel and element store of `workspace` once and takes the incoming index of that store. */
export const traceContext = async (workspace: Workspace): Promise<TraceContext> => {
  const layout = await workspace.get(workspaceLayoutState);
  const metamodel = await workspace.get(metamodelState);
  const store = await workspace.get(elementStoreState);
  return { layout, metamodel, store, incoming: incomingFor(workspace, store, metamodel) };
};

/** The derivation graph on a trace context. */
export interface DerivationGraph extends TraceContext {
  /**
   * The relation kinds with the meaning `derivation`, in metamodel order, whose key the metamodel
   * defines as a relation kind (a property of the same key wins, as in every check).
   */
  readonly kinds: readonly MetamodelRelationKind[];
  /** The same kinds by key. */
  readonly kindByKey: ReadonlyMap<string, MetamodelRelationKind>;
  /** The workspace file lists a repository that is not on this machine: a step down is incomplete. */
  readonly unavailable: boolean;
}

/**
 * The derivation graph of `context`. Throws `metamodel.meaning-unassigned` naming `command` when no
 * relation kind has the meaning `derivation` (SR-013 AK3).
 */
export const derivationGraph = (context: TraceContext, command: CommandName): DerivationGraph => {
  requireMeaning(context.metamodel, "derivation", command);
  // `keyDefinition`'s rule: a property of the same key wins, so its key holds no relation kind.
  const kinds = relationKindsWithMeaning(context.metamodel, "derivation").filter(
    (kind) => !context.metamodel.properties.some((p) => p.key === kind.key),
  );
  return {
    ...context,
    kinds,
    kindByKey: new Map(kinds.map((k) => [k.key, k])),
    unavailable: context.layout.repositories.some((r) => !r.available),
  };
};

/**
 * A derivation relation as the child's file stores it (ADR-0004: source = child, target = parent),
 * in the shape of the incoming index's relations, so a step down passes the index's own link:
 * `source` is the child, `key` the key of its relation kind (`DerivationGraph.kindByKey`), `index`
 * the position in the list under `key` (`relationPath` gives `[key, index]`), `item` the item as
 * written (a mapping with a text `id`).
 */
export type DerivationLink = Pick<IncomingRelation, "kind" | "source" | "key" | "index" | "item">;

/** The parents of `element`: one step per derivation item that names an available element. */
export const parentsOf = (graph: DerivationGraph, element: ElementRecord): Expansion<DerivationLink> => {
  const steps: Step<DerivationLink>[] = [];
  const unresolved: Unresolved<DerivationLink>[] = [];
  let incomplete = false;
  for (const { key } of graph.kinds) {
    // A relation kind holds a list (`relationItems` with `many`); one target there has none.
    const value: unknown = element.data[key];
    const items: readonly unknown[] = Array.isArray(value) ? value : NONE;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!hasId(item)) {
        continue;
      }
      const link: DerivationLink = { kind: "relation", source: element, key, index, item };
      const state = targetState(graph.layout, graph.store, element.repository, item);
      if (state.kind === "available") {
        steps.push({ to: state.element, link });
        continue;
      }
      unresolved.push({ link, state });
      incomplete ||= state.kind === "inaccessible" || state.kind === "unknown-repository";
    }
  }
  return { steps, unresolved, incomplete };
};

/**
 * The children of `element` (named by its repository and UUID): one step per derivation relation
 * that points at it; unresolved as `ambiguous` instead while other files of its repository share
 * its UUID (see the file comment).
 */
export const childrenOf = (graph: DerivationGraph, element: ElementRecord): Expansion<DerivationLink> => {
  const { repository } = element;
  // The relations `incomingTo` gives, read from the index directly: inline references are no
  // derivation (ADR-0004), so they are not read at all.
  const links = graph.incoming.relationsById.get(element.id);
  if (links === undefined) {
    // No relation points at it (a leaf of the chain, SR-082 AK4): nothing more to look up.
    return { steps: NONE, unresolved: NONE, incomplete: graph.unavailable };
  }
  // Most UUIDs have one record: only a shared one is looked at further (SR-088).
  const records = graph.store.byId.get(element.id) ?? NONE;
  const twins = records.length > 1 ? records.filter((r) => r.repository === repository) : NONE;
  const ambiguous: UnresolvedState | undefined =
    twins.length > 1 ? { kind: "ambiguous", repository, elements: twins } : undefined;
  const steps: Step<DerivationLink>[] = [];
  const unresolved: Unresolved<DerivationLink>[] = [];
  for (const link of links) {
    if (graph.kindByKey.has(link.key) && link.repository === repository) {
      if (ambiguous === undefined) {
        steps.push({ to: link.source, link });
      } else {
        unresolved.push({ link, state: ambiguous });
      }
    }
  }
  return { steps, unresolved, incomplete: graph.unavailable };
};

const NONE: readonly never[] = Object.freeze([]);

/** The one record of `records` in `repository` (`resolveTarget` finds it); undefined for none or several. */
const onlyRecordIn = (records: readonly ElementRecord[], repository: string): ElementRecord | undefined => {
  let found: ElementRecord | undefined;
  for (const record of records) {
    if (record.repository === repository) {
      if (found !== undefined) {
        return undefined;
      }
      found = record;
    }
  }
  return found;
};

/**
 * Every derivation relation of the store as an edge from the child (`from`, the source) to the
 * parent (`to`) whose target is `available`: the one record of its UUID in the repository it points
 * into (as `targetState` finds it; a repository that is not here holds no record). In the order of
 * `IncomingIndex.relationsById`: by its UUIDs (in no defined order: a fresh index has them in the
 * order first named, an index carried over a save adds new ones last, #267), then each list in
 * index order. For the cycles of the whole store (SR-090): `cyclesOf(store.elements,
 * derivationEdges(graph))`, whose cycles and their elements come in store order whatever the edge
 * order (only each cycle's `edges` follow it).
 */
export const derivationEdges = (graph: DerivationGraph): GraphEdge<DerivationLink>[] => {
  const edges: GraphEdge<DerivationLink>[] = [];
  for (const [id, links] of graph.incoming.relationsById) {
    const records = graph.store.byId.get(id) ?? NONE;
    for (const link of links) {
      const parent = graph.kindByKey.has(link.key) ? onlyRecordIn(records, link.repository) : undefined;
      if (parent !== undefined) {
        edges.push({ from: link.source, to: parent, link });
      }
    }
  }
  return edges;
};

export interface DerivationWalkOptions<L> extends WalkOptions<L> {
  /** `up`: from children to parents (SR-022 AK2, SR-023 AK3); `down`: from parents to children (SR-022 AK1, SR-023 AK1). */
  readonly direction: "up" | "down";
}

/**
 * Walks the derivation graph from `starts` (`walk`): up along `parentsOf` or down along
 * `childrenOf`, with depth, edges, cycles, `maxDepth`, unresolved targets, `incomplete` and leaves.
 */
export const walkDerivation = <L = never>(
  graph: DerivationGraph,
  starts: readonly ElementRecord[],
  options: DerivationWalkOptions<L>,
): WalkResult<DerivationLink, L> => {
  const { direction, ...rest } = options;
  return walk(starts, direction === "up" ? (e) => parentsOf(graph, e) : (e) => childrenOf(graph, e), rest);
};
