// Perspectives (SR-213, D-056, `perspective.schema.json`): a list of elements with a name, saved
// with its selection (conditions and optionally a saved filter by name), its grouping and its sort,
// without a view. The
// `perspectives` kind of saved-files.ts, which reads and writes them as it does saved filters:
// default folder `perspectives` in the main repository, names compared ignoring case and normal
// form in a namespace of their own (a saved filter may have the same name), faulty files reported
// with file and reason and never overwritten (AK8), problems `perspective.invalid` and
// `perspective.duplicate-name`. `workspace.check` does not check them (SR-213 rationale).
import type { PerspectiveFile } from "../generated/types.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { SavedFile, SavedFolder, SavedKind } from "./saved-files.js";
import { readSavedFolder } from "./saved-files.js";

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
