// The acceptance criteria of an element (D-072, SR-028 AK4): the values of the property with the
// meaning `acceptance-criteria`, a list of texts counted from 1 in their order. Evidence records name
// a criterion by that number. Without such a property, or with one that cannot hold the list (not of
// kind `text` with `many`: the metamodel warns, `acceptanceCriteriaProblem`), no element has
// criteria; a value that is no list holds none (the value kind check reports it, SR-085). Each
// criterion carries a criterion key (SR-204): the writers give and keep them (`reconcileCriteria`);
// the form of an item is `criterion-items.ts`.
import { randomInt } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { CommandError } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { acceptanceCriteriaProblem, propertyWithMeaning } from "../metamodel/index.js";
import type { KeyedCriterion } from "./criterion-items.js";
import { criterionKey, criterionText, isCriterionKey, isCriterionMapping } from "./criterion-items.js";

const keys = new WeakMap<Metamodel, string | undefined>();

/**
 * The key of the property with the meaning `acceptance-criteria`; undefined when no property has it
 * or it cannot hold the list. Memoised per metamodel object (N-036).
 */
export const acceptanceCriteriaKeyOf = (metamodel: Metamodel): string | undefined => {
  if (keys.has(metamodel)) {
    return keys.get(metamodel);
  }
  const property = propertyWithMeaning(metamodel, "acceptance-criteria");
  const key =
    property === undefined || acceptanceCriteriaProblem(property) !== undefined ? undefined : property.key;
  keys.set(metamodel, key);
  return key;
};

/** How many acceptance criteria `values` (an element's frontmatter) hold under `key` (`acceptanceCriteriaKeyOf`). */
export const criteriaCount = (values: Readonly<Record<string, unknown>>, key: string | undefined): number => {
  const value = key === undefined ? undefined : values[key];
  return Array.isArray(value) ? value.length : 0;
};

/** The first character of a generated criterion key: consonants, so a key reads as no word. */
const FIRST = "bcdfghjkmnpqrstvwxyz";
/** The other characters of a generated key. */
const REST = `${FIRST}0123456789`;
/** Characters of a generated key; 540,000 keys, retried against those the element has (SR-204 AK1). */
const GENERATED_LENGTH = 4;

/** A random integer from 0 below `below`; `crypto.randomInt` unless a test injects another. */
export type RandomInt = (below: number) => number;

/** A new criterion key that `taken` does not hold: 4 characters, the first a consonant (SR-204 AK1). */
export const newCriterionKey = (taken: ReadonlySet<string>, random: RandomInt = randomInt): string => {
  for (;;) {
    let key = FIRST.charAt(random(FIRST.length));
    while (key.length < GENERATED_LENGTH) {
      key += REST.charAt(random(REST.length));
    }
    if (!taken.has(key)) {
      return key;
    }
  }
};

/**
 * The stored items as entries of a new list that keeps their keys: an item with a key in its form
 * keeps it at its first occurrence; an item with a key in another form, or one an earlier item
 * holds already, becomes its text, so it is matched by its text or gets a new key (SR-204 AK1).
 * Other items stay as they are.
 */
export const carriedCriteria = (stored: unknown): unknown[] => {
  const seen = new Set<string>();
  return (Array.isArray(stored) ? (stored as unknown[]) : []).map((item) => {
    if (!isCriterionMapping(item)) {
      return item;
    }
    const key = criterionKey(item);
    if (key === undefined || !isCriterionKey(key) || seen.has(key)) {
      return item.text;
    }
    seen.add(key);
    return { key, text: item.text };
  });
};

const refused = (message: string, index: number, reason: string, key: unknown): CommandError =>
  new CommandError("input.invalid", message, {
    index,
    position: index + 1,
    reason,
    ...(typeof key === "string" ? { criterionKey: key } : {}),
  });

/** The keys the entries pass, checked (SR-204 AK5): each in its form and on one entry only. */
const passedKeys = (property: string, next: readonly unknown[]): Set<string> => {
  const passed = new Set<string>();
  next.forEach((entry, index) => {
    if (!isCriterionMapping(entry) || !Object.hasOwn(entry, "key")) {
      return;
    }
    const { key } = entry;
    if (!isCriterionKey(key)) {
      throw refused(
        `${property} item ${String(index + 1)}: ${JSON.stringify(key) ?? "the key"} is no criterion key; a criterion key is a lower-case letter a to z, then 3 to 15 lower-case letters a to z or digits`,
        index,
        "criterion-key-invalid",
        key,
      );
    }
    if (passed.has(key)) {
      throw refused(
        `${property} item ${String(index + 1)}: the criterion key ${key} is given twice; each acceptance criterion needs its own`,
        index,
        "criterion-key-duplicate",
        key,
      );
    }
    passed.add(key);
  });
  return passed;
};

/**
 * The acceptance criteria `next` as the file stores them, compared with the items `previous` the
 * file holds now (SR-204). An entry is a text, or `{ text, key? }`:
 *
 * - a passed key is kept; one not in its form, `true`, `null`, or one two entries pass, is
 *   `input.invalid` (`reason: criterion-key-invalid`, `criterion-key-duplicate`), so nothing is
 *   written (AK5);
 * - an entry without key takes the key of the first previous criterion with the same text whose key
 *   no entry passes and no earlier entry took, never by position (AK4); of two previous criteria with
 *   one key only the first counts, so the earlier one keeps it (AK1);
 * - every other entry gets a new key (AK1).
 *
 * When no key is passed and the texts are those of `previous` in their order, `previous` is kept as
 * it is, so a repeated import or a set of unchanged texts changes nothing. An item that is no text
 * stays as it is, without a key (SR-085 reports it).
 */
export const reconcileCriteria = (
  property: string,
  previous: unknown,
  next: readonly unknown[],
  random: RandomInt = randomInt,
): unknown[] => {
  const before = Array.isArray(previous) ? (previous as unknown[]) : undefined;
  const passed = passedKeys(property, next);
  if (
    passed.size === 0 &&
    before !== undefined &&
    isDeepStrictEqual(before.map(criterionText), next.map(criterionText))
  ) {
    return before;
  }
  // The keys of the previous criteria by text, each key at its first item only (AK1).
  const byText = new Map<string, string[]>();
  const all = new Set<string>(passed);
  for (const item of carriedCriteria(before)) {
    const key = criterionKey(item);
    if (key !== undefined) {
      all.add(key);
      if (!passed.has(key)) {
        const text = (item as KeyedCriterion).text;
        byText.set(text, [...(byText.get(text) ?? []), key]);
      }
    }
  }
  return next.map((entry) => {
    const text = criterionText(entry);
    if (typeof text !== "string") {
      return entry;
    }
    const given = isCriterionMapping(entry) ? entry.key : undefined;
    if (typeof given === "string") {
      return { key: given, text };
    }
    const key = byText.get(text)?.shift() ?? newCriterionKey(all, random);
    all.add(key);
    return { key, text };
  });
};

/**
 * `value` as stored when it is the value of the acceptance criteria `key` of `metamodel`
 * (`reconcileCriteria` with the items `previous` the file holds now); any other value as it is.
 */
export const withCriterionKeys = <T>(
  metamodel: Metamodel,
  key: string,
  previous: unknown,
  value: T,
): T =>
  Array.isArray(value) && acceptanceCriteriaKeyOf(metamodel) === key
    ? (reconcileCriteria(key, previous, value as unknown[]) as T)
    : value;
