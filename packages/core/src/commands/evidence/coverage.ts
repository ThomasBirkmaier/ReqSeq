// evidence.coverage (SR-036, SR-101 AK1): the coverage of a selection by children and evidence per
// level (evidence/coverage.ts), with the UUIDs behind every number (AK2). The selection is the one of
// `element.list` (query/selection.ts). `incomplete` (AK3, SR-006 AK2): a repository of the workspace
// file is not on this machine, so children, elements or evidence locations there are not seen, or a
// condition of the selection met such a target. Nothing is written.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { coverageOf, coverageRules, evidenceIndexState, evidenceReadState } from "../../evidence/index.js";
import { resolveSelection } from "../../query/index.js";
import { derivationGraph, traceContext } from "../../trace/index.js";

export default defineCommand({
  name: "evidence.coverage",
  run: async (ctx, input): Promise<CommandOutput<"evidence.coverage">> => {
    const command = "evidence.coverage";
    const graph = derivationGraph(await traceContext(ctx.workspace), command);
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, command);
    const index = await ctx.workspace.get(evidenceIndexState);
    const read = await ctx.workspace.get(evidenceReadState);
    return {
      levels: coverageOf(selected.elements, coverageRules(graph, index, selected.views)),
      incomplete: selected.incomplete || read.incomplete,
    };
  },
});
