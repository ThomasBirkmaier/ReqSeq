// Identifiers (#305, D-017): an ID from another source, such as the spec ID `SR-036` or a customer
// ID, kept in the property the metamodel gives the meaning `identifier`. An element's identifier is
// the text it holds there; it is unique per type (a duplicate is a finding, `identifiers.ts`), and
// element references accept it besides the UUID and short ID (`resolveRef`). Identifiers compare in
// any case, as UUIDs and short IDs do (#309): `sr-036` names the element with `SR-036`.
//
// The index is built with the short IDs (`buildShortIds`, `updateShortIds`), which depend on the
// same states (element store and metamodel) and are carried over a change of the store the same way
// (#184). Reading it reads nothing and writes nothing.
import type { Metamodel } from "../metamodel/index.js";
import { propertyWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "./elements.js";

/** The elements of a workspace by identifier, as `ShortIds` keeps them. */
export interface IdentifierIndex {
  /** The key of the property with the meaning `identifier`; undefined when no property has it. */
  readonly key: string | undefined;
  /**
   * The UUIDs of the elements with an identifier, by its `identifierMatch`, each UUID once, by code
   * units. UUIDs, not records: a save changes the records of a file but rarely its identifier, and
   * then the map is taken over as it is (`updateIdentifierIndex`).
   */
  readonly byValue: ReadonlyMap<string, readonly string[]>;
  /** The element store's records by UUID (`ElementStore.byId`). */
  readonly byId: ReadonlyMap<string, readonly ElementRecord[]>;
}

/** The key of the property with the meaning `identifier` (#305); undefined when no property has it. */
export const identifierKeyOf = (metamodel: Metamodel): string | undefined =>
  propertyWithMeaning(metamodel, "identifier")?.key;

/**
 * The identifier of an element: the text under `key` (`identifierKeyOf`), when it is not empty. Any
 * other value is no identifier; the value-kind check reports it (SR-085).
 */
export const identifierValue = (
  element: Pick<ElementRecord, "data">,
  key: string | undefined,
): string | undefined => {
  const value = key === undefined ? undefined : element.data[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

/** What two identifiers are compared by: the text in lower case (any case names the same, #309). */
export const identifierMatch = (value: string): string => value.toLowerCase();

/**
 * By repository, then file, by code units: the order does not depend on how the index was built (a
 * full build or an update), so every access lists candidates alike (SR-080). A file holds one
 * element, so no two elements have the same repository and file.
 */
const byPlace = (a: ElementRecord, b: ElementRecord): number =>
  a.repository !== b.repository ? (a.repository < b.repository ? -1 : 1) : a.file < b.file ? -1 : 1;

/** The records of a UUID; none when the store has no element with it. */
const recordsOf = (
  byId: ReadonlyMap<string, readonly ElementRecord[]>,
  id: string,
): readonly ElementRecord[] => byId.get(id) ?? [];

/** The `identifierMatch` of each record of a UUID that has an identifier. */
const matchesOf = (elements: readonly ElementRecord[], key: string): Set<string> => {
  const matches = new Set<string>();
  for (const element of elements) {
    const value = identifierValue(element, key);
    if (value !== undefined) {
      matches.add(identifierMatch(value));
    }
  }
  return matches;
};

/**
 * Adds `id` to the list of `match`, once: the records of one UUID come one after the other, so a
 * UUID already listed is the last one.
 */
const addId = (byValue: Map<string, string[]>, match: string, id: string): void => {
  const list = byValue.get(match);
  if (list === undefined) {
    byValue.set(match, [id]);
  } else if (list[list.length - 1] !== id) {
    list.push(id);
  }
};

/** The identifiers of the elements of `byId` (the element store), with the key of `metamodel`; one pass. */
export const buildIdentifierIndex = (
  byId: ReadonlyMap<string, readonly ElementRecord[]>,
  metamodel: Metamodel,
): IdentifierIndex => {
  const key = identifierKeyOf(metamodel);
  const byValue = new Map<string, string[]>();
  if (key !== undefined) {
    for (const [id, elements] of byId) {
      for (const element of elements) {
        const value = identifierValue(element, key);
        if (value !== undefined) {
          addId(byValue, identifierMatch(value), id);
        }
      }
    }
    for (const list of byValue.values()) {
      list.sort();
    }
  }
  return { key, byValue, byId };
};

/**
 * The index of `byId` (a store after a change, #184), built from `old`: for each UUID in `ids`, the
 * identifiers its records had before (`before`) and have now are compared, and only a UUID whose
 * identifiers changed moves between lists; when none did, the map of `old` is taken over. The same
 * as `buildIdentifierIndex` on `byId` when every other UUID has the same records in both stores.
 * `old` itself is not changed.
 */
export const updateIdentifierIndex = (
  old: IdentifierIndex,
  byId: ReadonlyMap<string, readonly ElementRecord[]>,
  ids: Iterable<string>,
  before: (id: string) => readonly ElementRecord[],
): IdentifierIndex => {
  const { key } = old;
  if (key === undefined) {
    return { ...old, byId };
  }
  const added = new Map<string, string[]>();
  const removed = new Map<string, Set<string>>();
  for (const id of ids) {
    const was = matchesOf(before(id), key);
    const is = matchesOf(recordsOf(byId, id), key);
    for (const match of was) {
      if (!is.has(match)) {
        removed.set(match, (removed.get(match) ?? new Set()).add(id));
      }
    }
    for (const match of is) {
      if (!was.has(match)) {
        added.set(match, [...(added.get(match) ?? []), id]);
      }
    }
  }
  if (added.size === 0 && removed.size === 0) {
    return { key, byValue: old.byValue, byId };
  }
  const byValue = new Map(old.byValue);
  for (const match of new Set([...added.keys(), ...removed.keys()])) {
    const gone = removed.get(match);
    const list = [
      ...(old.byValue.get(match) ?? []).filter((id) => gone?.has(id) !== true),
      ...(added.get(match) ?? []),
    ].sort();
    if (list.length === 0) {
      byValue.delete(match);
    } else {
      byValue.set(match, list);
    }
  }
  return { key, byValue, byId };
};

/**
 * The elements whose identifier is `value` in any case, by repository, then file: the records of
 * the UUIDs `index` lists for it that have it (a UUID that several files share may have it in one
 * file only).
 */
export const elementsWithIdentifier = (index: IdentifierIndex, value: string): readonly ElementRecord[] => {
  const match = identifierMatch(value);
  const ids = index.byValue.get(match) ?? [];
  return ids
    .flatMap((id) => recordsOf(index.byId, id))
    .filter((element) => {
      const own = identifierValue(element, index.key);
      return own !== undefined && identifierMatch(own) === match;
    })
    .sort(byPlace);
};
