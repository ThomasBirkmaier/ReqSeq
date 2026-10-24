// The element store (ADR-0008): every element file of every available repository of the workspace,
// found by its frontmatter in whatever folder it lies (SR-003, SR-004 AK1, D-056). Relations name
// their target by UUID only, so moving a file to another folder changes nothing for them (SR-003 AK3).
// The watcher keeps it current file by file (`updateElements`, SR-007).
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import type { FileSnapshot } from "../files/index.js";
import { readElementFile } from "../files/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { availableRepositories, workspaceLayoutState } from "../workspace/index.js";
import { listMarkdownFiles } from "./discover.js";
import type { ElementRecord } from "./elements.js";
import { classifyFile } from "./elements.js";
import { ignoreMatcher } from "./ignore.js";

/** A file of a repository of the workspace. */
export interface RepositoryFile {
  /** Workspace name of the repository. */
  readonly repository: string;
  /** Relative to the repository, `/` as separator. */
  readonly file: string;
}

/** What one Markdown file contributes to the store; small, so no parsed `Document` is held (ADR-0008). */
export type Contribution = (
  | { readonly kind: "element"; readonly element: ElementRecord }
  | { readonly kind: "not-element"; readonly file: string }
  /** A faulty file, or one that parsed but has an invalid `id` or `type`. */
  | { readonly kind: "problem"; readonly problem: Problem }
) & {
  /** YAML warnings of a file that parsed; they come before its problem. */
  readonly warnings: readonly Problem[];
  /** The bytes read, when the file parsed; the watcher compares their hash (SR-007). */
  readonly snapshot?: FileSnapshot;
};

/** What one available repository contributes; the watcher updates it file by file (SR-007). */
export interface RepositoryContents {
  /** Workspace name of the repository. */
  readonly repository: string;
  /** Where it was read, from the layout of the store. */
  readonly location: RepositoryLocation;
  /** Folders that cannot be listed and Markdown files that are not read, sorted by path. */
  readonly listing: readonly Problem[];
  /** Every listed Markdown file in path order (code units), with what it contributed. */
  readonly files: ReadonlyMap<string, Contribution>;
}

export interface ElementStore {
  /** All elements, by repository in the order of the workspace file, then by file path (code units). */
  readonly elements: readonly ElementRecord[];
  /**
   * Elements by UUID, in the order of `elements`. More than one record when files share a UUID
   * (a copied file); reporting that is SR-088.
   */
  readonly byId: ReadonlyMap<string, readonly ElementRecord[]>;
  /** Markdown files that are not elements (SR-003 AK2). LogReq never writes them. */
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
}

/** Files read at the same time; bounded so 50,000 files do not exhaust file handles (N-036). */
const READ_CONCURRENCY = 32;

const withRepository = (problem: Problem, repository: string): Problem => ({ ...problem, repository });

/** Reads and classifies one file at once, so that its YAML `Document` is dropped right after. */
const contribution = async (repository: RepositoryLocation, file: string): Promise<Contribution> => {
  const read = await readElementFile(repository.folder, file);
  if (read.kind === "problem") {
    return { kind: "problem", problem: withRepository(read.problem, repository.name), warnings: [] };
  }
  if (read.kind === "no-frontmatter") {
    return { kind: "not-element", file: read.path, warnings: [] };
  }
  const { snapshot } = read.file;
  const warnings = read.file.warnings.map((w) => withRepository(w, repository.name));
  const classified = classifyFile(repository.name, read.file);
  switch (classified.kind) {
    case "element":
      return { kind: "element", element: classified.element, warnings, snapshot };
    case "not-element":
      return { kind: "not-element", file: read.file.path, warnings, snapshot };
    case "problem":
      return { kind: "problem", problem: classified.problem, warnings, snapshot };
  }
};

/**
 * Reads `files` of a repository with bounded parallelism, by path. With `signal` aborted no
 * further file is read and the call rejects with its reason.
 */
const readRepository = async (
  repository: RepositoryLocation,
  files: readonly string[],
  signal: AbortSignal | undefined,
): Promise<ReadonlyMap<string, Contribution>> => {
  const results = new Map<string, Contribution>();
  // One shared iterator: each worker takes the next file until none are left.
  const queue = files.values();
  const worker = async (): Promise<void> => {
    for (const file of queue) {
      signal?.throwIfAborted();
      results.set(file, await contribution(repository, file));
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, worker));
  return results;
};

/** The store fields from the contents of the repositories, in their order. */
const assemble = (repositories: readonly RepositoryContents[]): ElementStore => {
  const elements: ElementRecord[] = [];
  const nonElements: RepositoryFile[] = [];
  const problems: Problem[] = [];
  for (const { repository, listing, files } of repositories) {
    problems.push(...listing);
    for (const result of files.values()) {
      problems.push(...result.warnings);
      if (result.kind === "problem") {
        problems.push(result.problem);
      } else if (result.kind === "element") {
        elements.push(result.element);
      } else {
        nonElements.push({ repository, file: result.file });
      }
    }
  }
  const byId = new Map<string, ElementRecord[]>();
  for (const element of elements) {
    const same = byId.get(element.id);
    if (same === undefined) {
      byId.set(element.id, [element]);
    } else {
      same.push(element);
    }
  }
  return { elements, byId, nonElements, problems, repositories };
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
  const entries = [...kept, ...fresh].sort(([a], [b]) => Number(a > b) - Number(a < b));
  return new Map(entries);
};

/** Reads every listed Markdown file of one repository. */
const readContents = async (
  repository: RepositoryLocation,
  ignored: (relativePath: string) => boolean,
  signal: AbortSignal | undefined,
): Promise<RepositoryContents> => {
  const listed = await listMarkdownFiles(repository, ignored);
  const read = await readRepository(repository, listed.files, signal);
  return {
    repository: repository.name,
    location: repository,
    listing: listed.problems,
    files: inListOrder(listed.files, read),
  };
};

/** The `ignore` globs of the workspace file as a test (the element walk and the watcher). */
export const ignoredBy = (layout: WorkspaceLayout): ((relativePath: string) => boolean) =>
  ignoreMatcher(layout.file.ignore ?? []);

/**
 * Reads the element files of every available repository of `layout` (a missing one is skipped,
 * SR-004 AK3). One folder walk per repository and bounded parallel reads, each file classified as
 * soon as it is read; no call of the version control program (N-036).
 */
export const loadElements = async (layout: WorkspaceLayout, signal?: AbortSignal): Promise<ElementStore> => {
  const ignored = ignoredBy(layout);
  const repositories: RepositoryContents[] = [];
  for (const repository of availableRepositories(layout)) {
    repositories.push(await readContents(repository, ignored, signal));
  }
  return assemble(repositories);
};

/** What changed in one repository, as the watcher saw it (SR-007). */
export interface RepositoryChanges {
  /**
   * Paths relative to the repository (`/` as separator) of files or folders that were created,
   * changed, renamed or deleted. Every listed file at or below such a path is checked again.
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

/** One repository after `changes`, or `before` itself when nothing it contributes changed. */
const updateContents = async (
  before: RepositoryContents,
  changes: RepositoryChanges,
  ignored: (relativePath: string) => boolean,
  signal: AbortSignal | undefined,
): Promise<RepositoryContents> => {
  const repository = before.location;
  // One walk again: it sees new, moved and deleted files and folders and applies every rule of the
  // full read (ignore globs, nested repositories, links) without reading a file (N-036).
  const listed = await listMarkdownFiles(repository, ignored);
  const named = new Set(changes.paths);
  const check: string[] = [];
  for (const file of listed.files) {
    const old = before.files.get(file);
    const touched = changes.all === true || atOrBelow(file, named);
    if (
      old === undefined ||
      named.has(file) ||
      (touched && (await statChanged(repository.folder, file, old)))
    ) {
      check.push(file);
    }
  }
  const read = await readRepository(repository, check, signal);
  // A file deleted between the walk and its read is gone, not unreadable.
  const gone = new Set<string>();
  for (const [file, now] of read) {
    if (
      now.kind === "problem" &&
      now.problem.code === "file.unreadable" &&
      !(await exists(path.join(repository.folder, file)))
    ) {
      gone.add(file);
    }
  }
  const files = listed.files.filter((file) => !gone.has(file));
  const fresh = new Map(
    [...read].filter(([file, now]) => {
      const old = before.files.get(file);
      return !gone.has(file) && (old === undefined || !same(old, now));
    }),
  );
  const unchanged =
    fresh.size === 0 &&
    files.length === before.files.size &&
    JSON.stringify(listed.problems) === JSON.stringify(before.listing);
  return unchanged
    ? before
    : {
        repository: repository.name,
        location: repository,
        listing: listed.problems,
        files: inListOrder(files, fresh, before.files),
      };
};

/**
 * The store after files changed outside the tool (SR-007): for each repository with changes its
 * Markdown files are listed again (one walk, no reads), files that are gone are dropped, new files
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
): Promise<ElementStore | undefined> => {
  const before = store.repositories;
  if (
    before === undefined ||
    JSON.stringify(availableRepositories(layout)) !== JSON.stringify(before.map((r) => r.location))
  ) {
    return loadElements(layout, signal);
  }
  const ignored = ignoredBy(layout);
  const repositories: RepositoryContents[] = [];
  for (const old of before) {
    const change = changes.get(old.repository);
    repositories.push(change === undefined ? old : await updateContents(old, change, ignored, signal));
  }
  return repositories.every((r, i) => r === before[i]) ? undefined : assemble(repositories);
};

/**
 * The element store of a workspace, read on first use and kept until reset. Reading it again
 * (`workspace.reset(elementStoreState)` or a new `Workspace`) finds every element where it lies
 * now; the watcher updates it file by file instead (`applyStoreChange`, SR-007). Resetting the
 * workspace layout resets it too.
 *
 * The store may be swapped while a command runs, and so may the states built on it (short IDs,
 * findings), each when it is next read. A command that needs one consistent view reads the store
 * once and derives the rest from that object (`buildShortIds(store.byId, metamodel)`,
 * `duplicateIdFindings(store)`, ...) instead of reading the states one after the other.
 */
export const elementStoreState = defineWorkspaceState(
  "elements",
  async (workspace): Promise<ElementStore> => loadElements(await workspace.get(workspaceLayoutState)),
  { dependsOn: [workspaceLayoutState] },
);

/** The queue of store changes of a workspace; not reset with the store, so changes stay in order. */
const storeChangesState = defineWorkspaceState("element-store-changes", (): { tail: Promise<unknown> } => ({
  tail: Promise.resolve(),
}));

const applyNow = async (
  workspace: Workspace,
  change: (store: ElementStore) => Promise<ElementStore | undefined>,
): Promise<ElementStore | undefined> => {
  for (;;) {
    const current = workspace.peek(elementStoreState);
    if (current === undefined) {
      return undefined;
    }
    const next = await change(await current);
    if (next === undefined) {
      return undefined;
    }
    if (await workspace.replace(elementStoreState, current, Promise.resolve(next))) {
      return next;
    }
    // The store was replaced in between: apply the change to the newer one.
  }
};

/**
 * Changes the element store of `workspace` without reading it again (the watcher, SR-007; writing
 * commands later): `change` gets the current store and returns the new one, or undefined for no
 * change. Calls run one after the other per workspace. When the store was replaced while `change`
 * ran, `change` runs again on the newer store; when it was reset (or never read), nothing happens,
 * since the next read finds the files as they are. Resolves with the store set, or undefined.
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
