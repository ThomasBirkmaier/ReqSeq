// evidence.degree (SR-037, SR-101 AK1): the verification degree of a selection (evidence/degree.ts) in
// the view of the selection, else of its saved filter, else the core (spec question #592 Q1). The
// selection is the one of `element.list` (query/selection.ts). `incomplete` (SR-006 AK2): a repository
// of the workspace file is not on this machine, so requirements, children or evidence locations there
// are not seen, or a condition of the selection met such a target. Nothing is written (D-030).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { evidenceReadState, selectionDegree, viewIdOf } from "../../evidence/index.js";
import { resolveSelection } from "../../query/index.js";
import type { View } from "../../variants/index.js";

const CORE: View = Object.freeze({ kind: "core" });

export default defineCommand({
  name: "evidence.degree",
  run: async (ctx, input): Promise<CommandOutput<"evidence.degree">> => {
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, "evidence.degree");
    const view = selected.views[0] ?? CORE;
    const degree = await selectionDegree(ctx.workspace, selected.elements, view);
    const read = await ctx.workspace.get(evidenceReadState);
    return { degree, view: viewIdOf(view), incomplete: selected.incomplete || read.incomplete };
  },
});
