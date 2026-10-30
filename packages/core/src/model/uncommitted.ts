// Uncommitted changes to the files the data of a state is made of (SR-062 K2, #531 Q2): whether the
// working copy of a repository still holds the state of its HEAD commit. `data.export` gives it as
// `repositories[].dirty`, `data.store` names the file `<commit>-dirty.jsonl` by it; `baseline.create`
// asks `uncommittedFiles` with the files of its selection (SR-050 AK2). Read only (ADR-0006, D-036).
//
// - The state files of a repository: `reqseq-workspace.yaml` of the main repository; the `*.yaml` and
//   `*.yml` files directly in the metamodel, saved-filter and baselines folders where they lie in it;
//   every `*.md` the element walk sees (not below `.git` or `node_modules`, not matched by an
//   `ignore` glob, not in a nested repository of the workspace) outside the evidence locations; and
//   every file an element of the store embeds, of any extension. Not counted: evidence records (the
//   pipeline writes new ones in the same run, and each names its version, D-026), `.reqseq/local.yaml`,
//   code, every other file, and the stored `*.jsonl` files. Paths compare in NFC (ADR-0006).
// - How a repository is found dirty, read only and with no new git command:
//   1. `changedPaths` against the commit (diff without index refresh, untracked files); the listed
//      paths that are or were state files are kept.
//   2. One `info` round of the object reader for `<commit>:<path>` of every state file of the store
//      in the repository and of every kept path, in its spelling, in NFC and in NFD, so that a
//      repository committed on macOS is not dirty by its spelling.
//   3. A state file without a blob at the commit is dirty when it is on disk in one of its spellings:
//      a new element file, also one Git ignores, and an embedded file Git ignores. One that is neither
//      in the commit nor on disk (a committed link to an image that exists nowhere) is no change.
//   4. A kept path with a blob is dirty only when the blob ID of its working bytes (in the first of
//      the three spellings that is a regular file; Git's hash:
//      `blob <size>\0` + bytes, SHA-1 or SHA-256 by the length of the commit ID) differs, so a copied
//      work tree (only its stat data changed) is clean.
//   5. More, never less: a missing file, a link or folder where the commit has a file, a file whose
//      bytes differ only by a checkout filter (`autocrlf`, LFS) and a path git cannot take are dirty.
// - Unknown (`dirtyUnknown`) where git cannot tell after the commit was found.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { listFolderFiles } from "../files/index.js";
import type { ChangedPaths, GitUnknownReason, ObjectInfos } from "../git/reader.js";
import { changedPaths, isGitPath, openObjectReader } from "../git/reader.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { WORKSPACE_FILE, settingLocation } from "../workspace/index.js";
import { ELEMENT_FILE_EXTENSION, SKIPPED_NAMES } from "./discover.js";
import { ignoreMatcher } from "./ignore.js";
import { mapBounded } from "./images.js";
import type { NoCommitReason } from "./repository-commit.js";
import { repositoryCommit } from "./repository-commit.js";

/** Where the state files of one repository lie (`stateRules`). */
export interface StateRules {
  readonly repository: Pick<RepositoryLocation, "name" | "folder" | "main" | "excludes">;
  /** Folders relative to the repository (`/`, NFC, `""` for its root) whose YAML files count. */
  readonly yamlFolders: readonly string[];
  /** The evidence locations in the repository, relative as `yamlFolders`. */
  readonly evidenceFolders: readonly string[];
  /** The `ignore` globs of the workspace file (`ignoredBy`). */
  readonly ignored: (relativePath: string) => boolean;
  /** The files elements of the store embed in the repository, relative to it with `/`, in NFC. */
  readonly embeds: ReadonlySet<string>;
  /** The folders of the nested repositories (`repository.excludes`), absolute, in NFC. */
  readonly excluded: ReadonlySet<string>;
}

/**
 * `location` relative to the folder of `repository` (`/`, NFC, `""` for the folder itself), or
 * undefined when it lies in another repository or leaves this one.
 */
const relativeIn = (
  repository: Pick<RepositoryLocation, "name" | "folder">,
  location: { readonly repository: string; readonly path: string },
): string | undefined => {
  if (location.repository !== repository.name) {
    return undefined;
  }
  const relative = path
    .relative(repository.folder, path.resolve(repository.folder, location.path))
    .split(path.sep)
    .join("/");
  return relative.split("/")[0] === ".." || path.isAbsolute(relative) ? undefined : relative.normalize("NFC");
};

/** The rules of the state files of `repository` (see the file comment). */
export const stateRules = (
  layout: Pick<WorkspaceLayout, "file" | "main" | "metamodel">,
  repository: Pick<RepositoryLocation, "name" | "folder" | "main" | "excludes">,
  embeds: ReadonlySet<string>,
): StateRules => {
  const located = (locations: readonly { readonly repository: string; readonly path: string }[]): string[] =>
    locations.flatMap((location) => {
      const relative = relativeIn(repository, location);
      return relative === undefined ? [] : [relative];
    });
  return {
    repository,
    yamlFolders: located([
      layout.metamodel,
      settingLocation(layout, "filters"),
      settingLocation(layout, "baselines"),
    ]),
    evidenceFolders: located(layout.file.evidence ?? []),
    ignored: ignoreMatcher(layout.file.ignore ?? []),
    embeds,
    excluded: new Set(repository.excludes.map((e) => e.normalize("NFC"))),
  };
};

const isYaml = (file: string): boolean => /\.ya?ml$/i.test(file);

/** Whether the element walk goes down to `file` (relative, `/`): no skipped name, no `ignore` glob, no nested repository. */
const walkSees = (rules: StateRules, file: string): boolean => {
  const names = file.split("/");
  return names.every((name, index) => {
    const relative = names.slice(0, index + 1).join("/");
    return (
      !SKIPPED_NAMES.has(name) &&
      !rules.ignored(relative) &&
      (index === names.length - 1 ||
        !rules.excluded.has(path.join(rules.repository.folder, relative).normalize("NFC")))
    );
  });
};

/** Whether `file` (relative to the repository, `/`) lies in `folder` (relative, `""` for the root) or below it. */
const isBelow = (folder: string, file: string): boolean => folder === "" || file.startsWith(`${folder}/`);

/** Whether `file` (relative to the repository of `rules`, `/`) is a state file (see the file comment). */
export const isStateFile = (rules: StateRules, file: string): boolean => {
  const nfc = file.normalize("NFC");
  if (rules.repository.main && nfc === WORKSPACE_FILE) {
    return true;
  }
  const folder = path.posix.dirname(nfc);
  if (isYaml(nfc) && rules.yamlFolders.includes(folder === "." ? "" : folder)) {
    return true;
  }
  if (rules.embeds.has(nfc)) {
    return true;
  }
  return (
    nfc.endsWith(ELEMENT_FILE_EXTENSION) &&
    !rules.evidenceFolders.some((evidence) => isBelow(evidence, nfc)) &&
    walkSees(rules, nfc)
  );
};

/**
 * The state files ReqSeq knows of in the repository of `rules`: the workspace file (main), the
 * YAML files `yaml` lists (relative to the repository), the element files `elements` and the
 * embedded files. Each once, as given.
 */
export const stateFiles = (
  rules: StateRules,
  elements: readonly string[],
  yaml: readonly string[],
): string[] => [
  ...new Set([
    ...(rules.repository.main ? [WORKSPACE_FILE] : []),
    ...yaml.filter((file) => isStateFile(rules, file)),
    ...elements,
    ...rules.embeds,
  ]),
];

/** The paths of `changedPaths` that are state files of `rules`, or were at the commit (see the file comment). */
export const uncommittedStateFiles = (rules: StateRules, paths: readonly string[]): string[] =>
  paths.filter((file) => isStateFile(rules, file));

/** Git's ID of a blob of `size` bytes, read from `content`: SHA-1 for a 40-digit ID, SHA-256 for a 64-digit one. */
export const gitBlobId = async (
  content: Uint8Array | AsyncIterable<Uint8Array>,
  size: number,
  idLength: number,
): Promise<string> => {
  const hash = createHash(idLength === 64 ? "sha256" : "sha1");
  hash.update(`blob ${String(size)}\0`);
  if (content instanceof Uint8Array) {
    hash.update(content);
  } else {
    for await (const chunk of content) {
      hash.update(chunk);
    }
  }
  return hash.digest("hex");
};

/** What `repositoryState` reads (tests replace it). */
export interface StateReader {
  readonly changedPaths: (folder: string, commit: string) => Promise<ChangedPaths>;
  /** ID, type and size of each of `names` (`<commit>:<path>`), as an object reader's `info` round gives them. */
  readonly objects: (folder: string, names: readonly string[]) => Promise<ObjectInfos>;
  /** The blob ID of the regular file `absolute` as it is now, or undefined when it is none (missing, a link, a folder). */
  readonly blobId: (absolute: string, idLength: number) => Promise<string | undefined>;
  /** Whether there is anything at `absolute` (a file, a link or a folder). */
  readonly exists: (absolute: string) => Promise<boolean>;
}

/**
 * The blob ID of the working file `absolute` (see `StateReader.blobId`), read through `open`. A file that
 * cannot be read (no permission, gone after `lstat`) has none, so it counts as changed. Exported with
 * `open` for the test of that case, which permissions cannot give as root.
 */
export const workingBlobId =
  (open: (absolute: string) => AsyncIterable<Uint8Array>) =>
  async (absolute: string, idLength: number): Promise<string | undefined> => {
    const stats = await fs.lstat(absolute).catch(() => undefined);
    return stats?.isFile() === true
      ? gitBlobId(open(absolute), stats.size, idLength).catch(() => undefined)
      : undefined;
  };

/** The readers of git and of the disk. */
export const DEFAULT_STATE_READER: StateReader = {
  changedPaths: async (folder, commit) => changedPaths(folder, commit),
  objects: async (folder, names) => {
    const reader = openObjectReader(folder);
    try {
      return await reader.info(names);
    } finally {
      reader.close();
    }
  },
  blobId: workingBlobId((absolute) => createReadStream(absolute)),
  exists: async (absolute) =>
    fs.lstat(absolute).then(
      () => true,
      () => false,
    ),
};

/** The state of a repository: its commit, and whether its state files differ from it. */
export interface RepositoryState {
  readonly commit?: string;
  /** Left out without a commit, and where Git cannot tell (`dirtyUnknown`). */
  readonly dirty?: boolean;
  /** Why there is no commit. */
  readonly unknown?: NoCommitReason;
  /** Why Git cannot tell `dirty` although the commit is known. */
  readonly dirtyUnknown?: GitUnknownReason;
}

/** The spellings a path is asked in: as given, in NFC and in NFD. */
const spellings = (file: string): string[] => [
  ...new Set([file, file.normalize("NFC"), file.normalize("NFD")]),
];

/** The YAML files directly in the YAML folders of `rules`, relative to the repository. */
const yamlFiles = async (rules: StateRules): Promise<string[]> =>
  (
    await Promise.all(
      rules.yamlFolders.map(async (folder) => {
        const listing = await listFolderFiles(path.join(rules.repository.folder, ...folder.split("/")));
        return listing.kind === "names"
          ? listing.names.map((name) => (folder === "" ? name : `${folder}/${name}`))
          : [];
      }),
    )
  ).flat();

/** The files of a repository that differ from a commit, or why Git cannot tell (`uncommittedFiles`). */
export type UncommittedFiles =
  | { readonly known: true; readonly files: readonly string[] }
  | { readonly known: false; readonly reason: GitUnknownReason };

/**
 * The files of the repository in `folder` that differ from `commit` (steps 1 to 5 of the file
 * comment): of `files` (relative, `/`) and of the paths `changedPaths` lists that `counts` keeps.
 * `data.export` asks with the state files, `baseline.create` with the files of a selection (SR-050 AK2).
 */
export const uncommittedFiles = async (
  folder: string,
  commit: string,
  files: readonly string[],
  counts: (file: string) => boolean,
  read: StateReader = DEFAULT_STATE_READER,
): Promise<UncommittedFiles> => {
  const changed = await read.changedPaths(folder, commit);
  if (!changed.known) {
    return { known: false, reason: changed.reason };
  }
  const kept = new Set(changed.paths.filter(counts));
  const all = [...new Set([...files, ...kept])];
  // A path git cannot take (a name with white space at an end) is dirty: more, never less.
  const odd = all.filter((file) => !isGitPath(file));
  const asked = all.filter((file) => isGitPath(file));
  const spelled = asked.map(spellings);
  const infos = await read.objects(
    folder,
    spelled.flat().map((file) => `${commit}:${file}`),
  );
  if (!infos.known) {
    return { known: false, reason: infos.reason };
  }
  let at = 0;
  const blobs = spelled.map((names) => {
    const found = infos.objects.slice(at, at + names.length).find((info) => info?.type === "blob");
    at += names.length;
    return found?.id;
  });
  /** The absolute path of `file` in each of its spellings. */
  const absolute = (file: string): string[] =>
    spellings(file).map((name) => path.join(folder, ...name.split("/")));
  const checked = asked.map((file, index) => ({ file, blob: blobs[index] }));
  const dirty = await mapBounded(checked, async ({ file, blob }) => {
    // A file without a blob at the commit is dirty when it is on disk (new, also one Git ignores);
    // one that is neither in the commit nor on disk (a link to an image that exists nowhere) is no change.
    if (blob === undefined) {
      for (const name of absolute(file)) {
        if (await read.exists(name)) {
          return true;
        }
      }
      return false;
    }
    if (!kept.has(file)) {
      return false;
    }
    // The working file in the first spelling there is: on a file system that keeps the normal form
    // (Linux), Git lists a file committed in NFD and checked out in NFC once in each form.
    for (const name of absolute(file)) {
      const now = await read.blobId(name, commit.length);
      if (now !== undefined) {
        return now !== blob;
      }
    }
    return true;
  });
  return { known: true, files: [...odd, ...asked.filter((_, index) => dirty[index] === true)] };
};

/**
 * The commit of `repository` and whether the state files of `rules` differ from it (see the file
 * comment): `elements` are the element files of the store in the repository.
 */
export const repositoryState = async (
  rules: StateRules,
  elements: readonly string[],
  read: StateReader = DEFAULT_STATE_READER,
): Promise<RepositoryState> => {
  const { repository } = rules;
  const head = await repositoryCommit(repository);
  if (head.commit === undefined) {
    return { unknown: head.unknown };
  }
  const commit = head.commit;
  const files = stateFiles(rules, elements, await yamlFiles(rules));
  const found = await uncommittedFiles(
    repository.folder,
    commit,
    files,
    (file) => isStateFile(rules, file),
    read,
  );
  return found.known ? { commit, dirty: found.files.length > 0 } : { commit, dirtyUnknown: found.reason };
};
