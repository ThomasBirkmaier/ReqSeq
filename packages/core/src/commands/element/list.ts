// element.list (SR-069, SR-101, SR-048 AK3, SR-043 with the validity of SR-040, SR-075): the elements
// of a selection (query/selection.ts), sorted (query/sort.ts), as list commands give them
// (model/list.ts), one page at a time; `total` counts every match and `incomplete` follows SR-006
// AK2. Only the page is built, so a filter over the 50,000 elements of N-036 reads the files of the
// page only. Sorted by `hierarchy` (SR-075 AK2), the list is the derivation tree depth first and
// `tree` gives the place of each element of the page. Nothing about the order is written (AK3).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { ElementListOutput } from "../../generated/types.js";
import type { ElementRecord } from "../../model/index.js";
import { listElements } from "../../model/index.js";
import type { TreePlace } from "../../query/index.js";
import { resolveSelection, sortElements } from "../../query/index.js";

type TreeEntry = NonNullable<ElementListOutput["tree"]>[number];

const named = (element: ElementRecord): { readonly id: string; readonly repository: string } => ({
  id: element.id,
  repository: element.repository,
});

const entryOf = ({ element, depth, parent }: TreePlace): TreeEntry => ({
  ...named(element),
  depth,
  ...(parent === undefined ? {} : { parent: named(parent) }),
});

export default defineCommand({
  name: "element.list",
  run: async (ctx, input): Promise<CommandOutput<"element.list">> => {
    const command = "element.list";
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, command);
    const sorted = sortElements({ ...selected, command }, selected.elements, input.sort ?? []);
    const end = input.offset + input.limit;
    const page = sorted.elements.slice(input.offset, end);
    const elements = await listElements(ctx.workspace, selected, page, { withText: input.withText === true });
    return {
      elements,
      ...(sorted.tree === undefined ? {} : { tree: sorted.tree.slice(input.offset, end).map(entryOf) }),
      total: selected.elements.length,
      incomplete: selected.incomplete,
    };
  },
});
