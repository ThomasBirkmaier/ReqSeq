// Files changed outside the tool (SR-007, ADR-0008): a watcher on every available repository folder
// keeps the element store of an open workspace current while a long-running process (API, MCP
// server, app) keeps it open. It only reads: no file is written and no process is spawned.
//
// macOS and Windows: one `node:fs` `watch` with `recursive` per repository (FSEvents,
// ReadDirectoryChangesW). Linux: one plain watch per folder (`FolderTree`), because Node emulates
// `recursive` there with one watch per file and loses a file once it was replaced by a rename.
// Events are collected in batches, 100 ms after the last one and at most 1 s after the first, so a
// pull with 1,000 changed files is one or a few updates (SR-007 AK2). Per batch:
// - the workspace file or `.logreq/local.yaml` changed: the layout is reset (and with it the
//   metamodel, the store and all state built on them) and the new repositories are watched;
// - a path in the metamodel folder changed: the metamodel is reset (SR-015);
// - element paths changed: the store is updated file by file (`updateElements`, hashes compared)
//   and replaced (`applyStoreChange`), which resets the state built on it (short IDs, findings). A
//   store nobody has read yet is left alone: the next read finds the files as they are.
// An update that fails resets the store, so the next command reads it in full.
//
// An event without a file name means the OS dropped the names of a burst: ReadDirectoryChangesW
// (Windows) overflows its buffer of about 4 KB on a pull of a few hundred files, and libuv then
// reports one change without a name, nothing else. Every repository below the watched folder is
// then checked file by file (size and mtime), the metamodel is read again when its folder lies
// there, and the layout is read once and compared, so a pull that also changed the workspace file
// is not missed (SR-007 AK2).
import type { FSWatcher } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import type { Problem } from "../catalog.js";
import { isTempFile } from "../files/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import {
  LOCAL_FILE,
  WORKSPACE_FILE,
  availableRepositories,
  loadWorkspaceLayout,
  workspaceLayoutState,
} from "../workspace/index.js";
import { ELEMENT_FILE_EXTENSION } from "./discover.js";
import type { RepositoryChanges } from "./store.js";
import { applyStoreChange, elementStoreState, ignoredBy, updateElements } from "./store.js";
import type { WatchFunction } from "./watch-tree.js";
import { FolderTree } from "./watch-tree.js";

export type { WatchFunction } from "./watch-tree.js";

export interface WatcherOptions {
  readonly watch?: WatchFunction;
  /**
   * One recursive watch per repository (macOS, Windows), or one watch per folder (Linux, where
   * Node's recursive watch loses replaced files). Default: by platform.
   */
  readonly recursive?: boolean;
  /** Quiet time after the last event before a batch runs (ADR-0008: 100 ms). */
  readonly debounceMs?: number;
  /** Longest wait after the first event of a batch, so a steady stream of events is still processed. */
  readonly maxWaitMs?: number;
}

/** The watcher of an open workspace (`watchWorkspace`). It stops when the workspace is closed. */
export interface WorkspaceWatcher {
  /** Resolves when the folders are watched (or could not be: commands then read files as before). */
  readonly ready: Promise<void>;
  /**
   * Folders that cannot be watched (`workspace.not-watched`, e.g. the OS limit of watches):
   * changes there are not seen until LogReq restarts or the layout changes. `workspace.status`
   * shows them.
   */
  readonly problems: readonly Problem[];
  /** Resolves once no batch is waiting or running. */
  settled(): Promise<void>;
}

const DEBOUNCE_MS = 100;
const MAX_WAIT_MS = 1000;

/** Folders whose content never counts (as in the element walk, discover.ts). */
const SKIPPED_NAMES = new Set([".git", "node_modules"]);

const defaultWatch: WatchFunction = (folder, options, listener) =>
  fs.watch(folder, { recursive: options.recursive, persistent: false }, listener);

/** `child` relative to `parent` with `/`, or undefined when it is not inside (or is `parent` itself). */
const inside = (parent: string, child: string): string | undefined => {
  const relative = path.relative(parent, child);
  return relative === "" || relative.startsWith("..") || path.isAbsolute(relative)
    ? undefined
    : relative.split(path.sep).join("/");
};

/** Whether `absolute` is `folder` or lies below it; false without a folder. */
const within = (folder: string | undefined, absolute: string): boolean =>
  folder !== undefined && (absolute === folder || inside(folder, absolute) !== undefined);

// The metamodel folder is the repository's real path joined with `location.path` as typed in the
// workspace file; event and walk paths are spelled as the file system gives them. So both are
// compared in Unicode NFC (#225): on macOS an NFD folder typed in NFC is the same folder. Where a
// file system keeps the normal forms apart, this only errs towards an extra reset or watch.

/** Whether the metamodel folder is `absolute` or lies below it, compared in NFC. */
const holdsMetamodel = (absolute: string, metamodel: string | undefined): boolean =>
  metamodel !== undefined && within(absolute.normalize("NFC"), metamodel.normalize("NFC"));

/** Whether `absolute` is the metamodel folder or lies below it, compared in NFC. */
const inMetamodel = (metamodel: string | undefined, absolute: string): boolean =>
  within(metamodel?.normalize("NFC"), absolute.normalize("NFC"));

const atOrBelow = (relative: string, folder: string): boolean =>
  relative === folder || relative.startsWith(`${folder}/`);

const hasSkippedName = (relative: string): boolean => relative.split("/").some((n) => SKIPPED_NAMES.has(n));

/** Whether a changed repository path can change the store: not in `.git` or `node_modules`, not a temp file. */
const counts = (relative: string): boolean =>
  !hasSkippedName(relative) && !isTempFile(path.posix.basename(relative));

/**
 * Whether a path that does not end in `.md` can change the store: a folder (created, moved) or a
 * path that is gone (a deleted folder). Other files (build output, images) are left out, so they
 * cost no walk.
 */
const mayHoldElements = async (folder: string, relative: string): Promise<boolean> => {
  if (relative.toLowerCase().endsWith(ELEMENT_FILE_EXTENSION)) {
    return true;
  }
  try {
    return (await fs.promises.lstat(path.join(folder, relative))).isDirectory();
  } catch {
    return true;
  }
};

/**
 * The folders of a repository that a per-folder watch leaves out: `.git`, `node_modules`, the
 * folders of other repositories of the workspace nested in it, and those of the `ignore` globs,
 * unless the metamodel lies in them.
 */
const skipIn = (layout: WorkspaceLayout, repository: RepositoryLocation): ((relative: string) => boolean) => {
  const ignored = ignoredBy(layout);
  const excludes = new Set(repository.excludes);
  return (relative) => {
    const absolute = path.join(repository.folder, relative);
    return (
      hasSkippedName(relative) ||
      excludes.has(absolute) ||
      (ignored(relative) && !holdsMetamodel(absolute, layout.metamodel.folder))
    );
  };
};

const notWatched = (repository: string, folder: string, code: string): Problem => ({
  code: "workspace.not-watched",
  severity: "warning",
  repository,
  file: folder === "" ? "." : folder,
  message:
    code === "ENOSPC"
      ? "Changes in this folder are not seen until LogReq restarts or the layout changes: the operating system's limit of watched folders is reached (ENOSPC; on Linux raise fs.inotify.max_user_watches)"
      : `Changes in this folder are not seen until LogReq restarts or the layout changes: it cannot be watched (${code})`,
});

const errorCode = (error: unknown): string => String((error as NodeJS.ErrnoException).code);

/** Changed element paths, seen by the watcher of one layout. */
interface ElementChanges {
  readonly layout: WorkspaceLayout;
  /** Changed paths per repository name; `null` when every file has to be checked. */
  readonly repositories: Map<string, Set<string> | null>;
}

interface Batch {
  layout: boolean;
  /** The OS dropped names in the main repository: the layout is read and compared (an overflow). */
  checkLayout: boolean;
  metamodel: boolean;
  elements: ElementChanges | undefined;
}

const emptyBatch = (): Batch => ({
  layout: false,
  checkLayout: false,
  metamodel: false,
  elements: undefined,
});

/** The element changes of a batch for `layout`; changes sorted with another layout are dropped. */
const elementChanges = (batch: Batch, layout: WorkspaceLayout): Map<string, Set<string> | null> => {
  if (batch.elements?.layout !== layout) {
    batch.elements = { layout, repositories: new Map() };
  }
  return batch.elements.repositories;
};

/** Whether a path relative to the main repository is the workspace file or in `.logreq` (the local file). */
const isWorkspaceFile = (relative: string | undefined): boolean =>
  relative !== undefined &&
  (relative === WORKSPACE_FILE || atOrBelow(relative, path.posix.dirname(LOCAL_FILE)));

class Watcher implements WorkspaceWatcher {
  ready: Promise<void>;
  readonly #workspace: Workspace;
  readonly #watch: WatchFunction;
  readonly #recursive: boolean;
  readonly #debounceMs: number;
  readonly #maxWaitMs: number;
  readonly #abort = new AbortController();
  #handles: Pick<FSWatcher, "close">[] = [];
  #trees: FolderTree[] = [];
  #problems: Problem[] = [];
  /** The layout being watched, as the workspace state holds it, and once read. */
  #layout: Promise<WorkspaceLayout> | undefined;
  #watched: WorkspaceLayout | undefined;
  #batch = emptyBatch();
  #timer: NodeJS.Timeout | undefined;
  #firstEvent = 0;
  /** The batches run one after the other on this chain. */
  #tail: Promise<void> = Promise.resolve();
  /** Batches waiting or running, and who waits for none to be left. */
  #work = 0;
  readonly #waiters: (() => void)[] = [];
  #closed = false;
  /** Counts the starts; a start that is no longer the last one stops. */
  #generation = 0;

  constructor(workspace: Workspace, options: WatcherOptions) {
    this.#workspace = workspace;
    this.#watch = options.watch ?? defaultWatch;
    this.#recursive = options.recursive ?? process.platform !== "linux";
    this.#debounceMs = options.debounceMs ?? DEBOUNCE_MS;
    this.#maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
    this.ready = this.#start();
  }

  get problems(): readonly Problem[] {
    return this.#problems;
  }

  async settled(): Promise<void> {
    await Promise.all(this.#trees.map((t) => t.settled()));
    if (this.#work > 0) {
      await new Promise<void>((resolve) => {
        this.#waiters.push(resolve);
      });
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#abort.abort();
    if (this.#timer !== undefined) {
      // The waiting batch never runs.
      clearTimeout(this.#timer);
      this.#timer = undefined;
      this.#done();
    }
    this.#closeHandles();
    await this.#tail;
  }

  /** One batch less; wakes `settled` callers when none is left. */
  #done(): void {
    this.#work -= 1;
    if (this.#work === 0) {
      for (const resolve of this.#waiters.splice(0)) {
        resolve();
      }
    }
  }

  #closeHandles(): void {
    for (const closable of [...this.#handles, ...this.#trees]) {
      closable.close();
    }
    this.#handles = [];
    this.#trees = [];
    this.#problems = [];
    this.#watched = undefined;
  }

  /** Reads the layout and watches its repositories; without a layout, the root for the workspace file. */
  async #start(): Promise<void> {
    // The old watches go first: no event is sorted with a layout that is no longer the workspace's.
    this.#generation += 1;
    const generation = this.#generation;
    this.#closeHandles();
    this.#batch.elements = undefined;
    let layout: WorkspaceLayout | undefined;
    try {
      this.#layout = this.#workspace.get(workspaceLayoutState);
      layout = await this.#layout;
    } catch {
      layout = undefined;
    }
    if (!this.#current(generation)) {
      return;
    }
    if (layout === undefined) {
      // No workspace (yet): wait for its file, but never watch an arbitrary folder tree.
      this.#open(this.#workspace.root, false, undefined, (name) => {
        if (name === null || isWorkspaceFile(name)) {
          this.#mark((b) => (b.layout = true));
        }
      });
      return;
    }
    const watched = layout;
    this.#watched = layout;
    const repositories = availableRepositories(layout);
    for (const repository of repositories) {
      // A watcher closed, or started again, meanwhile watches nothing more from this start.
      if (!this.#current(generation)) {
        return;
      }
      const onName = (name: string | null): void => {
        this.#onEvent(watched, repository.folder, name);
      };
      if (!this.#recursive) {
        // Every repository has its own tree; a nested one is left out of the outer tree (`excludes`).
        const tree = new FolderTree(repository.folder, {
          watch: this.#watch,
          skip: skipIn(layout, repository),
          onEvent: onName,
          onUnwatchable: (folder, code) => {
            this.#report(notWatched(repository.name, folder, code));
          },
          // A repository folder that is gone: read the layout again (as a broken recursive watch).
          onGone: () => {
            this.#mark((b) => (b.layout = true));
          },
        });
        this.#trees.push(tree);
        await tree.start();
      } else if (
        !repositories.some((r) => r !== repository && inside(r.folder, repository.folder) !== undefined)
      ) {
        // A repository inside another watched one is seen by that watcher.
        this.#open(repository.folder, true, repository.name, onName);
      }
    }
  }

  /** Whether the start of `generation` is the last one and the watcher is open. */
  #current(generation: number): boolean {
    return !this.#closed && generation === this.#generation;
  }

  /** Adds a problem once per repository and folder. */
  #report(problem: Problem): void {
    if (!this.#problems.some((p) => p.repository === problem.repository && p.file === problem.file)) {
      this.#problems.push(problem);
    }
  }

  /** Watches one folder; a folder that cannot be watched is reported (commands still read files). */
  #open(
    folder: string,
    recursive: boolean,
    repository: string | undefined,
    onName: (name: string | null) => void,
  ): void {
    try {
      const handle = this.#watch(folder, { recursive }, (_event, fileName) => {
        onName(fileName === null ? null : fileName.split(path.sep).join("/"));
      });
      // A recursive watch that breaks (its folder removed): read the layout again and watch anew.
      handle.on("error", () => {
        this.#mark((b) => (b.layout = true));
      });
      this.#handles.push(handle);
    } catch (error) {
      if (repository !== undefined) {
        this.#report(notWatched(repository, "", errorCode(error)));
      }
    }
  }

  /** Sorts one event of a repository watcher into the batch. */
  #onEvent(layout: WorkspaceLayout, folder: string, name: string | null): void {
    // An event of a watch whose layout is no longer watched (its start was superseded) is dropped.
    if (layout !== this.#watched) {
      return;
    }
    const repositories = availableRepositories(layout);
    if (name === null) {
      // The OS dropped the names (an overflow): anything below this folder may have changed.
      this.#mark((b) => {
        const changes = elementChanges(b, layout);
        for (const r of repositories.filter((r) => within(folder, r.folder))) {
          changes.set(r.name, null);
        }
        if (holdsMetamodel(folder, layout.metamodel.folder)) {
          b.metamodel = true;
        }
        // The repository folders are real paths; the root is the path the workspace was opened with.
        if (repositories.some((r) => r.main && within(folder, r.folder))) {
          b.checkLayout = true;
        }
      });
      return;
    }
    const absolute = path.join(folder, name);
    if (layout.repositories.some((r) => r.main && isWorkspaceFile(inside(r.folder, absolute)))) {
      this.#mark((b) => (b.layout = true));
      return;
    }
    if (inMetamodel(layout.metamodel.folder, absolute)) {
      this.#mark((b) => (b.metamodel = true));
    }
    // The innermost repository holds the file (a nested repository is read under its own name).
    let owner: { readonly repository: RepositoryLocation; readonly relative: string } | undefined;
    for (const repository of repositories) {
      const relative = inside(repository.folder, absolute);
      if (relative !== undefined && (owner === undefined || owner.relative.length > relative.length)) {
        owner = { repository, relative };
      }
    }
    if (owner !== undefined && counts(owner.relative)) {
      const { repository, relative } = owner;
      this.#mark((b) => {
        const repositories = elementChanges(b, layout);
        const paths = repositories.get(repository.name);
        if (paths === undefined) {
          repositories.set(repository.name, new Set([relative]));
        } else if (paths !== null) {
          paths.add(relative);
        }
      });
    }
  }

  /** Adds to the waiting batch and (re)starts its timer. */
  #mark(change: (batch: Batch) => void): void {
    if (this.#closed) {
      return;
    }
    change(this.#batch);
    const now = Date.now();
    if (this.#timer === undefined) {
      this.#firstEvent = now;
      this.#work += 1;
    }
    clearTimeout(this.#timer);
    const wait = Math.min(this.#debounceMs, this.#firstEvent + this.#maxWaitMs - now);
    this.#timer = setTimeout(
      () => {
        this.#flush();
      },
      Math.max(0, wait),
    );
  }

  #flush(): void {
    const batch = this.#batch;
    this.#batch = emptyBatch();
    this.#timer = undefined;
    this.#tail = this.#tail.then(async () => {
      await this.#process(batch);
      this.#done();
    });
  }

  async #process(batch: Batch): Promise<void> {
    if (this.#closed) {
      return;
    }
    try {
      if (
        batch.layout ||
        this.#workspace.peek(workspaceLayoutState) !== this.#layout ||
        (batch.checkLayout && (await this.#layoutChanged()))
      ) {
        await this.#workspace.reset(workspaceLayoutState);
        await this.#start();
        return;
      }
      if (batch.metamodel) {
        await this.#workspace.reset(metamodelState);
      }
      await this.#update(batch.elements);
    } catch {
      if (!this.#abort.signal.aborted) {
        // Whatever went wrong, the next command reads the files in full. A failing disposal of
        // dependent state is that state's to report; the watcher goes on.
        await this.#workspace.reset(elementStoreState).catch(() => undefined);
      }
    }
  }

  /** Whether the workspace and local files now give another layout than the watched one. */
  async #layoutChanged(): Promise<boolean> {
    const watched = this.#watched;
    try {
      return JSON.stringify(await loadWorkspaceLayout(this.#workspace.root)) !== JSON.stringify(watched);
    } catch {
      // A workspace file that no longer reads: the layout state reports why.
      return true;
    }
  }

  async #update(elements: ElementChanges | undefined): Promise<void> {
    // Events sorted with an older layout are dropped: the store was read again with the new one.
    if (
      elements === undefined ||
      elements.layout !== this.#watched ||
      this.#workspace.peek(elementStoreState) === undefined
    ) {
      return;
    }
    const { layout, repositories } = elements;
    const changes = new Map<string, RepositoryChanges>();
    for (const repository of availableRepositories(layout)) {
      const paths = repositories.get(repository.name);
      if (paths === null) {
        changes.set(repository.name, { paths: [], all: true });
      } else if (paths !== undefined) {
        const relevant: string[] = [];
        for (const relative of paths) {
          if (await mayHoldElements(repository.folder, relative)) {
            relevant.push(relative);
          }
        }
        if (relevant.length > 0) {
          changes.set(repository.name, { paths: relevant });
        }
      }
    }
    if (changes.size === 0) {
      return;
    }
    const signal = this.#abort.signal;
    await applyStoreChange(this.#workspace, async (store) => {
      const next = await updateElements(store, layout, changes, signal);
      // A watcher closed during the update replaces nothing.
      signal.throwIfAborted();
      return next;
    });
  }
}

/** Starts a watcher on `workspace`; `close()` stops it. Prefer `watchWorkspace`, which closes with the workspace. */
export const startWatcher = (
  workspace: Workspace,
  options: WatcherOptions = {},
): WorkspaceWatcher & { close(): Promise<void> } => new Watcher(workspace, options);

const watcherState = defineWorkspaceState("watcher", (workspace) => startWatcher(workspace), {
  dispose: (watcher) => watcher.close(),
});

/**
 * Keeps `workspace` current with the files while it is open (SR-007): the API and MCP servers
 * call it once after opening their workspace; closing the workspace stops the watcher. Calling it
 * again returns the same watcher. One-shot CLI commands read a fresh workspace and need none.
 */
export const watchWorkspace = (workspace: Workspace): WorkspaceWatcher => workspace.get(watcherState);

/** The folders the watcher of `workspace` cannot watch, for `workspace.status`; none without a watcher. */
export const watcherProblems = (workspace: Workspace): readonly Problem[] => {
  const watcher = workspace.peek(watcherState);
  return watcher === undefined ? [] : watcher.problems;
};
