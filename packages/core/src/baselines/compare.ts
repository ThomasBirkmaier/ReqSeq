// Comparing an element with its version in a baseline (SR-051 AK4 to AK7, `baseline.compare`,
// ADR-0018 "Git"): the field difference of its file at the baseline's commit against its file in
// the local copy, by the rule of the HTML export (`fieldDifference`, SR-232 AK7, D-033, D-080),
// with the two commits and the Git command that shows the difference. Git is only read (D-036:
// `fileSince` for the path then and whether the file is committed, `filesAtCommit` for its content).
//
// - The element: the copy `ref` resolves to when the baseline lists it (as `showBaseline` finds
//   copies); else the one copy of that UUID the baseline lists, also when `ref` names several copies
//   (SR-088) or the listed copy's file is gone. None listed: `input.invalid` with `reason:
//   not-in-baseline`; several listed and `ref` names none of them: `ref.ambiguous`, naming their
//   repositories (the input has no `repository` yet).
// - `from`: the commit the baseline names for the element's repository; `git.commit-not-found`
//   when the file names none or the repository does not have it (AK6). `to`: HEAD, `null` when the
//   file differs from HEAD, so the command compares with the working copy.
// - Refused (AK7), each with its reason: Git cannot read the repository (`git.unavailable`), no
//   file held the element at the commit (`ref.unknown`), no file holds the listed copy in the local
//   copy (`element.not-found`, `reason: missing`), or its file there cannot be read as an element
//   (`file.faulty`, `reason`: the code of the store's problem with that file, or `changed` when the
//   file changed since it was read).
// - `file` and `oldFile`: the path now and, when the file moved since `from`, the path then. A file
//   moved to a path Git does not track: `git diff` does not show untracked files, so the command
//   shows only the deletion until the new path is added to Git (`git add -N`); ReqSeq never stages.
// - `command`: `git -C <repository folder> diff <from> [<to>] -- [<oldFile>] <file>`, the folder
//   relative to the workspace root (`.` for the main repository), `/` as separator, to run in the
//   workspace root; the same on every access.
import { CommandError } from "../catalog.js";
import type { CommandOutput } from "../catalog.js";
import { readElementText } from "../files/index.js";
import { metamodelState } from "../metamodel/index.js";
import type {
  ElementRecord,
  ElementStore,
  FieldDifference,
  FileAtCommit,
  FilesAtCommit,
  ShortIds,
} from "../model/index.js";
import {
  elementStoreState,
  fieldDifference,
  fileSince,
  filesAtCommit,
  isUuid,
  resolveRef,
  shortIdState,
  workspacePath,
} from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { Baseline } from "./read.js";
import { copyOf } from "./read.js";
import { commandTitle } from "../runtime/command-titles.js";

type Output = CommandOutput<"baseline.compare">;

const notInBaseline = (baseline: Baseline, ref: string): CommandError =>
  new CommandError("input.invalid", `ref: the baseline ${baseline.name} does not list ${ref}`, {
    command: "baseline.compare",
    fields: ["ref"],
    reason: "not-in-baseline",
  });

/** The listed copy: its record, or only its repository when no file holds it now. */
interface Element {
  readonly id: string;
  readonly repository: string;
  readonly record: ElementRecord | undefined;
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
    return { id: record.id, repository: record.repository, record };
  }
  const [entry, other] = entries;
  if (entry === undefined) {
    throw failed ?? notInBaseline(baseline, ref);
  }
  const [copy] = copies;
  if (other === undefined && copy !== "ambiguous") {
    return copy === undefined
      ? { id: entry.id, repository: entry.repository ?? baseline.repository, record: undefined }
      : { id: copy.id, repository: copy.repository, record: copy };
  }
  const repositories = entries.map((e) => e.repository ?? baseline.repository);
  throw new CommandError(
    "ref.ambiguous",
    `ref: the baseline ${baseline.name} lists ${ref} ${other === undefined ? "without repository, and it has copies in several" : `in the repositories ${repositories.join(", ")}`}; ${commandTitle("baseline.compare")} cannot choose one of them`,
    { ref, repositories },
  );
};

/** The output for the element file `file` in `folder` (relative to the workspace root), moved from `oldFile`. */
const outputOf = (
  repository: string,
  from: string,
  to: string | null,
  where: { readonly folder: string; readonly file: string; readonly oldFile?: string },
  difference: FieldDifference,
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
    difference,
  };
};

/** Why the local copy has no element file for the listed copy at `file`, the path at the baseline (AK7). */
const noLocalFile = (store: ElementStore, element: Element, ref: string, file: string): CommandError => {
  const problem = store.problems.find(
    (p) => p.severity === "error" && p.repository === element.repository && p.file === file,
  );
  return problem === undefined
    ? new CommandError(
        "element.not-found",
        `No file of repository ${element.repository} in the local copy holds ${ref}; it was ${file} at the commit of the baseline`,
        { ref, repository: element.repository, file, reason: "missing" },
      )
    : new CommandError(
        "file.faulty",
        `The file ${file} of ${ref} in repository ${element.repository} cannot be read as an element: ${problem.message}`,
        { repository: element.repository, file, reason: problem.code },
      );
};

/**
 * The element's file at `from` (at `before`) and the text of its file in the local copy; else Git's reason, or the
 * file that changed since `fileSince` found the commit and the file a moment ago.
 */
const contentsOf = async (
  folder: string,
  from: string,
  before: string,
  record: ElementRecord,
): Promise<
  | { readonly then: FileAtCommit; readonly text: string }
  | (Extract<FilesAtCommit, { readonly known: false }> & { readonly code: "git.unavailable" })
  | { readonly code: "changed"; readonly file: string }
> => {
  const [old, text] = await Promise.all([
    filesAtCommit(folder, from, [{ file: before, id: record.id }]),
    readElementText(folder, record.file, record.snapshot),
  ]);
  if (!old.known) {
    return { ...old, code: "git.unavailable" };
  }
  const [then] = old.kind === "found" ? old.files : [];
  if (then === undefined) {
    return { code: "changed", file: before };
  }
  return text === undefined ? { code: "changed", file: record.file } : { then, text };
};

/** The difference of the element `ref` since `baseline` (see the file comment). */
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
  const gitUnknown = (detail: string, reason: string): CommandError =>
    new CommandError("git.unavailable", `Git cannot compare in repository ${element.repository}: ${detail}`, {
      repository: element.repository,
      reason,
    });
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
  const record = element.record;
  const found = await fileSince(repository.folder, from, record?.file, element.id);
  if (!found.known) {
    throw gitUnknown(found.detail, found.reason);
  }
  if (found.kind === "no-commit") {
    throw noCommit();
  }
  const before = found.before;
  if (before === undefined) {
    throw new CommandError("ref.unknown", `No file held ${ref} at the commit of baseline ${baseline.name}`, {
      ref,
    });
  }
  if (record === undefined) {
    throw noLocalFile(store, element, ref, before);
  }
  const contents = await contentsOf(repository.folder, from, before, record);
  if ("code" in contents) {
    throw contents.code === "git.unavailable"
      ? gitUnknown(contents.detail, contents.reason)
      : new CommandError(
          "file.faulty",
          `The file ${contents.file} of ${ref} changed while it was compared; compare again`,
          { repository: element.repository, file: contents.file, reason: "changed" },
        );
  }
  const metamodel = await workspace.get(metamodelState);
  return outputOf(
    element.repository,
    from,
    found.uncommitted ? null : found.head,
    {
      folder: workspacePath(layout, repository, ".") || ".",
      file: record.file,
      ...(before === record.file ? {} : { oldFile: before }),
    },
    fieldDifference(metamodel, contents.then, { type: record.type, data: record.data, text: contents.text }),
  );
};
