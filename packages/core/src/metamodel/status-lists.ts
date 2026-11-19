// The status lists of types (ThomasBirkmaier/ReqSeq-archive#306) as the status commands change them
// (SR-240). A type's `statuses` are a union over the type and its ancestors; without any list in the
// chain the type has every status, so a type without a list gets one written when its statuses
// change (SR-240 AK1, AK3), and a type with a list below it would then also get every status of that
// list: such a change is refused (`widenedTypes`).
import type { MetamodelType } from "../generated/types.js";
import type { Metamodel } from "./load.js";
import { findType } from "./lookup.js";

/** The definition of the type `key` as written; undefined when the metamodel has none. */
export const typeDefinition = (metamodel: Metamodel, key: string): MetamodelType | undefined =>
  metamodel.types.find((t) => t.key === key);

/** The statuses of the type `key`, own and inherited; none when the metamodel has no such type. */
export const statusKeysOf = (metamodel: Metamodel, key: string): readonly string[] =>
  findType(metamodel, key)?.statuses ?? [];

/** The type `key` and its ancestors that have a list of statuses of their own, the type first. */
export const statusListHolders = (metamodel: Metamodel, key: string): readonly MetamodelType[] =>
  [key, ...(findType(metamodel, key)?.ancestors ?? [])]
    .map((k) => typeDefinition(metamodel, k))
    .filter((t): t is MetamodelType => t?.statuses !== undefined);

/**
 * The types that extend `type`, over any number of levels, with a list of statuses of their own,
 * that have a status under `after` they do not have under `before` (SR-240 AK1, AK3); in the order
 * of the types of `after`.
 */
export const widenedTypes = (before: Metamodel, after: Metamodel, type: string): readonly string[] =>
  after.effectiveTypes
    .filter((t) => t.ancestors.includes(type) && typeDefinition(after, t.key)?.statuses !== undefined)
    .filter((t) => {
      const had = new Set(statusKeysOf(before, t.key));
      return t.statuses.some((status) => !had.has(status));
    })
    .map((t) => t.key);
