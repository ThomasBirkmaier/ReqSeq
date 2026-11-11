// The refusal of a `.git` folder (D-036, SR-083 AK3): ReqSeq never writes a file there, in any case
// and through links. Used by every command that writes to a path its caller gives: `data.store`,
// `evidence.enrichJunit`, `reqif.export` and `workspace.init` (#1449).
//
// Inside a repository (`gitPlaceOf`, #1487): a folder of the workspace file that ReqSeq writes into
// (filters, baselines, mappings, evidence) meets Git when a name below the repository folder is one
// that Windows or macOS take for `.git` (any case, trailing dots and spaces, the short name `GIT~1`),
// when an existing folder below it holds a `.git` entry (a repository of its own), or when the real
// path of an existing folder, links resolved, has such a name below the real repository folder.
// Judged relative to the repository, so a repository that itself lies below a `.git` folder (a
// worktree in `.git/wt/x`) is fine. `filter.save` and `baseline.create` refuse such a file
// (`refuseGitPlace`), and the workspace layout warns about such a folder.
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";
import { linksStayInside } from "../files/index.js";

/** Whether a name of `folder` is `.git`, in any case. */
const namesGit = (folder: string): boolean =>
  folder.split(path.sep).some((segment) => segment.toLowerCase() === ".git");

/** Whether Windows or macOS take the name for `.git`: any case, trailing dots and spaces dropped, or `GIT~n`. */
const takenForGit = (name: string): boolean => /^\.git[. ]*$/iu.test(name) || /^git~\d{1,6}$/iu.test(name);

/** Where a folder inside a repository meets Git (see the file comment); `path` is relative, with `/`. */
export interface GitPlace {
  readonly rule: "git-folder" | "git-entry";
  readonly path: string;
}

/** What a `GitPlace` is, for a message. */
export const GIT_PLACE: Readonly<Record<GitPlace["rule"], string>> = {
  "git-folder": "is .git or a name Windows or macOS take for it, or a link into such a folder",
  "git-entry": "holds a .git entry, so it is a repository of its own",
};

const exists = (at: string): Promise<boolean> =>
  fs.lstat(at).then(
    () => true,
    () => false,
  );

/** Where the absolute `folder` meets Git below the repository folder `root` (see the file comment). */
export const gitPlaceOf = async (root: string, folder: string): Promise<GitPlace | undefined> => {
  const names = path
    .relative(root, folder)
    .split(path.sep)
    .filter((name) => name !== "");
  const named = names.findIndex(takenForGit);
  if (named !== -1) {
    return { rule: "git-folder", path: names.slice(0, named + 1).join("/") };
  }
  const realRoot = await fs.realpath(root);
  for (let n = 1; n <= names.length; n++) {
    const at = path.join(root, ...names.slice(0, n));
    // A link out of the repository is never followed (#294); writing there is refused anyway.
    const inside = await linksStayInside(root, at).catch(() => false);
    const real = inside ? await fs.realpath(at).catch(() => undefined) : undefined;
    if (real === undefined) {
      return undefined;
    }
    const shown = names.slice(0, n).join("/");
    if (path.relative(realRoot, real).split(path.sep).some(takenForGit)) {
      return { rule: "git-folder", path: shown };
    }
    if (await exists(path.join(at, ".git"))) {
      return { rule: "git-entry", path: shown };
    }
  }
  return undefined;
};

/**
 * Refuses `file` (relative to the repository folder, `/`) with `input.invalid`, `reason: "git-folder"`,
 * when its folder meets Git (`gitPlaceOf`): ReqSeq never writes there (D-036, SR-083 AK4).
 */
export const refuseGitPlace = async (
  repository: { readonly name: string; readonly folder: string },
  file: string,
): Promise<void> => {
  const place = await gitPlaceOf(repository.folder, path.dirname(path.join(repository.folder, file)));
  if (place !== undefined) {
    throw new CommandError(
      "input.invalid",
      `Not written: ${file} in repository ${repository.name}: ${place.path} ${GIT_PLACE[place.rule]}; ReqSeq never writes to Git`,
      { repository: repository.name, file, reason: "git-folder", rule: place.rule, path: place.path },
    );
  }
};

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
const liesInGit = async (folder: string): Promise<boolean> => {
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
