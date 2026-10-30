// The Git state a new baseline holds (SR-050, ADR-0018 "repositories", ADR-0006): the HEAD commit of
// each repository involved, and the refusal while a file of the selection is not committed. Read only.
//
// - Involved (`involvedCommits`, SR-050 AK4): the repositories of the selected elements, the main
//   repository and the metamodel's, each once, in the order of the workspace file. One without
//   commit is `git.unavailable` naming it and the reason in words (`NO_COMMIT_TEXT`, AK7).
// - Uncommitted (`refuseUncommitted`, AK2), per repository with `uncommittedFiles`: the files of the
//   selected elements, the files they embed, the metamodel's YAML files (also one deleted from disk,
//   by its folder as data.export takes it, `relativeIn`) and the workspace file; no evidence record,
//   no other element. `baseline.uncommitted-changes` names the elements whose file or embedded file
//   changed (`details.elements`) and the other files (`details.files`); `git.unavailable` where Git
//   cannot tell.
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { ElementRecord } from "../model/index.js";
import {
  NO_COMMIT_TEXT,
  relativeIn,
  repositoryCommit,
  shortIdState,
  uncommittedFiles,
} from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { WORKSPACE_FILE } from "../workspace/index.js";

const gitUnavailable = (repository: string, why: string): CommandError =>
  new CommandError("git.unavailable", `Not created: repository ${repository} ${why}`, { repository });

/**
 * The repositories involved (AK4), each with its HEAD commit (AK7). Each is on this machine: the
 * selected elements are, the main repository is, and without the metamodel's the workspace is read-only.
 */
export const involvedCommits = async (
  layout: WorkspaceLayout,
  elements: readonly ElementRecord[],
): Promise<{ readonly repository: RepositoryLocation; readonly commit: string }[]> => {
  const names = new Set([layout.main, layout.metamodel.repository, ...elements.map((e) => e.repository)]);
  const involved = layout.repositories.filter((r) => names.has(r.name));
  return Promise.all(
    involved.map(async (repository) => {
      const head = await repositoryCommit(repository);
      if (head.commit === undefined) {
        throw gitUnavailable(
          repository.name,
          `has no commit (${NO_COMMIT_TEXT[head.unknown]}); put it under Git and commit, or check the folder`,
        );
      }
      return { repository, commit: head.commit };
    }),
  );
};

/** One file of a repository, as `details.files` names it. */
export interface ChangedFile {
  readonly repository: string;
  readonly file: string;
}

/** What `refuseUncommitted` checks: the selected elements, the files they embed and the metamodel. */
export interface Checked {
  readonly elements: readonly ElementRecord[];
  /** By repository: each embedded file (relative, NFC) with the elements that embed it. */
  readonly embeds: ReadonlyMap<string, ReadonlyMap<string, readonly ElementRecord[]>>;
  /** Where the metamodel lies: its repository, its folder as the workspace file names it, its files (relative, `/`). */
  readonly metamodel: {
    readonly repository: string;
    readonly path: string;
    readonly files: readonly string[];
  };
}

/** The files of the selection in `repository` that differ from `commit` (see the file comment). */
const changesIn = async (
  repository: RepositoryLocation,
  commit: string,
  checked: Checked,
): Promise<{ readonly elements: ElementRecord[]; readonly files: ChangedFile[] }> => {
  const own = checked.elements.filter((e) => e.repository === repository.name);
  const embeds = checked.embeds.get(repository.name) ?? new Map<string, readonly ElementRecord[]>();
  // The metamodel folder relative to this repository as data.export takes it (`relativeIn`), or undefined.
  const folder = relativeIn(repository, checked.metamodel);
  const files = [
    ...(repository.main ? [WORKSPACE_FILE] : []),
    ...(folder === undefined ? [] : checked.metamodel.files),
    ...own.map((e) => e.file),
    ...embeds.keys(),
  ].map((file) => file.normalize("NFC"));
  const known = new Set(files);
  const counts = (file: string): boolean =>
    known.has(file.normalize("NFC")) ||
    (folder !== undefined &&
      /\.ya?ml$/i.test(file) &&
      path.posix.join(folder, path.posix.basename(file)) === file.normalize("NFC"));
  const found = await uncommittedFiles(repository.folder, commit, files, counts);
  if (!found.known) {
    throw gitUnavailable(repository.name, `cannot be read by Git (${found.reason})`);
  }
  const changed = new Set(found.files.map((file) => file.normalize("NFC")));
  const named = new Set(own.filter((e) => changed.has(e.file.normalize("NFC"))));
  for (const [file, by] of embeds) {
    if (changed.has(file)) {
      by.forEach((e) => named.add(e));
    }
  }
  const elementFiles = new Set(own.map((e) => e.file.normalize("NFC")));
  return {
    elements: own.filter((e) => named.has(e)),
    files: [...changed]
      .filter((file) => !elementFiles.has(file))
      .map((file) => ({ repository: repository.name, file })),
  };
};

/** `{ id, repository, file }` of each element, as the error details name them. */
export const elementNames = (
  elements: readonly ElementRecord[],
): { id: string; repository: string; file: string }[] =>
  elements.map(({ id, repository, file }) => ({ id, repository, file }));

/** Refuses with `baseline.uncommitted-changes` when a file of the selection differs from its commit (AK2). */
export const refuseUncommitted = async (
  workspace: Workspace,
  commits: readonly { readonly repository: RepositoryLocation; readonly commit: string }[],
  checked: Checked,
): Promise<void> => {
  const changes = await Promise.all(commits.map(async (c) => changesIn(c.repository, c.commit, checked)));
  const elements = changes.flatMap((c) => c.elements);
  const files = changes.flatMap((c) => c.files);
  if (elements.length > 0 || files.length > 0) {
    const shortIds = await workspace.get(shortIdState);
    const shown = [...elements.map((e) => `${shortIds.of(e)} (${e.file})`), ...files.map((f) => f.file)];
    throw new CommandError(
      "baseline.uncommitted-changes",
      `Not created: not committed: ${shown.join(", ")}; commit them with Git or undo the changes, then create the baseline again`,
      { elements: elementNames(elements), files },
    );
  }
};
