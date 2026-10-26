// element.list (SR-069, SR-101, SR-048 AK3, SR-043 with the validity of SR-040): the elements of a
// selection (query/selection.ts), as list commands give them (model/list.ts), one page at a time;
// `total` counts every match and `incomplete` follows SR-006 AK2. Only the page is built, so a
// filter over the 50,000 elements of N-036 reads the files of the page only. Sorting and the
// derivation tree (SR-075) come with #87; until then `sort` is refused and the list keeps the order
// of the store.
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { listElements } from "../../model/index.js";
import { resolveSelection } from "../../query/index.js";

export default defineCommand({
  name: "element.list",
  run: async (ctx, input): Promise<CommandOutput<"element.list">> => {
    if (input.sort !== undefined) {
      throw new CommandError("input.invalid", "sort: sorting comes with SR-075; leave it out", {
        command: "element.list",
        fields: ["sort"],
      });
    }
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, "element.list");
    const page = selected.elements.slice(input.offset, input.offset + input.limit);
    const elements = await listElements(ctx.workspace, selected, page, { withText: input.withText === true });
    return { elements, total: selected.elements.length, incomplete: selected.incomplete };
  },
});
