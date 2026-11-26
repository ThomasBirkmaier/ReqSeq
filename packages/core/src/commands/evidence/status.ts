// evidence.status (SR-031, SR-034, SR-038): the verification and validation status of the elements of
// a selection (query/selection.ts, SR-101), one page at a time in workspace order, each element as
// element.list gives it (model/list.ts) with `verification` and `validation` from the evidence block
// (`withEvidenceStatus`, ADR-0012 "Status rules"), measured against the version listed; a
// requirement without own record is indirectly verified through its children or names those that
// are missing (SR-034). Without a selection, or with one that names only a view (SR-031 AK13,
// `statusSelected`), only the elements whose type has the meaning `requirement` or `need` (own or
// inherited, SR-012), every status included; while the metamodel is not valid (SR-011 AK3, AK4)
// every element. A selection that names any other part, an empty `ids` or a `where` without a
// condition included, selects as it does for every command. `total` counts the whole selection;
// `incomplete` follows SR-006 AK2: a repository of the workspace that is not on this machine may
// hold elements of the selection and records in its evidence locations. Only the page is built, so
// the files of the page and those of the requirements a status condition asks about are read
// (N-036). Nothing is written: the statuses are derived views and never the element's `status`
// (D-030). `names` names the variants and missing children the page's `verification` gives by UUID
// only (ThomasBirkmaier/ReqSeq-archive#588), from the store (nothing more is read).
import type { CommandContext, CommandInput, CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { verificationNameIds, withEvidenceStatus, workspaceStatus } from "../../evidence/index.js";
import type { ElementSelection } from "../../generated/types.js";
import { typesWithMeaning } from "../../metamodel/index.js";
import { listElements, namesField, namesOf } from "../../model/index.js";
import type { Selected } from "../../query/index.js";
import { resolveSelection } from "../../query/index.js";
import { incompleteNote, paged, sentence } from "../answer.js";

/** Whether `selection` names no part but a view: then the status lists requirements and needs (AK13). */
const viewOnly = (selection: ElementSelection | undefined): boolean =>
  selection === undefined ||
  Object.entries(selection).every(([part, value]) => part === "view" || value === undefined);

/**
 * The elements of `input.selection` (see the file comment): with no part but a view, and while the
 * metamodel is valid, only those whose type has the meaning `requirement` or `need`.
 */
const statusSelected = async (
  ctx: CommandContext,
  input: Pick<CommandInput<"evidence.status">, "selection">,
): Promise<Selected> => {
  const selected = await resolveSelection(ctx, input.selection ?? {}, "evidence.status");
  const { metamodel } = selected;
  if (!viewOnly(input.selection) || !metamodel.valid) {
    return selected;
  }
  const types = new Set(
    [...typesWithMeaning(metamodel, "requirement"), ...typesWithMeaning(metamodel, "need")].map((t) => t.key),
  );
  return { ...selected, elements: selected.elements.filter((e) => types.has(e.type)) };
};

export default defineCommand({
  name: "evidence.status",
  answer: (output) =>
    sentence(
      `Listed the verification status of ${paged(output.elements.length, output.total, "element")}`,
      incompleteNote(output.incomplete),
    ),
  run: async (ctx, input): Promise<CommandOutput<"evidence.status">> => {
    const selected = await statusSelected(ctx, input);
    const page = selected.elements.slice(input.offset, input.offset + input.limit);
    const status = await workspaceStatus(ctx.workspace, page);
    const elements = await listElements(ctx.workspace, selected, page, {
      extend: (record, element, forms) => withEvidenceStatus(status, record, element, forms),
    });
    return {
      elements,
      total: selected.elements.length,
      incomplete: selected.incomplete,
      ...namesField(namesOf(selected, verificationNameIds(elements.flatMap((e) => e.verification ?? [])))),
    };
  },
  outputElements: async (ctx, input) => {
    const selected = await statusSelected(ctx, input);
    return { elements: selected.elements, incomplete: selected.incomplete };
  },
});
