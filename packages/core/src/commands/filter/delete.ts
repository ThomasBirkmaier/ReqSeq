// filter.delete (SR-217 AK5 to AK7): deletes a saved filter only with `confirm`; without it the output names
// the name and file that `confirm` deletes. The logic is `deleteFilter` (query/saved-delete.ts).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { deleteFilter } from "../../query/index.js";

export default defineCommand({
  name: "filter.delete",
  run: async (ctx, input): Promise<CommandOutput<"filter.delete">> =>
    deleteFilter(ctx.workspace, input.name, input.confirm, {
      ...(input.file === undefined ? {} : { file: input.file }),
      ...(input.expectedFileSha256 === undefined ? {} : { expectedFileSha256: input.expectedFileSha256 }),
    }),
});
