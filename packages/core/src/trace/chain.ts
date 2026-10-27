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
// - Evidence (AK1, AK3 "Nachweis"; SR-033): the chain stays generic and never imports the evidence
//   block (which imports `trace`). Two seams: `hasEvidence` decides the `no-evidence` gap for every
//   element of the walk (the command passes `hasVerificationRecord`, no allocation), and
//   `ChainOutputContext.evidenceOf` gives what is shown below an element, called by `chainOutput`
//   only for the expanded downward nodes of the page, so a page of 200 nodes builds the evidence of
//   200 elements, not of the 42,000 of the whole chain (N-036). The walk's `leaves` stay for callers
//   that pass leaves of their own (core tests, #127 option 1); without `hasEvidence` they decide the
//   gap.
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
  /** Leaves below an element of the downward chain (`Chain.evidence`). Default: none. */
  readonly leaves?: (element: ElementRecord) => readonly L[];
  /**
   * Whether an element has evidence that closes its `no-evidence` gap (SR-022 AK3); asked only for a
   * requirement without a child. Default: it has leaves.
   */
  readonly hasEvidence?: (element: ElementRecord) => boolean;
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

/**
 * `expansion` without the steps to elements that are not part of the chain (`includes`); `down`:
 * the other end of an unresolved link is the element that stores it. For any link type that has a
 * `source`.
 */
export const within = <E extends { readonly source: ElementRecord }>(
  expansion: Expansion<E>,
  includes: (element: ElementRecord) => boolean,
  down: boolean,
): Expansion<E> => ({
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

/**
 * The steps of the downward chain from an element: its children (`childrenOf`) that are part of the
 * chain (`includes`). Shared by `traceChain` and `lacksEvidence`, so both count the same children.
 */
const childrenWithin = (
  graph: DerivationGraph,
  includes: ((element: ElementRecord) => boolean) | undefined,
): ((element: ElementRecord) => Expansion<DerivationLink>) =>
  includes === undefined ? (e) => childrenOf(graph, e) : (e) => within(childrenOf(graph, e), includes, true);

/** The type keys of the two gap meanings. */
interface GapTypes {
  readonly needs: ReadonlySet<string>;
  readonly requirements: ReadonlySet<string>;
}

const gapTypes = (metamodel: Metamodel): GapTypes => ({
  needs: typeKeys(metamodel, "need"),
  requirements: typeKeys(metamodel, "requirement"),
});

/**
 * The gap of an element whose children were looked at (SR-022 AK3, see the file comment): `no-child`
 * for a need without a child, `no-evidence` for a requirement without a child and without evidence
 * (`hasEvidence` of the element and its leaves, asked only then), none otherwise. The one rule of
 * `trace.chain` and of the marks of `trace.graph` (SR-111 AK4).
 */
const gapOf = (
  types: GapTypes,
  element: ElementRecord,
  hasChild: boolean,
  leaves: readonly unknown[],
  hasEvidence: (element: ElementRecord, leaves: readonly unknown[]) => boolean,
): GapKind | undefined => {
  if (hasChild) {
    return undefined;
  }
  if (types.needs.has(element.type)) {
    return "no-child";
  }
  return types.requirements.has(element.type) && !hasEvidence(element, leaves) ? "no-evidence" : undefined;
};

/** The default evidence of an element: it has leaves. */
const hasLeaves = (_element: ElementRecord, leaves: readonly unknown[]): boolean => leaves.length > 0;

/**
 * Whether an element is a `no-evidence` gap of the downward chain (SR-022 AK3), whatever depth a
 * chain would look at: its children are counted as the chain's down walk counts them (in the view,
 * `includes`; a child named only by an ambiguous relation is none, SR-088), and `leaves` is its
 * evidence. For the marks of `trace.graph` (SR-111 AK4): the chain decides its gaps with the records
 * (`hasEvidence`, SR-033), while `trace.graph` passes no records until #565, so with records the two
 * can differ until then.
 */
export const lacksEvidence = (
  graph: DerivationGraph,
  includes?: (element: ElementRecord) => boolean,
): ((element: ElementRecord, leaves: readonly unknown[]) => boolean) => {
  const types = gapTypes(graph.metamodel);
  const children = childrenWithin(graph, includes);
  return (element, leaves) =>
    types.requirements.has(element.type) &&
    gapOf(types, element, children(element).steps.length > 0, leaves, hasLeaves) === "no-evidence";
};

/** Gaps and evidence of the downward walk (see the file comment). */
const gapsOf = <L>(
  graph: DerivationGraph,
  down: WalkResult<DerivationLink, L>,
  hasEvidence: ((element: ElementRecord) => boolean) | undefined,
): { readonly gaps: ChainGap[]; readonly evidence: ChainEvidence<L>[] } => {
  const types = gapTypes(graph.metamodel);
  const gaps: ChainGap[] = [];
  const evidence: ChainEvidence<L>[] = [];
  const evidenced: (element: ElementRecord, leaves: readonly unknown[]) => boolean = hasEvidence ?? hasLeaves;
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
    const kind = gapOf(types, element, parent, leaves, evidenced);
    if (kind !== undefined) {
      gaps.push({ element, kind });
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
  const { direction, maxDepth, includes, leaves, hasEvidence } = options;
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
    down = walk([root], childrenWithin(graph, includes), leaves === undefined ? limit : { ...limit, leaves });
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
  const { gaps, evidence } =
    down === undefined ? { gaps: [], evidence: [] } : gapsOf(graph, down, hasEvidence);
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

/** The evidence below an element of the chain as `trace.chain` shows it (SR-033): its test cases and other records. */
export type ChainEvidenceLeaf = Pick<TraceChainOutput["evidence"][number], "testCases" | "records">;

/** What `chainOutput` needs besides the chain. */
export interface ChainOutputContext {
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
  /**
   * The evidence below an element of the downward chain (SR-022 AK1, SR-033), undefined when it has
   * none; asked only for the expanded downward nodes of the page. Default: none.
   */
  readonly evidenceOf?: (element: ElementRecord) => ChainEvidenceLeaf | undefined;
}

export type ChainNode = TraceChainOutput["nodes"][number];
type ChainEvidenceItem = TraceChainOutput["evidence"][number];
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
export const titles = (metamodel: Metamodel): ((element: ElementRecord) => string) => {
  const titleKey = titleKeyOf(metamodel) ?? "";
  return (element) => {
    const title = element.data[titleKey];
    return typeof title === "string" ? title : "";
  };
};

/** Builds the node of an element at `depth` for the output of a chain or neighbourhood. */
export const chainNode =
  (shortIds: ShortIds, titleOf: (element: ElementRecord) => string) =>
  (
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

/**
 * Adds to `evidence` the evidence below each expanded node of `nodes` (the downward nodes of a page,
 * in node order), one level deeper than the node (SR-022 AK1).
 */
const addEvidenceOf = (
  evidence: ChainEvidenceItem[],
  nodes: readonly { readonly element: ElementRecord; readonly depth: number; readonly expanded: boolean }[],
  evidenceOf: (element: ElementRecord) => ChainEvidenceLeaf | undefined,
): void => {
  for (const { element, depth, expanded } of nodes) {
    const leaf = expanded ? evidenceOf(element) : undefined;
    if (leaf !== undefined) {
      evidence.push({ id: element.id, repository: element.repository, depth: depth + 1, ...leaf });
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
 * their gaps, their evidence (`context.evidenceOf`, for the expanded downward nodes) and their
 * unresolved relations. Depth, gaps, cycles, hints and `incomplete` are those of the whole chain.
 * Default: every node.
 */
export const chainOutput = (
  chain: Chain<unknown>,
  context: ChainOutputContext,
  page: ChainPage = EVERY_NODE,
): TraceChainOutput => {
  const { shortIds } = context;
  const titleOf = titles(context.metamodel);
  const node = chainNode(shortIds, titleOf);
  const rootOnPage = page.offset === 0;
  const nodes: ChainNode[] = rootOnPage ? [node(chain.root, 0, chain.rootExpanded)] : [];
  const edges: ChainEdge[] = [];
  const gaps: ChainGap[] = [];
  const evidence: ChainEvidenceItem[] = [];
  const { evidenceOf } = context;
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
    const shown = result.nodes.slice(first, last);
    for (const { element, depth, expanded } of shown) {
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
      if (evidenceOf !== undefined) {
        addEvidenceOf(evidence, rootOnPage ? [...result.nodes.slice(0, 1), ...shown] : shown, evidenceOf);
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
    evidence,
    unresolved,
    incomplete: chain.incomplete,
    problems: chainProblems(chain, context),
  };
};
