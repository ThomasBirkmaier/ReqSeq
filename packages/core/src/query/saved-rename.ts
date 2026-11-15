// Renaming perspectives and saved filters (SR-217 AK1 to AK4, AK6, AK7): `perspective.rename` and
// `filter.rename`. Saved files are no elements (D-056), so D-045 does not hold them: the file name
// follows the name, as the name part of a new file does (saved-files.ts, AK2).
//
// - Found as when calling (`findSaved`), after the repository of the folder is known to be on this
//   machine (`file.folder-missing`): no file with the name is `input.invalid` at `name`, a name only
//   faulty files hold `file.faulty`. The same name, character for character, writes nothing.
// - The new name (AK3): another valid file of the kind holding it, ignoring case and normal form, is
//   `input.invalid` at `newName` with `reason: "name-taken"` and `files`; only faulty files holding
//   it, `file.faulty`. A change of case or normal form of the own name is a rename.
// - The file name (AK2, `renamedPath`): the name of a new file for the new name, the own entry left
//   out of the listing; the same ignoring case and normal form keeps the file name.
// - A saved filter (AK4, AK6): every perspective file that names it, also one a file with the same
//   name hides, gets the new name in its `filter` line, before the filter is written; also for a
//   change of case only. Refused, before anything is written, when the tool cannot be sure which
//   files name the filter: the perspectives or baselines folder in a repository that is not on this
//   machine or not listed (`file.folder-missing`; for the baselines folder #1739), or that cannot be
//   listed; a faulty perspective or baseline file that names the filter, or one that does not read as
//   YAML (`file.faulty`); a valid baseline file that names it (`input.invalid` with
//   `reason: "referenced"`), since ReqSeq never changes a baseline file. A filters folder that is
//   also the perspectives folder holds no valid perspective, so every filter file there is a faulty
//   perspective file that names no filter, unless it has a `filter` key.
// - Before the first write (AK7): no file to change or new path lies in Git (`refuseGitPlace`,
//   D-036), each file still has the bytes it was read with and is a writable regular file
//   (`checkReplaceable`), and each folder is writable, as far as the system tells (`isWritableFolder`).
//   Then the perspectives are written in file order, the renamed file last: first its new name
//   (`renameFileAtomic`), then its `name` line. When the name line cannot be written, the file is
//   renamed back, so the same call does not find a file it hid instead.
// - A write that fails part-way keeps its code; its message and `details.written` name the files
//   already changed. Unlike `writeElementFiles`, nothing is rolled back: the same call again finishes
//   the rename (perspectives already changed no longer name the old name).
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { CommandName } from "../catalog.js";
import type { FileSnapshot, YamlKeyEdit } from "../files/index.js";
import {
  checkReplaceable,
  editYamlDocument,
  readYamlFile,
  renameFileAtomic,
  writeFileAtomic,
} from "../files/index.js";
import type { Problem } from "../generated/types.js";
import { workspaceBaselines } from "../baselines/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { isWritableFolder, locate, refuseGitPlace, workspaceLayoutState } from "../workspace/index.js";
import { workspacePath } from "../model/index.js";
import { fold } from "./context.js";
import { PERSPECTIVES, readPerspectives } from "./perspectives.js";
import type { SavedFile, SavedFolder, SavedKind } from "./saved-files.js";
import { faultySaved, findSaved, newSavedFile, readSavedFolder, savedProblem } from "./saved-files.js";
import { FILTERS } from "./saved.js";

/** What a rename gives: the written files, the renamed file and the perspectives changed with a filter. */
export interface SavedRename {
  readonly files: string[];
  readonly renamed: { readonly from: string; readonly to: string }[];
  readonly perspectives: { readonly name: string; readonly file: string }[];
  readonly problems: Problem[];
}

/** One file to change: the file as read, its path afterwards (relative to its repository) and its edits. */
interface Change {
  readonly saved: SavedFile<unknown>;
  readonly to: string;
  readonly edits: readonly YamlKeyEdit[];
}

const NOTHING: SavedRename = { files: [], renamed: [], perspectives: [], problems: [] };

/** `file.folder-missing` when the folder of `kind` lies in a repository that is not on this machine or not listed. */
const missingRepository = (setting: string, repository: string): CommandError =>
  new CommandError(
    "file.folder-missing",
    `Not renamed: the ${setting} folder is in repository ${repository}, which is not available on this machine`,
    { repository },
  );

/** `file.folder-missing` when the folder of `kind` lies in a repository that is not on this machine or not listed. */
const refuseMissingRepository = (kind: SavedKind, folder: SavedFolder<unknown>): RepositoryLocation => {
  const { repository } = folder;
  if (repository?.available !== true) {
    throw missingRepository(kind.setting, folder.location.repository);
  }
  return repository;
};

/** The path of `saved` after a rename to `newName` (AK2): see the file comment. */
export const renamedPath = (
  kind: SavedKind,
  folder: SavedFolder<unknown>,
  saved: SavedFile<unknown>,
  newName: string,
): string => {
  const own = path.posix.basename(saved.path);
  // The rule's name without a suffix is the own file name, in any case: it stays (AK2), also when
  // another entry differs from it only in case.
  if (fold(newSavedFile(kind, newName, new Set())) === fold(own)) {
    return saved.path;
  }
  // The own entry left out as listed, so another entry that folds alike stays taken.
  const entries = new Set(folder.listed.filter((entry) => entry !== own).map(fold));
  const file = newSavedFile(kind, newName, entries);
  return fold(file) === fold(own) ? saved.path : path.posix.join(path.posix.dirname(saved.path), file);
};

/** The file of `name` and its change to `newName`, or undefined when the name stays as it is (AK1, AK3). */
const ownChange = (
  kind: SavedKind,
  folder: SavedFolder<unknown>,
  name: string,
  newName: string,
  command: CommandName,
): Change | undefined => {
  const found = findSaved(folder, name);
  if (found.kind === "faulty") {
    throw faultySaved(kind, name, found.files, "renamed");
  }
  if (found.kind === "none") {
    throw new CommandError("input.invalid", `name: no ${kind.label} is named ${JSON.stringify(name)}`, {
      command,
      fields: ["name"],
    });
  }
  const { saved } = found;
  if (saved.name === newName) {
    return undefined;
  }
  const taken = findSaved(folder, newName);
  if (taken.kind === "faulty") {
    throw faultySaved(kind, newName, taken.files, "given to another file");
  }
  if (taken.kind === "found" && taken.saved !== saved) {
    throw new CommandError(
      "input.invalid",
      `newName: the ${kind.label} ${JSON.stringify(taken.saved.name)} (${taken.saved.file}) has this name already`,
      { command, fields: ["newName"], reason: "name-taken", files: [taken.saved.file] },
    );
  }
  return { saved, to: renamedPath(kind, folder, saved, newName), edits: [{ key: "name", value: newName }] };
};

/** Whether `data`, a perspective file's data as read, names the filter `name` in its `filter`. */
const namesFilter = (data: unknown, name: string): boolean => {
  const filter = (data as { readonly filter?: unknown } | null)?.filter;
  return typeof filter === "string" && fold(filter) === fold(name);
};

/** Whether `data`, a baseline file's data as read, names the filter `name` in its stored selection. */
const baselineNamesFilter = (data: unknown, name: string): boolean =>
  namesFilter((data as { readonly selection?: unknown } | null)?.selection, name);

/** `file.faulty` for files that may name the filter but cannot be changed or read (AK6). */
const unsure = (filter: string, files: readonly string[]): CommandError =>
  new CommandError(
    "file.faulty",
    `Not renamed: the saved filter ${JSON.stringify(filter)} may be named in faulty files: ${files.join(", ")}; fix them by hand first`,
    { files: [...files] },
  );

/** The perspectives that name the filter `filter`, as changes to `newName` (AK4); refuses as AK6 says. */
const perspectiveChanges = async (
  layout: WorkspaceLayout,
  filter: string,
  newName: string,
): Promise<Change[]> => {
  const folder = await readPerspectives(layout);
  const repository =
    folder.incomplete || folder.repository === undefined
      ? refuseMissingRepository(PERSPECTIVES, folder)
      : folder.repository;
  if (folder.unreadable) {
    throw unsure(filter, [workspacePath(layout, repository, folder.folder)]);
  }
  const faulty = folder.faulty
    .filter((f) => !f.readable || namesFilter(f.data, filter))
    .map((f) => workspacePath(layout, repository, f.path));
  if (faulty.length > 0) {
    throw unsure(filter, faulty);
  }
  return [...folder.saved, ...folder.hidden]
    .filter((p) => namesFilter(p.data, filter) && p.data.filter !== newName)
    .sort((a, b) => Number(a.path > b.path) - Number(a.path < b.path))
    .map((saved) => ({ saved, to: saved.path, edits: [{ key: "filter", value: newName }] }));
};

/** Refuses when a baseline file names the filter, or one that may name it is faulty (AK6). */
const refuseBaselines = async (workspace: Workspace, filter: string, command: CommandName): Promise<void> => {
  const baselines = await workspaceBaselines(workspace);
  const naming = baselines.baselines.filter((b) => baselineNamesFilter(b.data, filter)).map((b) => b.shown);
  if (naming.length > 0) {
    throw new CommandError(
      "input.invalid",
      `name: the saved filter ${JSON.stringify(filter)} is named in ${naming.join(", ")}; ReqSeq never changes a baseline file, so it is not renamed`,
      { command, fields: ["name"], reason: "referenced", files: naming },
    );
  }
  const layout = await workspace.get(workspaceLayoutState);
  const { repository, folder } = locate(layout, baselines.location);
  if (baselines.incomplete || repository === undefined) {
    throw missingRepository("baselines", baselines.location.repository);
  }
  if (baselines.unreadable && folder !== undefined) {
    // A folder that cannot be listed is never the root of its repository, which the workspace needs.
    const shown = path.relative(repository.folder, folder).split(path.sep).join("/");
    throw unsure(filter, [workspacePath(layout, repository, shown)]);
  }
  const faulty: string[] = [];
  for (const file of baselines.faulty) {
    const read = await readYamlFile(repository.folder, file);
    if (read.kind === "problem" || baselineNamesFilter(read.file.data, filter)) {
      faulty.push(workspacePath(layout, repository, file));
    }
  }
  if (faulty.length > 0) {
    throw unsure(filter, faulty);
  }
};

/** Refuses, before anything is written, every change AK7 refuses. */
const checkChanges = async (changes: readonly Change[]): Promise<void> => {
  for (const { saved, to } of changes) {
    // Each repository is on this machine: the folders of both kinds were checked when read.
    const { repository } = saved;
    await refuseGitPlace(repository, saved.path);
    if (to !== saved.path) {
      await refuseGitPlace(repository, to);
    }
    await checkReplaceable(repository.folder, saved.path, saved.yaml.snapshot, { kind: "yaml" });
    const folder = path.posix.dirname(saved.path);
    if ((await isWritableFolder(path.join(repository.folder, folder))) === false) {
      throw new CommandError(
        "file.read-only",
        `Not written: the folder of ${saved.file} is not writable; nothing was written`,
        { repository: repository.name, folder },
      );
    }
  }
};

/** The file as outputs name it, at `file` relative to its repository. */
const shownAt = (saved: SavedFile<unknown>, file: string): string =>
  path.posix.join(path.posix.dirname(saved.file), path.posix.basename(file));

/**
 * Renames the file of `saved` back after its name line could not be written (see the file comment):
 * true when it is back at its old path.
 */
const renameBack = async (
  saved: SavedFile<unknown>,
  to: string,
  snapshot: FileSnapshot,
): Promise<boolean> => {
  try {
    await renameFileAtomic(saved.repository.folder, to, saved.path, snapshot, { kind: "yaml" });
    return true;
  } catch {
    return false;
  }
};

/**
 * The error of a write that stopped (see the file comment): `files` were changed before it, and the
 * file at `shown` was renamed and then renamed `back` (or not) after its name line failed; undefined
 * `back` when it was not renamed. The error itself when nothing is to be said beyond it.
 */
const stoppedError = (
  error: unknown,
  files: readonly string[],
  saved: SavedFile<unknown>,
  shown: string,
  back: boolean | undefined,
): unknown => {
  const written = back === false ? [...files, shown] : [...files];
  if ((written.length === 0 && back !== true) || !(error instanceof CommandError)) {
    return error;
  }
  const left =
    back === true
      ? `; ${saved.file} was renamed back and is unchanged`
      : back === false
        ? ` (${shown} keeps the old name in its file)`
        : "";
  const changed =
    written.length === 0
      ? "; nothing was changed"
      : `. Already changed: ${written.join(", ")}; the same call again finishes the rename`;
  return new CommandError(
    error.code,
    `${error.message}${left}${changed}`,
    { ...error.details, ...(written.length === 0 ? {} : { written }) },
    { cause: error },
  );
};

/** Writes `changes` in order (see the file comment); gives the written and the renamed files. */
const applyChanges = async (changes: readonly Change[]): Promise<Pick<SavedRename, "files" | "renamed">> => {
  const files: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  for (const { saved, to, edits } of changes) {
    const { repository } = saved;
    const shown = shownAt(saved, to);
    let moved: FileSnapshot | undefined;
    try {
      if (to !== saved.path) {
        moved = await renameFileAtomic(repository.folder, saved.path, to, saved.yaml.snapshot, {
          kind: "yaml",
        });
      }
      const edited = editYamlDocument(saved.yaml, edits);
      await writeFileAtomic(repository.folder, to, edited.bytes, moved ?? saved.yaml.snapshot, {
        kind: "yaml",
      });
      files.push(shown);
      if (moved !== undefined) {
        renamed.push({ from: saved.file, to: shown });
      }
    } catch (error) {
      // Renamed, but its name line not written: back to its old path, so the same call finds it there
      // and not a file it hid (a duplicate of its old name).
      const back = moved === undefined ? undefined : await renameBack(saved, to, moved);
      throw stoppedError(error, files, saved, shown, back);
    }
  }
  return { files, renamed };
};

/** A warning when a hidden file of `kind` holds the old name of `saved` now (see the file comment). */
const nowHolding = (kind: SavedKind, folder: SavedFolder<unknown>, saved: SavedFile<unknown>): Problem[] =>
  folder.hidden
    .filter((h) => fold(h.name) === fold(saved.name))
    .slice(0, 1)
    .map((h) =>
      savedProblem(
        kind.duplicate,
        "warning",
        h.repository.name,
        h.path,
        `${h.file} has the name ${JSON.stringify(h.name)} too and holds it now`,
      ),
    );

/** `perspective.rename` (see the file comment). */
export const renamePerspective = async (
  workspace: Workspace,
  name: string,
  newName: string,
): Promise<SavedRename> => {
  const layout = await workspace.get(workspaceLayoutState);
  const folder = await readSavedFolder<{ readonly name: string }>(layout, PERSPECTIVES);
  refuseMissingRepository(PERSPECTIVES, folder);
  const change = ownChange(PERSPECTIVES, folder, name, newName, "perspective.rename");
  if (change === undefined) {
    return NOTHING;
  }
  await checkChanges([change]);
  const written = await applyChanges([change]);
  return { ...written, perspectives: [], problems: nowHolding(PERSPECTIVES, folder, change.saved) };
};

/** `filter.rename` (see the file comment). */
export const renameFilter = async (
  workspace: Workspace,
  name: string,
  newName: string,
): Promise<SavedRename> => {
  const command = "filter.rename";
  const layout = await workspace.get(workspaceLayoutState);
  const folder = await readSavedFolder<{ readonly name: string }>(layout, FILTERS);
  refuseMissingRepository(FILTERS, folder);
  const change = ownChange(FILTERS, folder, name, newName, command);
  if (change === undefined) {
    return NOTHING;
  }
  const filter = change.saved.name;
  const perspectives = await perspectiveChanges(layout, filter, newName);
  await refuseBaselines(workspace, filter, command);
  const changes = [...perspectives, change];
  await checkChanges(changes);
  const written = await applyChanges(changes);
  return {
    ...written,
    perspectives: perspectives.map((p) => ({ name: p.saved.name, file: p.saved.file })),
    problems: nowHolding(FILTERS, folder, change.saved),
  };
};
