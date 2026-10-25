// The elements affected by a change of an element (SR-024, D-013): "Wenn ein Element inhaltlich
// geändert wird, muss das Tool alle Elemente zeigen, die von der Änderung betroffen sind." The
// `trace.affected` command is `traceAffected` and `affectedOutput` on one derivation graph.
//
// - "direkt oder über die Kette" (AK1), read mechanically (assumption of #36, stated in the PR):
//   distance 1 is every element whose file holds a relation or an inline reference to the element
//   (`directLinks`: any relation kind, any relation-valued property such as validity or packages,
//   and inline references; ADR-0004). From there the walk goes on only along the derivation chain
//   and inline references (glossary "Kette"; ADR-0004: inline references count for affected
//   elements, not for the chain): the incoming derivation relations (meaning `derivation`, SR-013)
//   and inline references of each affected element.
// - Each element once, at its shortest distance, breadth first, with the element it was reached
//   from and the link through which it points at that one; the way back to the element is the
//   path. The element itself is no affected element, also when a cycle leads back to it.
// - A walk of its own, not the generic `walk`: no edges and no cycle search are needed, and at
//   N-036 nearly every element of the workspace can be affected (about 48,500 from a need of the
//   generated workspace, 222,000 links).
// - The output is a page (`limit`, `offset`, `total`, as `element.list`): only the entries of the
//   page are built, each path by walking back.
// - `incomplete` (SR-006 AK2): a relation is stored only in its source's file (ADR-0004), so while
//   the workspace file lists a repository that is not on this machine, elements there may point at
//   an affected element unseen (as `childrenOf`, assumption #262 option 1).
// - Evidence records (AK4): the records of an older version of the element appear with it. They
//   come through the evidence seam (`AffectedOptions.evidence`): evidence records are read from
//   stage 4 on (SR-028), so the command passes none and the core tests pass their own (#127
//   option 1). A record of another version than the current one is a record of an old version.
import type { TraceAffectedOutput } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord, IncomingLink, ShortIds } from "../model/index.js";
import { directLinks, incomingTo, titleKeyOf } from "../model/index.js";
import type { DerivationGraph } from "./graph.js";

/** An evidence record as `trace.affected` lists it (SR-024 AK4, `data-export.schema.json#/$defs/evidenceRecord`). */
export type AffectedRecord = TraceAffectedOutput["records"][number];

export interface AffectedOptions {
  /**
   * The evidence seam (stage 4, SR-028): the current version of the element and its evidence
   * records. Default: none.
   */
  readonly evidence?: { readonly version: string; readonly records: readonly AffectedRecord[] };
}

/** An element the walk reached. */
export interface AffectedNode {
  readonly element: ElementRecord;
  /** Steps from the element asked for: 0 for it. */
  readonly depth: number;
  /** How it points at the node it was reached from (`before`); undefined for the element asked for. */
  readonly link: IncomingLink | undefined;
  readonly before: AffectedNode | undefined;
}

/** The affected elements of one element. */
export interface Affected {
  /** The element asked for. */
  readonly element: ElementRecord;
  /** Every reached element once, breadth first: the element asked for first, then the affected ones. */
  readonly reached: ReadonlyMap<ElementRecord, AffectedNode>;
  readonly incomplete: boolean;
  /** The records of an older version of the element (AK4), in the order given. */
  readonly records: readonly AffectedRecord[];
}

const NONE: readonly never[] = Object.freeze([]);

/**
 * Calls `visit` with each link of the chain into an affected element: the derivation relations (by
 * the graph's relation kinds) and the inline references of other elements that point at it. The
 * relations are read from the index directly, as `childrenOf` does; the references through
 * `incomingTo`, which decides where each one points, only when some reference names the UUID.
 */
const chainLinks = (
  graph: DerivationGraph,
  element: ElementRecord,
  visit: (link: IncomingLink) => void,
): void => {
  const { incoming, kindByKey } = graph;
  for (const link of incoming.relationsById.get(element.id) ?? NONE) {
    if (link.repository === element.repository && kindByKey.has(link.key)) {
      visit(link);
    }
  }
  if (incoming.referencesById.has(element.id)) {
    for (const link of incomingTo(incoming, element.repository, element.id)) {
      if (link.kind === "reference") {
        visit(link);
      }
    }
  }
};

/** The affected elements of `element` on `graph` (see the file comment). */
export const traceAffected = (
  graph: DerivationGraph,
  element: ElementRecord,
  options: AffectedOptions = {},
): Affected => {
  const start: AffectedNode = { element, depth: 0, link: undefined, before: undefined };
  const reached = new Map<ElementRecord, AffectedNode>([[element, start]]);
  const reach =
    (before: AffectedNode) =>
    (link: IncomingLink): void => {
      if (!reached.has(link.source)) {
        reached.set(link.source, { element: link.source, depth: before.depth + 1, link, before });
      }
    };
  directLinks(graph.incoming, element).forEach(reach(start));
  // A Map iterates the entries added while it is read: breadth first, level by level.
  for (const node of reached.values()) {
    if (node !== start) {
      chainLinks(graph, node.element, reach(node));
    }
  }
  const { evidence } = options;
  return {
    element,
    reached,
    incomplete: graph.unavailable,
    records: evidence === undefined ? NONE : evidence.records.filter((r) => r.version !== evidence.version),
  };
};

/** What `affectedOutput` needs besides the affected elements. */
export interface AffectedOutputContext {
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
}

/** The page of `affectedOutput`: `limit` entries from `offset`. */
export interface AffectedPage {
  readonly limit: number;
  readonly offset: number;
}

type AffectedEntry = TraceAffectedOutput["affected"][number];
type Via = AffectedEntry["via"];

const REFERENCE: Via = Object.freeze({ kind: "reference" });

/** The way from the element asked for to `node`, each element by UUID and repository (D-058). */
const pathTo = (node: AffectedNode): AffectedEntry["path"] => {
  const path: { readonly id: string; readonly repository: string }[] = [];
  for (let at: AffectedNode | undefined = node; at !== undefined; at = at.before) {
    path.push({ id: at.element.id, repository: at.element.repository });
  }
  return path.reverse();
};

/** One page of the affected elements as `trace.affected` gives it (catalog output). */
export const affectedOutput = (
  affected: Affected,
  context: AffectedOutputContext,
  page: AffectedPage,
): TraceAffectedOutput => {
  const { metamodel, shortIds } = context;
  // Without the meaning `title` (SR-013 AK3) no key is the title: every title is empty, as in element.get.
  const titleKey = titleKeyOf(metamodel) ?? "";
  const entries: AffectedEntry[] = [];
  const end = page.offset + page.limit;
  let index = 0;
  for (const node of affected.reached.values()) {
    // The element asked for is the only node without a link.
    if (node.link === undefined) {
      continue;
    }
    if (index >= end) {
      break;
    }
    if (index >= page.offset) {
      const { element, depth, link } = node;
      const title = element.data[titleKey];
      entries.push({
        id: element.id,
        shortId: shortIds.of(element),
        type: element.type,
        title: typeof title === "string" ? title : "",
        repository: element.repository,
        file: element.file,
        distance: depth,
        path: pathTo(node),
        via: link.kind === "relation" ? { kind: "relation", key: link.key } : REFERENCE,
      });
    }
    index += 1;
  }
  return {
    affected: entries,
    total: affected.reached.size - 1,
    records: [...affected.records],
    incomplete: affected.incomplete,
  };
};
