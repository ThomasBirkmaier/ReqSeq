// element.assignCriterionKeys (SR-204 AK3, D-072): gives every acceptance criterion without
// criterion key in the elements of a selection (query/selection.ts) a key, and names how many
// elements changed. Versions and existing keys stay as they are. See model/assign-criterion-keys.ts.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { assignCriterionKeys } from "../../model/index.js";
import { resolveSelection } from "../../query/index.js";
import { nestedVariantCheck } from "../../variants/index.js";

export default defineCommand({
  name: "element.assignCriterionKeys",
  run: async (ctx, input): Promise<CommandOutput<"element.assignCriterionKeys">> => {
    const selected = await resolveSelection(ctx.workspace, input.selection, "element.assignCriterionKeys");
    const result = await assignCriterionKeys(
      ctx.workspace,
      selected,
      await nestedVariantCheck(ctx.workspace, "element.assignCriterionKeys"),
    );
    // The count first: it is what the tool names (AK3).
    return {
      count: result.changed.length,
      changed: [...result.changed],
      skipped: [...result.skipped],
      files: [...result.files],
      incomplete: selected.incomplete,
    };
  },
});
