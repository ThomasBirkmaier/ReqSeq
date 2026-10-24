// Keys that hold relations (ADR-0004, D-012): the keys of relation kinds (always a list) and of
// properties of kind `relation` (one target, or a list with `many`). `keyDefinition` decides which
// definition a key has: a property wins over a relation kind of the same key, as in the value-kind
// check (SR-085). The checks that follow relations (SR-086, SR-089) read relations through here.
import type { MetamodelKey } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { keyDefinition } from "../metamodel/index.js";
import type { ValuePath } from "./values.js";

/** A key that holds relations. */
export interface RelationKey {
  /** How messages name the key: kind of definition, display name and key (D-043). */
  readonly label: string;
  /** Whether the value is a list of targets. */
  readonly many: boolean;
  /** `source-types` of a relation kind; a property names none. */
  readonly sourceTypes: readonly MetamodelKey[] | undefined;
  readonly targetTypes: readonly MetamodelKey[] | undefined;
}

const relationKeyOf = (metamodel: Metamodel, key: string): RelationKey | undefined => {
  const found = keyDefinition(metamodel, key);
  if (found === undefined) {
    return undefined;
  }
  const { name } = found.definition;
  if (found.kind === "relation") {
    return {
      label: `Relation ${name} (${key})`,
      many: true,
      sourceTypes: found.definition["source-types"],
      targetTypes: found.definition["target-types"],
    };
  }
  if (found.definition.kind !== "relation") {
    return undefined;
  }
  return {
    label: `Property ${name} (${key})`,
    many: found.definition.many === true,
    sourceTypes: undefined,
    targetTypes: found.definition["target-types"],
  };
};

/** One cache per metamodel object; a reset of the metamodel state makes a new object. */
const indexes = new WeakMap<Metamodel, Map<string, RelationKey | undefined>>();

/** The relation key `key` is, undefined for a key that holds no relations; cached per metamodel. */
export const relationKey = (metamodel: Metamodel, key: string): RelationKey | undefined => {
  let cache = indexes.get(metamodel);
  if (cache === undefined) {
    cache = new Map();
    indexes.set(metamodel, cache);
  }
  if (!cache.has(key)) {
    cache.set(key, relationKeyOf(metamodel, key));
  }
  return cache.get(key);
};

/**
 * The items of a relation key's value with their paths: `[key, i]` for a list, `[key]` for one
 * target. A list where one target belongs, or one value where a list belongs, gives none; the
 * value-kind check reports it (SR-085).
 */
export const relationItems = (
  key: string,
  relation: Pick<RelationKey, "many">,
  value: unknown,
): (readonly [ValuePath, unknown])[] => {
  if (relation.many) {
    return Array.isArray(value) ? value.map((item: unknown, i) => [[key, i], item] as const) : [];
  }
  return Array.isArray(value) ? [] : [[[key], value]];
};
