// The folders an export creates above its target (SR-235 AK7 to AK10, SR-207 AK4 to AK7): `html.export`
// (the target is the export folder) and `reqif.export` (the target is the file). Every refusal comes
// before any folder is created; `createFolders` and `removeEmptyFolders` of the files block create
// them and take them back.
//
// - The folder above the target exists (links followed, as before): nothing to create.
// - Else it is followed name by name from the root of the file system. Inside an available repository
//   of the workspace (by the real path; the deepest wins) a link is not followed, so the rules judge it
//   by its name; outside, a link is followed. The missing folders are created only inside a repository,
//   after the safety rules of `refuseUnlisted` with `ignored: false` (a link, `.git`, `node_modules`, an
//   embedded Git repository, a file on the way, a spelling other than on disk, a name Windows changes or
//   refuses) and a check that the folder is not in the folder of a repository of the workspace that is
//   not on this machine. A folder the `ignore` globs leave out is fine: the export is no element.
// - Outside every repository the refusal the caller gives (`file.folder-missing`), creating nothing.
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { refuseUnlisted } from "./write.js";

/** Whether `child` (absolute) is `folder` or lies inside it. */
const isWithin = (folder: string, child: string): boolean => {
  const relative = path.relative(folder, child);
  return !path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..";
};

/** The available repository of `layout` whose folder holds the real path `real`; the deepest wins. */
const repositoryOf = (layout: WorkspaceLayout, real: string): RepositoryLocation | undefined =>
  layout.repositories
    .filter((r) => r.available && isWithin(r.folder, real))
    .sort((a, b) => b.folder.length - a.folder.length)[0];

/** `absolute` with its nearest existing folder as its real path, and the rest as given. */
const realOf = async (absolute: string): Promise<string> => {
  let at = absolute;
  let real = await fs.realpath(at).catch(() => undefined);
  // The root of the file system always has a real path.
  while (real === undefined) {
    at = path.dirname(at);
    real = await fs.realpath(at).catch(() => undefined);
  }
  return path.join(real, path.relative(at, absolute));
};

/** What the caller says about its target. */
export interface ExportTarget {
  /** The target as the input names it, for messages. */
  readonly shown: string;
  /** The refusal when the folder above the target is missing outside every repository. */
  readonly outside: () => CommandError;
}

/**
 * The folders to create above the absolute `target`, topmost first, or none when the folder above it
 * exists; refuses as the file comment says, before anything is created.
 */
export const foldersAbove = async (
  layout: WorkspaceLayout,
  target: string,
  about: ExportTarget,
): Promise<readonly string[]> => {
  const above = path.dirname(target);
  if ((await fs.stat(above).catch(() => undefined))?.isDirectory() === true) {
    return [];
  }
  const { root } = path.parse(above);
  const parts = path.relative(root, above).split(path.sep).filter(Boolean);
  // The real path after each name that exists, from the root on.
  const reals = [root];
  let real = root;
  for (const part of parts) {
    const next = path.join(real, part);
    // Anything that cannot be looked at counts as missing; the rules below name it.
    const stat = await fs.lstat(next).catch(() => undefined);
    // Inside a repository a link is judged by the rules, never followed.
    if (stat === undefined || (stat.isSymbolicLink() && repositoryOf(layout, real) !== undefined)) {
      break;
    }
    const resolved = await fs.realpath(next).catch(() => undefined);
    if (resolved === undefined) {
      break;
    }
    real = resolved;
    reals.push(real);
  }
  const found = reals.length - 1;
  const repository = repositoryOf(layout, real);
  if (repository === undefined) {
    throw about.outside();
  }
  // The names from the repository folder on, as given from where the path enters the repository.
  const entry = reals.findIndex((r) => isWithin(repository.folder, r));
  const names = [
    ...path.relative(repository.folder, String(reals[entry])).split(path.sep).filter(Boolean),
    ...parts.slice(entry),
  ];
  const existing = names.length - (parts.length - found);
  const folder = path.join(repository.folder, ...names);
  for (const missing of layout.repositories.filter((r) => !r.available)) {
    if (isWithin(await realOf(missing.folder), folder)) {
      throw new CommandError(
        "input.invalid",
        `Not exported: ${about.shown}: the folder lies in the folder of repository ${missing.name} of the workspace, which is not on this machine`,
        { fields: ["output"], repository: missing.name, reason: "repository-missing" },
      );
    }
  }
  const judged = await refuseUnlisted(layout, repository, [...names, path.basename(target)].join("/"), {
    ignored: false,
    exported: true,
  });
  const spelled = judged.split("/").slice(0, -1);
  return spelled
    .slice(existing)
    .map((_, i) => path.join(repository.folder, ...spelled.slice(0, existing + i + 1)));
};
