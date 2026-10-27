// Reading one element for `element.get`: the element as `elementView` shows it, from its file as it
// is now (the store keeps no text, ADR-0008). Nothing is written; it also works while the workspace
// is read-only (SR-011 AK3).
//
// Stage 1 gives what stage 1 has (catalog description of the output of element.get):
// - text, properties, version (SR-091; left out with a `file.faulty` warning when a counted value
//   has no normal form, #276), own relations with the target's short ID and title, also
//   across repositories (SR-005 AK2, SR-084), a target in a missing repository only by short ID
//   (SR-006 AK1), a target whose UUID several files share as ambiguous (SR-088 AK2);
// - the successors of a superseded element as incoming relations (SR-072 AK3, `successionsFor`);
// - the hints of the element (SR-016, SR-085, SR-086, SR-072 AK2), and those of blocks that import
//   the model (`ElementHints`: SR-040 AK3, the outdated relations of SR-026 AK3), none while the
//   metamodel is not valid (#208, #220 option 1);
// - `readOnly`, always: true for an unknown type (SR-016 AK3), while the metamodel is not valid
//   (SR-011 AK3) and when this process cannot write the root folder of the element's repository
//   (`isWritableFolder`, like `workspace.status`; SR-018 AK2; unknown on Windows, then not set by it);
// - a hint `metamodel.meaning-unassigned` when no property has the meaning `title` (SR-013 AK3);
// - `versionDate` when the caller asks for it (`withDate`): the date of the version shown (D-013,
//   ADR-0005 "Version date", `versionDates`), `null` for content no commit has and when Git cannot
//   tell; without it no git runs and the field is left out (SR-082 AK3: opening stays fast);
// - one copy of an element whose UUID several files share (SR-088), picked by the inputs `repository`
//   and `file` among the candidates of `ref.ambiguous` (#255, `ElementCopy`).
// `verification` (SR-031, SR-034) and `validation` (SR-038) are added by `element.get` from the
// evidence block, which imports the model. Left out until later stages: the other incoming
// relations and the variants that replace or exclude the element (SR-046; the schema has no field for
// them yet).
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { readElementFile } from "../files/index.js";
import type { DataExportElement } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, meaningUnassignedMessage, metamodelState } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { isWritableFolder, workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { classifyFile } from "./elements.js";
import { embeddedImages } from "./images.js";
import type { ElementCopy } from "./resolve.js";
import { resolveRef } from "./resolve.js";
import type { ShortIds } from "./short-id.js";
import { shortIdState } from "./short-id.js";
import type { ElementStore } from "./store.js";
import type { LocatableFinding } from "./locate.js";
import { elementStoreState, ignoredBy } from "./store.js";
import { successionsFor } from "./successors.js";
import type { VersionDateContext, VersionDateWalk } from "./version-date.js";
import { prepareVersionDates, versionDates } from "./version-date.js";
import { elementView, titleKeyOf } from "./view.js";

/**
 * The version date of `walk` when the caller asks for it (`withDate`): Git starts reading the
 * history at once, while the view is built, and the returned function gives the field for the
 * version the view computed. Without `withDate` no git runs and the field is left out; it is also
 * left out for an element without a version (a counted value without a normal form, #276).
 */
const dateWhenAsked = async (
  context: VersionDateContext,
  walk: VersionDateWalk,
  withDate: boolean,
): Promise<(version: string | undefined) => Promise<{ readonly versionDate?: string | null }>> => {
  if (!withDate) {
    return () => Promise.resolve({});
  }
  await prepareVersionDates(context, [walk]);
  // One date per request. The history is read before the version is known; for an element
  // without a version (#276) that read is not used and no date is given.
  return async (version) =>
    version === undefined
      ? {}
      : { versionDate: (await versionDates(context, [{ ...walk, version }]))[0] as string | null };
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
 * Hints on the element shown from blocks that import the model, so the model cannot ask them itself
 * (`element.get` passes the superseded variants of SR-040 AK3 and the outdated relations of SR-026
 * AK3), before their lines in the file just read are known. Asked only while the metamodel is
 * valid; `record` is the element as its file holds it now, `withDate` the input `versionDate`.
 */
export type ElementHints = (
  context: ShowContext,
  record: ElementRecord,
  withDate: boolean,
) => Promise<readonly LocatableFinding[]>;

/** An element as `showElement` read it, with the SHA-256 of its file (SR-106). */
export interface ShownElement {
  readonly element: DataExportElement;
  /** The element as its file holds it now, which `element` shows (for the views of other blocks, SR-031). */
  readonly record: ElementRecord;
  /** The SHA-256 of the bytes of the file the element was read from, lower-case hex. */
  readonly fileSha256: string;
}

/**
 * The element `ref` names (`resolveRef`: `ref.unknown`, `ref.ambiguous`), in the repository and file
 * of `copy` when given (#255), read from its file now.
 * A file that changed since the store read it is shown as it is now, like a relation target is
 * stored (`currentTarget`). A file that is gone or no longer holds this element is `ref.unknown`,
 * and the element store is read again so the next call works on the files as they are; a file
 * that the new store reports as faulty (SR-008) is `file.faulty` with its errors instead. With the
 * element comes the SHA-256 of the file it was read from (`fileSha256`, the write precondition of
 * `element.update`, SR-106).
 */
export const showElement = async (
  context: ShowContext,
  ref: string,
  extra: ElementHints,
  /** Whether to date the version from Git (`element.get` input `versionDate`). */
  withDate: boolean,
  /** Which of the elements `ref` names (`element.get` inputs `repository` and `file`, #255). */
  copy: ElementCopy = {},
): Promise<ShownElement> => {
  const { workspace, layout, metamodel, store, shortIds } = context;
  const stored = resolveRef(store, shortIds, ref, copy);
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
  // The hints of other blocks (only against a valid metamodel), the start of the history walk and
  // the images run side by side.
  const [hints, dateOf, images] = await Promise.all([
    metamodel.valid ? extra(context, record, withDate) : [],
    dateWhenAsked(
      { workspace, layout, metamodel },
      { repository: record.repository, file: record.file, id: record.id, text: read.file.body },
      withDate,
    ),
    embeddedImages({ repository, ignored: ignoredBy(layout) }, record.file, read.file.body),
  ]);
  const element = elementView({
    record,
    file: read.file,
    images,
    metamodel,
    store,
    shortIds,
    // Without the meaning `title` (SR-013 AK3) no key is the title: the title is empty.
    titleKey: titleKey ?? "",
    layout,
    successionsOf: (element) => successionsFor(workspace, store, metamodel, element),
    extraFindings: hints,
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
    element: {
      ...element,
      ...date,
      // The repository root folder, as workspace.status checks it; a folder below it is not asked.
      readOnly: !metamodel.valid || findType(metamodel, record.type) === undefined || writable === false,
      problems,
    },
    record,
    fileSha256: read.file.snapshot.sha256,
  };
};

/** `element.get`: `showElement` on the workspace's current states. */
export const getElement = async (
  workspace: Workspace,
  ref: string,
  extra: ElementHints,
  /** Whether to date the version from Git (`element.get` input `versionDate`). */
  withDate: boolean,
  /** Which of the elements `ref` names (`element.get` inputs `repository` and `file`, #255). */
  copy: ElementCopy = {},
): Promise<ShownElement> =>
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
    copy,
  );
