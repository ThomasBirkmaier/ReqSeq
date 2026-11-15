// Deleting perspectives and saved filters (SR-217 AK5 to AK7): `perspective.delete` and
// `filter.delete`. Saved files are no elements (D-056), so D-045 does not hold them; this is the one
// place that deletes a file the user wrote (`deleteSavedFile`, files block).
//
// - Every call reads and checks everything, with or without `confirm`; nothing is kept between calls
//   (AK5). Only with `confirm` is the file deleted; the folder stays, also when it is empty then.
// - Found as when calling (`findSaved`), after the repository of the folder is known to be on this
//   machine (`file.folder-missing`): no file with the name is `input.invalid` at `name`, a name only
//   faulty files hold `file.faulty`. `name` in the output is the name stored in the file.
// - The caller's precondition (AK7, ADR-0007): with `file`, refused with `file.changed-on-disk` when
//   another file holds the name now; with `expectedFileSha256`, when the file has other bytes. So a
//   confirmation deletes the file the call without `confirm` named, and not a duplicate that holds
//   the name after it.
// - A saved filter (AK6): refused, already without `confirm`, when a perspective names it, also one a
//   file with the same name hides (`input.invalid` with `reason: "referenced"`), and when the tool
//   cannot be sure which files name it, as for a rename (`perspectivesNaming`, `refuseBaselines`).
// - Before the delete (AK7): the file does not lie in Git, still has the bytes it was read with, is a
//   writable regular file, and its folder is writable as far as the system tells (`checkChanges`).
// - A hidden file with the same name holds the name once the file is deleted: a warning in
//   `problems`, also without `confirm`.
import { CommandError } from "../catalog.js";
import type { CommandName } from "../catalog.js";
import { deleteSavedFile } from "../files/index.js";
import type { Problem } from "../generated/types.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { fold } from "./context.js";
import { PERSPECTIVES } from "./perspectives.js";
import type { SavedFile, SavedFolder, SavedKind } from "./saved-files.js";
import { faultySaved, findSaved, readSavedFolder, savedProblem } from "./saved-files.js";
import {
  checkChanges,
  perspectivesNaming,
  refuseBaselines,
  refuseMissingRepository,
} from "./saved-rename.js";
import { FILTERS } from "./saved.js";

/** What the caller read: the file and its bytes the call without `confirm` named (ADR-0007). */
export interface SavedDeleteExpected {
  readonly file?: string;
  readonly expectedFileSha256?: string;
}

/** What a delete gives: the file found, whether it was deleted and the files deleted. */
export interface SavedDelete {
  readonly name: string;
  readonly file: string;
  readonly fileSha256: string;
  readonly deleted: boolean;
  readonly files: string[];
  readonly problems: Problem[];
}

/** A refusal that comes from the shared write checks says "Not deleted", with its code and details. */
const asDelete = (error: unknown): unknown =>
  error instanceof CommandError && error.message.startsWith("Not written: ")
    ? new CommandError(
        error.code,
        `Not deleted: ${error.message.slice("Not written: ".length)}`,
        error.details,
        { cause: error },
      )
    : error;

/** The valid file of `name`, else the refusal (see the file comment). */
const ownFile = (
  kind: SavedKind,
  folder: SavedFolder<unknown>,
  name: string,
  command: CommandName,
): SavedFile<unknown> => {
  const found = findSaved(folder, name);
  if (found.kind === "faulty") {
    throw faultySaved(kind, name, found.files, "deleted");
  }
  if (found.kind === "none") {
    throw new CommandError("input.invalid", `name: no ${kind.label} is named ${JSON.stringify(name)}`, {
      command,
      fields: ["name"],
    });
  }
  return found.saved;
};

/** Refuses unless `saved` is the file and has the bytes the caller read (see the file comment). */
const refuseUnexpected = (
  kind: SavedKind,
  saved: SavedFile<unknown>,
  expected: SavedDeleteExpected,
): void => {
  if (expected.file !== undefined && expected.file !== saved.file) {
    throw new CommandError(
      "file.changed-on-disk",
      `Not deleted: the ${kind.label} ${JSON.stringify(saved.name)} is in ${saved.file} now, not in ${expected.file}. Read it again first.`,
      { files: [saved.file] },
    );
  }
  if (
    expected.expectedFileSha256 !== undefined &&
    expected.expectedFileSha256 !== saved.yaml.snapshot.sha256
  ) {
    throw new CommandError(
      "file.changed-on-disk",
      `Not deleted: ${saved.file} changed on disk since it was read. Read it again first.`,
      { files: [saved.file] },
    );
  }
};

/** The warning that a hidden file of `kind` holds the name of `saved` once it is deleted. */
const holdingAfter = (kind: SavedKind, folder: SavedFolder<unknown>, saved: SavedFile<unknown>): Problem[] =>
  folder.hidden
    .filter((h) => fold(h.name) === fold(saved.name))
    .slice(0, 1)
    .map((h) =>
      savedProblem(
        kind.duplicate,
        "warning",
        h.repository.name,
        h.path,
        `${h.file} has the name ${JSON.stringify(h.name)} too and holds it once ${saved.file} is deleted`,
      ),
    );

/** Reads the folder of `kind` and finds the file of `name` (see the file comment). */
const readOwn = async (
  workspace: Workspace,
  kind: SavedKind,
  name: string,
  expected: SavedDeleteExpected,
  command: CommandName,
): Promise<{ readonly folder: SavedFolder<unknown>; readonly saved: SavedFile<unknown> }> => {
  const layout = await workspace.get(workspaceLayoutState);
  const folder = await readSavedFolder<{ readonly name: string }>(layout, kind);
  refuseMissingRepository(kind, folder, "deleted");
  const saved = ownFile(kind, folder, name, command);
  refuseUnexpected(kind, saved, expected);
  return { folder, saved };
};

/** Checks the file as AK7 says and, with `confirm`, deletes it. */
const finish = async (
  kind: SavedKind,
  folder: SavedFolder<unknown>,
  saved: SavedFile<unknown>,
  confirm: boolean,
): Promise<SavedDelete> => {
  try {
    await checkChanges([{ saved, to: saved.path }], "deleted");
    if (confirm) {
      await deleteSavedFile(saved.repository.folder, saved.path, saved.yaml.snapshot);
    }
  } catch (error) {
    throw asDelete(error);
  }
  return {
    name: saved.name,
    file: saved.file,
    fileSha256: saved.yaml.snapshot.sha256,
    deleted: confirm,
    files: confirm ? [saved.file] : [],
    problems: holdingAfter(kind, folder, saved),
  };
};

/** `perspective.delete` (see the file comment). */
export const deletePerspective = async (
  workspace: Workspace,
  name: string,
  confirm: boolean,
  expected: SavedDeleteExpected = {},
): Promise<SavedDelete> => {
  const { folder, saved } = await readOwn(workspace, PERSPECTIVES, name, expected, "perspective.delete");
  return finish(PERSPECTIVES, folder, saved, confirm);
};

/** `filter.delete` (see the file comment). */
export const deleteFilter = async (
  workspace: Workspace,
  name: string,
  confirm: boolean,
  expected: SavedDeleteExpected = {},
): Promise<SavedDelete> => {
  const command = "filter.delete";
  const { folder, saved } = await readOwn(workspace, FILTERS, name, expected, command);
  const layout = await workspace.get(workspaceLayoutState);
  const naming = await perspectivesNaming(layout, saved.name, "deleted");
  if (naming.length > 0) {
    const files = naming.map((p) => p.file);
    throw new CommandError(
      "input.invalid",
      `name: the saved filter ${JSON.stringify(saved.name)} is named in the perspectives ${files.join(", ")}; it is not deleted`,
      { command, fields: ["name"], reason: "referenced", files },
    );
  }
  await refuseBaselines(workspace, saved.name, command, "deleted");
  return finish(FILTERS, folder, saved, confirm);
};
