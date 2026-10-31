// The neighbourhood of an element (SR-107): the inputs of `trace.neighbourhood` and the rows its answers
// give. The parents line, the tree of the children (derivations only, opened level by level) and the
// incoming relations and references grouped by kind. Pure display of the command's output (ADR-0002),
// no React: the order of the rows is the walk's order, the app sorts nothing.
import type { TraceNeighbourhoodInput, TraceNeighbourhoodOutput } from "@reqseq/core";
import { elementBufferOf } from "./buffers.js";
import type { ElementBuffer } from "./buffers.js";
import { rowOf } from "./rows.js";
import type { Row } from "./rows.js";

/** The most parents asked for (the whole chain up to the needs); a longer chain ends the line with "…". */
const PARENTS_MAX = 200;
/** The most nodes of the tree and of the incoming relations asked for; more end the sheet with a quiet line. */
export const NEIGHBOURHOOD_MAX = 5000;

type Node = TraceNeighbourhoodOutput["nodes"][number];
type Edge = TraceNeighbourhoodOutput["edges"][number];

/** The element a neighbourhood is of. */
interface Subject {
  readonly id: string;
  readonly repository: string;
}

export const parentsInput = (subject: Subject): Partial<TraceNeighbourhoodInput> => ({
  ref: subject.id,
  repository: subject.repository,
  direction: "up",
  meanings: ["derivation"],
  allLevels: true,
  limit: PARENTS_MAX,
});

/** The children down to `depth` levels below the element (derivations only, from the element itself). */
export const treeInput = (subject: Subject, depth: number): Partial<TraceNeighbourhoodInput> => ({
  ref: subject.id,
  repository: subject.repository,
  direction: "down",
  meanings: ["derivation"],
  maxDepth: depth,
  limit: NEIGHBOURHOOD_MAX,
});

/** Every relation and reference that points at the element, of every kind, in one call. */
export const incomingInput = (subject: Subject): Partial<TraceNeighbourhoodInput> => ({
  ref: subject.id,
  repository: subject.repository,
  direction: "down",
  maxDepth: 1,
  limit: NEIGHBOURHOOD_MAX,
});

const keyOf = (repository: string, id: string): string => `${repository}:${id}`;

const nodesByKey = (output: TraceNeighbourhoodOutput): ReadonlyMap<string, Node> =>
  new Map(output.nodes.map((node) => [keyOf(node.repository, node.id), node]));

/** The label of an element: its title, else its ID. */
const nameOf = (node: Node): string => (node.title === "" ? (node.identifier ?? node.shortId) : node.title);

/** The ID of an end of an edge, as the rows show it: its identifier, else its short ID. */
const idOf = (nodes: ReadonlyMap<string, Node>, repository: string, id: string): string => {
  const node = nodes.get(keyOf(repository, id));
  return node === undefined ? id : (node.identifier ?? node.shortId);
};

/**
 * The hover text of an outdated link, which names its direction (#513): "SR-147 refines an older version
 * of SR-076", for an inline reference "E references an older version of D2 in its text"; undefined when
 * the link is current. The word itself stands at the other end of the link in both views.
 */
const outdatedNote = (nodes: ReadonlyMap<string, Node>, edge: Edge): string | undefined => {
  if (!edge.outdated) {
    return undefined;
  }
  const source = idOf(nodes, edge.sourceRepository, edge.source);
  const target = idOf(nodes, edge.targetRepository, edge.target);
  return edge.kind === undefined
    ? `${source} references an older version of ${target} in its text`
    : `${source} ${edge.kind} an older version of ${target}`;
};

/** A parent in the line above the title. */
export interface Parent {
  readonly open: ElementBuffer;
  readonly name: string;
  /** The ID, for the tooltip. */
  readonly label: string;
  /** The element's own link to this parent is outdated (SR-025): its hover text, else undefined. */
  readonly outdated: string | undefined;
}

export interface Parents {
  /** The parents level by level, from the top needs down to the direct parents; a level in node order. */
  readonly levels: readonly (readonly Parent[])[];
  /** More parents exist than were asked for. */
  readonly more: boolean;
}

/** The parents of `trace.neighbourhood { direction: "up", allLevels }`, the top level first (AK1). */
export const parentLevels = (output: TraceNeighbourhoodOutput): Parents => {
  const nodes = nodesByKey(output);
  const outdated = new Map(
    output.edges
      .filter((edge) => edge.direction === "up" && edge.source === output.root && edge.outdated)
      .map((edge) => [keyOf(edge.targetRepository, edge.target), outdatedNote(nodes, edge)]),
  );
  const byDepth = new Map<number, Parent[]>();
  for (const node of output.nodes.filter((candidate) => candidate.direction === "up")) {
    const level = byDepth.get(node.depth) ?? [];
    level.push({
      open: elementBufferOf(node),
      name: nameOf(node),
      label: node.identifier ?? node.shortId,
      outdated: outdated.get(keyOf(node.repository, node.id)),
    });
    byDepth.set(node.depth, level);
  }
  return {
    levels: [...byDepth.entries()].sort(([a], [b]) => b - a).map(([, level]) => level),
    more: output.total > output.nodes.length,
  };
};

/** A row of the tree of children. */
export interface TreeRow {
  readonly row: Row;
  /** `<repository>:<id>`, the key in `NeighbourhoodBuffer.open`. */
  readonly key: string;
  /** 1 for a child of the element. */
  readonly level: number;
  /** The child appeared under an earlier parent (AK3): it is shown, but not opened here. */
  readonly repeated: boolean;
  /** Its link to its parent row is outdated: the hover text, else undefined. */
  readonly outdated: string | undefined;
  /** Whether it has children; undefined while the answer does not reach its children yet. */
  readonly expandable: boolean | undefined;
  readonly opened: boolean;
  /** Index of the row of its parent in the rows; undefined at level 1. */
  readonly parent: number | undefined;
}

export interface Tree {
  readonly rows: readonly TreeRow[];
  /** The answer holds only the first nodes of a larger tree. */
  readonly cut: boolean;
}

/**
 * The children as rows in the order of the walk, depth first: the direct children, and below a row of
 * `open` its children, one level further for each. A repeated row is a leaf (AK3): its children are under
 * its first appearance.
 */
export const treeRows = (output: TraceNeighbourhoodOutput, open: readonly string[]): Tree => {
  const nodes = nodesByKey(output);
  const childrenOf = new Map<string, Edge[]>();
  for (const edge of output.edges) {
    const key = keyOf(edge.targetRepository, edge.target);
    const siblings = childrenOf.get(key) ?? [];
    siblings.push(edge);
    childrenOf.set(key, siblings);
  }
  const rows: TreeRow[] = [];
  const walk = (parentKey: string, level: number, parent: number | undefined): void => {
    for (const edge of childrenOf.get(parentKey) ?? []) {
      const key = keyOf(edge.sourceRepository, edge.source);
      const node = nodes.get(key);
      if (node === undefined) {
        continue;
      }
      const opened = !edge.repeated && open.includes(key);
      let expandable: boolean | undefined = false;
      if (!edge.repeated) {
        expandable = node.expanded ? childrenOf.has(key) : undefined;
      }
      const at = rows.length;
      rows.push({
        row: rowOf(node, level - 1, [], false),
        key,
        level,
        repeated: edge.repeated,
        outdated: outdatedNote(nodes, edge),
        expandable,
        opened,
        parent,
      });
      if (opened) {
        walk(key, level + 1, at);
      }
    }
  };
  for (const root of output.nodes.filter((node) => node.depth === 0)) {
    walk(keyOf(root.repository, root.id), 1, undefined);
  }
  return { rows, cut: output.total > output.nodes.length };
};

/**
 * How many levels the tree is asked for: two to start with (the children and whether they have any), and
 * two below the deepest row that is open and shown, so every shown row knows whether it has children.
 */
export const fetchDepth = (rows: readonly TreeRow[]): number =>
  Math.max(2, ...rows.filter((row) => row.opened).map((row) => row.level + 2));

/** One element that points at the shown one. */
export interface GroupEntry {
  readonly row: Row;
  /** Its link to the shown element is outdated: the hover text, else undefined. */
  readonly outdated: string | undefined;
}

export interface Group {
  /** "← <kind>" or "← inline reference". */
  readonly heading: string;
  readonly entries: readonly GroupEntry[];
}

export interface Incoming {
  readonly groups: readonly Group[];
  readonly cut: boolean;
}

/**
 * The incoming relations and references by kind, the kinds in the order they first appear and the
 * entries in the order of the answer (AK2). The derivations are the children and left out. An element
 * that points with two kinds is listed under both.
 */
export const incomingGroups = (output: TraceNeighbourhoodOutput): Incoming => {
  const nodes = nodesByKey(output);
  const groups = new Map<string, GroupEntry[]>();
  for (const edge of output.edges.filter((candidate) => candidate.meaning !== "derivation")) {
    const node = nodes.get(keyOf(edge.sourceRepository, edge.source));
    if (node !== undefined) {
      const heading = `← ${edge.kind ?? "inline reference"}`;
      const entries = groups.get(heading) ?? [];
      entries.push({ row: rowOf(node, 0, [], false), outdated: outdatedNote(nodes, edge) });
      groups.set(heading, entries);
    }
  }
  return {
    groups: [...groups.entries()].map(([heading, entries]) => ({ heading, entries })),
    cut: output.total > output.nodes.length,
  };
};
