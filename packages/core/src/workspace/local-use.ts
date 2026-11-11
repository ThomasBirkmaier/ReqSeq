// Whether `.reqseq/local.yaml` may be used (SR-004 AK8, #1456): a local file that Git tracks would
// come with every clone and give its places to everyone, so it is not used, with a warning, and the
// places of the workspace file apply. Git is only read (D-036): the index and HEAD through
// `trackedFile` of the git reader. In this order:
// - On disk first, so that Git is asked about the very file the reader opens (review B1): not used
//   when `.reqseq` is a link, when the names on disk are not exactly `.reqseq` and `local.yaml` (a
//   case-insensitive file system opens `.REQSEQ/Local.yaml` too, while Git names are exact), or when
//   `.reqseq` lies in another work tree (a submodule or a nested repository, whose files the main
//   repository does not list). A link as the last name is refused by the reader itself.
// - No `.git` entry for the main repository, or no git program: the file applies (SR-004 AK6).
// - Otherwise Git is asked: the index (all stages) and, when a commit is known, HEAD; a repository
//   without commits is asked about its index only. Tracked: not used. Git refuses the repository,
//   fails or does not answer in time: not used either, since a `.git` entry is there (assumption of
//   the open question #1475).
// The warnings are constant texts without git's own message, so a layout loaded again compares equal.
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import { headCommit, headFiles, trackedFile, workTreeOf } from "../git/reader.js";
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

/** The HEAD commit of the work tree of `root`, or undefined without one (no commit yet, or Git cannot tell). */
const headOf = async (root: string): Promise<string | undefined> => {
  const files = await headFiles(root);
  if (files !== undefined) {
    return files.commit;
  }
  const head = await headCommit(root);
  return head.known ? head.commit : undefined;
};

/** Whether the local file of the main repository in `root` may be used (see the file comment); used without one. */
export const localFileUse = async (root: string): Promise<LocalFileUse> => {
  const folder = path.join(root, FOLDER);
  const stats = await fs.lstat(folder).catch(() => undefined);
  const file = await fs.stat(path.join(root, LOCAL_FILE)).catch(() => undefined);
  if (stats === undefined || file === undefined) {
    // No local file (or none that can be looked at): `readLocalFile` finds none or reports it.
    return { use: true };
  }
  if (stats.isSymbolicLink()) {
    return notUsed(`is reached through the link ${FOLDER}`);
  }
  const [rootNames, folderNames] = await Promise.all([namesIn(root), namesIn(folder)]);
  if (rootNames?.includes(FOLDER) !== true || folderNames?.includes(NAME) !== true) {
    return notUsed("is not spelled so on disk");
  }
  const [main, own] = await Promise.all([workTreeOf(root), workTreeOf(folder)]);
  if (main?.topLevel !== own?.topLevel) {
    return notUsed(
      `lies in another Git repository than the main repository (${FOLDER} is a submodule or a nested repository)`,
    );
  }
  if (main === undefined) {
    return { use: true };
  }
  const tracked = await trackedFile(root, LOCAL_FILE, await headOf(root));
  if (tracked.known) {
    return tracked.tracked
      ? notUsed(
          `is tracked by Git, so every clone would bring its places; remove it from Git (git rm --cached ${LOCAL_FILE}) and commit`,
        )
      : { use: true };
  }
  return tracked.reason === "no-git" ? { use: true } : notUsed("may be tracked by Git: Git could not tell");
};
