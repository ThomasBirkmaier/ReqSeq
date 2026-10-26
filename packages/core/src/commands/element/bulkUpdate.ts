// element.bulkUpdate (SR-071, SR-101): sets, adds to or removes one property for the elements of a
// selection (query/selection.ts), in one step. Without `confirm` it only previews: the number of
// affected elements (AK2) and the skipped ones whose type does not have the property (AK3). With
// `confirm` it writes only that property's lines (AK1, SR-102) through the write path of
// element.update. Never `id`, `type` or `status` (ADR-0002 rule 6). See model/bulk-update.ts.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { bulkUpdateElements } from "../../model/index.js";
import { resolveSelection } from "../../query/index.js";

export default defineCommand({
  name: "element.bulkUpdate",
  run: async (ctx, input): Promise<CommandOutput<"element.bulkUpdate">> => {
    const selected = await resolveSelection(ctx.workspace, input.selection, "element.bulkUpdate");
    const result = await bulkUpdateElements(ctx.workspace, selected, input);
    // The count first: it is what a person confirms (AK2).
    return {
      applied: result.applied,
      count: result.affected.length,
      affected: [...result.affected],
      unchanged: result.unchanged,
      skipped: [...result.skipped],
      files: [...result.files],
      problems: [...result.problems],
      incomplete: selected.incomplete,
    };
  },
});
