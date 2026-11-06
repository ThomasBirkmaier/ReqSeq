// The acceptance criteria of an element (D-072, SR-028 AK4): the values of the property with the
// meaning `acceptance-criteria`, a list of texts counted from 1 in their order. Evidence records name
// a criterion by that number. Without such a property, or with one that cannot hold the list (not of
// kind `text` with `many`: the metamodel warns, `acceptanceCriteriaProblem`), no element has
// criteria; a value that is no list holds none (the value kind check reports it, SR-085).
import type { Metamodel } from "../metamodel/index.js";
import { acceptanceCriteriaProblem, propertyWithMeaning } from "../metamodel/index.js";

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
