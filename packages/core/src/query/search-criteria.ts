// Acceptance criteria in the search (SR-222): the criterion keys of a store, and how a word of a query
// names a criterion key or a criterion reference. Pure; `search-index.ts` searches with them.
//
// - Criteria (`criterionKeysOf`): those element.get gives, of elements whose type has the meaning
//   requirement; a key counts only in the form of SR-204 AK5, so keys compare in lower case.
// - The keys of a store (`keyedRecords`): per key the records with a criterion that carries it, in
//   store order, built from the records of a store (a carried index patches the map of the index it
//   was carried from, `carryKeyed`, as the identifiers are carried, #215).
// - A key word (`queryKeyOf`, AK1): a word that is a key in its form, in any case, also with `AK-` in
//   front as a criterion reference writes it (`AK-rqjp`).
// - A criterion reference (`queryReferenceOf`, AK2): a word that `criterionReferenceOf` reads with a
//   key (SR-205 AK5: with or without brackets, split at the first `/`), in any case.
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord, ElementStore } from "../model/index.js";
import { acceptanceCriteriaKeyOf } from "../model/acceptance-criteria.js";
import { requirementTypesOf } from "../model/index.js";
import { criterionReferenceOf, isCriterionKey } from "../model/criterion-items.js";
import { PatchedMap } from "../model/patched-map.js";

/**
 * The records by criterion key (see the file comment), each by its key in the index (`recordKey` of
 * search-build.ts: repository and file), so a carry patches strings and keeps no record of an older
 * store.
 */
export type KeyedRecords = ReadonlyMap<string, readonly string[]>;

/** The key of a record in the index (`recordKey`). */
type KeyOf = (record: ElementRecord) => string;

/** What `recordKeys` reads of a metamodel, looked up once per store. */
interface CriteriaOf {
  readonly property: string | undefined;
  readonly requirements: ReadonlySet<string>;
}

const criteriaOf = (metamodel: Metamodel): CriteriaOf => ({
  property: acceptanceCriteriaKeyOf(metamodel),
  requirements: requirementTypesOf(metamodel),
});

/**
 * The keys in their form (SR-204 AK5) of the criteria of `record`, each once; none without criteria:
 * what `criterionKeysOf` gives, read with one `Object.keys` per item, since a build reads every
 * record (through `criterionKeysOf` about 100 ms at N-036, here about a third).
 */
const keysIn = (of: CriteriaOf, record: ElementRecord): readonly string[] => {
  const items = of.property === undefined ? undefined : record.data[of.property];
  if (!Array.isArray(items) || items.length === 0 || !of.requirements.has(record.type)) {
    return [];
  }
  const keys: string[] = [];
  for (const item of items as unknown[]) {
    if (typeof item === "string") {
      continue;
    }
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return [];
    }
    const { key, text } = item as { readonly key?: unknown; readonly text?: unknown };
    const size = Object.keys(item).length;
    if (typeof text !== "string" || size !== (key === undefined ? 1 : 2)) {
      // Not a criterion mapping (`isCriterionMapping`): the element has no criteria.
      return [];
    }
    if (isCriterionKey(key) && !keys.includes(key)) {
      keys.push(key);
    }
  }
  return keys;
};

/** The keys in their form (SR-204 AK5) of the criteria of `record`, each once (`keysIn`). */
export const recordKeys = (metamodel: Metamodel, record: ElementRecord): readonly string[] =>
  keysIn(criteriaOf(metamodel), record);

/** The records of `store` by the keys of their criteria, in store order. */
export const keyedRecords = (store: ElementStore, metamodel: Metamodel, keyOf: KeyOf): KeyedRecords => {
  const built = new Map<string, string[]>();
  const of = criteriaOf(metamodel);
  for (const record of store.elements) {
    const keys = keysIn(of, record);
    const at = keys.length === 0 ? "" : keyOf(record);
    for (const key of keys) {
      const records = built.get(key);
      if (records === undefined) {
        built.set(key, [at]);
      } else {
        records.push(at);
      }
    }
  }
  return built;
};

/**
 * The records by key of a store carried from the one of `known`: the keys of the records `gone`
 * before and `now` after are looked at again, a patch of `known` whose other entries stay the same
 * arrays. The order within an entry does not count: hits are ordered by `before` of search-results.ts.
 */
export const carryKeyed = (
  known: KeyedRecords,
  metamodel: Metamodel,
  gone: readonly ElementRecord[],
  now: readonly ElementRecord[],
  keyOf: KeyOf,
): KeyedRecords => {
  const changes = new Map<string, string[] | undefined>();
  const listOf = (key: string): string[] => {
    let list = changes.get(key);
    if (list === undefined) {
      list = [...(known.get(key) ?? [])];
      changes.set(key, list);
    }
    return list;
  };
  for (const record of gone) {
    for (const key of recordKeys(metamodel, record)) {
      const list = listOf(key);
      const at = list.indexOf(keyOf(record));
      if (at >= 0) {
        list.splice(at, 1);
      }
    }
  }
  for (const record of now) {
    for (const key of recordKeys(metamodel, record)) {
      listOf(key).push(keyOf(record));
    }
  }
  for (const [key, list] of changes) {
    if (list?.length === 0) {
      changes.set(key, undefined);
    }
  }
  return PatchedMap.patch(known, changes);
};

/** The criterion key a word of a query names (AK1): the word, or the word after `AK-`, in lower case. */
export const queryKeyOf = (word: string): string | undefined => {
  const lower = word.trim().toLowerCase();
  // `AK-` in front, as a criterion reference writes it (SR-029 AK10).
  const key = lower.startsWith("ak-") ? lower.slice(3) : lower;
  return isCriterionKey(key) ? key : undefined;
};

/** A criterion reference of a query (AK2): the element reference and the criterion key. */
export interface QueryReference {
  readonly ref: string;
  readonly key: string;
}

/** The criterion reference a word of a query is (AK2), in any case; undefined for any other word. */
export const queryReferenceOf = (word: string): QueryReference | undefined => {
  const read = criterionReferenceOf(word.toLowerCase());
  return read !== undefined && typeof read.criterion === "string" && read.ref !== ""
    ? { ref: read.ref, key: read.criterion }
    : undefined;
};
