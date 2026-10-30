// Comparing an element with its version in a baseline (SR-051 AK4, `baseline.compare`, ADR-0018
// "Git"): the two commits and the Git command that shows the difference. ReqSeq runs no diff and
// shows no old content (D-033); Git is only read (D-036, `fileSince`).
//
// - The element: `ref` as every command resolves it; a UUID that no file holds now but the baseline
//   lists is taken from the baseline. The baseline must list that copy (as `showBaseline` finds
//   it), else `input.invalid` with `reason: not-in-baseline`.
// - `from`: the commit the baseline names for the element's repository; `git.commit-not-found`
//   when the file names none or the repository does not have it. `to`: HEAD, `null` when the file
//   differs from HEAD or is gone, so the command compares with the working copy.
// - `file` and `oldFile`: the path now and, when the file moved since `from`, the path then.
// - `command`: `git -C <repository folder> diff <from> [<to>] -- [<oldFile>] <file>`, the folder
//   relative to the workspace root (`.` for the main repository), `/` as separator, to run in the
//   workspace root; the same on every access.
import { CommandError } from "../catalog.js";
import type { CommandOutput } from "../catalog.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import {
  elementStoreState,
  fileSince,
  isUuid,
  resolveRef,
  shortIdState,
  workspacePath,
} from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { Baseline } from "./read.js";
import { copyOf } from "./show.js";

type Output = CommandOutput<"baseline.compare">;

const notInBaseline = (baseline: Baseline, ref: string): CommandError =>
  new CommandError("input.invalid", `ref: the baseline ${baseline.name} does not list ${ref}`, {
    command: "baseline.compare",
    fields: ["ref"],
    reason: "not-in-baseline",
  });

/** The element `ref` names: its record now, or the copy a listed UUID names when no file holds it. */
const elementOf = (
  store: ElementStore,
  shortIds: ShortIds,
  baseline: Baseline,
  ref: string,
): { readonly id: string; readonly repository: string; readonly file: string | undefined } => {
  let record: ElementRecord;
  try {
    record = resolveRef(store, shortIds, ref);
  } catch (error) {
    const id = ref.toLowerCase();
    const entry = isUuid(id) ? baseline.data.elements.find((e) => e.id === id) : undefined;
    if ((error as CommandError).code !== "ref.unknown" || entry === undefined) {
      throw error;
    }
    return { id, repository: entry.repository ?? baseline.repository, file: undefined };
  }
  if (!baseline.data.elements.some((e) => e.id === record.id && copyOf(store.byId, baseline, e) === record)) {
    throw notInBaseline(baseline, ref);
  }
  return record;
};

/** The output for the element file `file` in `folder` (relative to the workspace root), moved from `oldFile`. */
const outputOf = (
  repository: string,
  from: string,
  to: string | null,
  where: { readonly folder: string; readonly file: string; readonly oldFile?: string },
): Output => {
  const { folder, file, oldFile } = where;
  return {
    repository,
    from,
    to,
    file,
    ...(oldFile === undefined ? {} : { oldFile }),
    command: [
      "git",
      "-C",
      folder,
      "diff",
      from,
      ...(to === null ? [] : [to]),
      "--",
      ...(oldFile === undefined ? [] : [oldFile]),
      file,
    ],
  };
};

/** The commits and the Git command for the element `ref` since `baseline` (see the file comment). */
export const compareBaseline = async (
  workspace: Workspace,
  baseline: Baseline,
  ref: string,
): Promise<Output> => {
  const layout = await workspace.get(workspaceLayoutState);
  const store = await workspace.get(elementStoreState);
  const element = elementOf(store, await workspace.get(shortIdState), baseline, ref);
  const repository = layout.repositories.find((r) => r.name === element.repository);
  const from = baseline.data.repositories.find((r) => r.name === element.repository)?.commit;
  const noCommit = (): CommandError =>
    new CommandError(
      "git.commit-not-found",
      `The commit of baseline ${baseline.name} in repository ${element.repository} (${from ?? "none named"}) is not in that repository on this machine; fetch it, or deepen a shallow clone`,
      { repository: element.repository, ...(from === undefined ? {} : { commit: from }) },
    );
  if (repository?.available !== true) {
    throw new CommandError(
      "git.unavailable",
      `Repository ${element.repository} of ${ref} is not on this machine; Git cannot compare there`,
      { repository: element.repository },
    );
  }
  if (from === undefined) {
    throw noCommit();
  }
  const found = await fileSince(repository.folder, from, element.file, element.id);
  if (!found.known) {
    throw new CommandError(
      "git.unavailable",
      `Git cannot compare in repository ${element.repository}: ${found.detail}`,
      { repository: element.repository, reason: found.reason },
    );
  }
  if (found.kind === "no-commit") {
    throw noCommit();
  }
  const file = element.file ?? found.before;
  if (file === undefined) {
    throw new CommandError("ref.unknown", `No file held ${ref} at the commit of baseline ${baseline.name}`, {
      ref,
    });
  }
  return outputOf(element.repository, from, found.uncommitted ? null : found.head, {
    folder: workspacePath(layout, repository, ".") || ".",
    file,
    ...(found.before === undefined || found.before === file ? {} : { oldFile: found.before }),
  });
};
