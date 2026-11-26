// Why a version has no date (SR-254, SR-075 AK5): the warnings an output gives for the versions it names whose
// date the tool cannot determine (`versionDates` of version-date.ts gave `null`). Read only (D-036, ADR-0006).
//
// - Per repository, the first reason of SR-254 AK2 that holds (`repositoryDating`): `missing` (not on this
//   machine, SR-006 AK2, or a name no repository of the workspace has), `unreadable` (no `.git` entry in its folder
//   or above, no git program, Git refuses it or finds no work tree: `headCommit`, and `readsWorkTree` where HEAD
//   names no commit), `shallow` (a shallow clone). A git call that does not answer in time tells no reason.
// - A version counts as not committed (AK3) when it is the element's current version (`currentVersionsOf`,
//   `sameVersion`) in a repository that is on this machine and that Git reads: with a commit and the whole history,
//   where `versionTimes` gives `uncommitted` (its content differs from the last commit that changed the file, or no
//   commit has the file); in a shallow clone, where the element file or an image its text embeds differs from HEAD
//   (`uncommittedFiles`: byte by byte, more, never less); in a repository without a commit, always.
// - The warnings, each once per repository (`undatedProblems`): `version.uncommitted` with the number of elements
//   not committed; for the other versions without date `version.date-unavailable` with the reason of AK2 where
//   one holds, else `version.date-unknown` with their number. An element counts once, whatever number of its
//   versions the output names. A sort (`sortReasonProblems`, SR-075 AK5) gives only `version.date-unavailable`.
import type { Problem } from "../generated/types.js";
import { headCommit, readsWorkTree, workTreeOf } from "../git/reader.js";
import { metamodelState } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { sameVersion } from "../version/version.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { CurrentVersion } from "./current-versions.js";
import { currentVersionsOf } from "./current-versions.js";
import type { ElementRecord } from "./elements.js";
import { uncommittedFiles } from "./uncommitted.js";
import type { VersionDateContext } from "./version-date.js";
import { versionTimes } from "./version-date.js";

/** A version an output names without a date. */
export interface UndatedVersion {
  /** The workspace name of the repository the element is in, or that a baseline entry names. */
  readonly repository: string;
  /** The element's UUID. */
  readonly id: string;
  /** The element as the workspace holds it; undefined for a baseline entry no element file holds. */
  readonly element?: ElementRecord;
  readonly version: string;
}

/** The reason of SR-254 AK2 that holds for a repository, the first in this order. */
export type UndatedReason = "missing" | "unreadable" | "shallow";

/** The problem codes of SR-254: `baseline.changes` and `baseline.prepare` leave them out (SR-241 AK6, SR-242 AK3). */
export const UNDATED_CODES: ReadonlySet<string> = new Set([
  "version.date-unavailable",
  "version.uncommitted",
  "version.date-unknown",
]);

/**
 * What `repositoryDating` found for a repository: the reason of AK2 that holds (none where none does or Git did not
 * answer in time), and, where Git reads it so the versions not committed can be told, its folder and HEAD (where
 * there is a commit).
 */
type RepositoryDating =
  | { readonly reason?: UndatedReason; readonly readable: false }
  | {
      readonly reason?: "shallow";
      readonly readable: true;
      readonly folder: string;
      readonly commit?: string;
    };

/** The versions without date of one repository, as `classifyUndated` sorted them. */
export interface UndatedRepository {
  readonly repository: string;
  readonly reason?: UndatedReason;
  /** The versions not committed (AK3). */
  readonly uncommitted: readonly UndatedVersion[];
  /** Every other version without date. */
  readonly other: readonly UndatedVersion[];
}

/** The reason of AK2 for the repository `name` and whether Git reads it (see the file comment). */
const repositoryDating = async (layout: WorkspaceLayout, name: string): Promise<RepositoryDating> => {
  const repository = layout.repositories.find((r) => r.name === name);
  if (repository?.available !== true) {
    return { reason: "missing", readable: false };
  }
  // Without a `.git` entry in the folder or above it, no git starts.
  if ((await workTreeOf(repository.folder)) === undefined) {
    return { reason: "unreadable", readable: false };
  }
  const head = await headCommit(repository.folder);
  if (head.known) {
    return head.shallow
      ? { reason: "shallow", readable: true, folder: repository.folder, commit: head.commit }
      : { readable: true, folder: repository.folder, commit: head.commit };
  }
  // `not-a-repository` is also a work tree whose HEAD names no commit yet: git still reads it.
  const read = head.reason === "not-a-repository" ? await readsWorkTree(repository.folder) : head;
  if (read.known) {
    return { readable: true, folder: repository.folder };
  }
  return read.reason === "timeout" ? { readable: false } : { reason: "unreadable", readable: false };
};

/** A version without date that is the element's current one, with that element and its entry. */
interface Current {
  readonly undated: UndatedVersion;
  readonly element: ElementRecord;
  readonly entry: Extract<CurrentVersion, { kind: "version" }>;
}

/** The files of `current` relative to the repository with `/`: the element file and the images its text embeds. */
const filesOf = ({ element, entry }: Current): string[] => [
  element.file,
  ...entry.images.flatMap((image) => (image.found === "nested" ? [] : [image.names.join("/")])),
];

/** The versions of `kept`. */
const versionsOf = (kept: readonly Current[]): Set<UndatedVersion> =>
  new Set(kept.map(({ undated }) => undated));

/** Which of `current`, all of one repository, are not committed (see the file comment). */
const notCommitted = async (
  context: VersionDateContext,
  dating: RepositoryDating,
  current: readonly Current[],
): Promise<Set<UndatedVersion>> => {
  if (!dating.readable || current.length === 0) {
    return new Set();
  }
  const { commit, folder } = dating;
  if (commit === undefined) {
    return versionsOf(current);
  }
  if (dating.reason === "shallow") {
    const asked = new Set(current.flatMap(filesOf));
    const found = await uncommittedFiles(folder, commit, [...asked], (file) => asked.has(file));
    if (!found.known) {
      return new Set();
    }
    const dirty = new Set(found.files);
    return versionsOf(current.filter((c) => filesOf(c).some((file) => dirty.has(file))));
  }
  const times = await versionTimes(
    context,
    current.map(({ undated, element }) => ({
      repository: undated.repository,
      file: element.file,
      id: element.id,
      version: undated.version,
    })),
  );
  return versionsOf(current.filter((_, i) => times[i]?.kind === "uncommitted"));
};

/** The versions of `undated` by repository, each with the reason of AK2 and whether it is committed (see the file comment). */
export const classifyUndated = async (
  workspace: Workspace,
  undated: readonly UndatedVersion[],
): Promise<UndatedRepository[]> => {
  if (undated.length === 0) {
    return [];
  }
  const [layout, metamodel] = await Promise.all([
    workspace.get(workspaceLayoutState),
    workspace.get(metamodelState),
  ]);
  const context: VersionDateContext = { workspace, layout, metamodel };
  const byName = new Map<string, UndatedVersion[]>();
  for (const version of undated) {
    byName.set(version.repository, [...(byName.get(version.repository) ?? []), version]);
  }
  const versions = await currentVersionsOf(
    workspace,
    undated.flatMap((u) => (u.element === undefined ? [] : [u.element])),
  );
  return Promise.all(
    [...byName].map(async ([repository, list]): Promise<UndatedRepository> => {
      const dating = await repositoryDating(layout, repository);
      const current = list.flatMap((version): Current[] => {
        const { element } = version;
        const entry = element === undefined ? undefined : versions.get(element);
        return element !== undefined && entry?.kind === "version" && sameVersion(version.version, entry.forms)
          ? [{ undated: version, element, entry }]
          : [];
      });
      const uncommitted = await notCommitted(context, dating, current);
      return {
        repository,
        ...(dating.reason === undefined ? {} : { reason: dating.reason }),
        uncommitted: list.filter((u) => uncommitted.has(u)),
        other: list.filter((u) => !uncommitted.has(u)),
      };
    }),
  );
};

/** The number of elements of `versions`, each once. */
const elementCount = (versions: readonly UndatedVersion[]): number =>
  new Set(versions.map((v) => `${v.id}\n${v.element?.file ?? ""}`)).size;

/** "1 element" or "2 elements". */
const elementsText = (count: number): string => `${String(count)} ${count === 1 ? "element" : "elements"}`;

/** Why the versions of repository `name` have no date, in words (AK2). */
const REASON_TEXT: Readonly<Record<UndatedReason, (name: string) => string>> = {
  missing: (name) => `Repository ${name} is not on this machine, so the dates of its versions are unknown`,
  unreadable: (name) =>
    `Git cannot read repository ${name} (no Git repository there, no git program, or Git refuses it), so the dates of its versions are unknown`,
  shallow: (name) =>
    `Repository ${name} is a shallow clone, so Git cannot give the dates of its versions; a clone with the full Git history gives the dates of committed versions`,
};

/** The warning of AK2 for `repository`, where a reason holds and a version without date is committed. */
const reasonProblem = (repository: UndatedRepository): Problem[] =>
  repository.reason === undefined || repository.other.length === 0
    ? []
    : [
        {
          code: "version.date-unavailable",
          severity: "warning",
          repository: repository.repository,
          message: REASON_TEXT[repository.reason](repository.repository),
        },
      ];

/** The warnings of SR-254 AK2 and AK3 for `repositories` (see the file comment). */
export const undatedProblems = (repositories: readonly UndatedRepository[]): Problem[] =>
  repositories.flatMap((repository): Problem[] => {
    const { uncommitted, other } = repository;
    const name = repository.repository;
    const problems: Problem[] = [];
    if (uncommitted.length > 0) {
      const count = elementCount(uncommitted);
      problems.push({
        code: "version.uncommitted",
        severity: "warning",
        repository: name,
        message: `${elementsText(count)} of repository ${name} ${count === 1 ? "has" : "have"} no version date: the version is not committed (its content differs from the last commit, or its file is in no commit)`,
      });
    }
    if (repository.reason !== undefined) {
      return [...problems, ...reasonProblem(repository)];
    }
    if (other.length > 0) {
      const count = elementCount(other);
      problems.push({
        code: "version.date-unknown",
        severity: "warning",
        repository: name,
        message: `Git cannot give the version date of ${elementsText(count)} of repository ${name}: no commit holds the version, or a Git call failed or did not answer in time`,
      });
    }
    return problems;
  });

/** The warnings of a sort by the version date (SR-075 AK5): the reason of SR-254 AK2 per repository, nothing else. */
export const sortReasonProblems = (repositories: readonly UndatedRepository[]): Problem[] =>
  repositories.flatMap(reasonProblem);

/** `classifyUndated` and `undatedProblems` in one step. */
export const undatedWarnings = async (
  workspace: Workspace,
  undated: readonly UndatedVersion[],
): Promise<Problem[]> => undatedProblems(await classifyUndated(workspace, undated));
