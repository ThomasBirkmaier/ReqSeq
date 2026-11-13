// The fields a search is restricted to (SR-216 AK2): `element.search` `fields` names fixed fields
// (`title`, `text`, `properties`, `id`) and the keys of single properties of the metamodel
// (`searchPropertyKeys`). Fixed names always mean the fixed field, also when a property has that
// key. `properties` holds every property, so a single property chosen beside it adds nothing and
// is left out of the options.
// Refused as `input.invalid` at `fields`, naming the key: `type` and `status` (found in `properties`
// by their names), the key of the title property (the field `title`), a key that holds relations
// (a relation kind or a property of kind `relation`: a search does not look in relations) and a key
// the metamodel does not know (so that a typo shows).
// `searchFieldChoices` lists the fields a search can be restricted to (SR-216 AK3,
// `element.searchFields`): the fixed ones, then each single property a type of the workspace's
// elements has, in metamodel order (`searchPropertyKeys`, so a property keyed like a fixed field is
// not listed).
import type { CommandName } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { propertyWithMeaning } from "../metamodel/index.js";
import type { ElementStore } from "../model/index.js";
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

/** One field a search can be restricted to: its key for `fields` and its name. */
export interface SearchFieldChoice {
  readonly key: string;
  readonly name: string;
}

const typesCache = new WeakMap<ElementStore, ReadonlySet<string>>();

/** The types the elements of `store` have, as written; one pass per store, since a store never changes. */
const typesOf = (store: ElementStore): ReadonlySet<string> => {
  let types = typesCache.get(store);
  if (types === undefined) {
    types = new Set(store.elements.map((element) => element.type));
    typesCache.set(store, types);
  }
  return types;
};

/**
 * The fields a search of `store` can be restricted to (see the file comment): title (by the title
 * property's name; "Title" without one, SR-013 AK3), text, IDs, all properties, then the single
 * properties of the types its elements have.
 */
export const searchFieldChoices = (metamodel: Metamodel, store: ElementStore): SearchFieldChoice[] => {
  const types = typesOf(store);
  const had = new Set(
    metamodel.effectiveTypes.filter((type) => types.has(type.key)).flatMap((type) => type.properties),
  );
  const eligible = new Set(searchPropertyKeys(metamodel));
  return [
    { key: "title", name: propertyWithMeaning(metamodel, "title")?.name ?? "Title" },
    { key: "text", name: "Text" },
    { key: "id", name: "IDs" },
    { key: "properties", name: "All properties" },
    ...metamodel.properties
      .filter(({ key }) => had.has(key) && eligible.has(key))
      .map(({ key, name }) => ({ key, name })),
  ];
};
