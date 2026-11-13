// Perspectives (SR-213, D-056, `perspective.schema.json`): a list of elements with a name, saved
// with its selection (conditions and optionally a saved filter by name), its grouping and its sort,
// without a view. The
// `perspectives` kind of saved-files.ts, which reads and writes them as it does saved filters:
// default folder `perspectives` in the main repository, names compared ignoring case and normal
// form in a namespace of their own (a saved filter may have the same name), faulty files reported
// with file and reason and never overwritten (AK8), problems `perspective.invalid` and
// `perspective.duplicate-name`. `workspace.check` does not check them (SR-213 rationale).
//
// The `perspective` input of `element.list` (AK4 to AK7) finds a perspective by name
// (`perspectiveFor`) and its saved filter (`perspectiveFilterFor`), both read on every call, so a
// filter saved again holds at the next call (AK6). An unknown perspective is `input.invalid` at
// `perspective`, one only a faulty file holds `file.faulty`; a filter it names that does not exist
// is `input.invalid` at `perspective`, one only a faulty file holds `file.faulty`, both naming the
// perspective and the filter.
import type { CommandName } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { PerspectiveFile } from "../generated/types.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { SavedFile, SavedFolder, SavedKind } from "./saved-files.js";
import { faultySaved, findSaved, inSavedFile, inSavedFileAsync, readSavedFolder } from "./saved-files.js";
import type { SavedFilter } from "./saved.js";
import { faultyFilter, findSavedFilter, readSavedFilters } from "./saved.js";

/** The perspectives as saved-files.ts reads and writes them. */
export const PERSPECTIVES: SavedKind = {
  setting: "perspectives",
  schema: "perspective.schema.json",
  label: "perspective",
  word: "perspective",
  invalid: "perspective.invalid",
  duplicate: "perspective.duplicate-name",
};

/** A valid perspective file. */
export type SavedPerspective = SavedFile<PerspectiveFile>;

/** The perspectives folder of a workspace and what it holds. */
export type SavedPerspectives = SavedFolder<PerspectiveFile>;

/** Reads the perspectives folder (saved-files.ts). */
export const readPerspectives = (layout: WorkspaceLayout): Promise<SavedPerspectives> =>
  readSavedFolder<PerspectiveFile>(layout, PERSPECTIVES);

/** Where a name was looked for and not found: the folder in a repository not on this machine, else `list`. */
const notFoundHint = (
  folder: Pick<SavedFolder<unknown>, "incomplete" | "repository">,
  list: string,
): string =>
  folder.incomplete
    ? `; its folder is in repository ${String(folder.repository?.name)}, which is not on this machine`
    : `; ${list} lists them`;

/** The perspective `name` for the input field `perspective` of `command` (see the file comment). */
export const perspectiveFor = async (
  layout: WorkspaceLayout,
  name: string,
  command: CommandName,
): Promise<SavedPerspective> => {
  const folder = await readPerspectives(layout);
  const found = findSaved(folder, name);
  if (found.kind === "found") {
    return found.saved;
  }
  if (found.kind === "faulty") {
    throw faultySaved(PERSPECTIVES, name, found.files, "used");
  }
  throw new CommandError(
    "input.invalid",
    `perspective: no perspective is named ${JSON.stringify(name)}${notFoundHint(folder, "perspective.list")}`,
    { command, fields: ["perspective"] },
  );
};

/** Runs `fn` with the name and file of the perspective in every `CommandError` it throws (`inSavedFile`). */
export const inPerspective = <T>(perspective: SavedPerspective, fn: () => T): T =>
  inSavedFile(PERSPECTIVES, perspective, fn);

/** `inPerspective` for an asynchronous `fn`. */
export const inPerspectiveAsync = async <T>(
  perspective: SavedPerspective,
  fn: () => Promise<T>,
): Promise<T> => inSavedFileAsync(PERSPECTIVES, perspective, fn);

/**
 * The saved filter `perspective` names, read now (AK6), or undefined when it names none; errors name
 * the perspective and the filter (see the file comment).
 */
export const perspectiveFilterFor = async (
  layout: WorkspaceLayout,
  perspective: SavedPerspective,
  command: CommandName,
): Promise<SavedFilter | undefined> => {
  const name = perspective.data.filter;
  if (name === undefined) {
    return undefined;
  }
  const saved = await readSavedFilters(layout);
  const found = findSavedFilter(saved, name);
  if (found.kind === "found") {
    return found.filter;
  }
  return inPerspective(perspective, () => {
    if (found.kind === "faulty") {
      throw faultyFilter(name, found.files, "used");
    }
    throw new CommandError(
      "input.invalid",
      `perspective: its saved filter ${JSON.stringify(name)} does not exist${notFoundHint(saved, "filter.list")}`,
      { command, fields: ["perspective"] },
    );
  });
};
