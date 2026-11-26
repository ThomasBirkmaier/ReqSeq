// Why a version has no date (SR-254, SR-075 AK5): the warnings an output gives for the versions it names whose
// date the tool cannot determine (`versionDates` of version-date.ts gave `null`). Read only (D-036, ADR-0006).
//
// - Per repository, the first reason of SR-254 AK2 that holds (`repositoryDating`): `missing` (not on this
//   machine, SR-006 AK2, or a name no repository of the workspace has), `unreadable` (no `.git` entry in its folder
//   or above, no git program, Git refuses it or finds no work tree: `headCommit`; a HEAD that names no commit
//   counts as a repository without a commit only where it names a branch, `symbolicHead`, whose Git folder holds
//   no commit for it, `headFiles`), `shallow` (a shallow clone). A git call that does not answer in time tells no
//   reason.
// - A version counts as not committed (AK3) when it is the element's current version (`currentVersionsOf`,
//   `sameVersion`) in a repository that is on this machine and that Git reads: with a commit and the whole history,
//   where `versionTimes` gives `uncommitted` (its content differs from the last commit that changed the file, or no
//   commit has the file); in a shallow clone, where HEAD has no element file of that path (also one Git ignores),
//   or the diff of the tracked files lists it and its bytes differ from HEAD's blob and its element there has
//   another version (`sameContent`: line endings and spaces at line ends make no difference, SR-091), or where an
//   image its text embeds is on disk and not at HEAD, or is listed and differs byte by byte; in a repository
//   without a commit, always. A file whose bytes cannot be read now tells nothing: its element keeps the reason.
//   The workspace keeps what it judged (`shallowState`) for the HEAD commit and the element store it judged
//   against, an image while it looks the same (size, modification time): a later page asks git nothing.
// - The warnings, each once per repository (`undatedProblems`): `version.uncommitted` with the number of elements
//   not committed; for the other versions without date `version.date-unavailable` with the reason of AK2 where
//   one holds, else `version.date-unknown` with their number. An element counts once, whatever number of its
//   versions the output names. A sort (`sortReasonProblems`, SR-075 AK5) gives only `version.date-unavailable`.
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../generated/types.js";
import type { ChangedPaths, HeadCommit, HeadFiles } from "../git/reader.js";
import {
  commitBlobs,
  headCommit,
  headFiles,
  openObjectReader,
  symbolicHead,
  trackedChanges,
  workTreeOf,
} from "../git/reader.js";
import { metamodelState } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { sameVersion } from "../version/version.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { CurrentVersion } from "./current-versions.js";
import { currentVersionsOf } from "./current-versions.js";
import type { ElementRecord } from "./elements.js";
import { mapBounded } from "./images.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";
import { gitBlobId } from "./uncommitted.js";
import type { VersionDateContext } from "./version-date.js";
import { sameContent, versionTimes } from "./version-date.js";

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
      /** In a shallow clone, `trackedChanges` against `commit`, started early. */
      readonly changed?: Promise<ChangedPaths>;
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

/**
 * The diff of a shallow clone against the commit its HEAD files name, started at once: `repositoryDating` reads it
 * where git names the same commit, so the diff runs beside the question to git.
 */
const earlyDiff = (
  folder: string,
  files: HeadFiles | undefined,
  cache: ShallowCache,
): { readonly commit: string; readonly changed: Promise<ChangedPaths> } | undefined =>
  // Nothing to start where the files of this commit were judged before (`changedInShallow`).
  files?.shallow === true && files.commit !== undefined && cache.files.get(folder)?.commit !== files.commit
    ? { commit: files.commit, changed: trackedChanges(folder, files.commit) }
    : undefined;

/**
 * What a workspace keeps of its shallow clones between calls, so that a page asks git once for the diff and no more
 * (SR-082 AK4): per repository folder the HEAD commit git named for the HEAD files of a stamp (`headFiles`), and the
 * blob IDs of a commit's tree for the paths asked so far (a commit's tree never changes).
 */
interface ShallowCache {
  readonly heads: Map<string, { readonly stamp: string; readonly commit: string }>;
  /**
   * Per folder, for one HEAD commit and one element store (whose texts the versions are computed from), whether each
   * file read so far is changed against HEAD; an image with how it looked (`look`, size and modification time).
   */
  readonly files: Map<
    string,
    {
      readonly commit: string;
      readonly store: ElementStore;
      readonly verdicts: Map<string, { readonly changed: boolean; readonly look?: string }>;
    }
  >;
  readonly trees: Map<
    string,
    { readonly commit: string; readonly asked: Set<string>; readonly ids: Map<string, string> }
  >;
}

const shallowState = defineWorkspaceState(
  "undated-shallow",
  (): ShallowCache => ({ heads: new Map(), trees: new Map(), files: new Map() }),
  { dependsOn: [workspaceLayoutState] },
);

/**
 * HEAD of the repository in `folder` as `headCommit` gives it, for a shallow clone whose HEAD files have the stamp
 * git was asked at before taken from `cache` without a process.
 */
const headOf = async (
  folder: string,
  files: HeadFiles | undefined,
  cache: ShallowCache,
): Promise<HeadCommit> => {
  const kept = cache.heads.get(folder);
  if (files?.shallow === true && kept?.stamp === files.stamp) {
    return { known: true, commit: kept.commit, shallow: true };
  }
  const head = await headCommit(folder);
  if (head.known && head.shallow && files?.shallow === true && files.commit === head.commit) {
    cache.heads.set(folder, { stamp: files.stamp, commit: head.commit });
  }
  return head;
};

/** The reason of AK2 for the repository `name` and whether Git reads it (see the file comment). */
const repositoryDating = async (
  layout: WorkspaceLayout,
  name: string,
  cache: ShallowCache,
): Promise<RepositoryDating> => {
  const repository = layout.repositories.find((r) => r.name === name);
  if (repository?.available !== true) {
    return { reason: "missing", readable: false };
  }
  // Without a `.git` entry in the folder or above it, no git starts.
  if ((await workTreeOf(repository.folder)) === undefined) {
    return { reason: "unreadable", readable: false };
  }
  const files = await headFiles(repository.folder);
  const early = earlyDiff(repository.folder, files, cache);
  const head = await headOf(repository.folder, files, cache);
  if (head.known) {
    return head.shallow
      ? {
          reason: "shallow",
          readable: true,
          folder: repository.folder,
          commit: head.commit,
          ...(early?.commit === head.commit ? { changed: early.changed } : {}),
        }
      : { readable: true, folder: repository.folder, commit: head.commit };
  }
  // `not-a-repository` is also a work tree whose HEAD names a branch without a commit yet: git still reads it. Where
  // the Git folder alone cannot tell (a reftable repository, a branch named through another symbolic ref:
  // `headFiles` gives nothing), git's answers decide: HEAD names a branch, and no commit.
  const read = head.reason === "not-a-repository" ? await symbolicHead(repository.folder) : head;
  if (read.known && files?.commit === undefined) {
    return { readable: true, folder: repository.folder };
  }
  return !read.known && read.reason === "timeout"
    ? { readable: false }
    : { reason: "unreadable", readable: false };
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

const nfc = (text: string): string => text.normalize("NFC");

/**
 * The bytes of each blob of `ids` in the repository of `folder`, in that order; undefined when Git cannot tell. All
 * are held at once: `changedInShallow` asks only for the element files whose working bytes differ from HEAD, and
 * one text each.
 */
const blobsOf = async (folder: string, ids: readonly string[]): Promise<Buffer[] | undefined> => {
  const reader = openObjectReader(folder);
  try {
    const parts = ids.map((): Buffer[] => []);
    const read = await reader.read(ids, (_, index) => (chunk) => {
      parts[index]?.push(chunk);
    });
    return read.known ? parts.map((chunks) => Buffer.concat(chunks)) : undefined;
  } finally {
    reader.close();
  }
};

/**
 * The blob IDs HEAD `commit` of the repository in `folder` has for `paths`, from `cache` where asked before, else from
 * one `commitBlobs` for the rest; undefined when Git cannot tell.
 */
const treeBlobs = async (
  cache: ShallowCache,
  folder: string,
  commit: string,
  paths: readonly string[],
): Promise<ReadonlyMap<string, string> | undefined> => {
  const kept = cache.trees.get(folder);
  const tree =
    kept?.commit === commit ? kept : { commit, asked: new Set<string>(), ids: new Map<string, string>() };
  const missing = paths.filter((p) => !tree.asked.has(p));
  if (missing.length > 0) {
    const listed = await commitBlobs(folder, commit, missing);
    if (!listed.known) {
      return undefined;
    }
    for (const [name, id] of listed.ids) {
      tree.ids.set(name, id);
    }
    for (const name of missing) {
      tree.asked.add(name);
    }
    cache.trees.set(folder, tree);
  }
  return tree.ids;
};

/** A path as it is asked of Git: as given, in NFC and in NFD (a repository committed on macOS, ADR-0006). */
const spellings = (file: string): string[] => [...new Set([file, nfc(file), file.normalize("NFD")])];

/**
 * What a file of an element is against HEAD: `committed`, `changed`, or `unknown` where its bytes cannot be read
 * now (they count for nothing); an element file that differs by its bytes is `differs`, with both texts, for
 * `sameContent`.
 */
type FileState =
  | { readonly kind: "committed" | "changed" | "unknown" }
  | { readonly kind: "differs"; readonly blob: string; readonly now: Buffer };

/**
 * The state of `file` (relative to `folder`) against HEAD `commit`, given its blob there (`blob`), whether the diff
 * lists it or nothing tells it unchanged (`listed`), and whether it is an element file (see `FileState`).
 */
const stateOf = async (
  folder: string,
  commit: string,
  file: string,
  {
    blob,
    listed,
    element,
  }: { readonly blob: string | undefined; readonly listed: boolean; readonly element: boolean },
): Promise<FileState> => {
  const absolute = path.join(folder, ...file.split("/"));
  if (blob === undefined) {
    // Not at HEAD: an element file the workspace read is new; an image is new where it is on disk.
    const there =
      element ||
      (await fs.lstat(absolute).then(
        () => true,
        () => false,
      ));
    return { kind: there ? "changed" : "committed" };
  }
  if (!listed) {
    return { kind: "committed" };
  }
  const now = await fs.readFile(absolute).catch(() => undefined);
  if (now === undefined) {
    return { kind: "unknown" };
  }
  if ((await gitBlobId(now, now.length, commit.length)) === blob) {
    return { kind: "committed" };
  }
  return element ? { kind: "differs", blob, now } : { kind: "changed" };
};

/**
 * Which of `current`, of the shallow clone in `folder` with HEAD `commit`, are not committed (see the file
 * comment). One `diff` of the tracked files (`trackedChanges`, no walk of the work tree for untracked files) and
 * one tree listing of HEAD (`commitBlobs`) per call; only the files the diff lists, or that HEAD does not have, are
 * read, at most `mapBounded` at a time, and a file whose bytes have HEAD's blob ID is committed without a parse
 * (a copied work tree, whose stat data all changed, lists every file).
 */
const changedInShallow = async (
  context: VersionDateContext,
  cache: ShallowCache,
  {
    folder,
    commit,
    changed: early,
  }: { readonly folder: string; readonly commit: string; readonly changed?: Promise<ChangedPaths> },
  current: readonly Current[],
): Promise<Current[]> => {
  const store = await context.workspace.get(elementStoreState);
  const previous = cache.files.get(folder);
  const kept = previous?.commit === commit && previous.store === store ? previous : undefined;
  const looks = looksOf(current);
  const verdicts = new Map(kept?.verdicts);
  // The files without a verdict, and the images that look otherwise than when they got theirs.
  const files = [...new Set(current.flatMap(filesOf))].filter((file) => {
    const verdict = verdicts.get(file);
    return verdict === undefined || verdict.look !== looks.get(file);
  });
  if (files.length > 0) {
    // With nothing kept, the diff tells which files to read; else only images that look otherwise are left: read.
    const [changed, blobs] = await Promise.all([
      kept === undefined ? (early ?? trackedChanges(folder, commit)) : undefined,
      treeBlobs(cache, folder, commit, files.flatMap(spellings)),
    ]);
    if (changed?.known === false || blobs === undefined) {
      return [];
    }
    const listed = changed === undefined ? undefined : new Set(changed.paths.map(nfc));
    const elementFiles = new Map(current.map((c) => [c.element.file, c.element.id]));
    const states = await mapBounded(files, async (file) => ({
      file,
      state: await stateOf(folder, commit, file, {
        blob: spellings(file)
          .map((name) => blobs.get(name))
          .find((id) => id !== undefined),
        listed: listed?.has(nfc(file)) ?? true,
        element: elementFiles.has(file),
      }),
    }));
    for (const file of files) {
      verdicts.delete(file);
    }
    for (const [file, changedFile] of await judged(context, folder, states, elementFiles)) {
      const look = looks.get(file);
      verdicts.set(file, { changed: changedFile, ...(look === undefined ? {} : { look }) });
    }
    cache.files.set(folder, { commit, store, verdicts });
  }
  return current.filter((c) => filesOf(c).some((file) => verdicts.get(file)?.changed === true));
};

/** How each image of `current` looked when its version was computed (size and modification time; "" missing). */
const looksOf = (current: readonly Current[]): Map<string, string> =>
  new Map(
    current.flatMap(({ entry }) =>
      entry.images.flatMap((image): [string, string][] =>
        image.found === "nested"
          ? []
          : [
              [
                image.names.join("/"),
                image.found === null ? "" : `${String(image.found.size)}:${String(image.found.mtimeMs)}`,
              ],
            ],
      ),
    ),
  );

/**
 * Whether each file of `states` is changed against HEAD: an element file whose bytes differ, by `sameContent` with
 * its text at HEAD. A file that cannot be read now, or whose HEAD text Git did not give, is left out: it tells
 * nothing.
 */
const judged = async (
  context: VersionDateContext,
  folder: string,
  states: readonly { readonly file: string; readonly state: FileState }[],
  elementIds: ReadonlyMap<string, string>,
): Promise<Map<string, boolean>> => {
  const differing = states.flatMap(({ file, state }) => (state.kind === "differs" ? [{ file, state }] : []));
  const heads =
    differing.length === 0
      ? []
      : await blobsOf(
          folder,
          differing.map(({ state }) => state.blob),
        );
  const result = new Map<string, boolean>();
  for (const { file, state } of states) {
    if (state.kind === "committed" || state.kind === "changed") {
      result.set(file, state.kind === "changed");
    }
  }
  differing.forEach(({ file, state }, index) => {
    const head = heads?.[index];
    if (head !== undefined) {
      result.set(file, !sameContent(context, file, String(elementIds.get(file)), head, state.now));
    }
  });
  return result;
};

/** Which of `current`, all of one repository, are not committed (see the file comment). */
const notCommitted = async (
  context: VersionDateContext,
  cache: ShallowCache,
  dating: RepositoryDating,
  current: readonly Current[],
): Promise<Set<UndatedVersion>> => {
  if (!dating.readable || current.length === 0) {
    return new Set();
  }
  const { commit } = dating;
  if (commit === undefined) {
    return versionsOf(current);
  }
  if (dating.reason === "shallow") {
    return versionsOf(await changedInShallow(context, cache, { ...dating, commit }, current));
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
  const cache = workspace.get(shallowState);
  const context: VersionDateContext = { workspace, layout, metamodel };
  const byName = new Map<string, UndatedVersion[]>();
  for (const version of undated) {
    const list = byName.get(version.repository);
    if (list === undefined) {
      byName.set(version.repository, [version]);
    } else {
      list.push(version);
    }
  }
  const versions = await currentVersionsOf(
    workspace,
    undated.flatMap((u) => (u.element === undefined ? [] : [u.element])),
  );
  return Promise.all(
    [...byName].map(async ([repository, list]): Promise<UndatedRepository> => {
      const dating = await repositoryDating(layout, repository, cache);
      const current = list.flatMap((version): Current[] => {
        const { element } = version;
        const entry = element === undefined ? undefined : versions.get(element);
        return element !== undefined && entry?.kind === "version" && sameVersion(version.version, entry.forms)
          ? [{ undated: version, element, entry }]
          : [];
      });
      const uncommitted = await notCommitted(context, cache, dating, current);
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
