// workspace.status (SR-004, SR-011, SR-018; SR-006 extends it): the repositories of the workspace,
// which are available and writable, where the metamodel lies, whether it is valid and whether the
// workspace is read-only. `variantIndependent` shows the mark of the workspace file (SR-173).
// `evidence` lists the evidence locations of the workspace file with whether the evidence walk reads
// each (#625); `workspace.check` says why not. Its `folder` is what evidence.record takes (SR-215).
import type { CommandOutput, Problem } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { metamodelState, workspaceAccess } from "../../metamodel/index.js";
import { evidenceFolder, isReadEvidenceLocation } from "../../evidence/index.js";
import { repositoryCommit, watcherProblems } from "../../model/index.js";
import type { RepositoryLocation, WorkspaceLayout } from "../../workspace/index.js";
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
  const marked = repository.variantIndependent ? { variantIndependent: true as const } : {};
  if (!repository.available) {
    return { status: { name: repository.name, available: false, path: repository.path, ...marked } };
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
      ...marked,
      ...(commit === undefined ? {} : { commit }),
      ...(writable === undefined ? {} : { readOnly: !writable }),
    },
    ...(problem === undefined ? {} : { problem }),
  };
};

/**
 * The `evidence` locations as written, each with whether the evidence walk reads it and its folder as
 * evidence.record takes it (`evidenceFolder`, the same rule), which a location of an unlisted repository lacks.
 */
const evidenceLocations = (layout: WorkspaceLayout): Promise<CommandOutput<"workspace.status">["evidence"]> =>
  Promise.all(
    (layout.file.evidence ?? []).map(async (location) => {
      const folder = evidenceFolder(layout, location);
      return {
        repository: location.repository,
        path: location.path,
        available: await isReadEvidenceLocation(layout, location),
        ...(folder === undefined ? {} : { folder }),
      };
    }),
  );

export default defineCommand({
  name: "workspace.status",
  run: async (ctx): Promise<CommandOutput<"workspace.status">> => {
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const metamodel = await ctx.workspace.get(metamodelState);
    const access = await workspaceAccess(ctx.workspace);
    const [checked, evidence] = await Promise.all([
      Promise.all(layout.repositories.map(checkRepository)),
      evidenceLocations(layout),
    ]);
    return {
      name: layout.name,
      repositories: checked.map((c) => c.status),
      metamodel: { repository: metamodel.repository, path: metamodel.path, valid: metamodel.valid },
      evidence,
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
