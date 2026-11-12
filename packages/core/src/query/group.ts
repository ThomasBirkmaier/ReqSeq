// Grouping a list (SR-149): "Das Tool muss Listen nach Typ, Status, Paket oder einer Property mit
// auswählbaren Werten in Gruppen mit Überschrift zeigen und die Gruppierung jederzeit umstellen lassen,
// ohne sie in den Elementen zu speichern." Computed for each call from what the files hold; nothing
// is written (AK5).
//
// - Keys: `type` (as written: a subtype is a group of its own, as in element.facets), `status` (as
//   written), `package` (the property with the meaning `packages`, `metamodel.meaning-unassigned`
//   without one), or the key of a property whose values element.facets offers (`offersValues`, the
//   one rule of "Property mit auswählbaren Werten", SR-124, SR-132): choice and relation properties
//   always, text, number and date when they have few values shared over the workspace (a topic, not a
//   title). Any other key, a relation kind among them, is `input.invalid` at `group`.
// - The values of an element (AK2): every value of a list, each once. A choice written by its display
//   name (`findNamed`, as on write and in conditions) is in the group of that choice; one that names
//   several stays as written. A relation property gives its available targets (as the conditions read
//   them). No value (absent, null, [], a mapping) puts the element in the last group (AK1); so do
//   targets that are all not available (spec-frage #978), which the last group counts as `unavailable`.
//   A status is read as the status filter and element.facets read it, a text only: a status written
//   as a list puts the element in the last group (the sort would take its first item).
// - Order of the groups (AK1, "in der Reihenfolge der Sortierung nach diesem Wert"): the values as
//   the sort ranks them (`sortValueOf`, `compareSortValues` of sort.ts): types, statuses and choices
//   in metamodel order, then numbers, texts ignoring case, booleans. Targets, which are no sort key,
//   by title ignoring case, then short ID, the order of element.facets (spec-frage #978).
// - Cost (N-036): one pass over the selection with one map lookup per value, one sort of the
//   distinct values; for free text the facets rule once over the store, which stops at a property
//   with too many values. No file is read.
import type { CommandName } from "../catalog.js";
import type { MetamodelProperty } from "../generated/types.js";
import { findNamed, keyDefinition } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { identifierField, resolveTarget, titleKeyOrEmpty } from "../model/index.js";
import { validityTarget } from "../variants/index.js";
import { invalidAt, propertyFor, valuesOf } from "./context.js";
import { offersValues } from "./facets.js";
import type { Selected } from "./selection.js";
import type { SortValue } from "./sort.js";
import { compareSortValues, NO_RANKS, ranksOf, sortValueOf } from "./sort.js";

type Scalar = string | number | boolean;

/** The heading of a group; `value` is left out for the last group, the elements without one. */
export interface GroupHead {
  readonly value?: Scalar;
  readonly name?: string;
  readonly title?: string;
  readonly identifier?: string;
  /** Last group of a relation property only: its elements that name only targets not available. */
  readonly unavailable?: number;
}

/** The groups of a selection: their heads in order, and the groups of each element by index. */
export interface Grouping {
  /** In order; the last one, without `value`, may have no element. */
  readonly heads: readonly GroupHead[];
  /** The indexes into `heads` of the groups of `element`, each once, ascending. */
  readonly groupsOf: (element: ElementRecord) => readonly number[];
}

/** A distinct value while the groups are found: its heading and how it ranks. */
interface Found {
  readonly head: GroupHead;
  readonly rank: SortValue;
}

/** A distinct value and, once ordered, the index of its group. */
interface Slot {
  readonly found: Found;
  index: number;
}

/** What a reader tells of one element: each value by its map key, and a target that is not available. */
interface Sink {
  readonly add: (id: string, found: () => Found) => void;
  readonly unavailable: () => void;
}

/** The values of one element under the key. */
type Reader = (element: ElementRecord, sink: Sink) => void;

const isScalar = (value: unknown): value is Scalar =>
  typeof value === "string" ||
  (typeof value === "number" && !Number.isNaN(value)) ||
  typeof value === "boolean";

const scalarId = (value: Scalar): string => `${typeof value}\n${String(value)}`;

/** Metamodel entries (types, statuses, choices): a value by its key, ranked and named as they define it. */
const namedReader = (
  entries: readonly { readonly key: string; readonly name: string }[],
): ((value: Scalar, sink: Sink) => void) => {
  const ranks = ranksOf(entries);
  const names = new Map(entries.map((entry) => [entry.key, entry.name]));
  return (value, sink) => {
    sink.add(scalarId(value), () => {
      const name = typeof value === "string" ? names.get(value) : undefined;
      return { head: { value, ...(name === undefined ? {} : { name }) }, rank: sortValueOf(value, ranks) };
    });
  };
};

/**
 * The available targets of a relation property, read as element.facets and the property condition
 * `eq` read them: every item of `valuesOf`, whatever `many` says, so that `eq` on a group's value
 * selects the group. (The condition `package` reads by `many`, `validityEntries`; the two differ only
 * for a value of the wrong shape, a single mapping where a list is expected, SR-085.) An item that
 * names no element (a free name, D-020, or no ID) is no value; one whose target is not found (its
 * repository not on this machine, or not in the workspace) counts as `unavailable`.
 */
const targetReader = (selected: Selected, property: MetamodelProperty): Reader => {
  const { metamodel, store, shortIds } = selected;
  // Without the meaning `title` no key is the title (SR-013 AK3): every target is untitled.
  const titleKey = titleKeyOrEmpty(metamodel);
  return (element, sink) => {
    for (const item of valuesOf(element.data[property.key])) {
      const named = validityTarget(item, element);
      if (named === undefined) {
        continue;
      }
      const found = resolveTarget(store, element.repository, named);
      if (found.kind !== "found") {
        sink.unavailable();
        continue;
      }
      const target = found.element;
      sink.add(`${target.repository}\n${target.id}`, () => {
        const value = shortIds.of(target);
        const stored = target.data[titleKey];
        const title = typeof stored === "string" ? stored : "";
        const head = { value, ...(title === "" ? {} : { title }), ...identifierField(shortIds, target) };
        return { head, rank: sortValueOf(`${title}\n${value}`, NO_RANKS) };
      });
    }
  };
};

/** How the values of `by` are read (see the file comment). */
const readerOf = (selected: Selected, command: CommandName, by: string): Reader => {
  const { metamodel, store } = selected;
  switch (by) {
    case "type": {
      const read = namedReader(metamodel.effectiveTypes);
      return (element, sink) => {
        read(element.type, sink);
      };
    }
    case "status": {
      const read = namedReader(metamodel.statuses);
      return (element, sink) => {
        const status = element.data["status"];
        if (typeof status === "string") {
          read(status, sink);
        }
      };
    }
    case "package":
      return targetReader(selected, propertyFor({ command, metamodel }, "packages"));
  }
  const found = keyDefinition(metamodel, by);
  if (found !== undefined && found.kind !== "property") {
    throw invalidAt(
      { command },
      "group",
      `${by} is a relation kind, not a property; group by type, status, package or a property with values to choose`,
    );
  }
  const definition = found?.definition;
  if (definition === undefined || !offersValues(store.elements, definition)) {
    throw invalidAt(
      { command },
      "group",
      `${by} is no property with values to choose (as element.facets offers them); group by type, status, package or such a property`,
    );
  }
  if (definition.kind === "relation") {
    return targetReader(selected, definition);
  }
  const choices = definition.choices ?? [];
  const read = namedReader(choices);
  return (element, sink) => {
    for (const stored of valuesOf(element.data[by])) {
      if (isScalar(stored)) {
        const match = typeof stored === "string" ? findNamed(choices, stored) : undefined;
        read(match?.kind === "found" ? match.key : stored, sink);
      }
    }
  };
};

/**
 * Checks that a list can be grouped by `by`, as `groupingOf` checks it, without reading a selection:
 * whether a text, number or date property offers values is decided over the whole workspace
 * (`offersValues` over the store). Errors name the field `group`.
 */
export const checkGroupKey = (selected: Selected, command: CommandName, by: string): void => {
  readerOf(selected, command, by);
};

/**
 * The groups of `selected` by `by` (see the file comment): one pass over the selection, then the
 * distinct values in order and the group without a value last. Errors name the field `group`.
 */
export const groupingOf = (selected: Selected, command: CommandName, by: string): Grouping => {
  const read = readerOf(selected, command, by);
  const distinct = new Map<string, Slot>();
  const slotsOf = new Map<ElementRecord, Slot[]>();
  let unavailable = 0;
  for (const element of selected.elements) {
    const slots: Slot[] = [];
    // Set by the reader's callback, so an object: a `let` would read as never set here.
    const seen = { unavailable: false };
    read(element, {
      add: (id, found) => {
        let slot = distinct.get(id);
        if (slot === undefined) {
          slot = { found: found(), index: 0 };
          distinct.set(id, slot);
        }
        if (!slots.includes(slot)) {
          slots.push(slot);
        }
      },
      unavailable: () => {
        seen.unavailable = true;
      },
    });
    if (slots.length > 0) {
      slotsOf.set(element, slots);
    } else if (seen.unavailable) {
      unavailable += 1;
    }
  }
  const ordered = [...distinct.values()].sort((a, b) => compareSortValues(a.found.rank, b.found.rank));
  ordered.forEach((slot, index) => {
    slot.index = index;
  });
  const groups = new Map(
    [...slotsOf].map(([element, slots]) => [element, slots.map((s) => s.index).sort((a, b) => a - b)]),
  );
  const none = [ordered.length];
  return {
    heads: [...ordered.map((slot) => slot.found.head), unavailable === 0 ? {} : { unavailable }],
    groupsOf: (element) => groups.get(element) ?? none,
  };
};
