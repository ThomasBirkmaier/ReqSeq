// workspace.status (SR-004, SR-011, SR-018; SR-006 extends it): the repositories of the workspace,
// which are available and writable, where the metamodel lies, whether it is valid and whether the
// workspace is read-only.
import type { CommandOutput, Problem } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { metamodelState, workspaceAccess } from "../../metamodel/index.js";
import { repositoryCommit, watcherProblems } from "../../model/index.js";
import type { RepositoryLocation } from "../../workspace/index.js";
import { isWritableFolder, workspaceLayoutState } from "../../workspace/index.js";

type RepositoryStatus = CommandOutput<"workspace.status">["repositories"][number];

interface Checked {
  readonly status: RepositoryStatus;
  readonly problem?: Problem;
}

/**
 * The commit (`repositoryCommit`) and whether the folder is writable are read on every call, not
 * kept: both change while the workspace is open. A read-only repository (SR-018 AK2) is shown,
 * nothing more: it does not make the workspace read-only, writes into it are refused by the files
 * block (`file.read-only`). `readOnly` is left out where it is unknown (Windows, see
 * `isWritableFolder`).
 */
const checkRepository = async (repository: RepositoryLocation): Promise<Checked> => {
  if (!repository.available) {
    return { status: { name: repository.name, available: false, path: repository.path } };
  }
  const [{ commit, problem }, writable] = await Promise.all([
    repositoryCommit(repository),
    isWritableFolder(repository.folder),
  ]);
  return {
    status: {
      name: repository.name,
      available: true,
      path: repository.path,
      ...(commit === undefined ? {} : { commit }),
      ...(writable === undefined ? {} : { readOnly: !writable }),
    },
    ...(problem === undefined ? {} : { problem }),
  };
};

export default defineCommand({
  name: "workspace.status",
  run: async (ctx): Promise<CommandOutput<"workspace.status">> => {
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const metamodel = await ctx.workspace.get(metamodelState);
    const access = await workspaceAccess(ctx.workspace);
    const checked = await Promise.all(layout.repositories.map(checkRepository));
    return {
      name: layout.name,
      repositories: checked.map((c) => c.status),
      metamodel: { repository: metamodel.repository, path: metamodel.path, valid: metamodel.valid },
      // A missing or faulty metamodel opens the workspace read-only (SR-011 AK3); a read-only
      // repository, also the metamodel's, does not (SR-018 AK2).
      readOnly: access.readOnly,
      problems: [
        ...layout.problems,
        ...metamodel.problems,
        ...checked.flatMap((c) => (c.problem === undefined ? [] : [c.problem])),
        // Folders a running watcher cannot watch (SR-007): their changes need a restart.
        ...watcherProblems(ctx.workspace),
      ],
    };
  },
});
