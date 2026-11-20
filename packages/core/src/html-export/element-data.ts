// What the pages of the HTML export show of each element besides its text (SR-232 AK1, AK2, SR-231 AK8), read in one
// batch for all elements (N-036): the element as `data.export` and `element.list` give it (`listElements`: properties as
// in the file, own relations and the successors' relations, each with the state of its other end), with its
// verification and validation status (`withEvidenceStatus`, the one source of `evidence.status` and `element.get`,
// SR-080 AK2); its acceptance criteria with number, criterion key, text and the reference for test names
// (`criterionReferencesOf`, SR-205 AK1); and the status of each criterion in every view it applies in
// (`criterionStatusesByView`, SR-031).
import type { ViewCriterionStatuses } from "../evidence/index.js";
import { criterionStatusesByView, withEvidenceStatus, workspaceStatus } from "../evidence/index.js";
import type { DataExportElement } from "../generated/types.js";
import type { CriterionReferences, ElementRecord, ListContext } from "../model/index.js";
import { criterionReferencesOf, listElements } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { zip } from "../files/index.js";

/** One element as its page shows it (see the file comment). */
export interface ElementData {
  readonly record: ElementRecord;
  readonly element: DataExportElement;
  readonly criteria?: CriterionReferences;
  readonly criterionStatuses?: readonly ViewCriterionStatuses[];
}

/** The data of each of `records`, in their order (`listElements` gives each once, in the order given). */
export const elementDataOf = async (
  workspace: Workspace,
  context: ListContext,
  records: readonly ElementRecord[],
): Promise<ElementData[]> => {
  const status = await workspaceStatus(workspace, records);
  const data: Omit<ElementData, "record">[] = [];
  await listElements(workspace, context, records, {
    extend: (record, listed, forms) => {
      const element = withEvidenceStatus(status, record, listed, forms);
      const criteria = criterionReferencesOf(context, record, element.type, element.properties);
      const statuses = criteria === undefined ? undefined : criterionStatusesByView(status, record, forms);
      data.push({
        element,
        ...(criteria === undefined ? {} : { criteria }),
        ...(statuses === undefined ? {} : { criterionStatuses: statuses }),
      });
      return element;
    },
  });
  return zip(records, data).map(([record, shown]) => ({ record, ...shown }));
};
