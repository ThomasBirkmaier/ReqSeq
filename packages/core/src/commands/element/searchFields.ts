// element.searchFields (SR-216 AK3): the fields a search can be restricted to, which `element.search`
// `fields` takes, each with its key and name: title, text, IDs, all properties, then each single
// property a type of the workspace's elements has (`searchFieldChoices`, query/search-fields.ts). The
// app's command prompt completes `fields` with it (ADR-0002 rule 1, a read command made for completion
// like workspace.listFolder); CLI, API and MCP give the same answer (D-029). Cost: one pass over the
// elements per store for their types, then the metamodel; no file is read.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { metamodelState } from "../../metamodel/index.js";
import { elementStoreState } from "../../model/index.js";
import { searchFieldChoices } from "../../query/search-fields.js";

export default defineCommand({
  name: "element.searchFields",
  run: async (ctx): Promise<CommandOutput<"element.searchFields">> => {
    const metamodel = await ctx.workspace.get(metamodelState);
    const store = await ctx.workspace.get(elementStoreState);
    return { fields: searchFieldChoices(metamodel, store) };
  },
});
