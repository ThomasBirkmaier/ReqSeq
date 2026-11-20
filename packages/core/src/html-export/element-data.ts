// What the pages of the HTML export show of each element besides its text (SR-232 AK1, AK2, SR-231 AK8), read in one
// batch for all elements (N-036): the element as `data.export` and `element.list` give it (`listElements`: properties as
// in the file, own relations and the successors' relations, each with the state of its other end), with its
// verification and validation status (`withEvidenceStatus`, the one source of `evidence.status` and `element.get`,
// SR-080 AK2); its acceptance criteria with number, criterion key, text and the reference for test names
// (`criterionReferencesOf`, SR-205 AK1); and the status of each criterion in every view it applies in
// (`criterionStatusesByView`, SR-031); the records that bear its verification status, by acceptance criterion
// (`elementDisplay`, the rule of `evidence.list`, SR-232 AK3, SR-032 AK3); and its open hints as `hint.list` gives
// them (`hintsByElement`, AK4), read once for the workspace.
import type { Problem } from "../catalog.js";
import type { Display, EvidenceRecord, ViewCriterionStatuses } from "../evidence/index.js";
import {
  criterionStatusesByView,
  elementDisplay,
  withEvidenceStatus,
  workspaceStatus,
} from "../evidence/index.js";
import { hintsByElement } from "../hints/index.js";
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
  /** For a requirement with verification records: its records and the rows of verification that group them. */
  readonly evidence?: ElementEvidence;
  /** Its open hints, when it has one. */
  readonly hints?: readonly Problem[];
}

/** The verification records of a requirement and its rows of `evidence.list`'s `display`, which name them by position. */
export interface ElementEvidence {
  readonly records: readonly EvidenceRecord[];
  readonly rows: readonly Display["rows"][number][];
}

/** The verification rows of `record` (see the file comment); none without a row. */
const evidenceOf = (
  status: Awaited<ReturnType<typeof workspaceStatus>>,
  record: ElementRecord,
  current: Parameters<typeof elementDisplay>[2],
): ElementEvidence | undefined => {
  const records = status.source.recordsOf(record.id);
  const rows = elementDisplay(status, record, current, records).display.rows.filter(
    (row) => row.kind === "verification",
  );
  return rows.length === 0 ? undefined : { records, rows };
};

/** The data of each of `records`, in their order (`listElements` gives each once, in the order given). */
export const elementDataOf = async (
  workspace: Workspace,
  context: ListContext,
  records: readonly ElementRecord[],
): Promise<ElementData[]> => {
  const status = await workspaceStatus(workspace, records);
  const hints = await hintsByElement(workspace);
  const data: Omit<ElementData, "record">[] = [];
  await listElements(workspace, context, records, {
    extend: (record, listed, forms) => {
      const element = withEvidenceStatus(status, record, listed, forms);
      const criteria = criterionReferencesOf(context, record, element.type, element.properties);
      const statuses = criteria === undefined ? undefined : criterionStatusesByView(status, record, forms);
      const evidence = evidenceOf(status, record, forms);
      const own = hints.get(record.id);
      data.push({
        element,
        ...(criteria === undefined ? {} : { criteria }),
        ...(statuses === undefined ? {} : { criterionStatuses: statuses }),
        ...(evidence === undefined ? {} : { evidence }),
        ...(own === undefined ? {} : { hints: own }),
      });
      return element;
    },
  });
  return zip(records, data).map(([record, shown]) => ({ record, ...shown }));
};
