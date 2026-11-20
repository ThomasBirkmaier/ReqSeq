// Whether a workspace may be changed. A workspace whose metamodel is missing or faulty opens
// read-only (SR-011 AK3): every read works, every write-files command whose catalog entry has
// `whileReadOnly: "refuse"` (all but workspace.init, ThomasBirkmaier/ReqSeq-archive#142) is refused by `invoke`
// with `workspace.read-only` before it runs, and a next step of an output that names such a command is
// left out (`runnableSteps`, SR-226 AK6). Part of the metamodel block: today the metamodel is the only
// cause of a read-only workspace.
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { NextStep } from "../generated/types.js";
import { contractsBundle } from "../runtime/contracts.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { metamodelState } from "./state.js";

export interface WorkspaceAccess {
  readonly readOnly: boolean;
  /** The errors that make it read-only; empty when it may be changed. */
  readonly reasons: readonly Problem[];
}

/**
 * All problems of the metamodel: the layout reports a missing metamodel folder or repository, the
 * metamodel block the files (`metamodel.get`; `workspaceAccess` takes the errors).
 */
export const metamodelProblems = async (workspace: Workspace): Promise<readonly Problem[]> => {
  const layout = await workspace.get(workspaceLayoutState);
  const metamodel = await workspace.get(metamodelState);
  return [...layout.problems.filter((p) => p.code === "metamodel.invalid"), ...metamodel.problems];
};

/** Read-only while the metamodel is not valid: no change could be checked against it. */
export const workspaceAccess = async (workspace: Workspace): Promise<WorkspaceAccess> => {
  const metamodel = await workspace.get(metamodelState);
  if (metamodel.valid) {
    return { readOnly: false, reasons: [] };
  }
  const reasons = await metamodelProblems(workspace);
  return { readOnly: true, reasons: reasons.filter((p) => p.severity === "error") };
};

/** Throws `workspace.read-only` with the reasons in `details.problems` when `command` may not write. */
export const assertWritable = async (workspace: Workspace, command: string): Promise<void> => {
  const access = await workspaceAccess(workspace);
  if (access.readOnly) {
    throw new CommandError(
      "workspace.read-only",
      `The workspace is read-only because its metamodel is missing or faulty; ${command} changes no file. Fix the metamodel files and open the workspace again.`,
      { command, problems: access.reasons },
    );
  }
};

/** The commands of this catalog that are refused while the workspace is read-only (`whileReadOnly: "refuse"`). */
const REFUSED_WHILE_READ_ONLY: ReadonlySet<string> = new Set(
  (
    contractsBundle.catalog as { readonly commands: readonly { name: string; whileReadOnly?: string }[] }
  ).commands
    .filter((entry) => entry.whileReadOnly === "refuse")
    .map((entry) => entry.name),
);

/**
 * The steps of `steps` that can run in `workspace` now (SR-226 AK6): while it is read-only, none whose
 * command is refused then, by `refused` (by default the catalog of this version); all of them otherwise.
 */
export const runnableSteps = async (
  workspace: Workspace,
  steps: readonly NextStep[],
  refused: (command: string) => boolean = (command) => REFUSED_WHILE_READ_ONLY.has(command),
): Promise<NextStep[]> =>
  (await workspaceAccess(workspace)).readOnly ? steps.filter((step) => !refused(step.command)) : [...steps];
