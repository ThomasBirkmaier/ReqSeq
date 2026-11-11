// The refusal of a `.git` folder (D-036, SR-083 AK3): ReqSeq never writes a file there, in any case
// and through links. Used by every command that writes to a path its caller gives: `data.store`,
// `evidence.enrichJunit`, `reqif.export` and `workspace.init` (#1449). The workspace layout reports a
// filters, baselines or mappings folder of the workspace file there (`liesInGit`, #1487).
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";

/** Whether a name of `folder` is `.git`, in any case. */
const namesGit = (folder: string): boolean =>
  folder.split(path.sep).some((segment) => segment.toLowerCase() === ".git");

/** The refusal of `file` in a `.git` folder. */
const gitFolderError = (file: string): CommandError =>
  new CommandError(
    "input.invalid",
    `${path.basename(file)} lies in a .git folder; ReqSeq never writes to Git`,
    {
      file: path.basename(file),
      reason: "git-folder",
    },
  );

/** Refuses a file in a `.git` folder, in any case and through links (D-036): `real` is its real folder. */
export const refuseGit = (real: string, file: string): void => {
  if (namesGit(real)) {
    throw gitFolderError(file);
  }
};

/**
 * Whether the absolute `folder` lies in a `.git` folder, also before it exists: the folder as given,
 * then the real path of its nearest existing folder with the rest of the path below it. Reads only
 * real paths; a folder no real path is found for is judged as given.
 */
export const liesInGit = async (folder: string): Promise<boolean> => {
  const chain: string[] = [];
  for (let at = folder; !chain.includes(at); at = path.dirname(at)) {
    chain.push(at);
  }
  let real = folder;
  for (const at of chain) {
    const found = await fs.realpath(at).catch(() => undefined);
    if (found !== undefined) {
      real = path.join(found, path.relative(at, folder));
      break;
    }
  }
  return namesGit(folder) || namesGit(real);
};

/** Refuses `file` in the absolute `folder` when that folder lies in a `.git` folder (`liesInGit`). */
export const refuseGitAt = async (folder: string, file: string): Promise<void> => {
  if (await liesInGit(folder)) {
    throw gitFolderError(file);
  }
};
