// evidence.status (SR-031, SR-034, SR-038): the verification and validation status of the elements of
// a selection (query/selection.ts, SR-101), one page at a time in workspace order, each element as
// element.list gives it (model/list.ts) with `verification` and `validation` from the evidence block
// (`withEvidenceStatus`, ADR-0012 "Status rules"), measured against the version listed; a
// requirement without own record is indirectly verified through its children or names those that
// are missing (SR-034). `total` counts the whole selection; `incomplete` follows SR-006 AK2: a
// repository of the workspace that is not on this machine may hold elements of the selection and
// records in its evidence locations. Only the page is built, so the files of the page and those of
// the requirements a status condition asks about are read (N-036). Nothing is written: the statuses
// are derived views and never the element's `status` (D-030).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { withEvidenceStatus, workspaceStatus } from "../../evidence/index.js";
import { listElements } from "../../model/index.js";
import { resolveSelection } from "../../query/index.js";

export default defineCommand({
  name: "evidence.status",
  run: async (ctx, input): Promise<CommandOutput<"evidence.status">> => {
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, "evidence.status");
    const page = selected.elements.slice(input.offset, input.offset + input.limit);
    const status = await workspaceStatus(ctx.workspace, page);
    const elements = await listElements(ctx.workspace, selected, page, {
      extend: (record, element) => withEvidenceStatus(status, record, element),
    });
    return {
      elements,
      total: selected.elements.length,
      incomplete: selected.incomplete,
    };
  },
});
