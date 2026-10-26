// The chain of an element (SR-022, D-012): "Das Tool muss zu jedem Element die vollständige Kette
// aufwärts bis zu den obersten Parents und abwärts bis zu den Nachweisen zeigen." The `trace.chain`
// command (SR-006, SR-022, SR-033) is `traceChain` and `chainOutput` on one derivation graph.
//
// - Up and down are two walks of the derivation graph from the element (`walk` with `parentsOf` or
//   `childrenOf`, `graph.ts`): each element once per direction at its shortest depth (AK1, AK2),
//   `maxDepth` per direction. The walk reaches every element once, so it stops at a cycle (AK4).
// - A view (SR-040, `appliesIn`) is a filter on the steps: an element that does not apply in it is
//   not reached, and nothing is reached through it. The root is always the start (assumption: the
//   chain of the element asked for, whatever the view). The variant views of stage 5 narrow it further.
// - Evidence (AK1, AK3 "Nachweis"): what hangs below an element of the downward chain comes through
//   the walk's leaves (`leaves`). Stage 2 has no evidence records (SR-028, stage 4): the command passes
//   none, and the core tests pass records of their own (#127 option 1). Test cases and executions in
//   the chain are SR-033 (stage 4).
// - Gaps (AK3), downward and only for elements whose children were looked at (`expanded`): an element
//   of a type with the meaning `need` without a child is `no-child`; an element of a type with the
//   meaning `requirement` without a child and without evidence is `no-evidence` (a requirement is
//   closed by a child or by its own evidence; SR-034 counts children for a parent). Other types have
//   no gap. A child that only an ambiguous relation names (SR-088, `childrenOf`) is not a child here.
// - Cycles (AK4): the cycles of each walk (strongly connected components, the notion of SR-090), one
//   hint `trace.cycle` each. When the root lies in a cycle, both walks see it: it is reported once.
// - `incomplete` (SR-006 AK2) and the unresolved links (SR-006 AK1, SR-088, SR-089) come from the
//   walks; downwards every step is incomplete while a repository of the workspace file is not on this
//   machine (`childrenOf`, assumption #262 option 1). An unresolved parent whose `id` is no UUID makes
//   the chain incomplete when its repository is not here, but it is not listed: the output names
//   elements by UUID, and the value-kind check reports such an item (SR-085).
// - Elements are named by UUID and workspace name of their repository (D-058). Two files of one
//   repository with the same UUID (SR-088) are two nodes, told apart only by `file`; edges and gaps
//   name both the same way.
// - Pages (SR-082 AK4, spec-frage #290): the walks are always complete, so depth, gaps, cycles and
//   `incomplete` are those of the whole chain; `chainOutput` builds one page of nodes (the root, the
//   upward ones, the downward ones) and the edges, gaps and unresolved relations of those nodes. An
//   edge belongs to the node it leads to in its walk, so each edge is on one page.
// - Cost (SR-082 AK4, N-036): the walks are linear in the elements and edges reached; the output adds
//   one short ID and one title per node of the page. At N-036 the largest chain has about 42,000
//   nodes, 112,000 edges and 36 MB of JSON as a whole (#227).
import type { Problem } from "../catalog.js";
import type { TraceChainOutput } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { meaningUnassignedMessage, typesWithMeaning } from "../metamodel/index.js";
import { isUuid } from "../model/elements.js";
import type { ElementRecord, ShortIds } from "../model/index.js";
import { UNKNOWN_TYPE_PREFIX, elementLabel, identifierField, titleKeyOf } from "../model/index.js";
import type { DerivationGraph, DerivationLink } from "./graph.js";
import { cycleNames } from "./cycles.js";
import { childrenOf, parentsOf } from "./graph.js";
import type { Expansion, WalkCycle, WalkResult } from "./walk.js";
import { walk } from "./walk.js";

/** Which way the chain goes from its root (the `direction` of `trace.chain`). */
export type ChainDirection = "up" | "down" | "both";

export interface ChainOptions<L> {
  readonly direction: ChainDirection;
  /** The deepest depth in each direction (0: the root only); undefined: as far as the graph goes. */
  readonly maxDepth?: number;
  /** Whether an element is part of the chain, e.g. it applies in a view (SR-040). Default: every one. */
  readonly includes?: (element: ElementRecord) => boolean;
  /** The evidence of an element of the downward chain (stage 4, SR-028). Default: none. */
  readonly leaves?: (element: ElementRecord) => readonly L[];
}

/** One walk of the chain. */
export interface ChainWalk<L> {
  readonly direction: "up" | "down";
  readonly result: WalkResult<DerivationLink, L>;
}

/** What is missing below an element of the downward chain (SR-022 AK3). */
export type GapKind = "no-child" | "no-evidence";

export interface ChainGap {
  readonly element: ElementRecord;
  readonly kind: GapKind;
}

/** Evidence of an element of the downward chain, one level below it. */
export interface ChainEvidence<L> {
  readonly element: ElementRecord;
  /** The depth of the element plus one. */
  readonly depth: number;
  readonly leaf: L;
}

/** The type meanings the gaps need; one that no type has is named here (SR-013 AK3). */
export type GapMeaning = "need" | "requirement";

export interface Chain<L> {
  readonly root: ElementRecord;
  /** Whether the root's parents or children were looked at (false only for `maxDepth` 0). */
  readonly rootExpanded: boolean;
  /** The upward walk first, then the downward one; each starts with the root. */
  readonly walks: readonly ChainWalk<L>[];
  /** The gaps of the downward walk, in node order. */
  readonly gaps: readonly ChainGap[];
  /** The evidence of the expanded elements of the downward walk, in node order. */
  readonly evidence: readonly ChainEvidence<L>[];
  /** The cycles of the walks, the upward ones first; a cycle both walks found is listed once. */
  readonly cycles: readonly WalkCycle<DerivationLink>[];
  /** The type meanings that no type has, so their gaps were not looked for. */
  readonly unassigned: readonly GapMeaning[];
  /** Some part of the chain lies in a repository that is not on this machine (SR-006 AK2). */
  readonly incomplete: boolean;
}

/** `expansion` without the steps to elements that are not part of the chain (`includes`). */
const within = (
  expansion: Expansion<DerivationLink>,
  includes: (element: ElementRecord) => boolean,
  down: boolean,
): Expansion<DerivationLink> => ({
  steps: expansion.steps.filter((step) => includes(step.to)),
  // Downwards the other end of an unresolved relation is the child that stores it.
  unresolved: down ? expansion.unresolved.filter((u) => includes(u.link.source)) : expansion.unresolved,
  incomplete: expansion.incomplete,
});

/** The keys of the effective types with `meaning`. */
const typeKeys = (metamodel: Metamodel, meaning: GapMeaning): ReadonlySet<string> =>
  new Set(typesWithMeaning(metamodel, meaning).map((t) => t.key));

/**
 * Whether the two cycles have the same elements. A cycle through the root is the same component in
 * both walks unless `maxDepth` cuts it: then each walk sees only the part within its reach, the two
 * parts overlap but differ, and both are reported (the hint of each names what its walk saw).
 */
const sameCycle = (a: WalkCycle<DerivationLink>, b: WalkCycle<DerivationLink>): boolean => {
  if (a.elements.length !== b.elements.length) {
    return false;
  }
  const members = new Set(a.elements);
  return b.elements.every((e) => members.has(e));
};

/** Gaps and evidence of the downward walk (see the file comment). */
const gapsOf = <L>(
  graph: DerivationGraph,
  down: WalkResult<DerivationLink, L>,
): { readonly gaps: ChainGap[]; readonly evidence: ChainEvidence<L>[] } => {
  const needs = typeKeys(graph.metamodel, "need");
  const requirements = typeKeys(graph.metamodel, "requirement");
  const gaps: ChainGap[] = [];
  const evidence: ChainEvidence<L>[] = [];
  // The walk expands its nodes in order and takes the steps of each one after the other, so the
  // edges come in the order of the nodes they start from: one pass over both, no lookup (SR-082 AK4).
  let next = 0;
  for (const { element, depth, expanded, leaves } of down.nodes) {
    let parent = false;
    while (down.edges[next]?.from === element) {
      parent = true;
      next += 1;
    }
    if (!expanded) {
      continue;
    }
    for (const leaf of leaves) {
      evidence.push({ element, depth: depth + 1, leaf });
    }
    if (parent) {
      continue;
    }
    if (needs.has(element.type)) {
      gaps.push({ element, kind: "no-child" });
    } else if (requirements.has(element.type) && leaves.length === 0) {
      gaps.push({ element, kind: "no-evidence" });
    }
  }
  return { gaps, evidence };
};

/**
 * The chain of `root` in `graph` (see the file comment): the walks in `options.direction`, their
 * gaps, evidence, cycles and `incomplete`.
 */
export const traceChain = <L = never>(
  graph: DerivationGraph,
  root: ElementRecord,
  options: ChainOptions<L>,
): Chain<L> => {
  const { direction, maxDepth, includes, leaves } = options;
  const limit = maxDepth === undefined ? {} : { maxDepth };
  const walks: ChainWalk<L>[] = [];
  if (direction !== "down") {
    const expand =
      includes === undefined
        ? (e: ElementRecord) => parentsOf(graph, e)
        : (e: ElementRecord) => within(parentsOf(graph, e), includes, false);
    walks.push({ direction: "up", result: walk<DerivationLink, L>([root], expand, limit) });
  }
  let down: WalkResult<DerivationLink, L> | undefined;
  if (direction !== "up") {
    const expand =
      includes === undefined
        ? (e: ElementRecord) => childrenOf(graph, e)
        : (e: ElementRecord) => within(childrenOf(graph, e), includes, true);
    down = walk([root], expand, leaves === undefined ? limit : { ...limit, leaves });
    walks.push({ direction: "down", result: down });
  }
  const cycles: WalkCycle<DerivationLink>[] = [];
  for (const { result } of walks) {
    for (const cycle of result.cycles) {
      if (!cycles.some((known) => sameCycle(known, cycle))) {
        cycles.push(cycle);
      }
    }
  }
  const { gaps, evidence } = down === undefined ? { gaps: [], evidence: [] } : gapsOf(graph, down);
  const meanings: readonly GapMeaning[] = ["need", "requirement"];
  return {
    root,
    rootExpanded: maxDepth === undefined || maxDepth > 0,
    walks,
    gaps,
    evidence,
    cycles,
    unassigned: down === undefined ? [] : meanings.filter((m) => graph.metamodel.meanings[m].length === 0),
    incomplete: walks.some((w) => w.result.incomplete),
  };
};

/** What `chainOutput` needs besides the chain. */
export interface ChainOutputContext {
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
}

type ChainNode = TraceChainOutput["nodes"][number];
type ChainUnresolved = TraceChainOutput["unresolved"][number];

/** The hint of one cycle (SR-022 AK4), at its first element: one problem (a cycle has elements). */
const cycleHints = (context: ChainOutputContext, cycle: WalkCycle<DerivationLink>): Problem[] => {
  const count = cycle.elements.length;
  const names = cycleNames(cycle, (e) => elementLabel(context, e));
  const message =
    count === 1
      ? `The chain stops at a cycle: ${names} derives from itself`
      : `The chain stops at a cycle of derivations with ${String(count)} elements: ${names}`;
  return cycle.elements.slice(0, 1).map((first) => ({
    code: "trace.cycle",
    severity: "warning",
    message,
    repository: first.repository,
    file: first.file,
    elementId: first.id,
  }));
};

/** The page of `chainOutput`: `limit` nodes from `offset`, in the order of the output's nodes. */
export interface ChainPage {
  readonly limit: number;
  readonly offset: number;
}

/** Every node of a chain on one page (the core tests and a full export). */
const EVERY_NODE: ChainPage = { limit: Number.POSITIVE_INFINITY, offset: 0 };

type ChainEdge = TraceChainOutput["edges"][number];

/** The title of an element; without the meaning `title` (SR-013 AK3) every title is empty, as in element.get. */
const titles = (metamodel: Metamodel): ((element: ElementRecord) => string) => {
  const titleKey = titleKeyOf(metamodel) ?? "";
  return (element) => {
    const title = element.data[titleKey];
    return typeof title === "string" ? title : "";
  };
};

/**
 * Adds to `edges` the edges of a walk that lead to an element of `onPage` in the walk: upwards the
 * parent, downwards the child. (A loop, not a spread: a whole chain has over 100,000 edges.)
 */
const addEdgesTo = (
  edges: ChainEdge[],
  { result, direction }: ChainWalk<unknown>,
  onPage: ReadonlySet<ElementRecord>,
): void => {
  for (const edge of result.edges) {
    if (onPage.has(edge.to)) {
      const target = direction === "up" ? edge.to : edge.from;
      edges.push({
        source: edge.link.source.id,
        sourceRepository: edge.link.source.repository,
        target: target.id,
        targetRepository: target.repository,
        kind: edge.link.key,
        direction,
        cyclic: edge.cyclic,
      });
    }
  }
};

/** Adds to `unresolved` the unresolved relations of the elements of `onPage` in a walk. */
const addUnresolvedOf = (
  unresolved: ChainUnresolved[],
  { result, direction }: ChainWalk<unknown>,
  onPage: ReadonlySet<ElementRecord>,
  shortIds: ShortIds,
  titleOf: (element: ElementRecord) => string,
): void => {
  for (const { from, link, state } of result.unresolved) {
    if (!onPage.has(from)) {
      continue;
    }
    if (direction === "down") {
      unresolved.push({
        direction,
        from: from.id,
        fromRepository: from.repository,
        kind: link.key,
        id: link.source.id,
        shortId: shortIds.of(link.source),
        ...identifierField(shortIds, link.source),
        title: titleOf(link.source),
        targetState: state.kind,
      });
    } else if (isUuid(link.item.id)) {
      // A target that is no UUID is a finding of its own (SR-085).
      unresolved.push({
        direction,
        from: from.id,
        fromRepository: from.repository,
        kind: link.key,
        id: link.item.id,
        ...(state.kind === "inaccessible"
          ? { shortId: `${UNKNOWN_TYPE_PREFIX}-${shortIds.tail(link.item.id)}` }
          : {}),
        targetState: state.kind,
      });
    }
  }
};

/** The hints of the whole chain: meanings no type has (SR-013 AK3), then one per cycle (SR-022 AK4). */
const chainProblems = (chain: Chain<unknown>, context: ChainOutputContext): Problem[] => {
  const problems: Problem[] = [];
  if (context.metamodel.valid) {
    for (const meaning of chain.unassigned) {
      problems.push({
        code: "metamodel.meaning-unassigned",
        severity: "warning",
        message: meaningUnassignedMessage(meaning, "trace.chain"),
      });
    }
  }
  for (const cycle of chain.cycles) {
    problems.push(...cycleHints(context, cycle));
  }
  return problems;
};

/**
 * One page of the chain as `trace.chain` gives it (catalog output): UUIDs, short IDs and titles
 * (spec-frage #290, SR-082 AK4). The nodes are the root, then those of the upward walk, then those
 * of the downward walk (each walk without its root); `total` counts them all. Only the nodes of the
 * page are built, with the edges that lead to them in their walk (so each edge is on one page),
 * their gaps and their unresolved relations. Depth, gaps, cycles, hints and `incomplete` are those
 * of the whole chain. Default: every node.
 */
export const chainOutput = (
  chain: Chain<unknown>,
  context: ChainOutputContext,
  page: ChainPage = EVERY_NODE,
): TraceChainOutput => {
  const { shortIds } = context;
  const titleOf = titles(context.metamodel);
  const node = (
    element: ElementRecord,
    depth: number,
    expanded: boolean,
    direction?: ChainNode["direction"],
  ): ChainNode => {
    const status = element.data["status"];
    return {
      id: element.id,
      shortId: shortIds.of(element),
      ...identifierField(shortIds, element),
      type: element.type,
      title: titleOf(element),
      ...(typeof status === "string" ? { status } : {}),
      repository: element.repository,
      file: element.file,
      depth,
      expanded,
      ...(direction === undefined ? {} : { direction }),
    };
  };
  const rootOnPage = page.offset === 0;
  const nodes: ChainNode[] = rootOnPage ? [node(chain.root, 0, chain.rootExpanded)] : [];
  const edges: ChainEdge[] = [];
  const gaps: ChainGap[] = [];
  const unresolved: ChainUnresolved[] = [];
  // The position among all nodes of a walk's second node; the root is the first of all.
  let start = 1;
  for (const walked of chain.walks) {
    const { direction, result } = walked;
    // The elements of this walk on the page; the root is each walk's first node.
    const onPage = new Set<ElementRecord>(rootOnPage ? [chain.root] : []);
    // This walk's nodes on the page, after its root; clamped, so a page that ends before the walk
    // starts takes none of it (`slice` counts a negative end from the back).
    const first = Math.max(1, page.offset - start + 1);
    const last = Math.max(first, page.offset + page.limit - start + 1);
    for (const { element, depth, expanded } of result.nodes.slice(first, last)) {
      onPage.add(element);
      nodes.push(node(element, depth, expanded, direction));
    }
    start += result.nodes.length - 1;
    // No node of this walk on the page: nothing of it either.
    if (onPage.size === 0) {
      continue;
    }
    if (direction === "down") {
      for (const gap of chain.gaps) {
        if (onPage.has(gap.element)) {
          gaps.push(gap);
        }
      }
    }
    addEdgesTo(edges, walked, onPage);
    addUnresolvedOf(unresolved, walked, onPage, shortIds, titleOf);
  }
  return {
    root: chain.root.id,
    nodes,
    total: start,
    edges,
    gaps: gaps.map(({ element, kind }) => ({ id: element.id, repository: element.repository, kind })),
    unresolved,
    incomplete: chain.incomplete,
    problems: chainProblems(chain, context),
  };
};
