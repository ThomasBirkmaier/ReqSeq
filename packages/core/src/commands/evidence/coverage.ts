// evidence.coverage (SR-036, SR-101 AK1): the coverage of a selection by children and evidence per
// level (evidence/coverage.ts), with the UUIDs behind every number (AK2). The selection is the one of
// `element.list` (query/selection.ts). `incomplete` (AK3, SR-006 AK2): a repository of the workspace
// file is not on this machine, so children, elements or evidence locations there are not seen, or a
// condition of the selection met such a target. `names` names every element the levels list (#588),
// from the selection's records (nothing more is read). Nothing is written.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { coverageOf, coverageRules, evidenceIndexState, evidenceReadState } from "../../evidence/index.js";
import { namesField, namesOfRecords } from "../../model/index.js";
import { resolveSelection } from "../../query/index.js";
import { derivationGraph, traceContext } from "../../trace/index.js";
import { viewsInclude } from "../../variants/index.js";

export default defineCommand({
  name: "evidence.coverage",
  run: async (ctx, input): Promise<CommandOutput<"evidence.coverage">> => {
    const command = "evidence.coverage";
    const graph = derivationGraph(await traceContext(ctx.workspace), command);
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, command);
    const index = await ctx.workspace.get(evidenceIndexState);
    const read = await ctx.workspace.get(evidenceReadState);
    const includes = viewsInclude({ workspace: ctx.workspace, ...selected }, selected.views);
    const levels = coverageOf(selected.elements, coverageRules(graph, index, selected.views, includes));
    const listed = new Set(
      levels.flatMap((level) => [...level.elements.withChildren, ...level.elements.withoutChildren]),
    );
    return {
      levels,
      incomplete: selected.incomplete || read.incomplete,
      ...namesField(
        namesOfRecords(
          selected,
          selected.elements.filter((element) => listed.has(element.id)),
        ),
      ),
    };
  },
});
