// Creating folders for new files (ADR-0007). `files` is the only module that writes to disk
// (docs/architecture), so commands that put a file into a folder that does not exist yet (the
// metamodel folder of `workspace.init`) create it here.
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";
import { linksStayInside } from "./links.js";
import { errorCode, resolveInRoot } from "./paths.js";

const NOT_WRITABLE: readonly string[] = ["EACCES", "EPERM"];
const NOT_A_FOLDER: readonly string[] = ["EEXIST", "ENOTDIR"];

/** How a refusal of a folder begins, and the details it carries. */
interface Refusal {
  readonly verb: string;
  readonly details?: Record<string, unknown>;
}

const CREATED: Refusal = { verb: "Not created" };

/** Passes CommandErrors on and maps raw Node errors to codes of `common.schema.json#/$defs/error`. */
const toCommandError = (error: unknown, folder: string, refusal: Refusal = CREATED): CommandError => {
  if (error instanceof CommandError) {
    return error;
  }
  const { verb, details } = refusal;
  const code = String(errorCode(error));
  if (NOT_WRITABLE.includes(code)) {
    return new CommandError(
      "file.read-only",
      `${verb}: folder ${folder}; the folder above it is not writable (${code})`,
      details,
    );
  }
  if (NOT_A_FOLDER.includes(code)) {
    return new CommandError(
      "file.not-regular",
      `${verb}: ${folder} or a path above it is a file, not a folder`,
      details,
    );
  }
  return new CommandError("internal", `${verb}: folder ${folder} (${code})`, details);
};

/**
 * Creates the folder `relativePath` below `root` with every missing folder above it; an existing
 * folder is left as it is. Returns its path relative to `root` (`/` as separator). Refuses paths
 * outside the root and the root itself (`input.invalid`), a folder above it that is linked out of
 * the root (`input.invalid`), a file in the way (`file.not-regular`) and folders that are not
 * writable (`file.read-only`). Never removes anything.
 */
export const createFolder = async (root: string, relativePath: string): Promise<string> => {
  const { absolute, file } = resolveInRoot(root, relativePath);
  try {
    // Judged before anything follows a link out of the root (#294).
    if (!(await linksStayInside(root, absolute))) {
      throw new CommandError("input.invalid", `Not created: folder ${file} is linked outside the workspace`);
    }
    await fs.mkdir(absolute, { recursive: true });
    return file;
  } catch (error) {
    throw toCommandError(error, file);
  }
};

/**
 * Removes each of the absolute `folders` (topmost first, as `createFolders` gives them) that is empty,
 * the deepest first; a folder that holds anything, or is gone, stays as it is (SR-235 AK10, SR-207 AK7).
 */
export const removeEmptyFolders = async (folders: readonly string[]): Promise<void> => {
  for (const folder of [...folders].reverse()) {
    await fs.rmdir(folder).catch(() => undefined);
  }
};

/**
 * Creates the absolute `folders`, topmost first, each below the one before, for an export whose
 * workspace root is `root` (`foldersAbove` of the model judged them); refuses a file or folder that
 * took a place since (`file.not-regular`) and a folder that is not writable (`file.read-only`), naming
 * the folder relative to `root` as the export's `output`, after removing the folders it created.
 * Returns them.
 */
export const createFolders = async (folders: readonly string[], root: string): Promise<readonly string[]> => {
  const created: string[] = [];
  try {
    for (const folder of folders) {
      await fs.mkdir(folder);
      created.push(folder);
    }
    return created;
  } catch (error) {
    await removeEmptyFolders(created);
    const failed = path.relative(root, String(folders[created.length])).split(path.sep).join("/");
    throw toCommandError(error, failed, { verb: "Not exported", details: { fields: ["output"] } });
  }
};
