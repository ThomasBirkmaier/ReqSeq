// data.store (SR-062): the data of the current state of the elements of a selection, as data.export
// gives it (query/selection.ts, SR-101; `selection.baseline` included, SR-061 AK2), written to
// `<commit>.jsonl` or `<commit>-dirty.jsonl` in a folder, one element per line (#319; data/store.ts).
// No status is changed (D-030).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { storeData } from "../../data/index.js";
import { resolveSelection } from "../../query/index.js";

export default defineCommand({
  name: "data.store",
  run: async (ctx, input): Promise<CommandOutput<"data.store">> => {
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, "data.store", {
      baseline: true,
    });
    return storeData(ctx.workspace, selected, input);
  },
});
