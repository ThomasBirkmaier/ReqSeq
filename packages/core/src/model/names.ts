// How an output names an element it gives elsewhere by UUID only (#588,
// `common.schema.json#/$defs/elementName`): its short ID, identifier (#305) and title, as element.list
// gives them, so a reader (the CLI's readable output) can name it without a lookup of its own
// (ADR-0002 rule 3). Nothing is read: the store keeps the frontmatter, and the short IDs are built.
import type { ElementName } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord } from "./elements.js";
import type { ShortIds } from "./short-id.js";
import { identifierField } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { titleKeyOrEmpty } from "./view.js";

/** The states names are taken from: `shortIds` of `store`. */
export interface NameContext {
  readonly metamodel: Metamodel;
  readonly store: Pick<ElementStore, "byId">;
  readonly shortIds: ShortIds;
}

/**
 * The names of `records`, each UUID once (the first record of a UUID names it), in their order. The
 * title is empty without the meaning `title` (SR-013 AK3), as in element.list.
 */
export const namesOfRecords = (context: NameContext, records: Iterable<ElementRecord>): ElementName[] => {
  const { shortIds } = context;
  const titleKey = titleKeyOrEmpty(context.metamodel);
  const seen = new Set<string>();
  const names: ElementName[] = [];
  for (const record of records) {
    if (!seen.has(record.id)) {
      seen.add(record.id);
      const title = record.data[titleKey];
      names.push({
        id: record.id,
        repository: record.repository,
        shortId: shortIds.of(record),
        ...identifierField(shortIds, record),
        title: typeof title === "string" ? title : "",
      });
    }
  }
  return names;
};

/**
 * The names of the elements with the UUIDs `ids`, each once, in their order: the first element of a
 * UUID in store order (twins in several repositories, SR-088, share one name, as `missingChildren`
 * shares one UUID). A UUID that is not in the store is left out (the reader shows it as it is).
 */
export const namesOf = (context: NameContext, ids: Iterable<string>): ElementName[] => {
  const records: ElementRecord[] = [];
  for (const id of ids) {
    const record = context.store.byId.get(id)?.[0];
    if (record !== undefined) {
      records.push(record);
    }
  }
  return namesOfRecords(context, records);
};

/** `{ names }` for an output, left out when there is none (`names` of the catalog outputs). */
export const namesField = (names: readonly ElementName[]): { readonly names?: readonly ElementName[] } =>
  names.length === 0 ? {} : { names };
