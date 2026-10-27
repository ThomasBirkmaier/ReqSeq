// The mark "emergent behaviour" of an element (SR-035, N-010, D-012, ADR-0012 "Status rules"): a person
// sets it through the property with the meaning `emergent` (D-059); the tool never sets or computes it.
// An element is emergent when that property holds the choice key `yes` (`EMERGENT_CHOICE`, shared with
// the metamodel check of the meaning; files hold keys, D-043); `no`, no value, a display name, a list or
// any other value is no mark, and without a property with the meaning, or with one that cannot hold the
// mark (a warning of the metamodel), no element is emergent (assumption, spec question #591 Q1). The
// output field `emergent` (`view.ts`), the filter condition `emergent` (`query/condition.ts`) and the
// verification status (`evidence/indirect.ts`) all ask this one predicate.
import type { Metamodel } from "../metamodel/index.js";
import { EMERGENT_CHOICE, emergentProblem, propertyWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "./elements.js";

const keys = new WeakMap<Metamodel, string | undefined>();

/**
 * The key of the property with the meaning `emergent`; undefined when no property has it, or when it
 * cannot hold the mark (not a choice without `many` with the key `yes`: the metamodel warns,
 * `emergentProblem`). Memoised per metamodel object, so a list of 50,000 elements does not search the
 * properties per element (N-036).
 */
export const emergentKeyOf = (metamodel: Metamodel): string | undefined => {
  if (keys.has(metamodel)) {
    return keys.get(metamodel);
  }
  const property = propertyWithMeaning(metamodel, "emergent");
  const key = property === undefined || emergentProblem(property) !== undefined ? undefined : property.key;
  keys.set(metamodel, key);
  return key;
};

/** Whether `record` is marked emergent: its property `key` (`emergentKeyOf`) holds `yes` (file comment). */
export const isEmergent = (record: Pick<ElementRecord, "data">, key: string | undefined): boolean =>
  key !== undefined && record.data[key] === EMERGENT_CHOICE;
