// element.facets (#425, SR-069, SR-101): the statuses and the values of the properties of the
// elements of a selection (query/selection.ts) with counts, so a caller can offer the values a
// filter can take: the app's "Filter list by property" asks it for the list it is on, and CLI, API
// and MCP give the same answer (D-029). Free text (a title, acceptance criteria) gives no values;
// the rule and the exact counting are in query/facets.ts. Cost: one pass over the selection and one
// over the store, no file is read (`Selected` holds the records).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { facetsOf, resolveSelection } from "../../query/index.js";

export default defineCommand({
  name: "element.facets",
  run: async (ctx, input): Promise<CommandOutput<"element.facets">> => {
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, "element.facets");
    return {
      total: selected.elements.length,
      ...facetsOf(selected, input.maxValues),
      incomplete: selected.incomplete,
    };
  },
});
