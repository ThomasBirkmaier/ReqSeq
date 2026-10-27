// The commit of a repository of the workspace (ADR-0006: read only, `rev-parse` and `ls-tree` through
// the git reader), as `workspace.status` (SR-004) and `data.export` (SR-061) give it. Read on every
// call, never kept: the commit changes while the workspace is open.
//
// - The HEAD of the Git work tree the folder lies in. Below the top level of its work tree, the
//   folder has the commit of the repository above only where that commit has a tree at the folder:
//   a stray repository that tracks nothing there (a home folder under Git with `*` ignored) is none
//   of the folder's, so the commit is left out.
// - Without Git, outside a repository or before the first commit the commit is left out too. Only a
//   refusal is worth telling (Git refuses a repository another user owns, `safe.directory`): the
//   person can fix it, so it comes back as a `git.unavailable` info.
import type { Problem } from "../generated/types.js";
import { headCommit, workTreeOf } from "../git/reader.js";
import type { RepositoryLocation } from "../workspace/index.js";
import { treeAt } from "./changed.js";

/** The commit of a repository, when Git tells it, and why not when that is worth telling. */
export interface RepositoryCommit {
  readonly commit?: string;
  readonly problem?: Problem;
}

/** The commit of the available `repository` (see the file comment). */
export const repositoryCommit = async (
  repository: Pick<RepositoryLocation, "name" | "folder">,
): Promise<RepositoryCommit> => {
  const head = await headCommit(repository.folder);
  if (head.known) {
    if ((await workTreeOf(repository.folder))?.depth !== 0) {
      const seen = await treeAt(repository.folder, head.commit);
      if (!seen.known || !seen.tree) {
        return {};
      }
    }
    return { commit: head.commit };
  }
  return head.reason === "refused"
    ? {
        problem: {
          code: "git.unavailable",
          severity: "info",
          repository: repository.name,
          message: `Git refuses to read repository ${repository.name} because another user owns it (see git config safe.directory); its commit is unknown`,
        },
      }
    : {};
};
