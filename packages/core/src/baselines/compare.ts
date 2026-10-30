// Comparing an element with its version in a baseline (SR-051 AK4, `baseline.compare`, ADR-0018
// "Git"): the two commits and the Git command that shows the difference. ReqSeq runs no diff and
// shows no old content (D-033); Git is only read (D-036, `fileSince`).
//
// - The element: the copy `ref` resolves to when the baseline lists it (as `showBaseline` finds
//   copies); else the one copy of that UUID the baseline lists, also when `ref` names several copies
//   (SR-088) or the listed copy's file is gone. None listed: `input.invalid` with `reason:
//   not-in-baseline`; several listed and `ref` names none of them: `ref.ambiguous`, naming their
//   repositories (the input has no `repository` yet).
// - `from`: the commit the baseline names for the element's repository; `git.commit-not-found`
//   when the file names none or the repository does not have it. `to`: HEAD, `null` when the file
//   differs from HEAD or is gone, so the command compares with the working copy.
// - `file` and `oldFile`: the path now and, when the file moved since `from`, the path then. A file
//   moved to a path Git does not track: `git diff` does not show untracked files, so the command
//   shows only the deletion until the new path is added to Git (`git add -N`); ReqSeq never stages.
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

/** Where an element file is now: its record, or the repository of a listed copy no file holds. */
interface Element {
  readonly id: string;
  readonly repository: string;
  readonly file: string | undefined;
}

/** The UUIDs a failed `resolveRef` of `ref` stood for: a UUID nothing holds, or the candidates. */
const uuidsOf = (error: CommandError, ref: string): ReadonlySet<string> => {
  if (error.code === "ref.ambiguous") {
    const { candidates } = error.details as { candidates: readonly { id: string }[] };
    return new Set(candidates.map((c) => c.id));
  }
  return new Set(isUuid(ref.toLowerCase()) ? [ref.toLowerCase()] : []);
};

/**
 * The copy `ref` names that the baseline lists (see the file comment): the copy `ref` resolves to,
 * else the one listed copy of a UUID `ref` stands for, also when no file holds it now. Several
 * listed copies that `ref` does not resolve to stay `ref.ambiguous`, naming their repositories.
 */
const elementOf = (store: ElementStore, shortIds: ShortIds, baseline: Baseline, ref: string): Element => {
  let record: ElementRecord | undefined;
  let ids: ReadonlySet<string>;
  let failed: CommandError | undefined;
  try {
    record = resolveRef(store, shortIds, ref);
    ids = new Set([record.id]);
  } catch (error) {
    failed = error as CommandError;
    ids = uuidsOf(failed, ref);
  }
  const entries = baseline.data.elements.filter((e) => ids.has(e.id));
  const copies = entries.map((e) => copyOf(store.byId, baseline, e));
  if (record !== undefined && copies.includes(record)) {
    return record;
  }
  const [entry, other] = entries;
  if (entry === undefined) {
    throw failed ?? notInBaseline(baseline, ref);
  }
  const [copy] = copies;
  if (other === undefined && copy !== "ambiguous") {
    return copy ?? { id: entry.id, repository: entry.repository ?? baseline.repository, file: undefined };
  }
  const repositories = entries.map((e) => e.repository ?? baseline.repository);
  throw new CommandError(
    "ref.ambiguous",
    `ref: the baseline ${baseline.name} lists ${ref} ${other === undefined ? "without repository, and it has copies in several" : `in the repositories ${repositories.join(", ")}`}; baseline.compare cannot choose one of them`,
    { ref, repositories },
  );
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
