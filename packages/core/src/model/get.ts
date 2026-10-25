// Reading one element for `element.get`: the element as `elementView` shows it, from its file as it
// is now (the store keeps no text, ADR-0008). Nothing is written; it also works while the workspace
// is read-only (SR-011 AK3).
//
// Stage 1 gives what stage 1 has (catalog description of the output of element.get):
// - text, properties, version (SR-091), own relations with the target's short ID and title, also
//   across repositories (SR-005 AK2, SR-084), a target in a missing repository only by short ID
//   (SR-006 AK1), a target whose UUID several files share as ambiguous (SR-088 AK2);
// - the successors of a superseded element as incoming relations (SR-072 AK3, `successionsFor`);
// - the hints of the element (SR-016, SR-085, SR-086, SR-072 AK2), none while the metamodel is not
//   valid (#208, #220 option 1);
// - `readOnly`, always: true for an unknown type (SR-016 AK3), while the metamodel is not valid
//   (SR-011 AK3) and when this process cannot write the root folder of the element's repository
//   (`isWritableFolder`, like `workspace.status`; SR-018 AK2; unknown on Windows, then not set by it);
// - a hint `metamodel.meaning-unassigned` when no property has the meaning `title` (SR-013 AK3);
// - `versionDate` when the caller asks for it (`withDate`): the date of the version shown (D-013,
//   ADR-0005 "Version date", `versionDates`), `null` for content no commit has and when Git cannot
//   tell; without it no git runs and the field is left out (SR-082 AK3: opening stays fast).
// Left out until later stages: the other incoming relations, `verification` and `validation`, and
// the variants that replace or exclude the element (SR-046; the schema has no field for them yet).
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { readElementFile } from "../files/index.js";
import type { DataExportElement } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, meaningUnassignedMessage, metamodelState } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { isWritableFolder, workspaceLayoutState } from "../workspace/index.js";
import { classifyFile } from "./elements.js";
import { embeddedImages } from "./images.js";
import { resolveRef } from "./resolve.js";
import type { ShortIds } from "./short-id.js";
import { shortIdState } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState, ignoredBy } from "./store.js";
import { successionsFor } from "./successors.js";
import type { VersionDateContext, VersionDateWalk } from "./version-date.js";
import { prepareVersionDates, versionDates } from "./version-date.js";
import type { ExtraFindings } from "./view.js";
import { elementView, titleKeyOf } from "./view.js";

/**
 * The version date of `walk` when the caller asks for it (`withDate`): Git starts reading the
 * history at once, while the view is built, and the returned function gives the field for the
 * version the view computed. Without `withDate` no git runs and the field is left out.
 */
const dateWhenAsked = async (
  context: VersionDateContext,
  walk: VersionDateWalk,
  withDate: boolean,
): Promise<(version: string) => Promise<{ readonly versionDate?: string | null }>> => {
  if (!withDate) {
    return () => Promise.resolve({});
  }
  await prepareVersionDates(context, [walk]);
  // One date per request.
  return async (version) => ({
    versionDate: (await versionDates(context, [{ ...walk, version }]))[0] as string | null,
  });
};

/** What `showElement` reads: the workspace states it works on, as `getElement` takes them. */
export interface ShowContext {
  readonly workspace: Workspace;
  readonly layout: WorkspaceLayout;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
}

/**
 * The element `ref` names (`resolveRef`: `ref.unknown`, `ref.ambiguous`), read from its file now.
 * A file that changed since the store read it is shown as it is now, like a relation target is
 * stored (`currentTarget`). A file that is gone or no longer holds this element is `ref.unknown`,
 * and the element store is read again so the next call works on the files as they are; a file
 * that the new store reports as faulty (SR-008) is `file.faulty` with its errors instead.
 */
export const showElement = async (
  context: ShowContext,
  ref: string,
  extra: ExtraFindings,
  /** Whether to date the version from Git (`element.get` input `versionDate`). */
  withDate: boolean,
): Promise<DataExportElement> => {
  const { workspace, layout, metamodel, store, shortIds } = context;
  const stored = resolveRef(store, shortIds, ref);
  const repository = layout.repositories.find((r) => r.name === stored.repository);
  if (repository === undefined) {
    // The store reads only repositories of the layout, so this is a bug.
    throw new CommandError(
      "internal",
      `Repository ${stored.repository} of ${stored.file} is not in the workspace`,
    );
  }
  const read = await readElementFile(repository.folder, stored.file);
  const classified = read.kind === "parsed" ? classifyFile(stored.repository, read.file) : undefined;
  if (read.kind !== "parsed" || classified?.kind !== "element" || classified.element.id !== stored.id) {
    // Read the files again; the new store says whether the file is faulty now or gone (SR-008).
    await workspace.reset(elementStoreState);
    const faulty = (await workspace.get(elementStoreState)).problems.filter(
      (p) => p.repository === stored.repository && p.file === stored.file && p.severity === "error",
    );
    const where = { ref, repository: stored.repository, file: stored.file };
    throw faulty.length > 0
      ? new CommandError(
          "file.faulty",
          `${stored.file} is faulty now: ${faulty.map((p) => p.message).join("; ")}`,
          {
            ...where,
            problems: faulty,
          },
        )
      : new CommandError(
          "ref.unknown",
          `${ref} is no longer in ${stored.file}: the file changed on disk`,
          where,
        );
  }
  const record = classified.element;
  const titleKey = titleKeyOf(metamodel);
  const dateOf = await dateWhenAsked(
    { workspace, layout, metamodel },
    { repository: record.repository, file: record.file, id: record.id, text: read.file.body },
    withDate,
  );
  const element = elementView({
    record,
    file: read.file,
    images: await embeddedImages({ repository, ignored: ignoredBy(layout) }, record.file, read.file.body),
    metamodel,
    store,
    shortIds,
    // Without the meaning `title` (SR-013 AK3) no key is the title: the title is empty.
    titleKey: titleKey ?? "",
    layout,
    successionsOf: (element) => successionsFor(workspace, store, metamodel, element),
    extraFindings: extra,
  });
  const problems: Problem[] = [...element.problems];
  // A hint only against a valid metamodel, like the view's own (#208, #220 option 1).
  if (metamodel.valid && titleKey === undefined) {
    problems.push({
      code: "metamodel.meaning-unassigned",
      severity: "warning",
      message: meaningUnassignedMessage("title", "element.get"),
    });
  }
  const [writable, date] = await Promise.all([isWritableFolder(repository.folder), dateOf(element.version)]);
  return {
    ...element,
    ...date,
    // The repository root folder, as workspace.status checks it; a folder below it is not asked.
    readOnly: !metamodel.valid || findType(metamodel, record.type) === undefined || writable === false,
    problems,
  };
};

/** `element.get`: `showElement` on the workspace's current states. */
export const getElement = async (
  workspace: Workspace,
  ref: string,
  extra: ExtraFindings,
  /** Whether to date the version from Git (`element.get` input `versionDate`). */
  withDate: boolean,
): Promise<DataExportElement> =>
  showElement(
    {
      workspace,
      layout: await workspace.get(workspaceLayoutState),
      metamodel: await workspace.get(metamodelState),
      store: await workspace.get(elementStoreState),
      shortIds: await workspace.get(shortIdState),
    },
    ref,
    extra,
    withDate,
  );
