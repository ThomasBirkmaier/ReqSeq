// The element store (ADR-0008): every element file of every available repository of the workspace,
// found by its frontmatter in whatever folder it lies (SR-003, SR-004 AK1, D-056). Relations name
// their target by UUID only, so moving a file to another folder changes nothing for them (SR-003 AK3).
// The watcher keeps it current file by file (`updateElements`, SR-007), and so does a write of
// ReqSeq itself (`withWrittenFiles`, `recordWrites`, #166).
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import type { FileSnapshot, ParsedFile } from "../files/index.js";
import type { StateChange, Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { loadMetamodel, metamodelState } from "../metamodel/index.js";
import { availableRepositories, workspaceLayoutState } from "../workspace/index.js";
import type { Contribution } from "./contribution.js";
import { contribution, parsedContribution } from "./contribution.js";
import type { DiscoveredFiles } from "./discover.js";
import { ELEMENT_FILE_EXTENSION, listMarkdownFiles, listsFile, pathState } from "./discover.js";
import type { ElementRecord } from "./elements.js";
import { ignoreMatcher } from "./ignore.js";
import type { Reuse } from "./model-cache.js";
import { loadThroughCache } from "./model-cache.js";
import type { LoadedVersion, Versioning } from "./loaded-version.js";
import { versioningOf } from "./loaded-version.js";
import { handOverView } from "./by-id.js";
import { byPath, inPathOrder } from "./path-order.js";
import { PATCH_LIMIT } from "./patch-limits.js";
import { PatchedMap } from "./patched-map.js";
import type { ReadRequest } from "./read-pool.js";
import { openReadPool, readWorkers } from "./read-pool.js";

export type { Contribution } from "./contribution.js";
export { byPath } from "./path-order.js";

/** A file of a repository of the workspace. */
export interface RepositoryFile {
  /** Workspace name of the repository. */
  readonly repository: string;
  /** Relative to the repository, `/` as separator. */
  readonly file: string;
}

/** What one available repository contributes; the watcher updates it file by file (SR-007). */
export interface RepositoryContents {
  /** Workspace name of the repository. */
  readonly repository: string;
  /** Where it was read, from the layout of the store. */
  readonly location: RepositoryLocation;
  /** Folders that cannot be listed and Markdown files that are not read, sorted by path. */
  readonly listing: readonly Problem[];
  /**
   * Every listed Markdown file in path order (code units), with what it contributed. After a change
   * a `PatchedMap` over the files before (#215): read it as a `ReadonlyMap` only.
   */
  readonly files: ReadonlyMap<string, Contribution>;
}

export interface ElementStore {
  /** All elements, by repository in the order of the workspace file, then by file path (code units). */
  readonly elements: readonly ElementRecord[];
  /**
   * Elements by UUID, each list in the order of `elements`; the order of the UUIDs is not defined
   * after a change (a `PatchedMap`, #215; a hot read loop looks it up through `recordsById`). More than one record when files share a UUID (a copied
   * file); reporting that is SR-088.
   */
  readonly byId: ReadonlyMap<string, readonly ElementRecord[]>;
  /**
   * Markdown files that are not elements (SR-003 AK2). ReqSeq never changes them; the only ones it
   * writes are new evidence records (`evidence.record`, SR-030), which it creates and never replaces.
   */
  readonly nonElements: readonly RepositoryFile[];
  /**
   * With `repository` set, per repository in the order of the workspace file: folders that cannot
   * be listed and Markdown files that are not read (links, `.MD`), then per file in path order its
   * faulty YAML or content (SR-008), YAML warnings and invalid `id` or `type`. A faulty file never
   * stops the others (SR-008 AK3).
   */
  readonly problems: readonly Problem[];
  /**
   * Per available repository in the order of the workspace file, what each file contributed; the
   * fields above are built from it. `updateElements` reads a store without it in full.
   */
  readonly repositories?: readonly RepositoryContents[];
  /**
   * What the files were read with to give each element its version as read (`loadedVersionsOf`,
   * #439); the store's later reads (watcher batches, writes) use it too. Undefined: none were computed.
   */
  readonly versioning?: Versioning;
}

/** A store as a full read gives it: with what each file of each repository contributed. */
export type LoadedStore = ElementStore & { readonly repositories: readonly RepositoryContents[] };

/** Files read at the same time; bounded so 50,000 files do not exhaust file handles (N-036). */
const READ_CONCURRENCY = 32;

/**
 * Reads `files` of a repository with bounded parallelism, by path. With `signal` aborted no
 * further file is read and the call rejects with its reason.
 */
const readRepository = async (
  repository: RepositoryLocation,
  files: readonly string[],
  signal: AbortSignal | undefined,
  versioning: Versioning | undefined,
): Promise<ReadonlyMap<string, Contribution>> => {
  const results = new Map<string, Contribution>();
  // One shared iterator: each worker takes the next file until none are left.
  const queue = files.values();
  const worker = async (): Promise<void> => {
    for (const file of queue) {
      signal?.throwIfAborted();
      results.set(file, await contribution(repository, file, versioning));
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, worker));
  return results;
};

/** How the files are read; tests set them, the store uses the defaults. */
export interface ReadOptions {
  /** Worker threads of a read with many files. Default: one per core minus one, at least one (ADR-0008). */
  readonly workers?: number;
  /** A read of at least this many files runs in worker threads, a smaller one in this thread. Default 1,000. */
  readonly workerThreshold?: number;
  /**
   * Which listed files of a repository to take from the model cache instead of reading them
   * (`loadThroughCache`, SR-082). Default: read every file.
   */
  readonly reuse?: Reuse;
  /**
   * When given, each element read gets its version as read (`parsedContribution`, #439), and the
   * store keeps the `Versioning`; asked only when a file is read. Default: none.
   */
  readonly versioning?: VersioningSource | undefined;
}

/**
 * Where the versions as read come from (`ReadOptions.versioning`): a `Versioning`, its promise, or a
 * function asked only when a file is read. One that fails or gives none means no versions.
 */
export type VersioningSource =
  Versioning | PromiseLike<Versioning | undefined> | (() => PromiseLike<Versioning | undefined>);

/** The `Versioning` of `source`; undefined when it gives none or fails, so it never fails a read. */
const versioningFrom = async (source: VersioningSource | undefined): Promise<Versioning | undefined> => {
  try {
    return await (typeof source === "function" ? source() : source);
  } catch {
    return undefined;
  }
};

/** The `Versioning` for a read into `store`: from `source` when given, else the one `store` was read with. */
const versioningFor = async (
  store: ElementStore,
  source: VersioningSource | undefined,
): Promise<Versioning | undefined> => (source === undefined ? store.versioning : versioningFrom(source));

/**
 * The `Versioning` of the metamodel of `workspace` as it is now (#439), without building its metamodel
 * state, so that reading the store builds no other state: the state's value when it is there, else
 * the metamodel read from `layout`.
 */
export const workspaceVersioning =
  (workspace: Workspace, layout: WorkspaceLayout) => async (): Promise<Versioning | undefined> =>
    versioningOf(await (workspace.peek(metamodelState) ?? loadMetamodel(layout)));

/**
 * From this many files a read goes to worker threads (ADR-0008, N-036). Measured in a fresh process
 * on 4 cores (3 workers): the pool breaks even with this thread at about 1,000 files (both about
 * 1.0 s; starting the workers, which load the YAML parser and compile the schemas, costs about
 * 0.5 s) and is ahead from 2,000 files (4,000 files: 2.3 s against 3.2 s; 50,000: 10 s against 41 s).
 */
const WORKER_THRESHOLD = 1_000;

/**
 * What each file of each request contributes, with its request, in the order of `requests`: from
 * `workerThreshold` files in all, in one pool of worker threads that takes the files of every
 * request from one queue (the cold load, a large watcher batch; ADR-0008, N-036), else in this
 * thread. Both give the same contributions. The pool is stopped when the read ends, also on an
 * abort or a failure.
 */
const readAll = async <R extends ReadRequest & { readonly repository: RepositoryLocation }>(
  requests: readonly R[],
  signal: AbortSignal | undefined,
  options: ReadOptions,
  versioning: Versioning | undefined,
): Promise<(readonly [R, ReadonlyMap<string, Contribution>])[]> => {
  const count = requests.reduce((sum, { files }) => sum + files.length, 0);
  if (count < (options.workerThreshold ?? WORKER_THRESHOLD)) {
    const read: (readonly [R, ReadonlyMap<string, Contribution>])[] = [];
    for (const request of requests) {
      read.push([request, await readRepository(request.repository, request.files, signal, versioning)]);
    }
    return read;
  }
  signal?.throwIfAborted();
  const pool = openReadPool(options.workers ?? readWorkers());
  try {
    return await pool.read(requests, signal, versioning);
  } finally {
    await pool.close();
  }
};

/** `elements` (when given), `problems` and `nonElements` of the store from the contents of the repositories. */
const collect = (
  repositories: readonly RepositoryContents[],
  elements?: ElementRecord[],
): { readonly problems: Problem[]; readonly nonElements: RepositoryFile[] } => {
  const nonElements: RepositoryFile[] = [];
  const problems: Problem[] = [];
  for (const { repository, listing, files } of repositories) {
    problems.push(...listing);
    for (const result of files.values()) {
      problems.push(...result.warnings);
      if (result.kind === "problem") {
        problems.push(result.problem);
      } else if (result.kind === "element") {
        elements?.push(result.element);
      } else {
        nonElements.push({ repository, file: result.file });
      }
    }
  }
  return { problems, nonElements };
};

/** The store fields from the contents of the repositories, in their order. */
const assemble = (
  repositories: readonly RepositoryContents[],
  versioning: Versioning | undefined,
): LoadedStore => {
  const elements: ElementRecord[] = [];
  const { problems, nonElements } = collect(repositories, elements);
  const byId = new Map<string, ElementRecord[]>();
  for (const element of elements) {
    const same = byId.get(element.id);
    if (same === undefined) {
      byId.set(element.id, [element]);
    } else {
      same.push(element);
    }
  }
  return {
    elements,
    byId,
    nonElements,
    problems,
    repositories,
    ...(versioning === undefined ? {} : { versioning }),
  };
};

/**
 * Contributions of the files listed, in path order (code units, as `listMarkdownFiles` sorts):
 * `fresh` where read, else `before`. Every listed file is in one of them.
 */
const inListOrder = (
  files: readonly string[],
  fresh: ReadonlyMap<string, Contribution>,
  before: ReadonlyMap<string, Contribution> = new Map(),
): Map<string, Contribution> => {
  const listed = new Set(files);
  const kept = [...before].filter(([file]) => listed.has(file) && !fresh.has(file));
  return inPathOrder([...kept, ...fresh]);
};

/** The files of a repository whose contribution changed: removed, added or replaced. */
interface Touched {
  /** The repository's contents in the store before and after. */
  readonly before: RepositoryContents;
  readonly after: RepositoryContents;
  readonly files: ReadonlySet<string>;
}

/**
 * What `patchStore` made each store from: the store before and its touched files (`storeUpdate`).
 * The store before is held weakly, so that a chain of patched stores does not keep every earlier
 * store alive.
 */
const patchedFrom = new WeakMap<
  ElementStore,
  { readonly from: WeakRef<ElementStore>; readonly touched: readonly Touched[] }
>();

/** Whether a contribution adds nothing to `problems` or `nonElements`: none, or an element without warnings. */
const quiet = (result: Contribution | undefined): boolean =>
  result === undefined || (result.kind === "element" && result.warnings.length === 0);

/** The first index of `list` whose record is not before `record` in store order (`compare`). */
const lowerBound = (
  list: readonly ElementRecord[],
  record: ElementRecord,
  compare: (a: ElementRecord, b: ElementRecord) => number,
): number => {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const at = list[middle];
    if (at !== undefined && compare(at, record) < 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

/**
 * The store after the files `touched` of `before` changed to those of `repositories` (#215,
 * ADR-0008): `elements` is copied once and patched at the places of the records that went and came
 * (binary search by repository index and path), `byId` is a `PatchedMap` in which each touched
 * UUID's list is built again in store order (hot read loops look it up through `recordsById`); `problems` and `nonElements` are kept when every
 * repository has the same `listing` object and every touched file contributes, before and
 * after, nothing or an element without warnings, else they are collected again. Every other record
 * stays the same object. From `PATCH_LIMIT` touched files the store is assembled anew. Either way the
 * result equals `assemble(repositories)` (up to the order of the UUIDs in `byId`), and `storeUpdate`
 * finds its changes from the touched files.
 */
const patchStore = (
  before: LoadedStore,
  repositories: readonly RepositoryContents[],
  touched: readonly Touched[],
  versioning: Versioning | undefined,
): LoadedStore => {
  let count = 0;
  for (const { files } of touched) {
    count += files.size;
  }
  const store =
    count >= PATCH_LIMIT
      ? assemble(repositories, versioning)
      : patched(before, repositories, touched, versioning);
  patchedFrom.set(store, { from: new WeakRef(before), touched });
  return store;
};

/** `patchStore` below its limit. */
const patched = (
  before: LoadedStore,
  repositories: readonly RepositoryContents[],
  touched: readonly Touched[],
  versioning: Versioning | undefined,
): LoadedStore => {
  const gone = new Set<ElementRecord>();
  const came: ElementRecord[] = [];
  let keep = repositories.every((r, i) => r.listing === before.repositories[i]?.listing);
  for (const { before: from, after: to, files } of touched) {
    for (const file of files) {
      const old = from.files.get(file);
      const now = to.files.get(file);
      keep &&= quiet(old) && quiet(now);
      if (old?.kind === "element") {
        gone.add(old.element);
      }
      if (now?.kind === "element") {
        came.push(now.element);
      }
    }
  }
  const rank = new Map(repositories.map((r, i) => [r.repository, i]));
  const compare = (a: ElementRecord, b: ElementRecord): number =>
    Number(rank.get(a.repository)) - Number(rank.get(b.repository)) || byPath(a.file, b.file);
  // Each place in `before.elements`: a record that came goes before the record there, one that went
  // is left out. One file contributes one record, so a place is never taken twice.
  // The sort is stable: records that came at one place stay in store order.
  const edits = [
    ...came.sort(compare).map((record) => ({ at: lowerBound(before.elements, record, compare), record })),
    ...[...gone].map((record) => ({ at: lowerBound(before.elements, record, compare), record: undefined })),
  ].sort((a, b) => a.at - b.at || Number(a.record === undefined) - Number(b.record === undefined));
  const elements: ElementRecord[] = [];
  let next = 0;
  for (const { at, record } of edits) {
    for (const kept of before.elements.slice(next, at)) {
      elements.push(kept);
    }
    next = at;
    if (record === undefined) {
      next = at + 1;
    } else {
      elements.push(record);
    }
  }
  for (const kept of before.elements.slice(next)) {
    elements.push(kept);
  }
  const ids = new Set([...gone, ...came].map((record) => record.id));
  const changes = [...ids].map((id): [string, ElementRecord[] | undefined] => {
    const list = [
      ...(before.byId.get(id) ?? []).filter((record) => !gone.has(record)),
      ...came.filter((record) => record.id === id),
    ].sort(compare);
    return [id, list.length === 0 ? undefined : list];
  });
  const byId = PatchedMap.patch(before.byId, changes);
  handOverView(before.byId, byId, changes);
  const { problems, nonElements } = keep ? before : collect(repositories);
  return {
    elements,
    byId,
    nonElements,
    problems,
    repositories,
    ...(versioning === undefined ? {} : { versioning }),
  };
};

/** The `ignore` globs of the workspace file as a test (the element walk and the watcher). */
export const ignoredBy = (layout: WorkspaceLayout): ((relativePath: string) => boolean) =>
  ignoreMatcher(layout.file.ignore ?? []);

/**
 * Reads the element files of every available repository of `layout` (a missing one is skipped,
 * SR-004 AK3). One folder walk per repository, then the files are read, each classified as soon as
 * it is read: with bounded parallelism in this thread, or, from `workerThreshold` files of all
 * repositories together, in one pool of worker threads (ADR-0008); no call of the version control
 * program (N-036). With `options.reuse`, files whose model cache entry still matches are taken from
 * it instead of being read (SR-082).
 */
export const loadElements = async (
  layout: WorkspaceLayout,
  signal?: AbortSignal,
  options: ReadOptions = {},
): Promise<LoadedStore> => {
  const ignored = ignoredBy(layout);
  const walks: {
    readonly repository: RepositoryLocation;
    readonly listed: DiscoveredFiles;
    readonly reused: ReadonlyMap<string, Contribution>;
    readonly files: readonly string[];
  }[] = [];
  for (const repository of availableRepositories(layout)) {
    const listed = await listMarkdownFiles(repository, ignored);
    const { reused, read } = (await options.reuse?.(repository, listed.files)) ?? {
      reused: new Map<string, Contribution>(),
      read: listed.files,
    };
    walks.push({ repository, listed, reused, files: read });
  }
  // Only when a file is read: a start that takes every file from the model cache loads no metamodel.
  const versioning = walks.some((w) => w.files.length > 0)
    ? await versioningFrom(options.versioning)
    : undefined;
  const read = await readAll(walks, signal, options, versioning);
  return assemble(
    read.map(([{ repository, listed, reused }, files]) => ({
      repository: repository.name,
      location: repository,
      listing: listed.problems,
      files: inListOrder(listed.files, files, reused),
    })),
    versioning,
  );
};

/** What changed in one repository, as the watcher saw it (SR-007). */
export interface RepositoryChanges {
  /**
   * Paths relative to the repository (`/` as separator) of files or folders that were created,
   * changed, renamed or deleted, in any Unicode normal form. Every listed file at or below such a
   * path (both compared in NFC) is checked again.
   */
  readonly paths: readonly string[];
  /** The watcher cannot say which paths changed: every file is checked again. */
  readonly all?: boolean;
}

/** Whether `file` or one of its folders is in `paths`. */
const atOrBelow = (file: string, paths: ReadonlySet<string>): boolean => {
  for (let end = file.length; end > 0; end = file.lastIndexOf("/", end - 1)) {
    if (paths.has(file.slice(0, end))) {
      return true;
    }
  }
  return false;
};

/**
 * Whether a file found below a changed folder (or with `all`) may have changed: its size or
 * modification time differs from the snapshot, a cheap `stat` before reading it again. A file the
 * watcher named itself is always read again.
 */
const statChanged = async (folder: string, file: string, before: Contribution): Promise<boolean> => {
  if (before.snapshot === undefined) {
    return true;
  }
  try {
    const stat = await fs.lstat(path.join(folder, file));
    return stat.size !== before.snapshot.size || stat.mtimeMs !== before.snapshot.mtimeMs;
  } catch {
    // Gone since the walk, or not readable: reading it tells which.
    return true;
  }
};

/** Whether a path exists; only "no such file" counts as gone. */
const exists = (absolute: string): Promise<boolean> =>
  fs.lstat(absolute).then(
    () => true,
    (error: unknown) => (error as NodeJS.ErrnoException).code !== "ENOENT",
  );

/**
 * Whether a file read again contributes the same as before: the same snapshot (SHA-256, size and
 * modification time, so the store keeps the time a full read would give), or, for a file that did
 * not parse (no snapshot), the same result.
 */
const same = (before: Contribution, after: Contribution): boolean =>
  JSON.stringify(before.snapshot) === JSON.stringify(after.snapshot) &&
  (before.snapshot !== undefined || JSON.stringify(before) === JSON.stringify(after));

/**
 * The most paths a batch may name in one repository for `listedWithoutWalk` to look at them one by
 * one: each costs a few `lstat`, `opendir` and `realpath` calls, while a walk of 50,000 files costs
 * about 25 ms (N-036, #215); a larger batch (a pull) walks.
 */
export const WALK_SKIP_LIMIT = 64;

/** `relative` folded as a file system that ignores case and normal form compares it. */
const folded = (relative: string): string => relative.normalize("NFC").toLowerCase();

/**
 * A test whether the store holds a file at or below a path, compared ignoring case and normal form:
 * the folded files and every folder above one are put in a set once, on the first question.
 */
const holdsBelow = (before: RepositoryContents): ((relative: string) => boolean) => {
  let held: Set<string> | undefined;
  return (relative) => {
    if (held === undefined) {
      held = new Set();
      for (const file of before.files.keys()) {
        const key = folded(file);
        for (let end = key.length; end > 0; end = key.lastIndexOf("/", end - 1)) {
          held.add(key.slice(0, end));
        }
      }
    }
    return held.has(folded(relative));
  };
};

/**
 * What a walk of the repository would list after `changes`, found without a walk (#215), or
 * undefined when only a walk can tell. That is so only when the OS named the paths (no `all`), there
 * are at most `WALK_SKIP_LIMIT` of them, the repository had no listing problem before (an unreadable
 * folder, a link or `.MD` file, a stale temp file: a walk keeps those current), and each path is
 * one of: a file the store holds that the walk still lists (`listsFile`: every folder above it a
 * real folder without a `.git` entry, the spelling as on disk), a file it holds that is gone from a
 * folder the walk goes into, a new `*.md` file the walk lists that is no folder above a file of the
 * store (one moved away and replaced by the file), or a path that is gone and is no file of the store
 * and no folder above one (a temporary file of an editor; both compared ignoring case and normal
 * form). Anything else (a folder, a link, another spelling, a name Windows abbreviates, an error)
 * walks.
 */
const listedWithoutWalk = async (
  before: RepositoryContents,
  changes: RepositoryChanges,
  ignored: (relativePath: string) => boolean,
): Promise<{ readonly read: readonly string[]; readonly gone: ReadonlySet<string> } | undefined> => {
  if (changes.all === true || changes.paths.length > WALK_SKIP_LIMIT || before.listing.length > 0) {
    return undefined;
  }
  const gone = new Set<string>();
  const read: string[] = [];
  const below = holdsBelow(before);
  for (const relative of changes.paths) {
    const state = await pathState(before.location, ignored, relative);
    const held = before.files.has(relative);
    if (state === "listed" && held) {
      read.push(relative);
    } else if (state === "gone" && held) {
      gone.add(relative);
    } else if (state === "listed" && relative.endsWith(ELEMENT_FILE_EXTENSION) && !below(relative)) {
      // New, and no folder of that name held files (it was moved away, the file took its place).
      read.push(relative);
    } else if (state !== "gone" || below(relative)) {
      return undefined;
    }
  }
  return { read, gone };
};

/**
 * The files of a repository to read again after `changes`, from a walk: new ones, those the
 * watcher named, and those below a named folder (or all) whose size or modification time differ;
 * and the held files the walk no longer lists.
 */
const walkedChanges = async (
  before: RepositoryContents,
  changes: RepositoryChanges,
  listed: DiscoveredFiles,
): Promise<{ readonly read: readonly string[]; readonly gone: ReadonlySet<string> }> => {
  // Compared in Unicode NFC (#225): the watcher may spell a path in another normal form than
  // `readdir` (FSEvents on macOS). Where a file system keeps the forms apart, a file is at most
  // checked once more.
  const named = new Set(changes.paths.map((p) => p.normalize("NFC")));
  const read: string[] = [];
  for (const file of listed.files) {
    const old = before.files.get(file);
    const key = file.normalize("NFC");
    const touched = changes.all === true || atOrBelow(key, named);
    if (
      old === undefined ||
      named.has(key) ||
      (touched && (await statChanged(before.location.folder, file, old)))
    ) {
      read.push(file);
    }
  }
  const kept = new Set(listed.files);
  return { read, gone: new Set([...before.files.keys()].filter((file) => !kept.has(file))) };
};

/** One repository after a change, with the files whose contribution changed (removed, added, replaced). */
interface UpdatedContents {
  readonly contents: RepositoryContents;
  readonly touched: ReadonlySet<string>;
}

/**
 * One repository after `changes` (`contents` is `before` itself when nothing it contributes
 * changed): `files` is `before.files` patched with the touched files (`PatchedMap` in path order,
 * #215), and `listing` the same object when the walk found the same problems.
 */
const updateContents = async (
  before: RepositoryContents,
  changes: RepositoryChanges,
  ignored: (relativePath: string) => boolean,
  signal: AbortSignal | undefined,
  versioning: Versioning | undefined,
): Promise<UpdatedContents> => {
  const repository = before.location;
  // The changed paths alone when they tell what a walk would list (#215), else one walk again: it
  // sees new, moved and deleted files and folders and applies every rule of the full read (ignore
  // globs, nested repositories, links) without reading a file (N-036).
  const skipped = await listedWithoutWalk(before, changes, ignored);
  let listing = before.listing;
  let found = skipped;
  if (found === undefined) {
    const listed = await listMarkdownFiles(repository, ignored);
    found = await walkedChanges(before, changes, listed);
    // The same problems keep the same object, so `patchStore` can keep the store's problems.
    if (JSON.stringify(listed.problems) !== JSON.stringify(listing)) {
      listing = listed.problems;
    }
  }
  const { read: check, gone: unlisted } = found;
  const read = new Map(
    (await readAll([{ repository, files: check }], signal, {}, versioning)).flatMap(([, files]) => [
      ...files,
    ]),
  );
  // A file deleted between the walk and its read is gone, not unreadable.
  const deleted = new Set(unlisted);
  for (const [file, now] of read) {
    if (
      now.kind === "problem" &&
      now.problem.code === "file.unreadable" &&
      !(await exists(path.join(repository.folder, file)))
    ) {
      read.delete(file);
      deleted.add(file);
    }
  }
  // Only the files the store held are dropped; a new file deleted before its read changes nothing.
  const gone = [...deleted].filter((file) => before.files.has(file));
  const fresh = [...read].filter(([file, now]) => {
    const old = before.files.get(file);
    return old === undefined || !same(old, now);
  });
  const touched = new Set([...gone, ...fresh.map(([file]) => file)]);
  if (touched.size === 0 && listing === before.listing) {
    return { contents: before, touched };
  }
  return {
    contents: {
      repository: repository.name,
      location: repository,
      listing,
      files:
        touched.size === 0
          ? before.files
          : PatchedMap.patch(
              before.files,
              [...gone.map((file): [string, undefined] => [file, undefined]), ...fresh],
              { order: byPath },
            ),
    },
    touched,
  };
};

/**
 * Whether `updateElements` reads `store` in full for `layout`: it has no `repositories`, or they are
 * not those available in `layout`. Every record of the result is then another object.
 */
export const readsInFull = (store: ElementStore, layout: WorkspaceLayout): boolean =>
  store.repositories === undefined ||
  JSON.stringify(availableRepositories(layout)) !== JSON.stringify(store.repositories.map((r) => r.location));

/**
 * The store after files changed outside the tool (SR-007): for each repository with changes its
 * Markdown files are listed again (one walk, no reads, skipped when the changed paths alone tell
 * what it would list: `listedWithoutWalk`), files that are gone are dropped, new files
 * are read and the changed ones read again; a file whose snapshot (SHA-256, size, time) is
 * unchanged keeps its record, and a file deleted while it is read counts as gone. The result
 * equals `loadElements` on the working tree now. Undefined when nothing changed, so dependent
 * state is kept. A store without `repositories`, or one whose repositories are not those available
 * in `layout`, is read in full.
 */
export const updateElements = async (
  store: ElementStore,
  layout: WorkspaceLayout,
  changes: ReadonlyMap<string, RepositoryChanges>,
  signal?: AbortSignal,
  source?: VersioningSource,
): Promise<ElementStore | undefined> => {
  const before = store.repositories;
  const versioning = await versioningFor(store, source);
  if (before === undefined || readsInFull(store, layout)) {
    return loadElements(layout, signal, { versioning });
  }
  const ignored = ignoredBy(layout);
  const repositories: RepositoryContents[] = [];
  const touched: Touched[] = [];
  for (const old of before) {
    const change = changes.get(old.repository);
    const updated =
      change === undefined
        ? { contents: old, touched: new Set<string>() }
        : await updateContents(old, change, ignored, signal, versioning);
    repositories.push(updated.contents);
    if (updated.touched.size > 0) {
      touched.push({ before: old, after: updated.contents, files: updated.touched });
    }
  }
  return repositories.every((r, i) => r === before[i])
    ? undefined
    : patchStore(store as LoadedStore, repositories, touched, versioning);
};

/** A file ReqSeq has just written (`element.create`, `element.update`, ...), for `withWrittenFiles`. */
export interface WrittenFile {
  /** Workspace name of the repository. */
  readonly repository: string;
  /** The bytes as written, parsed, with the snapshot of the write. */
  readonly file: ParsedFile;
  /** The snapshot of the file the write replaced; undefined for a new file. */
  readonly replaced: FileSnapshot | undefined;
}

/**
 * `withWrittenFiles` cannot tell that its result equals a full read; the caller resets the store
 * (`recordWrites`). Any other error is a bug and is passed on.
 */
export class StoreFallback extends Error {
  override readonly name = "StoreFallback";
}

const sameSnapshot = (a: FileSnapshot | undefined, b: FileSnapshot | undefined): boolean =>
  a === undefined || b === undefined
    ? a === b
    : a.path === b.path && a.size === b.size && a.mtimeMs === b.mtimeMs && a.sha256 === b.sha256;

/** Whether the walk lists a new file; an error while looking counts as "cannot tell". */
const listedNew = async (
  contents: RepositoryContents,
  layout: WorkspaceLayout,
  file: string,
): Promise<boolean> => {
  if (contents.listing.some((p) => p.severity === "error")) {
    return false;
  }
  try {
    return await listsFile(contents.location, ignoredBy(layout), file);
  } catch {
    return false;
  }
};

/**
 * The store with files as ReqSeq has just written them (#166, ADR-0008), without reading any
 * file: each file's contribution is built from the bytes written and the snapshot of the write,
 * the same way a full read builds it, and patched in (`PatchedMap` in path order: new files are
 * sorted once, so a bulk write of n new files stays O(n log n), #729). The store is patched once
 * for all of them (`patchStore`, #215) and every other record stays the same object. Undefined when
 * the store has every file as written already (the watcher saw them first), so a write is never
 * applied twice; the watcher, in turn, finds the snapshots unchanged when it sees the files.
 * Rejects with `StoreFallback` when the result could differ from `loadElements` on the working
 * tree now, and the caller then resets the store: a store without `repositories` or without the
 * repository; a file the store holds in another state than the one the write replaced (a newer
 * change was seen meanwhile); a new file that the walk would not list under its repository
 * (`listsFile`: ignored, linked, unreadable or nested folders, another spelling), or a repository
 * with folders that cannot be listed.
 */
export const withWrittenFiles = async (
  store: ElementStore,
  layout: WorkspaceLayout,
  written: readonly WrittenFile[],
  source?: VersioningSource,
): Promise<ElementStore | undefined> => {
  const versioning = await versioningFor(store, source);
  const repositories = [...(store.repositories ?? [])];
  /** By index in `repositories`: the files written, with what they contribute now. */
  const changed = new Map<
    number,
    { readonly contents: RepositoryContents; readonly files: Map<string, Contribution> }
  >();
  for (const { repository, file: parsed, replaced } of written) {
    const index = repositories.findIndex((r) => r.repository === repository);
    const contents = repositories[index];
    if (contents === undefined) {
      throw new StoreFallback(`the element store holds no files of repository ${repository}`);
    }
    const files = changed.get(index)?.files ?? new Map<string, Contribution>();
    const file = parsed.path;
    const old = files.get(file) ?? contents.files.get(file);
    if (old !== undefined && sameSnapshot(old.snapshot, parsed.snapshot)) {
      continue;
    }
    if (!sameSnapshot(old?.snapshot, replaced)) {
      throw new StoreFallback(`the element store holds another state of ${file} than the write replaced`);
    }
    if (old === undefined && !(await listedNew(contents, layout, file))) {
      throw new StoreFallback(`a full read may not list ${file} under repository ${repository}`);
    }
    files.set(file, parsedContribution(repository, parsed, versioning));
    changed.set(index, { contents, files });
  }
  if (changed.size === 0) {
    return undefined;
  }
  const touched: Touched[] = [];
  for (const [index, { contents, files }] of changed) {
    const after = { ...contents, files: PatchedMap.patch(contents.files, files, { order: byPath }) };
    repositories[index] = after;
    touched.push({ before: contents, after, files: new Set(files.keys()) });
  }
  return patchStore(store as LoadedStore, repositories, touched, versioning);
};

/**
 * The element store of a workspace, read on first use and kept until reset; through the model
 * cache when the workspace has a cache folder (`WorkspaceOptions.cacheFolder`, SR-082). Reading it again
 * (`workspace.reset(elementStoreState)` or a new `Workspace`) finds every element where it lies
 * now; the watcher and ReqSeq's own writes update it file by file instead (`applyStoreChange`;
 * `updateElements`, SR-007; `recordWrites`, #166). Resetting the workspace layout resets it
 * too.
 *
 * The store may be swapped while a command runs, and so may the states built on it (short IDs,
 * findings), each when it is next read. A command that needs one consistent view reads the store
 * once and derives the rest from that object (`buildShortIds(store.byId, metamodel)`,
 * `duplicateIdFindings(store)`, ...) instead of reading the states one after the other.
 */
export const elementStoreState = defineWorkspaceState(
  "elements",
  async (workspace): Promise<ElementStore> => {
    const layout = await workspace.get(workspaceLayoutState);
    const folder = workspace.cacheFolder;
    // The versions as read (#439) need the metamodel, asked only when files are read and without
    // building its state; the store does not depend on it (none valid: no versions).
    const versioning = workspaceVersioning(workspace, layout);
    return folder === undefined
      ? loadElements(layout, undefined, { versioning })
      : loadThroughCache(workspace, folder, layout, (reuse) =>
          loadElements(layout, undefined, reuse === undefined ? { versioning } : { reuse, versioning }),
        );
  },
  { dependsOn: [workspaceLayoutState] },
);

/** The queue of store changes of a workspace; not reset with the store, so changes stay in order. */
const storeChangesState = defineWorkspaceState("element-store-changes", (): { tail: Promise<unknown> } => ({
  tail: Promise.resolve(),
}));

/**
 * What a change of the element store changed (#184): the files whose element record is not the
 * same object in both stores (changed, new or gone), and the UUIDs of those records before and
 * after. Every other record is the same object in both, as `updateElements` and `withWrittenFiles`
 * keep it, so a state built on the store needs to look again only at these.
 */
export interface StoreUpdate {
  readonly from: ElementStore;
  readonly to: ElementStore;
  /** Each such file, by repository. */
  readonly files: ReadonlyMap<string, ReadonlySet<string>>;
  /** The UUIDs of their records, before and after the change. */
  readonly ids: ReadonlySet<string>;
  /** The repositories of `to`, in store order. */
  readonly repositories: readonly RepositoryContents[];
}

/**
 * The update from `from` to `to`, per repository whose contents are another object: every file
 * whose contribution is another object, found from the touched files alone when `patchStore` made
 * `to` from `from` (#215). Undefined when one of them has no `repositories` or they
 * hold other repositories or the same in another order: then nothing tells which records are the
 * same, and kept problems could not be merged by the index of their repository (`carryProblems`).
 */
export const storeUpdate = (from: ElementStore, to: ElementStore): StoreUpdate | undefined => {
  const pairs = changedContributions(from, to);
  if (pairs === undefined || to.repositories === undefined) {
    return undefined;
  }
  const files = new Map<string, Set<string>>();
  const ids = new Set<string>();
  const note = (result: Contribution | undefined): void => {
    if (result?.kind === "element") {
      const { repository, file, id } = result.element;
      files.set(repository, (files.get(repository) ?? new Set()).add(file));
      ids.add(id);
    }
  };
  for (const [before, after] of pairs) {
    note(before);
    note(after);
  }
  return { from, to, files, ids, repositories: to.repositories };
};

/**
 * Each file's contribution in `from` and in `to` where they are other objects; for a store
 * `patchStore` made from `from`, only its touched files are looked at (#215, O(changed)), else
 * every file of each repository whose contents are another object. Undefined when the stores hold
 * other repositories (see `storeUpdate`).
 */
const changedContributions = (
  from: ElementStore,
  to: ElementStore,
): (readonly [Contribution | undefined, Contribution | undefined])[] | undefined => {
  if (from.repositories === undefined || to.repositories?.length !== from.repositories.length) {
    return undefined;
  }
  const pairs: (readonly [Contribution | undefined, Contribution | undefined])[] = [];
  const compare = (old: RepositoryContents, now: RepositoryContents, files: Iterable<string>): void => {
    for (const file of files) {
      const before = old.files.get(file);
      const after = now.files.get(file);
      if (before !== after) {
        pairs.push([before, after]);
      }
    }
  };
  const patch = patchedFrom.get(to);
  if (patch?.from.deref() === from) {
    for (const { before, after, files } of patch.touched) {
      compare(before, after, files);
    }
    return pairs;
  }
  for (const [i, now] of to.repositories.entries()) {
    // The same repositories in the same order: `carryProblems` merges kept problems by this index.
    const old = from.repositories[i];
    if (old?.repository !== now.repository) {
      return undefined;
    }
    if (old !== now) {
      compare(old, now, old.files.keys());
      compare(
        old,
        now,
        [...now.files.keys()].filter((file) => !old.files.has(file)),
      );
    }
  }
  return pairs;
};

/** The update of the store value `applyStoreChange` is installing, by that value (a Promise), while `replace` runs. */
const updates = new WeakMap<object, StoreUpdate>();

/**
 * A `carry` hook for a state built on the element store (`WorkspaceState.carry`, #184): when
 * `applyStoreChange` replaced the store and knows what changed, `next` gets the state's value and
 * the `StoreUpdate`, and returns the value for the new store (built from the old one by looking
 * again at the changed files only) or undefined to reset it. Any other replace resets the state.
 */
export const carryStoreUpdate =
  <T>(next: (value: T, update: StoreUpdate, workspace: Workspace) => T | undefined) =>
  (value: T, change: StateChange, workspace: Workspace): T | undefined => {
    // The store's value is always a Promise, an object.
    const update = change.key === elementStoreState ? updates.get(change.to as object) : undefined;
    return update === undefined ? undefined : next(value, update, workspace);
  };

const applyNow = async (
  workspace: Workspace,
  change: (store: ElementStore) => Promise<ElementStore | undefined>,
): Promise<ElementStore | undefined> => {
  for (;;) {
    const current = workspace.peek(elementStoreState);
    if (current === undefined) {
      return undefined;
    }
    const before = await current;
    const next = await change(before);
    if (next === undefined) {
      return undefined;
    }
    const value = Promise.resolve(next);
    const update = storeUpdate(before, next);
    if (update !== undefined) {
      updates.set(value, update);
    }
    try {
      if (await workspace.replace(elementStoreState, current, value)) {
        return next;
      }
    } finally {
      // The hooks have run: the update (with the whole store before) is not kept alive any longer.
      updates.delete(value);
    }
    // The store was replaced in between: apply the change to the newer one.
  }
};

/**
 * Changes the element store of `workspace` without reading it again (the watcher, SR-007; ReqSeq's
 * own writes, #166): `change` gets the current store and returns the new one, or undefined for no
 * change. Calls run one after the other per workspace. When the store was replaced while `change`
 * ran, `change` runs again on the newer store; when it was reset (or never read), nothing happens,
 * since the next read finds the files as they are. The states built on the store are carried over
 * the change (`storeUpdate`, `carryStoreUpdate`, #184) or reset. Resolves with the store set, or
 * undefined.
 */
export const applyStoreChange = (
  workspace: Workspace,
  change: (store: ElementStore) => Promise<ElementStore | undefined>,
): Promise<ElementStore | undefined> => {
  const queue = workspace.get(storeChangesState);
  const run = queue.tail.then(() => applyNow(workspace, change));
  queue.tail = run.catch(() => undefined);
  return run;
};

/**
 * Puts files ReqSeq has just written into the element store of `workspace` without reading any
 * file again (#166, ADR-0008): `element.create`, `element.update` and every later command that
 * writes element files call it once with all files of the command. It goes through the queue of
 * `applyStoreChange`, so a save waits behind a watcher batch that is running. The states built on
 * the store (short IDs, findings) are carried over the change or reset (`carryStoreUpdate`, #184).
 * When the result could differ from a full read (`StoreFallback`), or the layout `layout` is no
 * longer the workspace's, the store is reset, so the next read finds the files as written. Other
 * errors are passed on.
 */
export const recordWrites = async (
  workspace: Workspace,
  layout: WorkspaceLayout,
  written: readonly WrittenFile[],
): Promise<void> => {
  try {
    await applyStoreChange(workspace, async (store) => {
      // The layout was read again (the workspace file changed): the store will be read with it.
      if ((await workspace.peek(workspaceLayoutState)) !== layout) {
        throw new StoreFallback("the workspace layout changed since the write");
      }
      return withWrittenFiles(store, layout, written, workspaceVersioning(workspace, layout));
    });
  } catch (error) {
    if (!(error instanceof StoreFallback)) {
      throw error;
    }
    await workspace.reset(elementStoreState);
  }
};

/** The versions as read of each store (`loadedVersionsOf`), built on first use. */
const loadedByStore = new WeakMap<ElementStore, ReadonlyMap<ElementRecord, LoadedVersion>>();

/**
 * The version of each element of `store` as its file was read (#439, `loaded-version.ts`), by
 * record: only those that have one. Empty for a store without `repositories`.
 */
export const loadedVersionsOf = (store: ElementStore): ReadonlyMap<ElementRecord, LoadedVersion> => {
  let loaded = loadedByStore.get(store);
  if (loaded === undefined) {
    const byRecord = new Map<ElementRecord, LoadedVersion>();
    for (const { files } of store.repositories ?? []) {
      for (const result of files.values()) {
        if (result.kind === "element" && result.version !== undefined) {
          byRecord.set(result.element, result.version);
        }
      }
    }
    loaded = byRecord;
    loadedByStore.set(store, loaded);
  }
  return loaded;
};
