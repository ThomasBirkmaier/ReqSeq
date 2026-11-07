// Creating folders for new files (ADR-0007). `files` is the only module that writes to disk
// (docs/architecture), so commands that put a file into a folder that does not exist yet (the
// metamodel folder of `workspace.init`) create it here.
import fs from "node:fs/promises";
import { CommandError } from "../catalog.js";
import { linksStayInside } from "./links.js";
import { errorCode, resolveInRoot } from "./paths.js";

const NOT_WRITABLE: readonly string[] = ["EACCES", "EPERM"];
const NOT_A_FOLDER: readonly string[] = ["EEXIST", "ENOTDIR"];

/** Passes CommandErrors on and maps raw Node errors to codes of `common.schema.json#/$defs/error`. */
const toCommandError = (error: unknown, folder: string): CommandError => {
  if (error instanceof CommandError) {
    return error;
  }
  const code = String(errorCode(error));
  if (NOT_WRITABLE.includes(code)) {
    return new CommandError(
      "file.read-only",
      `Not created: folder ${folder}; the folder above it is not writable (${code})`,
    );
  }
  if (NOT_A_FOLDER.includes(code)) {
    return new CommandError(
      "file.not-regular",
      `Not created: ${folder} or a path above it is a file, not a folder`,
    );
  }
  return new CommandError("internal", `Not created: folder ${folder} (${code})`);
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
