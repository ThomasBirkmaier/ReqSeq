// The restriction of `workspace.check` to what a merge request changed (SR-092, D-025, N-059). The
// open points follow the recommended options of spec question #291:
//
// - Changed is the working copy against a given commit (`changedSince`): committed since, staged,
//   not staged and untracked files, read through the git reader (ADR-0006), never written (D-036).
//   The revision is looked up in every available repository; one without it, or one that is no Git
//   repository, adds nothing and gets an `info` problem, so a pipeline sees what was not looked at.
//   Only when none has it is it `git.commit-not-found` (CLI exit code 4, ADR-0009). A repository
//   folder may lie below the top level of its Git work tree (#377): the paths stay relative to the
//   folder. Where git then lists nothing and the commit has no tree at the folder, Git sees none of
//   its files (the work tree ignores the folder, as a home folder under Git with `*` in
//   `.gitignore` may): it is not looked at either, never a check of nothing. Any failure of
//   git in a repository is `git.unavailable`: never a check of less than asked. `changedFiles` names
//   files directly (`localPath`, no folders); with both, both count. Paths compare in NFC (ADR-0006).
// - An element file deleted since the commit, or one whose UUID changed, leaves the relations of
//   other elements to its old UUID unresolved (SR-089): its old UUID counts as changed, so those
//   findings are kept.
// - The changed elements C: the elements whose file changed, or an image their text embeds (the
//   image counts to the version, ADR-0005). Their targets Z: one step along their relations,
//   relation-valued properties and inline references, wherever the target lies.
// - A finding is kept when its element is in C or Z, or its target is in C: a relation of another
//   element that points at an old version of a changed element is what N-059 asks for. A finding
//   about a file and no element (SR-008) is kept when the file changed or belongs to C or Z.
//   Findings about no element and no file are kept; `workspace.check` keeps the problems of the
//   layout and the metamodel itself, so a broken metamodel never passes a merge request.
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { parseFileBytes } from "../files/index.js";
import type { GitUnknown, ReadOptions } from "../git/reader.js";
import {
  changedPaths,
  isGitPath,
  isRevision,
  openObjectReader,
  resolveCommit,
  workTreeOf,
} from "../git/reader.js";
import type { Metamodel } from "../metamodel/index.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import type { CurrentVersions } from "./current-versions.js";
import { ELEMENT_FILE_EXTENSION } from "./discover.js";
import type { ElementMatch, ElementRecord } from "./elements.js";
import { outgoingLinks } from "./incoming.js";
import { resolveReference } from "./references.js";
import type { TargetState } from "./relations.js";
import { targetState } from "./relations.js";
import type { ElementStore } from "./store.js";

/** What a check is restricted to, as `workspace.check` takes it. */
export interface ChangedInput {
  /** Local paths: absolute, or relative to the workspace root (ADR-0009). */
  readonly changedFiles?: readonly string[] | undefined;
  /** A Git revision. */
  readonly changedSince?: string | undefined;
}

/** The changed paths per repository name: relative to the repository, with `/`, in NFC. */
export type ChangedFiles = ReadonlyMap<string, ReadonlySet<string>>;

/** What changed: the files, the UUIDs the changed files held at the commit, and what was not looked at. */
export interface Changes {
  readonly files: ChangedFiles;
  /**
   * The UUID of every element a changed element file held at the commit (`changedSince`). A file
   * deleted since, or one whose UUID changed, leaves relations to the old UUID that no longer
   * resolve (SR-089): those count as relations to a changed element.
   */
  readonly ids: ReadonlySet<string>;
  /** `info` for each repository that has no such commit or is no Git repository: its changes are not seen. */
  readonly problems: readonly Problem[];
}

const nfc = (text: string): string => text.normalize("NFC");

const add = (changed: Map<string, Set<string>>, repository: string, file: string): void => {
  const files = changed.get(repository);
  if (files === undefined) {
    changed.set(repository, new Set([nfc(file)]));
  } else {
    files.add(nfc(file));
  }
};

/** `file` with links resolved as far as it exists, so it compares with the real folders of the layout. */
const realPathOf = async (file: string): Promise<string> => {
  try {
    return await fs.realpath(file);
  } catch {
    const parent = path.dirname(file);
    return parent === file ? file : path.join(await realPathOf(parent), path.basename(file));
  }
};

/** The repository that holds `file` (the innermost one, for a repository inside another), with the path in it. */
const repositoryOf = (
  repositories: readonly RepositoryLocation[],
  file: string,
): { readonly repository: RepositoryLocation; readonly file: string } | undefined => {
  // The innermost first: the longest folder.
  const byDepth = [...repositories].sort((a, b) => b.folder.length - a.folder.length);
  for (const repository of byDepth) {
    const names = path.relative(repository.folder, file).split(path.sep);
    if (names[0] !== "" && names[0] !== ".." && !path.isAbsolute(names.join(path.sep))) {
      return { repository, file: names.join("/") };
    }
  }
  return undefined;
};

const invalid = (field: string, message: string): CommandError =>
  new CommandError("input.invalid", message, { command: "workspace.check", fields: [field] });

/** Whether `file` is a folder now. */
const isFolder = async (file: string): Promise<boolean> =>
  fs.stat(file).then(
    (stat) => stat.isDirectory(),
    () => false,
  );

/**
 * `changedFiles` by repository. A path that lies in no available repository, or names a folder
 * (which would select nothing), is `input.invalid`; a file that does not exist is fine (deleted).
 */
const namedFiles = async (
  root: string,
  repositories: readonly RepositoryLocation[],
  files: readonly string[],
  changed: Map<string, Set<string>>,
): Promise<void> => {
  const outside: string[] = [];
  const folders: string[] = [];
  for (const given of files) {
    const absolute = path.resolve(root, given);
    const shown = path.relative(root, absolute).split(path.sep).join("/") || ".";
    const found = repositoryOf(repositories, await realPathOf(absolute));
    if (found === undefined) {
      outside.push(shown);
    } else if (await isFolder(absolute)) {
      folders.push(shown);
    } else {
      add(changed, found.repository.name, found.file);
    }
  }
  if (outside.length > 0) {
    throw invalid(
      "changedFiles",
      `changedFiles names files in no repository of the workspace on this machine: ${outside.join(", ")}`,
    );
  }
  if (folders.length > 0) {
    throw invalid("changedFiles", `changedFiles names folders, not files: ${folders.join(", ")}`);
  }
};

/** Git cannot tell what changed in `repository`. */
const unavailable = (repository: string, reason: string): CommandError =>
  new CommandError(
    "git.unavailable",
    `Git cannot tell what changed in repository ${repository} (${reason}); the check cannot be restricted`,
    { command: "workspace.check", repository, reason },
  );

/** The UUID in the frontmatter of `bytes`, if it has one. */
const idIn = (file: string, bytes: Buffer): string[] => {
  const parsed = parseFileBytes(file, bytes);
  const data: unknown = parsed.kind === "parsed" ? parsed.content.data : undefined;
  const id = typeof data === "object" && data !== null ? (data as Record<string, unknown>)["id"] : undefined;
  return typeof id === "string" ? [id] : [];
};

/**
 * The UUIDs that the element files among `paths` held at `commit` (`Changes.ids`), read through
 * one object reader: a path that did not exist then, or held no element, gives none.
 */
const idsAt = async (
  folder: string,
  commit: string,
  paths: readonly string[],
  signal: AbortSignal,
): Promise<{ readonly known: true; readonly ids: string[] } | GitUnknown> => {
  const files = paths.filter((file) => file.endsWith(ELEMENT_FILE_EXTENSION) && isGitPath(file));
  const reader = openObjectReader(folder, { signal });
  try {
    const chunks = files.map((): Buffer[] => []);
    const read = await reader.read(
      files.map((file) => `${commit}:${file}`),
      (_, index) => (chunk) => {
        chunks[index]?.push(chunk);
      },
    );
    if (!read.known) {
      return read;
    }
    const ids = chunks.flatMap((parts, index) =>
      read.objects[index]?.type === "blob" ? idIn(String(files[index]), Buffer.concat(parts)) : [],
    );
    return { known: true, ids };
  } finally {
    reader.close();
  }
};

/**
 * Whether Git sees `folder` at `commit`: the commit has a tree there (`.` names the
 * folder itself).
 */
export const treeAt = async (
  folder: string,
  commit: string,
  options: ReadOptions = {},
): Promise<{ readonly known: true; readonly tree: boolean } | GitUnknown> => {
  const reader = openObjectReader(folder, options);
  try {
    const info = await reader.info([`${commit}:.`]);
    return info.known ? { known: true, tree: info.objects[0]?.type === "tree" } : info;
  } finally {
    reader.close();
  }
};

/** Why a repository's changes are not looked at: no Git, no such commit, or Git sees none of its files. */
type NotLookedAt = "no-git" | "no-commit" | "unseen";

/** What changed in one repository since a revision. */
type RepositoryChange =
  | { readonly kind: NotLookedAt }
  | { readonly kind: "changed"; readonly paths: readonly string[]; readonly ids: readonly string[] };

/** What git says where it finds no repository. */
const NOT_A_REPOSITORY = /not a git repository/i;

const changeOf = async (
  repository: RepositoryLocation,
  revision: string,
  signal: AbortSignal,
): Promise<RepositoryChange> => {
  // As for version dates: without a `.git` entry in the folder or above it, the folder is in no
  // repository, and no git starts.
  const tree = await workTreeOf(repository.folder);
  if (tree === undefined) {
    return { kind: "no-git" };
  }
  // In a repository, every failure of git makes the restriction unknown: never a check of less.
  const resolved = await resolveCommit(repository.folder, revision, { signal });
  // Below the top level, `workTreeOf` may name a `.git` entry that git does not use
  // (`GIT_CEILING_DIRECTORIES`, a file system boundary): git then says it is no repository, as for
  // a folder without any. Other failures (a broken configuration, a corrupt repository) stay
  // unavailable, so only git's own "not a git repository" counts (ADR-0006).
  if (
    !resolved.known &&
    tree.depth > 0 &&
    resolved.reason === "not-a-repository" &&
    NOT_A_REPOSITORY.test(resolved.detail)
  ) {
    return { kind: "no-git" };
  }
  if (!resolved.known) {
    throw unavailable(repository.name, resolved.reason);
  }
  if (resolved.commit === undefined) {
    return { kind: "no-commit" };
  }
  const paths = await changedPaths(repository.folder, resolved.commit, { signal });
  if (!paths.known) {
    throw unavailable(repository.name, paths.reason);
  }
  // Below the top level, nothing listed may mean that Git sees none of the folder's files.
  if (tree.depth > 0 && paths.paths.length === 0) {
    const seen = await treeAt(repository.folder, resolved.commit, { signal });
    if (!seen.known) {
      throw unavailable(repository.name, seen.reason);
    }
    if (!seen.tree) {
      return { kind: "unseen" };
    }
  }
  const old = await idsAt(repository.folder, resolved.commit, paths.paths, signal);
  if (!old.known) {
    throw unavailable(repository.name, old.reason);
  }
  return { kind: "changed", paths: paths.paths, ids: old.ids };
};

/** Why a repository's changes are not looked at, as the `info` problem says it. */
const NOT_LOOKED_AT: Readonly<Record<NotLookedAt, (repository: string, revision: string) => string>> = {
  "no-git": (repository, revision) =>
    `Repository ${repository} is no Git repository: its changes since ${revision} are not looked at`,
  "no-commit": (repository, revision) =>
    `Repository ${repository} has no commit ${revision}: its changes are not looked at`,
  unseen: (repository, revision) =>
    `Repository ${repository} lies in a Git work tree that sees none of its files (it ignores the folder, or the folder holds none): its changes since ${revision} are not looked at`,
};

/** The `info` problem of a repository whose changes are not looked at (#291 point 3). */
const notLookedAt = (repository: string, revision: string, kind: NotLookedAt): Problem => ({
  code: kind === "no-commit" ? "git.revision-missing" : "git.unavailable",
  severity: "info",
  message: NOT_LOOKED_AT[kind](repository, revision),
  repository,
});

/** The files that differ from `revision`, in every available repository that has it (#291 point 3). */
const filesSince = async (
  repositories: readonly RepositoryLocation[],
  revision: string,
  changed: Map<string, Set<string>>,
  signal: AbortSignal,
): Promise<{ readonly ids: Set<string>; readonly problems: Problem[] }> => {
  if (!isRevision(revision)) {
    throw invalid("changedSince", `changedSince is no revision Git can take: ${JSON.stringify(revision)}`);
  }
  const results = await Promise.all(
    repositories.map(async (repository) => ({
      repository,
      change: await changeOf(repository, revision, signal),
    })),
  );
  signal.throwIfAborted();
  const ids = new Set<string>();
  const problems: Problem[] = [];
  for (const { repository, change } of results) {
    if (change.kind === "changed") {
      for (const file of change.paths) {
        add(changed, repository.name, file);
      }
      for (const id of change.ids) {
        ids.add(id);
      }
    } else {
      problems.push(notLookedAt(repository.name, revision, change.kind));
    }
  }
  if (problems.length === results.length) {
    throw results.some(({ change }) => change.kind === "no-commit")
      ? new CommandError(
          "git.commit-not-found",
          `Commit ${revision} is not available locally in any repository of the workspace: fetch it, or deepen a shallow clone`,
          { command: "workspace.check", revision },
        )
      : new CommandError(
          "git.unavailable",
          results.some(({ change }) => change.kind === "unseen")
            ? "Git sees the files of no repository of the workspace on this machine; the check cannot be restricted to changes since a commit"
            : "No repository of the workspace on this machine is a Git repository; the check cannot be restricted to changes since a commit",
          { command: "workspace.check" },
        );
  }
  return { ids, problems };
};

/**
 * What `input` names as changed; undefined when it restricts nothing (neither `changedFiles` nor
 * `changedSince`). Throws `input.invalid`, `git.unavailable` or `git.commit-not-found` (see the
 * file comment).
 */
export const changedFiles = async (
  root: string,
  layout: WorkspaceLayout,
  input: ChangedInput,
  signal: AbortSignal,
): Promise<Changes | undefined> => {
  if (input.changedFiles === undefined && input.changedSince === undefined) {
    return undefined;
  }
  const repositories = layout.repositories.filter((r) => r.available);
  const files = new Map<string, Set<string>>();
  await namedFiles(root, repositories, input.changedFiles ?? [], files);
  if (input.changedSince === undefined) {
    return { files, ids: new Set(), problems: [] };
  }
  const since = await filesSince(repositories, input.changedSince, files, signal);
  return { files, ...since };
};

/** What a restricted check keeps. */
export interface Restriction {
  /** The changed elements (C), in store order. */
  readonly changed: readonly ElementRecord[];
  /** The changed elements and their targets (C and Z), in store order. */
  readonly selected: readonly ElementRecord[];
  /** Whether a finding of the elements or files belongs to the restriction (see the file comment). */
  readonly keeps: (problem: Problem) => boolean;
}

/** The workspace states a restriction is computed on. */
export interface RestrictionContext {
  readonly store: ElementStore;
  readonly layout: WorkspaceLayout;
  readonly metamodel: Metamodel;
  /** The current versions, for the images an element embeds; undefined against an invalid metamodel. */
  readonly versions: CurrentVersions | undefined;
}

const fileKey = (repository: string, file: string): string => `${repository}\n${nfc(file)}`;

/** Whether `element` is changed: its file, or an image its text embeds (ADR-0005). */
const isChanged = (
  element: ElementRecord,
  changed: ChangedFiles,
  versions: CurrentVersions | undefined,
): boolean => {
  const files = changed.get(element.repository);
  if (files === undefined) {
    return false;
  }
  if (files.has(nfc(element.file))) {
    return true;
  }
  const current = versions?.byRecord.get(element);
  return current?.kind === "version" && current.images.some((image) => files.has(nfc(image.names.join("/"))));
};

/** The elements a target names: one, the copies of its UUID (SR-088), or none (missing, not here). */
const elementsOf = (named: TargetState | ElementMatch): readonly ElementRecord[] =>
  named.kind === "ambiguous" ? named.elements : "element" in named ? [named.element] : [];

/** The targets of `source`: its relations and inline references, one step, every element a target names. */
const targetsOf = (source: ElementRecord, context: RestrictionContext): ElementRecord[] =>
  outgoingLinks(source, context.metamodel).flatMap((link) =>
    elementsOf(
      link.kind === "relation"
        ? targetState(context.layout, context.store, source.repository, {
            id: link.item.id,
            repository: link.repository,
          })
        : resolveReference(context.store, source.repository, link.reference),
    ),
  );

/** The restriction of a check to `changes` and the targets of the elements in it. */
export const restrictTo = (changes: Changes, context: RestrictionContext): Restriction => {
  const changed = changes.files;
  const changedElements = context.store.elements.filter((e) => isChanged(e, changed, context.versions));
  const chosen = new Set(changedElements);
  for (const element of changedElements) {
    for (const target of targetsOf(element, context)) {
      chosen.add(target);
    }
  }
  const selected = context.store.elements.filter((e) => chosen.has(e));
  const changedIds = new Set([...changes.ids, ...changedElements.map((e) => e.id)]);
  const selectedIds = new Set(selected.map((e) => e.id));
  // The changed paths, the folders above them (a folder that cannot be listed) and the files of C and Z.
  const files = new Set(selected.map((e) => fileKey(e.repository, e.file)));
  for (const [repository, paths] of changed) {
    for (const file of paths) {
      const names = file.split("/");
      for (let i = 1; i <= names.length; i += 1) {
        files.add(fileKey(repository, names.slice(0, i).join("/")));
      }
    }
  }
  const keeps = (problem: Problem): boolean => {
    if (problem.elementId !== undefined) {
      return (
        selectedIds.has(problem.elementId) ||
        (problem.targetId !== undefined && changedIds.has(problem.targetId))
      );
    }
    if (problem.file !== undefined && problem.repository !== undefined) {
      return files.has(fileKey(problem.repository, problem.file));
    }
    return true;
  };
  return { changed: changedElements, selected, keeps };
};
