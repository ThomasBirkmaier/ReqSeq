// The neighbourhood of an element (SR-107, D-031, D-062): "Das Tool muss beim geöffneten Element
// seine Parents dauerhaft und seine Children und eingehenden Beziehungen auf Abruf zeigen." The
// `trace.neighbourhood` command is `traceNeighbourhood` and `neighbourhoodOutput`. It is the walk of
// `trace.chain` (chain.ts) over every relation kind, every property of kind `relation` and every
// inline reference instead of the derivation graph, and it marks each edge as repeated and outdated.
// The graph of SR-111 (D-063) uses the same command.
//
// - Up and down are two walks of the links from the element (`walk`, graph.ts), each element once per
//   walk at its shortest depth, `maxDepth` per direction. Up follows the links the element's file
//   stores: its relations and relation properties, then its inline references (`outgoingOf`). Down
//   follows the links that point at it (`incomingOf`, the incoming index): the relations, then the
//   references. ADR-0004: the source of a link is placed below its target.
// - What is followed: every relation key and every inline reference, or only the keys in `kinds`
//   and the meanings in `meanings` (`neighbourhoodFilter`). A key that is both a property and a
//   relation kind counts as a property, as everywhere (`relationKeysOf`).
// - A view (SR-040, `appliesIn`) is a filter on the steps (`within`): an element that does not apply
//   in it is not reached; the root always is.
// - `repeated` (SR-107 AK3): an edge leads, in its own walk, to an element that this walk first
//   reached through another edge, or to the root. Assumption (spec question #421, option A): the
//   first occurrence is the one the breadth-first walk reaches first (shortest depth, then link
//   order). It holds within one call and within the followed links, because the walk knows nothing
//   else.
// - `outdated` (SR-107 AK4) is the rule of SR-025 (`isOutdatedVersion`), the one the hints use.
// - `incomplete` (SR-006 AK2): up, a link into a repository that is not here or not in the workspace
//   file; down, any repository of the workspace file that is not on this machine (the sources lie in
//   their own files, assumption #262 option 1, as `childrenOf`).
// - Unresolved links (a missing or ambiguous target, SR-088, SR-089) are no steps and not listed:
//   `element.get` and `workspace.check` report them. Down, while several files of the element's
//   repository share its UUID (SR-088), no link is followed, as in `childrenOf`.
// - Pages (SR-082 AK4): as in `chainOutput`. The walks are always complete; the page holds `limit`
//   nodes from `offset` (the root, the up walk, the down walk) and the edges that lead to them in
//   their walk, so each edge is on one page.
// - Cost: linear in the elements and links reached; the output adds one short ID and one title per
//   node of the page, and the current version of each edge target of the page (`versionsOf`).
import type { CommandName } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { MetamodelRelationKind, TraceNeighbourhoodOutput } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import type {
  ElementRecord,
  IncomingLink,
  ReferenceTargetState,
  RelationKey,
  ShortIds,
} from "../model/index.js";
import {
  currentVersionsOf,
  hasId,
  incomingTo,
  isOutdatedVersion,
  referenceTargetState,
  referencesOf,
  relationKeysOf,
  targetState,
} from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { ChainNode, ChainPage } from "./chain.js";
import { chainNode, titles, within } from "./chain.js";
import type { TraceContext } from "./graph.js";
import type { Expansion, Step, WalkEdge, WalkResult } from "./walk.js";
import { walk } from "./walk.js";

/** The meaning of an edge in the output (`data-export#/$defs/relation` `meaning`). */
export type NeighbourhoodMeaning = "derivation" | "replacement" | "exclusion" | "reference";

/** Which links the neighbourhood follows (see the file comment). */
export interface NeighbourhoodFilter {
  /** Keys of relation kinds or of properties of kind `relation`. */
  readonly kinds?: readonly string[];
  readonly meanings?: readonly NeighbourhoodMeaning[];
}

/** What a neighbourhood computation reads, and which links it follows. */
export interface NeighbourhoodContext extends TraceContext {
  /** The relation keys that are followed, with their definitions. */
  readonly keys: ReadonlyMap<string, RelationKey>;
  /** Whether inline references are followed. */
  readonly references: boolean;
  /** The workspace file lists a repository that is not on this machine: a step down is incomplete. */
  readonly unavailable: boolean;
}

/** The meaning of a relation kind by key; a key that is also a property has none (`relationKeysOf`). */
const relationMeanings = (metamodel: Metamodel): ReadonlyMap<string, MetamodelRelationKind["meaning"]> => {
  const properties = new Set(metamodel.properties.map((p) => p.key));
  return new Map(metamodel.relations.filter((r) => !properties.has(r.key)).map((r) => [r.key, r.meaning]));
};

/**
 * The context of a neighbourhood: of `context`'s relation keys, those in `filter.kinds` or with a
 * meaning in `filter.meanings`, and whether references are followed. Without both lists, every one.
 * The keys come in the order of `relationKeysOf`.
 */
export const neighbourhoodContext = (
  context: TraceContext,
  filter: NeighbourhoodFilter,
): NeighbourhoodContext => {
  const { kinds, meanings } = filter;
  const all = relationKeysOf(context.metamodel);
  const unavailable = context.layout.repositories.some((r) => !r.available);
  if (kinds === undefined && meanings === undefined) {
    return { ...context, keys: all, references: true, unavailable };
  }
  const meaningOf = relationMeanings(context.metamodel);
  const keys = new Map(
    [...all].filter(([key]) => {
      const meaning = meaningOf.get(key);
      return (
        (kinds?.includes(key) ?? false) || (meaning !== undefined && (meanings?.includes(meaning) ?? false))
      );
    }),
  );
  return { ...context, keys, references: meanings?.includes("reference") ?? false, unavailable };
};

/**
 * Throws `input.invalid` for the keys in `kinds` that are no relation kind and no property of kind
 * `relation` of `metamodel` (`relationKeysOf`), naming the field `kinds` and the valid keys. Shared by
 * `trace.neighbourhood` and `trace.matrix`.
 */
export const checkRelationKinds = (
  metamodel: Metamodel,
  kinds: readonly string[] | undefined,
  command: CommandName,
): void => {
  const valid = [...relationKeysOf(metamodel).keys()];
  const unknown = (kinds ?? []).filter((key) => !valid.includes(key));
  if (unknown.length > 0) {
    throw new CommandError(
      "input.invalid",
      `unknown kind of relation: ${unknown.join(", ")}; the keys of relation kinds and relation properties are ${valid.join(", ")}`,
      { command, fields: ["kinds"], unknown, kinds: valid },
    );
  }
};

const NONE: readonly never[] = Object.freeze([]);

/**
 * What the file of `element` stores that the neighbourhood follows: its relations and relation
 * properties in the order of its frontmatter keys and items, then its inline references (the order
 * of `outgoingLinks`, over the followed keys only). A target that is `available` is a step; one in a
 * repository that is not here or not in the workspace file makes the walk incomplete; a missing or
 * ambiguous one is no step (see the file comment).
 */
export const outgoingOf = (
  context: NeighbourhoodContext,
  element: ElementRecord,
): Expansion<IncomingLink> => {
  const { layout, store, keys } = context;
  const steps: Step<IncomingLink>[] = [];
  let incomplete = false;
  const follow = (state: ReferenceTargetState, link: IncomingLink): void => {
    if (state.kind === "available") {
      steps.push({ to: state.element, link });
    } else {
      incomplete ||= state.kind === "inaccessible" || state.kind === "unknown-repository";
    }
  };
  const addItem = (key: string, index: number | undefined, item: unknown): void => {
    if (!hasId(item)) {
      return;
    }
    const state = targetState(layout, store, element.repository, item);
    // The link as the index holds it: `repository` is where the item points.
    const repository = state.kind === "available" ? state.element.repository : element.repository;
    follow(state, { kind: "relation", source: element, key, index, item, repository });
  };
  const { data } = element;
  for (const key of Object.keys(data)) {
    const relation = keys.get(key);
    if (relation === undefined) {
      continue;
    }
    const value: unknown = data[key];
    if (!Array.isArray(value)) {
      // One target; under a key with `many` it has none (SR-085 reports it).
      if (!relation.many) {
        addItem(key, undefined, value);
      }
    } else if (relation.many) {
      for (let index = 0; index < value.length; index += 1) {
        addItem(key, index, value[index]);
      }
    }
  }
  if (context.references) {
    for (const reference of referencesOf(element, context.metamodel)) {
      follow(referenceTargetState(layout, store, element.repository, reference), {
        kind: "reference",
        source: element,
        reference,
      });
    }
  }
  return { steps, unresolved: NONE, incomplete };
};

/** Whether the neighbourhood follows `link` (a relation of a followed key, or a followed reference). */
const followed = (context: NeighbourhoodContext, link: IncomingLink): boolean =>
  link.kind === "relation" ? context.keys.has(link.key) : context.references;

/**
 * The links that point at `element` and are followed, relations first, then references, each one a
 * step to its source; none while other files of its repository share its UUID (SR-088).
 */
const incomingOf = (context: NeighbourhoodContext, element: ElementRecord): Expansion<IncomingLink> => {
  const { repository, id } = element;
  const records = context.store.byId.get(id) ?? NONE;
  const ambiguous = records.length > 1 && records.filter((r) => r.repository === repository).length > 1;
  const steps: Step<IncomingLink>[] = [];
  if (!ambiguous) {
    // Without references the relations are read from the index directly: `incomingTo` would also
    // resolve every reference to the element, which a derivation-only walk never needs (SR-082 AK4).
    const links: readonly IncomingLink[] = context.references
      ? incomingTo(context.incoming, repository, id)
      : (context.incoming.relationsById.get(id) ?? NONE);
    for (const link of links) {
      if (followed(context, link) && (link.kind === "reference" || link.repository === repository)) {
        steps.push({ to: link.source, link });
      }
    }
  }
  return { steps, unresolved: NONE, incomplete: context.unavailable };
};

/** Which way the neighbourhood goes from its root (the `direction` of `trace.neighbourhood`). */
export type NeighbourhoodDirection = "up" | "down" | "both";

export interface NeighbourhoodOptions {
  readonly direction: NeighbourhoodDirection;
  /** The deepest depth in each direction (0: the root only); undefined: as far as the links go. */
  readonly maxDepth?: number;
  /** Whether an element is part of the neighbourhood, e.g. it applies in a view (SR-040). Default: every one. */
  readonly includes?: (element: ElementRecord) => boolean;
  /** The bound of each walk (`WalkOptions.maxNodes`, the graph of SR-111). Default: none. */
  readonly maxNodes?: number;
}

/** One walk of the neighbourhood. */
export interface NeighbourhoodWalk {
  readonly direction: "up" | "down";
  readonly result: WalkResult<IncomingLink, never>;
}

export interface Neighbourhood {
  readonly root: ElementRecord;
  /** Whether the root's links were looked at (false only for `maxDepth` 0). */
  readonly rootExpanded: boolean;
  /** The up walk first, then the down walk; each starts with the root. */
  readonly walks: readonly NeighbourhoodWalk[];
  /** Some part of the neighbourhood lies in a repository that is not on this machine (SR-006 AK2). */
  readonly incomplete: boolean;
}

/** The neighbourhood of `root` (see the file comment): the walks in `options.direction`. */
export const traceNeighbourhood = (
  context: NeighbourhoodContext,
  root: ElementRecord,
  options: NeighbourhoodOptions,
): Neighbourhood => {
  const { direction, maxDepth, includes, maxNodes } = options;
  const limit = {
    ...(maxDepth === undefined ? {} : { maxDepth }),
    ...(maxNodes === undefined ? {} : { maxNodes }),
  };
  const walks: NeighbourhoodWalk[] = [];
  const walkOf = (way: "up" | "down", expand: (element: ElementRecord) => Expansion<IncomingLink>): void => {
    const expansion =
      includes === undefined ? expand : (e: ElementRecord) => within(expand(e), includes, way === "down");
    walks.push({ direction: way, result: walk<IncomingLink>([root], expansion, limit) });
  };
  if (direction !== "down") {
    walkOf("up", (e) => outgoingOf(context, e));
  }
  if (direction !== "up") {
    walkOf("down", (e) => incomingOf(context, e));
  }
  return {
    root,
    rootExpanded: maxDepth === undefined || maxDepth > 0,
    walks,
    incomplete: walks.some((w) => w.result.incomplete),
  };
};

/** What `neighbourhoodOutput` needs besides the neighbourhood. */
export interface NeighbourhoodOutputContext {
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
}

/** The current version of an element, undefined when it has none. */
export type VersionLookup = (element: ElementRecord) => string | undefined;

/**
 * Gives the current versions of the elements the edges of the page lead to, for `outdated`
 * (`currentVersionsOf`); called once, with each element once.
 */
export type VersionsOf = (targets: readonly ElementRecord[]) => Promise<VersionLookup>;

/**
 * The `VersionsOf` of a workspace: the current versions as `currentVersionsOf` reads them (only the
 * files of the targets), undefined for an element that has none. Shared by `trace.neighbourhood` and
 * `trace.matrix`.
 */
export const currentVersionLookup =
  (workspace: Workspace): VersionsOf =>
  async (targets) => {
    const versions = await currentVersionsOf(workspace, targets);
    return (element) => {
      const entry = versions.get(element);
      return entry?.kind === "version" ? entry.version : undefined;
    };
  };

type NeighbourhoodEdge = TraceNeighbourhoodOutput["edges"][number];

/** The key's description in the output: whether it is a property, and its relation kind's meaning. */
export const keyInfo = (
  metamodel: Metamodel,
): ((key: string) => Pick<NeighbourhoodEdge, "property" | "meaning">) => {
  const properties = new Set(metamodel.properties.map((p) => p.key));
  const meanings = relationMeanings(metamodel);
  return (key) => {
    if (properties.has(key)) {
      return { property: true };
    }
    const meaning = meanings.get(key);
    return meaning === undefined ? {} : { meaning };
  };
};

/**
 * One page of the neighbourhood as `trace.neighbourhood` gives it (catalog output). The nodes are
 * the root, then those of the up walk, then those of the down walk (each walk without its root);
 * `total` counts them all. Only the nodes of the page are built, with the edges that lead to them in
 * their walk. `versionsOf` gives the current versions of the targets of those edges. Default page:
 * every node.
 */
export const neighbourhoodOutput = async (
  n: Neighbourhood,
  context: NeighbourhoodOutputContext,
  page: ChainPage,
  versionsOf: VersionsOf,
): Promise<TraceNeighbourhoodOutput> => {
  const { shortIds, metamodel } = context;
  const node = chainNode(shortIds, titles(metamodel));
  const rootOnPage = page.offset === 0;
  const nodes: ChainNode[] = rootOnPage ? [node(n.root, 0, n.rootExpanded)] : [];
  const onEdges: { readonly walk: NeighbourhoodWalk; readonly edge: WalkEdge<IncomingLink> }[] = [];
  // The position among all nodes of a walk's second node; the root is the first of all.
  let start = 1;
  for (const walked of n.walks) {
    const { direction, result } = walked;
    const onPage = new Set<ElementRecord>(rootOnPage ? [n.root] : []);
    // This walk's nodes on the page, after its root; clamped, so a page that ends before the walk
    // starts takes none of it (`slice` counts a negative end from the back).
    const first = Math.max(1, page.offset - start + 1);
    const last = Math.max(first, page.offset + page.limit - start + 1);
    for (const { element, depth, expanded } of result.nodes.slice(first, last)) {
      onPage.add(element);
      nodes.push(node(element, depth, expanded, direction));
    }
    start += result.nodes.length - 1;
    // A loop, not a spread: a whole neighbourhood can have over 100,000 edges.
    for (const edge of result.edges) {
      if (onPage.has(edge.to)) {
        onEdges.push({ walk: walked, edge });
      }
    }
  }
  const targetOf = ({ walk: { direction }, edge }: (typeof onEdges)[number]): ElementRecord =>
    direction === "up" ? edge.to : edge.from;
  const versionOf = await versionsOf([...new Set(onEdges.map(targetOf))]);
  const infoOf = keyInfo(metamodel);
  const edges = onEdges.map((entry): NeighbourhoodEdge => {
    const { walk: walked, edge } = entry;
    const { link } = edge;
    const target = targetOf(entry);
    const stored = link.kind === "relation" ? link.item["version"] : link.reference.version;
    return {
      source: link.source.id,
      sourceRepository: link.source.repository,
      target: target.id,
      targetRepository: target.repository,
      link: link.kind,
      ...(link.kind === "relation" ? { kind: link.key, ...infoOf(link.key) } : { meaning: "reference" }),
      direction: walked.direction,
      cyclic: edge.cyclic,
      repeated: walked.result.byElement.get(edge.to)?.via !== edge,
      outdated: isOutdatedVersion(stored, versionOf(target)),
    };
  });
  return { root: n.root.id, nodes, total: start, edges, incomplete: n.incomplete };
};
