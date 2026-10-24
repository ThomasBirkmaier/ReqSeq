// workspace.status (SR-004; SR-006, SR-011 and SR-018 extend it): the repositories of the
// workspace, which are available, where the metamodel lies.
import type { Problem } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { headCommit } from "../../git/reader.js";
import type { RepositoryLocation } from "../../workspace/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

export interface RepositoryStatus {
  readonly name: string;
  readonly available: boolean;
  readonly path: string;
  /** HEAD commit; absent when unknown (not a Git repository, no commit yet, no git program). */
  readonly commit?: string;
}

export interface WorkspaceStatusOutput {
  readonly name: string;
  readonly repositories: readonly RepositoryStatus[];
  readonly metamodel: { readonly repository: string; readonly path: string; readonly valid: boolean };
  readonly readOnly: boolean;
  readonly problems: readonly Problem[];
}

interface Checked {
  readonly status: RepositoryStatus;
  readonly problem?: Problem;
}

/** The commit is read on every call, not kept: it changes while the workspace is open. */
const checkRepository = async (repository: RepositoryLocation): Promise<Checked> => {
  const status = { name: repository.name, available: repository.available, path: repository.path };
  if (!repository.available) {
    return { status };
  }
  const head = await headCommit(repository.folder);
  if (head.known) {
    return { status: { ...status, commit: head.commit } };
  }
  // Only a refusal is worth telling: the person can fix it. Missing git or no repository is normal.
  return head.reason === "refused"
    ? {
        status,
        problem: {
          code: "git.unavailable",
          severity: "info",
          message: `Git refuses to read repository ${repository.name} because another user owns it (see git config safe.directory); its commit is unknown`,
        },
      }
    : { status };
};

export default defineCommand({
  name: "workspace.status",
  run: async (ctx): Promise<WorkspaceStatusOutput> => {
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const checked = await Promise.all(layout.repositories.map(checkRepository));
    return {
      name: layout.name,
      repositories: checked.map((c) => c.status),
      // Until the metamodel block loads the files (SR-011), valid means: the folder exists.
      metamodel: {
        repository: layout.metamodel.repository,
        path: layout.metamodel.path,
        valid: layout.metamodel.exists,
      },
      // Read-only states come with SR-011 AK3 (faulty metamodel) and SR-018 AK2.
      readOnly: false,
      problems: [...layout.problems, ...checked.flatMap((c) => (c.problem === undefined ? [] : [c.problem]))],
    };
  },
});
