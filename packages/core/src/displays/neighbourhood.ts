// The display model of the neighbourhood of an element (SR-107, SR-232 AK5; ADR-0019 points 1, 2, 9(a)): the parents
// up to the topmost, the children as a tree, and the incoming relations and references by kind, from the answers of
// `trace.neighbourhood` as they are. The app's parents line and neighbourhood buffer and the export's section render
// it; the order of the rows is the walk's order, nothing is sorted here.
//
// - Parents: the nodes of the up walk (derivations), the topmost level first, a level in node order, each element
//   once (the walk gives it once, at its shortest depth). A parent that a derivation of a shown element points at with
//   an older version carries the note of that link, two such links both (SR-107 AK4).
// - Children: the down walk over the derivations as a tree, depth first in the walk's order (SR-107 AK2). A child
//   reached again is shown under each parent, marked repeated everywhere but where the walk reached it first, the
//   nearest place, and has no rows below a repeated place (SR-107 AK3). The rows below a child stand only when it is
//   open: every child for the export, the ones the reader opened for the app.
// - Incoming: every relation, relation property and inline reference that points at the element and is no derivation
//   (those are the children), one group per key and one for the inline references, in the order they first appear,
//   headed by `relationGroupLabel`; an element that points with two keys stands in both.
// - Bound (SR-232 AK5 for the export, the `limit` of the app's calls): a part shows its `bound` nearest elements (the
//   walk is breadth first), and says so (`more`) when the walk reached more or the answer is one page of more. The
//   tree is drawn from the shown elements only.
// - Each row is an `ElementRef`; an element with an invalid status is marked (`invalid`) and stays in the walk (SR-232
//   AK6).
import type { MetamodelGetOutput, TraceNeighbourhoodOutput } from "../generated/types.js";
import type { ElementRef } from "./element-ref.js";
import { elementRef, invalidStatusKeys } from "./element-ref.js";
import type { RelationNames } from "./labels.js";
import { REFERENCE_WORD, relationGroupLabel, shownId } from "./labels.js";

/** An answer of `trace.neighbourhood`, without its sentence. */
export type NeighbourhoodAnswer = Pick<TraceNeighbourhoodOutput, "nodes" | "edges" | "total">;
type Node = NeighbourhoodAnswer["nodes"][number];
type Edge = NeighbourhoodAnswer["edges"][number];

/** A parent of the element. */
export interface ParentDisplay {
  readonly ref: ElementRef;
  /** `<repository>:<id>`. */
  readonly key: string;
  readonly depth: number;
  /** The notes of the outdated derivations that point at it; undefined when none is outdated. */
  readonly outdated: string | undefined;
}

/** A row of the tree of children. */
export interface ChildDisplay {
  readonly ref: ElementRef;
  /** `<repository>:<id>`, as the app keeps the open rows. */
  readonly key: string;
  /** 1 for a child of the element. */
  readonly level: number;
  /** It appeared under an earlier parent (SR-107 AK3): shown, but not opened here. */
  readonly repeated: boolean;
  /** Its link to its parent row is outdated: the note, else undefined. */
  readonly outdated: string | undefined;
  /** Whether it has children; undefined while the answer does not reach its children yet. */
  readonly expandable: boolean | undefined;
  readonly opened: boolean;
  /** The index of the row of its parent; undefined at level 1. */
  readonly parent: number | undefined;
}

/** One element that points at the element. */
export interface IncomingEntry {
  readonly ref: ElementRef;
  readonly key: string;
  readonly outdated: string | undefined;
}

export interface IncomingGroupDisplay {
  readonly key: string;
  /** "← <name of the kind>" or "← inline reference". */
  readonly label: string;
  readonly entries: readonly IncomingEntry[];
}

/** A part and whether its bound left elements out. */
export interface Part<T> {
  readonly rows: readonly T[];
  readonly more: boolean;
}

export interface NeighbourhoodDisplay {
  /** The levels of the parents, the topmost first. */
  readonly parents: Part<readonly ParentDisplay[]>;
  readonly children: Part<ChildDisplay>;
  readonly incoming: Part<IncomingGroupDisplay>;
}

/** The answers it is built from; one answer may serve as both `parents` and `children` (`direction: "both"`). */
export interface NeighbourhoodInput {
  /** The up walk over the derivations. */
  readonly parents?: NeighbourhoodAnswer | undefined;
  /** The down walk over the derivations. */
  readonly children?: NeighbourhoodAnswer | undefined;
  /** One step down over every other key and the inline references. */
  readonly incoming?: NeighbourhoodAnswer | undefined;
  readonly metamodel: RelationNames & Pick<MetamodelGetOutput, "statuses">;
}

export interface NeighbourhoodOptions {
  /** How many elements each part shows at most (SR-232 AK5: 100 each on the export page; the app: its `limit`). */
  readonly bound: { readonly parents: number; readonly children: number; readonly incoming: number };
  /** The children whose rows below them stand, by key; `all` for every one. */
  readonly open: readonly string[] | "all";
}

const NO_ANSWER: NeighbourhoodAnswer = { nodes: [], edges: [], total: 0 };

export const keyOf = (repository: string, id: string): string => `${repository}:${id}`;

/** The nodes of `answer` that walk `direction`, the root left out. */
const walked = (answer: NeighbourhoodAnswer, direction: "up" | "down"): Node[] =>
  answer.nodes.filter((node) => node.depth > 0 && node.direction === direction);

/** The shown nodes of a walk by key, and whether the bound or the page left some out. */
const shownOf = (
  answer: NeighbourhoodAnswer,
  direction: "up" | "down",
  bound: number,
): { readonly shown: ReadonlyMap<string, Node>; readonly more: boolean } => {
  const nodes = walked(answer, direction);
  const kept = nodes.slice(0, bound);
  return {
    shown: new Map(kept.map((node) => [keyOf(node.repository, node.id), node])),
    more: nodes.length > bound || answer.total > answer.nodes.length,
  };
};

/**
 * The note of an outdated link, which names its direction (#513): "SR-147 points to an older version of SR-076
 * (refines)", with the key or "inline reference"; undefined when the link is current.
 */
const outdatedNote = (nodes: ReadonlyMap<string, Node>, edge: Edge): string | undefined => {
  if (!edge.outdated) {
    return undefined;
  }
  const idOf = (repository: string, id: string): string => {
    const node = nodes.get(keyOf(repository, id));
    return node === undefined ? id : shownId(node.shortId, node.identifier);
  };
  return `${idOf(edge.sourceRepository, edge.source)} points to an older version of ${idOf(edge.targetRepository, edge.target)} (${edge.kind ?? REFERENCE_WORD})`;
};

const allNodes = (answer: NeighbourhoodAnswer): ReadonlyMap<string, Node> =>
  new Map(answer.nodes.map((node) => [keyOf(node.repository, node.id), node]));

const parentsOf = (
  answer: NeighbourhoodAnswer,
  bound: number,
  invalid: ReadonlySet<string>,
): Part<readonly ParentDisplay[]> => {
  const nodes = allNodes(answer);
  const { shown, more } = shownOf(answer, "up", bound);
  const root = answer.nodes.find((node) => node.depth === 0);
  const from = (edge: Edge): boolean => {
    const key = keyOf(edge.sourceRepository, edge.source);
    return shown.has(key) || (root !== undefined && key === keyOf(root.repository, root.id));
  };
  const notes = new Map<string, string[]>();
  for (const edge of answer.edges) {
    const key = keyOf(edge.targetRepository, edge.target);
    const note =
      edge.direction === "up" && shown.has(key) && from(edge) ? outdatedNote(nodes, edge) : undefined;
    if (note !== undefined) {
      notes.set(key, [...(notes.get(key) ?? []), note]);
    }
  }
  const byDepth = new Map<number, ParentDisplay[]>();
  for (const [key, node] of shown) {
    const level = byDepth.get(node.depth) ?? [];
    level.push({
      ref: elementRef(node, invalid),
      key,
      depth: node.depth,
      outdated: notes.get(key)?.join("; "),
    });
    byDepth.set(node.depth, level);
  }
  return { rows: [...byDepth].sort(([a], [b]) => b - a).map(([, level]) => level), more };
};

const childrenOf = (
  answer: NeighbourhoodAnswer,
  options: NeighbourhoodOptions,
  invalid: ReadonlySet<string>,
): Part<ChildDisplay> => {
  const nodes = allNodes(answer);
  const { shown, more } = shownOf(answer, "down", options.bound.children);
  const below = new Map<string, { readonly edge: Edge; readonly node: Node }[]>();
  for (const edge of answer.edges) {
    const node = edge.direction === "down" ? shown.get(keyOf(edge.sourceRepository, edge.source)) : undefined;
    if (node !== undefined) {
      const parent = keyOf(edge.targetRepository, edge.target);
      below.set(parent, [...(below.get(parent) ?? []), { edge, node }]);
    }
  }
  const rows: ChildDisplay[] = [];
  // A stack instead of recursion: a chain can be thousands of levels deep. Only an edge the walk took leads further,
  // and each element is reached by one such edge, so every element is opened once.
  const stack: {
    readonly edge: Edge;
    readonly node: Node;
    readonly level: number;
    readonly parent: number | undefined;
  }[] = [];
  const push = (key: string, level: number, parent: number | undefined): void => {
    for (const { edge, node } of [...(below.get(key) ?? [])].reverse()) {
      stack.push({ edge, node, level, parent });
    }
  };
  for (const root of answer.nodes.filter((node) => node.depth === 0)) {
    push(keyOf(root.repository, root.id), 1, undefined);
  }
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { edge, node, level, parent } = next;
    const key = keyOf(edge.sourceRepository, edge.source);
    const opened = !edge.repeated && (options.open === "all" || options.open.includes(key));
    let expandable: boolean | undefined = false;
    if (!edge.repeated) {
      expandable = node.expanded ? below.has(key) : undefined;
    }
    const at = rows.length;
    rows.push({
      ref: elementRef(node, invalid),
      key,
      level,
      repeated: edge.repeated,
      outdated: outdatedNote(nodes, edge),
      expandable,
      opened,
      parent,
    });
    if (opened) {
      push(key, level + 1, at);
    }
  }
  return { rows, more };
};

const incomingOf = (
  answer: NeighbourhoodAnswer,
  bound: number,
  names: RelationNames,
  invalid: ReadonlySet<string>,
): Part<IncomingGroupDisplay> => {
  const nodes = allNodes(answer);
  const { shown, more } = shownOf(answer, "down", bound);
  const groups = new Map<string, { label: string; entries: IncomingEntry[] }>();
  for (const edge of answer.edges) {
    const key = keyOf(edge.sourceRepository, edge.source);
    const node = shown.get(key);
    if (edge.direction === "down" && edge.meaning !== "derivation" && node !== undefined) {
      const property = edge.property === true;
      const group = `${property ? "property" : "kind"}:${edge.kind ?? ""}`;
      const found = groups.get(group) ?? {
        label: relationGroupLabel({ kind: edge.kind, property, direction: "in" }, names),
        entries: [],
      };
      found.entries.push({ ref: elementRef(node, invalid), key, outdated: outdatedNote(nodes, edge) });
      groups.set(group, found);
    }
  }
  return { rows: [...groups].map(([key, { label, entries }]) => ({ key, label, entries })), more };
};

/** The display model of the neighbourhood (see the file comment). */
export const neighbourhoodDisplay = (
  input: NeighbourhoodInput,
  options: NeighbourhoodOptions,
): NeighbourhoodDisplay => {
  const invalid = invalidStatusKeys(input.metamodel);
  return {
    parents: parentsOf(input.parents ?? NO_ANSWER, options.bound.parents, invalid),
    children: childrenOf(input.children ?? NO_ANSWER, options, invalid),
    incoming: incomingOf(input.incoming ?? NO_ANSWER, options.bound.incoming, input.metamodel, invalid),
  };
};
