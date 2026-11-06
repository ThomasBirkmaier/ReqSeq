// The element as element.get and element.resolve show it (#456; a block helper, since every file in
// a command folder is a command): with its verification and validation status (SR-031, SR-034,
// SR-038, `withEvidenceStatus`) and the variants that replace or exclude it (`replacedBy`,
// `excludedBy`, SR-046 AK3, by the view rule over the store, `replacedExcludedOf`). `names` names the
// variants of its validity, `replacedBy` and `excludedBy`, then the replacements, then the views and
// missing children of `verification` (`verificationNameIds`), each once, so the app and the CLI show
// titles (SR-046 AK1/AK2, ThomasBirkmaier/ReqSeq-archive#588). `incomplete`: a repository of the workspace is not here, so
// replacements, exclusions and records stored there are missing (SR-006 AK2). `writtenWithStatus` gives
// the element a write returns (element.create, element.update) the same verification and validation
// status (#214); `replacedBy`, `excludedBy`, `names` and `incomplete` stay with element.get.
import { exportedProperties, targetIds, withReplacedExcluded } from "./export.js";
import { verificationNameIds, withEvidenceStatus, workspaceStatus } from "../evidence/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { DataExportElement, ElementName } from "../generated/types.js";
import type { ShownElement } from "../model/index.js";
import {
  currentVersionsOf,
  elementStoreState,
  formsOfEntry,
  namesField,
  namesOf,
  shortIdState,
} from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { replacedExcludedOf } from "../variants/index.js";
import { workspaceLayoutState } from "../workspace/index.js";

/** What element.get and element.resolve give about one element besides their own fields. */
export interface ShownWithNames {
  readonly element: DataExportElement;
  readonly names?: readonly ElementName[];
  readonly incomplete?: true;
}

/** `shown` (read by `getElement`) with status, replacements, exclusions, `names` and `incomplete`. */
export const shownWithNames = async (workspace: Workspace, shown: ShownElement): Promise<ShownWithNames> => {
  const { record } = shown;
  const [store, metamodel, shortIds, layout] = await Promise.all([
    workspace.get(elementStoreState),
    workspace.get(metamodelState),
    workspace.get(shortIdState),
    workspace.get(workspaceLayoutState),
  ]);
  const uses = replacedExcludedOf({ workspace, store, metamodel }, record);
  const element = withReplacedExcluded(
    uses,
    withEvidenceStatus(await workspaceStatus(workspace, [record]), record, shown.element, shown.forms),
  );
  const validity = exportedProperties(metamodel).validity;
  const named = [
    ...(validity === undefined ? [] : targetIds(validity, record)),
    ...uses.replacedBy.map((u) => u.variant.id),
    ...uses.excludedBy.map((v) => v.id),
    ...uses.replacedBy.map((u) => u.replacement.id),
    ...verificationNameIds(element.verification ?? []),
  ];
  return {
    element,
    ...namesField(namesOf({ metamodel, store, shortIds }, named)),
    ...(layout.repositories.some((r) => !r.available) ? { incomplete: true as const } : {}),
  };
};

/**
 * The element a write returned (`written`, its file as written) with its verification and validation status
 * as `shownWithNames` gives it, from the record of the store after the write; unchanged when the store holds
 * no record of that file (which a write that recorded its file does not leave).
 */
export const writtenWithStatus = async (
  workspace: Workspace,
  written: DataExportElement,
): Promise<DataExportElement> => {
  const store = await workspace.get(elementStoreState);
  // By file too: two files of one repository may share a UUID (SR-088).
  const record = store.byId
    .get(written.id)
    ?.find((r) => r.repository === written.repository && r.file === written.file);
  if (record === undefined) {
    return written;
  }
  // Both normal forms of the file as written, as `element.get` measures it (also with images).
  const forms = formsOfEntry((await currentVersionsOf(workspace, [record])).get(record));
  return withEvidenceStatus(await workspaceStatus(workspace, [record]), record, written, forms);
};
