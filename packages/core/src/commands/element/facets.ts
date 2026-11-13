// element.facets (ThomasBirkmaier/ReqSeq-archive#425, SR-069, SR-101, SR-118): the types, the statuses and the values of the properties of the
// elements of a selection (query/selection.ts) with counts, so a caller can offer the values a
// filter can take: the app's "Filter list by property" asks it for the list it is on, and CLI, API
// and MCP give the same answer (D-029). Free text (a title, acceptance criteria) gives no values;
// the rule and the exact counting are in query/facets.ts. Cost: one pass over the selection and one
// over the store, no file is read (`Selected` holds the records).
//
// With `search` (SR-216) only the elements of the selection that element.search finds for its query in
// its fields count: the facets of a list of search hits restricted to fields, which a `text` condition
// (every field) cannot select. The fields are checked as element.search checks them, against the
// selection's metamodel and then the index's; the hits are compared by repository and file, as the
// `text` condition compares them, so an index carried to a newer store restricts the selection's records.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { ElementFacetsInput } from "../../generated/types.js";
import type { Selected } from "../../query/index.js";
import { facetsOf, matchingKeys, recordKey, resolveSelection, searchIndex } from "../../query/index.js";
import { searchFieldsOf } from "../../query/search-fields.js";
import type { Workspace } from "../../runtime/workspace.js";

/** `selected` with only the elements `search` finds (see the file comment). */
const searched = async (
  workspace: Workspace,
  selected: Selected,
  search: NonNullable<ElementFacetsInput["search"]>,
): Promise<Selected> => {
  const checked = searchFieldsOf("element.facets", selected.metamodel, search.fields);
  const index = await searchIndex(workspace);
  const chosen =
    index.metamodel === selected.metamodel
      ? checked
      : searchFieldsOf("element.facets", index.metamodel, search.fields);
  const keys = matchingKeys(index, search.query, chosen);
  return { ...selected, elements: selected.elements.filter((element) => keys.has(recordKey(element))) };
};

export default defineCommand({
  name: "element.facets",
  run: async (ctx, input): Promise<CommandOutput<"element.facets">> => {
    const resolved = await resolveSelection(ctx.workspace, input.selection ?? {}, "element.facets");
    const selected =
      input.search === undefined ? resolved : await searched(ctx.workspace, resolved, input.search);
    return {
      total: selected.elements.length,
      ...facetsOf(selected, input.maxValues),
      incomplete: selected.incomplete,
    };
  },
});
