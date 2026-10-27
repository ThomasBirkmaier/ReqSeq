// trace.matrix (SR-125, N-076, D-062): the traceability matrix of a selection. The rows are the
// elements of the selection in the order `element.list` gives (query/ordered.ts), one page at a time;
// the columns are the relation kinds and directions that occur in the whole selection, each with the
// rows that have a link and their share; the cells hold the elements at the other end, outdated or
// missing marked (trace/matrix.ts). All of it is computed here, so every access shows the same
// (SR-125 AK6, D-029). `incomplete` follows SR-006 AK2 over the whole selection.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { orderedSelection, resolveSelection } from "../../query/index.js";
import {
  checkRelationKinds,
  columnOutput,
  currentVersionLookup,
  matrixColumns,
  matrixContext,
  matrixRows,
  traceContext,
} from "../../trace/index.js";
import { appliesIn, validityOf } from "../../variants/index.js";

export default defineCommand({
  name: "trace.matrix",
  run: async (ctx, input): Promise<CommandOutput<"trace.matrix">> => {
    const command = "trace.matrix";
    const base = await traceContext(ctx.workspace);
    checkRelationKinds(base.metamodel, input.kinds, command);
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, command);
    const sorted = orderedSelection(selected, command, input.sort);
    const { views } = selected;
    const validity = validityOf(selected.metamodel);
    const context = matrixContext(base, {
      shortIds: selected.shortIds,
      kinds: input.kinds,
      // A row applies in every view of the selection (the selection's and the saved filter's), so does the other end of a link.
      ...(views.length === 0
        ? {}
        : { includes: (element) => views.every((view) => appliesIn(validity, element, view)) }),
    });
    const total = selected.elements.length;
    const columns = matrixColumns(context, selected.elements);
    const end = input.offset + input.limit;
    const page =
      sorted.tree === undefined
        ? sorted.elements.slice(input.offset, end).map((element) => ({ element }))
        : sorted.tree.slice(input.offset, end).map(({ element, depth }) => ({ element, depth }));
    const rows = await matrixRows(context, page, columns, currentVersionLookup(ctx.workspace));
    return {
      columns: columns.map((column) => columnOutput(column, total)),
      rows,
      total,
      incomplete: selected.incomplete,
    };
  },
});
