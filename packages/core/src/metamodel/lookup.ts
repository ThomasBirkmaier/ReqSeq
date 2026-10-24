// Finding types by their key (SR-012, D-043): element files hold the key of their type, the tool
// shows its name. Only the key finds a type, never the name, so renaming a type changes no file.
import { CommandError } from "../catalog.js";
import type { MetamodelKey, MetamodelProperty, MetamodelRelationKind } from "../generated/types.js";
import type { EffectiveType } from "./inheritance.js";
import type { Metamodel } from "./load.js";

/** One index per metamodel object; a reset of the metamodel state makes a new object. */
const indexes = new WeakMap<Metamodel, ReadonlyMap<MetamodelKey, EffectiveType>>();

const indexOf = (metamodel: Metamodel): ReadonlyMap<MetamodelKey, EffectiveType> => {
  const known = indexes.get(metamodel);
  if (known !== undefined) {
    return known;
  }
  const index = new Map(metamodel.effectiveTypes.map((t) => [t.key, t]));
  indexes.set(metamodel, index);
  return index;
};

/** The effective type with this key (its `name` is what the tool shows); undefined if unknown. */
export const findType = (metamodel: Metamodel, key: MetamodelKey): EffectiveType | undefined =>
  indexOf(metamodel).get(key);

/**
 * The type a new element gets (for `element.create`, SR-001, SR-064): its key goes into the file,
 * its effective `properties` and `required` are what the element has. Throws `input.invalid` with
 * `details.type` and `details.reason` (`unknown` or `abstract`) when no element of it can be created.
 */
export const typeForNewElement = (metamodel: Metamodel, key: MetamodelKey): EffectiveType => {
  const type = findType(metamodel, key);
  if (type === undefined) {
    throw new CommandError("input.invalid", `Unknown type ${key}: the metamodel has no type with this key`, {
      type: key,
      reason: "unknown",
    });
  }
  if (type.abstract) {
    throw new CommandError(
      "input.invalid",
      `Type ${key} is abstract: elements of this type cannot be created`,
      { type: key, reason: "abstract" },
    );
  }
  return type;
};

/** What the metamodel defines under a frontmatter key: a property or a relation kind. */
export type KeyDefinition =
  | { readonly kind: "property"; readonly definition: MetamodelProperty }
  | { readonly kind: "relation"; readonly definition: MetamodelRelationKind };

const keyIndexes = new WeakMap<Metamodel, ReadonlyMap<string, KeyDefinition>>();

/**
 * The definition of a frontmatter key, undefined for a key the metamodel does not know (SR-016).
 * Keys are unique across properties and relation kinds (ADR-0004); should a property and a
 * relation kind share one anyway, the property wins, in every check that uses this lookup.
 */
export const keyDefinition = (metamodel: Metamodel, key: string): KeyDefinition | undefined => {
  let index = keyIndexes.get(metamodel);
  if (index === undefined) {
    const built = new Map<string, KeyDefinition>();
    for (const definition of metamodel.relations) {
      built.set(definition.key, { kind: "relation", definition });
    }
    for (const definition of metamodel.properties) {
      built.set(definition.key, { kind: "property", definition });
    }
    keyIndexes.set(metamodel, built);
    index = built;
  }
  return index.get(key);
};

/**
 * Whether a list of type keys (`source-types`, `target-types`) allows the type `typeKey`: an
 * absent list allows every type, an empty one none, and a type in the list also allows every type
 * that extends it, over any number of levels (SR-012). A type the metamodel does not know is
 * allowed only by its own key.
 */
export const allowsType = (
  list: readonly MetamodelKey[] | undefined,
  typeKey: MetamodelKey,
  metamodel: Metamodel,
): boolean => {
  if (list === undefined) {
    return true;
  }
  if (list.includes(typeKey)) {
    return true;
  }
  return findType(metamodel, typeKey)?.ancestors.some((key) => list.includes(key)) === true;
};
