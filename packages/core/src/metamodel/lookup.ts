// Finding types by their key (SR-012, D-043): element files hold the key of their type, the tool
// shows its name. Only the key finds a type, never the name, so renaming a type changes no file.
import { CommandError } from "../catalog.js";
import type { MetamodelKey } from "../generated/types.js";
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
