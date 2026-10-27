// data.export (SR-061, SR-101): the data of the current state of the elements of a selection
// (query/selection.ts, SR-101 AK1/AK2), the only command so far that takes `selection.baseline`
// (SR-061 AK2, assumption A1 of #530 Q2), as JSON of `data-export.schema.json` (data/export.ts).
// Nothing is written and no status is changed (D-030).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { exportData } from "../../data/index.js";
import { resolveSelection } from "../../query/index.js";

export default defineCommand({
  name: "data.export",
  run: async (ctx, input): Promise<CommandOutput<"data.export">> => {
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, "data.export", {
      baseline: true,
    });
    return exportData(ctx.workspace, selected, input.selection);
  },
});
