// The fields a search is restricted to (SR-216 AK2): `element.search` `fields` names fixed fields
// (`title`, `text`, `properties`, `id`) and the keys of single properties of the metamodel
// (`searchPropertyKeys`). Fixed names always mean the fixed field, also when a property has that
// key. `properties` holds every property, so a single property chosen beside it adds nothing and
// is left out of the options.
// Refused as `input.invalid` at `fields`, naming the key: `type` and `status` (found in `properties`
// by their names), the key of the title property (the field `title`), a key that holds relations
// (a relation kind or a property of kind `relation`: a search does not look in relations) and a key
// the metamodel does not know (so that a typo shows).
import type { CommandName } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { relationKey, titleKeyOf } from "../model/index.js";
import { invalidAt } from "./context.js";
import type { SearchElementsOptions, SearchField } from "./search-index.js";
import { SEARCH_FIELDS, searchPropertyKeys } from "./search-index.js";

const isFixed = (name: string): name is SearchField => (SEARCH_FIELDS as readonly string[]).includes(name);

/** Why `key` is no field of a search, or undefined when it is the key of a single property. */
const refusal = (metamodel: Metamodel, key: string): string | undefined => {
  if (key === "type" || key === "status") {
    return `"${key}" is searched with "properties"`;
  }
  if (key === titleKeyOf(metamodel)) {
    return `"${key}" is the title; choose "title"`;
  }
  if (relationKey(metamodel, key) !== undefined) {
    return `"${key}" holds relations, which a search does not look in`;
  }
  return searchPropertyKeys(metamodel).includes(key)
    ? undefined
    : `"${key}" is not a property of the metamodel`;
};

/**
 * The search options of `fields` (`element.search` `fields`) with `metamodel` (see the file comment):
 * the fixed fields and the single properties; nothing when `fields` is undefined (every field).
 */
export const searchFieldsOf = (
  command: CommandName,
  metamodel: Metamodel,
  fields: readonly string[] | undefined,
): Pick<SearchElementsOptions, "fields" | "propertyKeys"> => {
  if (fields === undefined) {
    return {};
  }
  const fixed: SearchField[] = [];
  const keys: string[] = [];
  for (const name of fields) {
    if (isFixed(name)) {
      fixed.push(name);
      continue;
    }
    const why = refusal(metamodel, name);
    if (why !== undefined) {
      throw invalidAt({ command }, "fields", why);
    }
    keys.push(name);
  }
  // `properties` holds every single property: they are left out beside it.
  return fixed.includes("properties") ? { fields: fixed } : { fields: fixed, propertyKeys: keys };
};
