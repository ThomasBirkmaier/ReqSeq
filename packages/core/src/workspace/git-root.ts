// The root of the Git repository a folder lies in, for the place of the skill file (D-079, SR-229 AK8):
// the nearest folder at or above it with a `.git` entry that git accepts (`workTreeOf`, no process).
import { workTreeOf } from "../git/reader.js";

/** The real path of the Git root of `folder`, or undefined when it lies in no Git repository. */
export const gitRootOf = async (folder: string): Promise<string | undefined> =>
  (await workTreeOf(folder))?.topLevel;
