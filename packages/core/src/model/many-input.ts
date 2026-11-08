// One value given for a property with many values (#1209). `element.create`, `element.update` and
// `element.bulkUpdate` store the value of a property with `many: true` as a list, also when the
// caller gives one item without a list (`--set packages=PKG-…`, `"packages": "PKG-…"`): it becomes
// a list of one, as `["PKG-…"]` would be, so the written file is no wrong value kind (SR-085) and a
// relation target of `packages` counts for its package. A value that counts as no value
// (`isEmptyValue`) stays as given, as for every kind. A hand-written file is still read as it is.
import type { ElementInputValue } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { keyDefinition } from "../metamodel/index.js";
import { isEmptyValue } from "./required.js";

/** The value of property `key` as given, as a list of one when the property has `many` and the value is one item. */
export const listWhereMany = (
  metamodel: Metamodel,
  key: string,
  given: ElementInputValue,
): ElementInputValue => {
  const definition = keyDefinition(metamodel, key);
  if (
    definition?.kind !== "property" ||
    definition.definition.many !== true ||
    Array.isArray(given) ||
    isEmptyValue(given)
  ) {
    return given;
  }
  return [given] as ElementInputValue;
};
