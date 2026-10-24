// workspace.status (SR-004, SR-011; SR-006 and SR-018 extend it): the repositories of the
// workspace, which are available, where the metamodel lies, whether it is valid and whether the
// workspace is read-only.
import type { CommandOutput, Problem } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { headCommit } from "../../git/reader.js";
import { metamodelState, workspaceAccess } from "../../metamodel/index.js";
import type { RepositoryLocation } from "../../workspace/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

type RepositoryStatus = CommandOutput<"workspace.status">["repositories"][number];

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
  run: async (ctx): Promise<CommandOutput<"workspace.status">> => {
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const metamodel = await ctx.workspace.get(metamodelState);
    const access = await workspaceAccess(ctx.workspace);
    const checked = await Promise.all(layout.repositories.map(checkRepository));
    return {
      name: layout.name,
      repositories: checked.map((c) => c.status),
      metamodel: { repository: metamodel.repository, path: metamodel.path, valid: metamodel.valid },
      // A missing or faulty metamodel opens the workspace read-only (SR-011 AK3).
      readOnly: access.readOnly,
      problems: [
        ...layout.problems,
        ...metamodel.problems,
        ...checked.flatMap((c) => (c.problem === undefined ? [] : [c.problem])),
      ],
    };
  },
});
