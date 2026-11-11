// The refusal of a `.git` folder (D-036, SR-083 AK3): ReqSeq never writes a file there, in any case
// and through links. Used by every command that writes to a path its caller gives: `data.store`,
// `evidence.enrichJunit`, `reqif.export` and `workspace.init` (#1449).
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";

/** Refuses a file in a `.git` folder, in any case and through links (D-036): `real` is its real folder. */
export const refuseGit = (real: string, file: string): void => {
  if (real.split(path.sep).some((segment) => segment.toLowerCase() === ".git")) {
    throw new CommandError(
      "input.invalid",
      `${path.basename(file)} lies in a .git folder; ReqSeq never writes to Git`,
      { file: path.basename(file), reason: "git-folder" },
    );
  }
};

/**
 * Refuses `file` in the absolute `folder` when that folder lies in a `.git` folder, also before it
 * exists: the folder as given, then the real path of its nearest existing folder with the rest of
 * the path below it. Reads only real paths; a folder no real path is found for is judged as given.
 */
export const refuseGitAt = async (folder: string, file: string): Promise<void> => {
  refuseGit(folder, file);
  const chain: string[] = [];
  for (let at = folder; !chain.includes(at); at = path.dirname(at)) {
    chain.push(at);
  }
  for (const at of chain) {
    const real = await fs.realpath(at).catch(() => undefined);
    if (real !== undefined) {
      refuseGit(path.join(real, path.relative(at, folder)), file);
      break;
    }
  }
};
