// The element as element.get and element.resolve show it (#456; a block helper, since every file in
// a command folder is a command): with its verification and validation status (SR-031, SR-034,
// SR-038, `withEvidenceStatus`) and the variants that replace or exclude it (`replacedBy`,
// `excludedBy`, SR-046 AK3, by the view rule over the store, `replacedExcludedOf`). `names` names the
// variants of its validity, `replacedBy` and `excludedBy`, then the replacements, then the views and
// missing children of `verification` (`verificationNameIds`), each once, so the app and the CLI show
// titles (SR-046 AK1/AK2, #588). `incomplete`: a repository of the workspace is not here, so
// replacements, exclusions and records stored there are missing (SR-006 AK2).
import { exportedProperties, targetIds, withReplacedExcluded } from "./export.js";
import { verificationNameIds, withEvidenceStatus, workspaceStatus } from "../evidence/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { DataExportElement, ElementName } from "../generated/types.js";
import type { ShownElement } from "../model/index.js";
import { elementStoreState, namesField, namesOf, shortIdState } from "../model/index.js";
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
    withEvidenceStatus(await workspaceStatus(workspace, [record]), record, shown.element),
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
