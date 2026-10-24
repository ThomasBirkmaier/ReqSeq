// Creating folders for new files (ADR-0007). `files` is the only module that writes to disk
// (docs/architecture), so commands that put a file into a folder that does not exist yet (the
// metamodel folder of `workspace.init`) create it here.
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";
import { errorCode, resolveInRoot } from "./paths.js";

const NOT_WRITABLE: readonly string[] = ["EACCES", "EPERM"];
const NOT_A_FOLDER: readonly string[] = ["EEXIST", "ENOTDIR"];

/** The closest path at or above `absolute` that exists; `root` exists, so the walk ends there at the latest. */
const existingAncestor = async (absolute: string): Promise<string> => {
  try {
    await fs.lstat(absolute);
    return absolute;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
    return existingAncestor(path.dirname(absolute));
  }
};

const isInside = (parent: string, child: string): boolean => {
  const rel = path.relative(parent, child);
  return !path.isAbsolute(rel) && rel.split(path.sep)[0] !== "..";
};

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
    const [realRoot, realExisting] = await Promise.all([
      fs.realpath(root),
      existingAncestor(absolute).then(async (existing) => fs.realpath(existing)),
    ]);
    if (!isInside(realRoot, realExisting)) {
      throw new CommandError("input.invalid", `Not created: folder ${file} is linked outside the workspace`);
    }
    await fs.mkdir(absolute, { recursive: true });
    return file;
  } catch (error) {
    throw toCommandError(error, file);
  }
};
