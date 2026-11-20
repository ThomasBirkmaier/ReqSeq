// evidence.degree (SR-037, SR-101 AK1): the verification degree of a selection (evidence/degree.ts) in
// the view of the selection, else of its saved filter, else the core (spec question ThomasBirkmaier/ReqSeq-archive#592 Q1). The
// selection is the one of `element.list` (query/selection.ts). `incomplete` (SR-006 AK2): a repository
// of the workspace file is not on this machine, so requirements, children or evidence locations there
// are not seen, or a condition of the selection met such a target. `names` names the variant of the
// view (ThomasBirkmaier/ReqSeq-archive#588). Nothing is written (D-030). `countedElements` gives the
// requirements of `degree.total` and of each `degree.counts.*` (SR-224 AK4) in the same view, by the rule
// the degree counts with (`degreeElements`).
import type {
  CommandContext,
  CommandInput,
  CommandOutput,
  OutputCount,
  OutputElements,
} from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import {
  degreeFieldElements,
  evidenceReadState,
  selectionDegree,
  selectionDegreeElements,
  variantIdsOf,
  viewIdOf,
} from "../../evidence/index.js";
import { namesField, namesOf } from "../../model/index.js";
import { resolveSelection } from "../../query/index.js";
import type { View } from "../../variants/index.js";
import { counted, incompleteNote, sentence, viewNamed } from "../answer.js";
import { degreePercent } from "../../evidence/degree-text.js";

const CORE: View = Object.freeze({ kind: "core" });

/** The requirements of `degree.total` and of each `degree.counts.*` (SR-224 AK4); baseline.prepare gives its own by it. */
export const countedOfDegree = async (
  ctx: CommandContext,
  input: CommandInput<"evidence.degree">,
  count: OutputCount,
): Promise<OutputElements> => {
  const selected = await resolveSelection(ctx, input.selection ?? {}, "evidence.degree");
  const view = selected.views[0] ?? CORE;
  const by = await selectionDegreeElements(ctx.workspace, selected.elements, view);
  const read = await ctx.workspace.get(evidenceReadState);
  return {
    elements: degreeFieldElements(by, count.field.slice("degree.".length)),
    incomplete: selected.incomplete || read.incomplete,
    view,
  };
};

export default defineCommand({
  name: "evidence.degree",
  answer: (output) => {
    const { degree } = output;
    const verified = degree.counts.verified + degree.counts.indirect;
    return sentence(
      `${String(verified)} of ${counted(degree.total, "requirement")} in view ${viewNamed(output.view, output.names)} ${verified === 1 ? "is" : "are"} verified or indirectly verified${degree.share === undefined ? "" : ` (${degreePercent(degree.share)})`}`,
      incompleteNote(output.incomplete),
    );
  },
  run: async (ctx, input): Promise<CommandOutput<"evidence.degree">> => {
    const selected = await resolveSelection(ctx, input.selection ?? {}, "evidence.degree");
    const view = selected.views[0] ?? CORE;
    const degree = await selectionDegree(ctx.workspace, selected.elements, view);
    const read = await ctx.workspace.get(evidenceReadState);
    const id = viewIdOf(view);
    return {
      degree,
      view: id,
      incomplete: selected.incomplete || read.incomplete,
      ...namesField(namesOf(selected, variantIdsOf(id))),
    };
  },
  countedElements: countedOfDegree,
});
