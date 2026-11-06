// Grouping a list (SR-149): "Das Tool muss Listen nach Typ, Status, Paket oder einer Property mit
// auswählbaren Werten in Gruppen mit Überschrift zeigen und die Gruppierung jederzeit umstellen lassen,
// ohne sie in den Elementen zu speichern." Computed for each call from what the files hold; nothing
// is written (AK5).
//
// - Keys: `type` (as written: a subtype is a group of its own, as in element.facets), `status` (as
//   written), `package` (the available targets of the property with the meaning `packages`,
//   `metamodel.meaning-unassigned` without one), or the key of a property of kind choice. Any other
//   key, a free-text property or one that holds relations, is `input.invalid` at `group`: SR-149
//   groups by "einer Property mit auswählbaren Werten".
// - The values of an element (AK2): every value of a list, each once; a choice written by its
//   display name (`findNamed`, as on write and in conditions) is in the group of that choice, one
//   that names several stays as written. No value (absent, null, [], a mapping) puts the element in
//   the last group (AK1); so do packages that are all not on this machine (spec-frage #978).
// - Order of the groups (AK1, "in der Reihenfolge der Sortierung nach diesem Wert"), as the sort
//   ranks values (`sort.ts`): types, statuses and choices in metamodel order, then other values:
//   numbers, texts ignoring case (ties as written), booleans; a type the metamodel does not know
//   after the known ones by its key. Packages, which are no sort key, by title ignoring case, then
//   short ID, the order of element.facets (spec-frage #978).
// - Cost (N-036): one pass over the selection with one map lookup per value, one sort of the
//   distinct values. No file is read.
import type { CommandName } from "../catalog.js";
import { findNamed, keyDefinition } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { identifierField, relationKey, resolveTarget, titleKeyOrEmpty } from "../model/index.js";
import { validityEntries, validityTarget } from "../variants/index.js";
import { fold, invalidAt, propertyFor, valuesOf } from "./context.js";
import type { Selected } from "./selection.js";

type Scalar = string | number | boolean;

/** The heading of a group; `value` is left out for the last group, the elements without one. */
export interface GroupHead {
  readonly value?: Scalar;
  readonly name?: string;
  readonly title?: string;
  readonly identifier?: string;
}

/** The groups of a selection: their heads in order, and the groups of each element by index. */
export interface Grouping {
  /** In order; the last one, without `value`, may have no element. */
  readonly heads: readonly GroupHead[];
  /** The indexes into `heads` of the groups of `element`, each once, ascending. */
  readonly groupsOf: (element: ElementRecord) => readonly number[];
}

/** A distinct value while the groups are found, with what orders it. */
interface Found {
  readonly head: GroupHead;
  /** 0 ranked by the metamodel, 1 a number, 2 a text, 3 a boolean. */
  readonly kind: number;
  readonly number: number;
  /** The folded text and the text as written (texts, packages). */
  readonly text: string;
  readonly raw: string;
}

/** A distinct value and, once ordered, the index of its group. */
interface Slot {
  readonly found: Found;
  index: number;
}

/** The values of one element under the key, each as its map key and how it is found. */
type Reader = (element: ElementRecord, add: (id: string, found: () => Found) => void) => void;

const ranked = (rank: number, head: GroupHead): Found => ({ head, kind: 0, number: rank, text: "", raw: "" });

const textual = (head: GroupHead, raw: string): Found => ({ head, kind: 2, number: 0, text: fold(raw), raw });

/** A value of no metamodel rank: numbers, texts, booleans (see the file comment). */
const plain = (value: Scalar): Found =>
  typeof value === "string"
    ? textual({ value }, value)
    : { head: { value }, kind: typeof value === "number" ? 1 : 3, number: Number(value), text: "", raw: "" };

const isScalar = (value: unknown): value is Scalar =>
  typeof value === "string" ||
  (typeof value === "number" && !Number.isNaN(value)) ||
  typeof value === "boolean";

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compareFound = (a: Found, b: Found): number =>
  a.kind - b.kind || a.number - b.number || compareText(a.text, b.text) || compareText(a.raw, b.raw);

/** A value ranked by `ranks` (metamodel order) with its name, else as written. */
const rankedOr = (
  value: Scalar,
  ranks: ReadonlyMap<string, { readonly rank: number; readonly name: string }>,
): Found => {
  const known = typeof value === "string" ? ranks.get(value) : undefined;
  return known === undefined ? plain(value) : ranked(known.rank, { value, name: known.name });
};

const ranksOf = (
  entries: readonly { readonly key: string; readonly name: string }[],
): ReadonlyMap<string, { readonly rank: number; readonly name: string }> =>
  new Map(entries.map((entry, rank) => [entry.key, { rank, name: entry.name }]));

const scalarId = (value: Scalar): string => `${typeof value}\n${String(value)}`;

/** How the values of `by` are read (see the file comment). */
const readerOf = (selected: Selected, command: CommandName, by: string): Reader => {
  const { metamodel } = selected;
  switch (by) {
    case "type": {
      const ranks = ranksOf(metamodel.effectiveTypes);
      return (element, add) => {
        add(scalarId(element.type), () => rankedOr(element.type, ranks));
      };
    }
    case "status": {
      const ranks = ranksOf(metamodel.statuses);
      return (element, add) => {
        const status = element.data["status"];
        if (typeof status === "string") {
          add(scalarId(status), () => rankedOr(status, ranks));
        }
      };
    }
    case "package":
      return packageReader(selected, command);
  }
  const relation = relationKey(metamodel, by);
  if (relation !== undefined) {
    throw invalidAt(
      { command },
      "group",
      `${relation.label} holds relations; group by package, or by a property of kind choice`,
    );
  }
  const found = keyDefinition(metamodel, by);
  const choices =
    found?.kind === "property" && found.definition.kind === "choice" ? found.definition.choices : undefined;
  if (choices === undefined) {
    throw invalidAt(
      { command },
      "group",
      `${by} is no property with values to choose; group by type, status, package or a property of kind choice`,
    );
  }
  const ranks = ranksOf(choices);
  return (element, add) => {
    for (const stored of valuesOf(element.data[by])) {
      if (!isScalar(stored)) {
        continue;
      }
      const match = typeof stored === "string" ? findNamed(choices, stored) : undefined;
      const value = match?.kind === "found" ? match.key : stored;
      add(scalarId(value), () => rankedOr(value, ranks));
    }
  };
};

/** The available packages of an element, as the condition `package` reads them. */
const packageReader = (selected: Selected, command: CommandName): Reader => {
  const { metamodel, store, shortIds } = selected;
  const property = propertyFor({ command, metamodel }, "packages");
  const packages = { key: property.key, many: property.many === true };
  // Without the meaning `title` no key is the title (SR-013 AK3): every package is untitled.
  const titleKey = titleKeyOrEmpty(metamodel);
  return (element, add) => {
    for (const entry of validityEntries(packages, element)) {
      const named = validityTarget(entry.value, element);
      const found = named === undefined ? undefined : resolveTarget(store, element.repository, named);
      if (found?.kind !== "found") {
        continue;
      }
      const target = found.element;
      add(`${target.repository}\n${target.id}`, () => {
        const value = shortIds.of(target);
        const stored = target.data[titleKey];
        const title = typeof stored === "string" ? stored : "";
        const head = { value, ...(title === "" ? {} : { title }), ...identifierField(shortIds, target) };
        return textual(head, `${title}\n${value}`);
      });
    }
  };
};

/**
 * The groups of `selected` by `by` (see the file comment): one pass over the selection, then the
 * distinct values in order and the group without a value last. Errors name the field `group`.
 */
export const groupingOf = (selected: Selected, command: CommandName, by: string): Grouping => {
  const read = readerOf(selected, command, by);
  const distinct = new Map<string, Slot>();
  const slotsOf = new Map<ElementRecord, Slot[]>();
  for (const element of selected.elements) {
    const slots: Slot[] = [];
    read(element, (id, found) => {
      let slot = distinct.get(id);
      if (slot === undefined) {
        slot = { found: found(), index: 0 };
        distinct.set(id, slot);
      }
      if (!slots.includes(slot)) {
        slots.push(slot);
      }
    });
    if (slots.length > 0) {
      slotsOf.set(element, slots);
    }
  }
  const ordered = [...distinct.values()].sort((a, b) => compareFound(a.found, b.found));
  ordered.forEach((slot, index) => {
    slot.index = index;
  });
  const groups = new Map(
    [...slotsOf].map(([element, slots]) => [element, slots.map((s) => s.index).sort((a, b) => a - b)]),
  );
  const none = [ordered.length];
  return {
    heads: [...ordered.map((slot) => slot.found.head), {}],
    groupsOf: (element) => groups.get(element) ?? none,
  };
};
