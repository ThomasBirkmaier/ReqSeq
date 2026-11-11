// Whether `.reqseq/local.yaml` may be used (SR-004 AK8, #1456): a local file that Git tracks would
// come with every clone and give its places to everyone, so it is not used, with a warning, and the
// places of the workspace file apply. Git is only read (D-036): the index and HEAD through
// `trackedFile` of the git reader. In this order:
// - No `.git` entry for the main repository: the file applies (SR-004 AK6), whatever `.reqseq` is.
// - On disk, so that Git is asked about the very file the reader opens: not used when `.reqseq` is
//   a link (also one that stays inside the root), when the names on disk are not exactly `.reqseq`
//   and `local.yaml` (a case-insensitive file system opens `.REQSEQ/Local.yaml` too), when a folder
//   cannot be listed, or when `.reqseq` lies in another work tree (a submodule or any nested
//   repository, tracked or not, whose files the main repository does not list). A link as the last
//   name is refused by the reader itself.
// - Then Git is asked about the index (all stages, also an entry that names the same file by another
//   spelling) and HEAD. Tracked: not used. No git program: the file applies (SR-004 AK6). Git
//   refuses the repository, fails or does not answer in time: not used, since a `.git` entry is
//   there (assumption of the open question #1475).
// The warnings are constant texts without git's own message, so a layout loaded again compares equal.
// The disk can change between these checks and the read; a person who can change `.reqseq` there
// can also change the workspace file.
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import { trackedFile, workTreeOf } from "../git/reader.js";
import { LOCAL_FILE } from "./config.js";

/** Whether the local file of a main repository is used, and the warning when it is not. */
export type LocalFileUse = { readonly use: true } | { readonly use: false; readonly problem: Problem };

const [FOLDER = "", NAME = ""] = LOCAL_FILE.split("/");

const notUsed = (why: string): LocalFileUse => ({
  use: false,
  problem: {
    code: "workspace.invalid",
    severity: "warning",
    file: LOCAL_FILE,
    message: `${LOCAL_FILE} ${why}; it is ignored, and the places of the workspace file apply`,
  },
});

/** The names in `folder`, or undefined when it cannot be listed. */
const namesIn = async (folder: string): Promise<readonly string[] | undefined> =>
  fs.readdir(folder).then(
    (names): readonly string[] | undefined => names,
    () => undefined,
  );

/** Whether the local file of the main repository in `root` may be used (see the file comment); used without one. */
export const localFileUse = async (root: string): Promise<LocalFileUse> => {
  const folder = path.join(root, FOLDER);
  const stats = await fs.lstat(folder).catch(() => undefined);
  const file = await fs.stat(path.join(root, LOCAL_FILE)).catch(() => undefined);
  if (stats === undefined || file === undefined) {
    // No local file (or none that can be looked at): `readLocalFile` finds none or reports it.
    return { use: true };
  }
  const main = await workTreeOf(root);
  if (main === undefined) {
    return { use: true };
  }
  if (stats.isSymbolicLink()) {
    return notUsed(`is reached through the link ${FOLDER}`);
  }
  const [rootNames, folderNames] = await Promise.all([namesIn(root), namesIn(folder)]);
  if (rootNames === undefined || folderNames === undefined) {
    return notUsed(`cannot be checked: its folder or ${FOLDER} cannot be listed`);
  }
  if (!rootNames.includes(FOLDER) || !folderNames.includes(NAME)) {
    return notUsed("is not spelled so on disk");
  }
  const own = await workTreeOf(folder);
  if (own?.topLevel !== main.topLevel) {
    return notUsed(
      `lies in another Git repository than the main repository (${FOLDER} is a submodule or a nested repository)`,
    );
  }
  const tracked = await trackedFile(root, LOCAL_FILE);
  if (tracked.known) {
    return tracked.tracked
      ? notUsed(
          `is tracked by Git, so every clone would bring its places; remove it from Git (git rm --cached ${LOCAL_FILE}) and commit`,
        )
      : { use: true };
  }
  return tracked.reason === "no-git" ? { use: true } : notUsed("may be tracked by Git: Git could not tell");
};
