// element.bulkUpdate (SR-071, SR-101): sets, adds to or removes one property for the elements of a
// selection (query/selection.ts), in one step. Without `confirm` it only previews: the number of
// affected elements (AK2) and the skipped ones whose type does not have the property (AK3). With
// `confirm` it writes only that property's lines (AK1, SR-102) through the write path of
// element.update. Never `id`, `type` or `status` (ADR-0002 rule 6). See model/bulk-update.ts. A
// variant is not written with validity entries: the preview lists them, `confirm` is refused (SR-039 AK2).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { bulkUpdateElements } from "../../model/index.js";
import { resolveSelection } from "../../query/index.js";
import { nestedVariantCheck } from "../../variants/index.js";
import { counted, filesNote, incompleteNote, problemsNote, sentence } from "../answer.js";

export default defineCommand({
  name: "element.bulkUpdate",
  answer: (output, input) =>
    sentence(
      output.applied
        ? `Changed property ${input.property} of ${counted(output.count, "element")}`
        : `Preview: the change of property ${input.property} would change ${counted(output.count, "element")}, nothing written`,
      output.unchanged === 0 ? "" : `${counted(output.unchanged, "element")} unchanged`,
      output.skipped.length === 0 ? "" : `${counted(output.skipped.length, "element")} left out`,
      output.applied ? filesNote(output.files) : "",
      problemsNote(output.problems),
      incompleteNote(output.incomplete),
    ),
  run: async (ctx, input): Promise<CommandOutput<"element.bulkUpdate">> => {
    const selected = await resolveSelection(ctx, input.selection, "element.bulkUpdate");
    const result = await bulkUpdateElements(
      ctx.workspace,
      selected,
      input,
      await nestedVariantCheck(ctx.workspace, "element.bulkUpdate"),
    );
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
      plan: result.plan,
    };
  },
});
