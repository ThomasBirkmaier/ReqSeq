// filter.rename (SR-217 AK1 to AK4, AK6, AK7): gives a saved filter a new name; its file is renamed
// to the name part of the new name (AK2), and every perspective that names the filter gets the new
// name first. The logic is `renameFilter` (query/saved-rename.ts).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { renameFilter } from "../../query/index.js";

export default defineCommand({
  name: "filter.rename",
  run: async (ctx, input): Promise<CommandOutput<"filter.rename">> =>
    renameFilter(ctx.workspace, input.name, input.newName),
});
