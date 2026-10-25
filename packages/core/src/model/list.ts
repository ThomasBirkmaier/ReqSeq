// Elements as list commands give them (`data-export.schema.json#/$defs/element`, text left out):
// `trace.related` (SR-023) now, `element.list` and the data export later. Each element is the one of
// `element.get` without text, hints and `readOnly` (`listedElement`), with its current version
// (`currentVersionsOf`: the version of its file as it is now, ADR-0005). Only the files of the
// listed elements are read, unless the workspace keeps the versions or the list is a large share of
// the store.
//
// - A file that changed since the store read it and still holds the element: the element is listed
//   as the file holds it now, so its data and its version agree.
// - An element without a current version (its file no longer holds it, an embedded image cannot be
//   read, a counted value has no normal form) is listed without `version`, with one `file.faulty`
//   warning in its `problems` that says why. One such element never fails the list (ADR-0008
//   "Current versions").
import type { DataExportElement } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { currentVersionsOf } from "./current-versions.js";
import type { ElementRecord } from "./elements.js";
import type { ShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { successionsFor } from "./successors.js";
import { listedElement, noVersionProblem, titleKeyOf } from "./view.js";

/** The states a list reads: `records` must be elements of `store`, `shortIds` of the same store. */
export interface ListContext {
  readonly layout: Pick<WorkspaceLayout, "repositories">;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
}

/** `records`, in their order and each once, as list commands give them (see the file comment). */
export const listElements = async (
  workspace: Workspace,
  context: ListContext,
  records: readonly ElementRecord[],
): Promise<DataExportElement[]> => {
  const { layout, metamodel, store, shortIds } = context;
  const versions = await currentVersionsOf(workspace, records);
  // Without the meaning `title` (SR-013 AK3) no key is the title: the title is empty, as in element.get.
  const titleKey = titleKeyOf(metamodel) ?? "";
  const successionsOf = (element: ElementRecord): ReturnType<typeof successionsFor> =>
    successionsFor(workspace, store, metamodel, element);
  const elements: DataExportElement[] = [];
  // The versions come in the order of `records`, each record once.
  for (const [stored, version] of versions) {
    const record = version.kind === "version" ? (version.element ?? stored) : stored;
    const input = { record, metamodel, store, shortIds, titleKey, layout, successionsOf };
    elements.push(
      version.kind === "version"
        ? listedElement(input, version.version)
        : { ...listedElement(input, undefined), problems: [noVersionProblem(stored, version.message)] },
    );
  }
  return elements;
};
