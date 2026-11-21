// The neighbourhood of an element (SR-107): the inputs of `trace.neighbourhood` and the rows its answers
// give. The parents line, the tree of the children (derivations only, opened level by level) and the
// incoming relations and references grouped by kind, from core's display model of the neighbourhood
// (`neighbourhoodDisplay`, ADR-0019), which the HTML export renders too. No React: the order of the rows is
// the walk's order, the app sorts nothing.
import type { TraceNeighbourhoodInput, TraceNeighbourhoodOutput } from "@reqseq/core";
import { NO_NAMES, neighbourhoodDisplay } from "@reqseq/core/displays";
import type { ElementRef, NeighbourhoodInput, RelationNames } from "@reqseq/core/displays";
import { elementBufferOf } from "./buffers.js";
import type { ElementBuffer } from "./buffers.js";
import { shownId } from "./id-title.js";
import { rowOf } from "./rows.js";
import type { Row } from "./rows.js";

/** The most parents asked for (the whole chain up to the needs); a longer chain ends the line with "…". */
const PARENTS_MAX = 200;
/** The most nodes of the tree and of the incoming relations asked for; more end the sheet with a quiet line. */
export const NEIGHBOURHOOD_MAX = 5000;

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

/** The app's caps are the `limit` of its calls (ADR-0019 point 9(a)); it marks no invalid status. */
const modelOf = (names: RelationNames): NeighbourhoodInput["metamodel"] => ({ ...names, statuses: [] });

const bound = { parents: PARENTS_MAX, children: NEIGHBOURHOOD_MAX, incoming: NEIGHBOURHOOD_MAX };

/** The label of an element: its title, else its ID. */
const nameOf = (ref: ElementRef): string =>
  ref.title === "" ? shownId(ref.shortId, ref.identifier) : ref.title;

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

/**
 * The parents of `trace.neighbourhood { direction: "up", allLevels }`, the top level first (AK1), from the display
 * model of the neighbourhood (`neighbourhoodDisplay`).
 */
export const parentLevels = (output: TraceNeighbourhoodOutput): Parents => {
  const { parents } = neighbourhoodDisplay(
    { parents: output, metamodel: modelOf(NO_NAMES) },
    { bound, open: [] },
  );
  return {
    levels: parents.rows.map((level) =>
      level.map((parent) => ({
        open: elementBufferOf(parent.ref),
        name: nameOf(parent.ref),
        label: shownId(parent.ref.shortId, parent.ref.identifier),
        outdated: parent.outdated,
      })),
    ),
    more: parents.more,
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
 * The children as rows in the order of the walk, depth first: the direct children, and below a row of `open` its
 * children, one level further for each, from the display model of the neighbourhood (`neighbourhoodDisplay`). A
 * repeated row is a leaf (AK3): its children are under its first appearance.
 */
export const treeRows = (output: TraceNeighbourhoodOutput, open: readonly string[]): Tree => {
  const { children } = neighbourhoodDisplay(
    { children: output, metamodel: modelOf(NO_NAMES) },
    { bound, open },
  );
  return {
    rows: children.rows.map((child) => ({
      row: rowOf(child.ref, child.level - 1, [], false),
      key: child.key,
      level: child.level,
      repeated: child.repeated,
      outdated: child.outdated,
      expandable: child.expandable,
      opened: child.opened,
      parent: child.parent,
    })),
    cut: children.more,
  };
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
 * The incoming relations and references by kind, the kinds in the order they first appear and the entries in the
 * order of the answer (AK2), each kind headed by `relationGroupLabel` with `names`, from the display model of the
 * neighbourhood (`neighbourhoodDisplay`). The derivations are the children and left out. An element that points
 * with two kinds is listed under both.
 */
export const incomingGroups = (
  output: TraceNeighbourhoodOutput,
  names: RelationNames = NO_NAMES,
): Incoming => {
  const { incoming } = neighbourhoodDisplay(
    { incoming: output, metamodel: modelOf(names) },
    { bound, open: [] },
  );
  return {
    groups: incoming.rows.map((group) => ({
      heading: group.label,
      entries: group.entries.map((entry) => ({
        row: rowOf(entry.ref, 0, [], false),
        outdated: entry.outdated,
      })),
    })),
    cut: incoming.more,
  };
};
