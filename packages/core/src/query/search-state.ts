// The search index of a workspace (ADR-0008): built on first use of a store, or taken from the
// cache folder of the copy when it was built from the same file entries (`search-cache.ts`), and
// carried over every change of the store that the watcher or LogReq's own writes make (SR-007 AK2:
// "Suche ... nach höchstens 10 Sekunden aktuell").
//
// Two ways to get it, measured at N-036 (50,000 elements, ADR-0008): building it takes about 7 s in
// slices of 5 ms, so the thread keeps answering; loading `search.json` takes about 1.4 s, of which
// about 1 s blocks the thread (MiniSearch rebuilds its maps in one call; its asynchronous loader
// took about 7 s). A one-shot process that needs the index now (a CLI command) loads the cache and
// writes it after a build. A server (`warmSearchIndex`) builds it in the background once it is
// usable and keeps it current by carrying it: blocking for a second right after it listens would
// delay the answers SR-082 AK1 and AK3 measure, and it never needs the cache again.
//
// A build or carry that no search waits for pauses while a command runs on the workspace
// (`Workspace.busy`), so a command waits for at most one slice; one that a search waits for
// (`searchIndex`) does not pause. A build or carry stops when its workspace is closed or its value
// is no longer the state (a reset of the metamodel or layout), since nobody can read its result.
import { metamodelState } from "../metamodel/index.js";
import { codeFingerprint, queueCacheSave, usableCacheFolder } from "../model/model-cache.js";
import type { StoreUpdate } from "../model/store.js";
import { carryStoreUpdate, elementStoreState } from "../model/store.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { canonicalRoot, workspaceLayoutState } from "../workspace/index.js";
import { readSearchCache, saveSearchCache, searchDigest } from "./search-cache.js";
import type { BuildControl, SearchIndex } from "./search-index.js";
import { SearchBuildCancelled, buildSearchIndex, carrySearchIndex } from "./search-index.js";

/**
 * The most UUIDs a store change may name (`StoreUpdate.ids`) for the index to be carried over it;
 * after a larger one (a checkout) the index of the new store is built again, in slices. A carry
 * reads the changed files and replaces their documents (about 2 s for 1,000 at N-036, with the
 * update of the store); far above this many, a build costs less.
 */
export const SEARCH_CARRY_LIMIT = 10_000;

/** How long a server waits after its warm-up before it starts building the index (`warmSearchIndex`), in ms. */
export const SEARCH_WARM_DELAY_MS = 1000;

/**
 * How often a search asks for the index (`searchIndex`): a build or carry it waited for stops when
 * the state is reset meanwhile (a change of the metamodel or layout, a store read again), and the
 * search then waits for the next one.
 */
export const SEARCH_ATTEMPTS = 5;

/** The workspaces of servers (`warmSearchIndex`): they build the index in the background, without the cache. */
const servers = new WeakSet<Workspace>();

/** One build or carry of the state: whether a search waits for it, and the value it waits for first. */
interface Run {
  wanted: boolean;
  previous: Run | undefined;
}

/** The run of every value of the state. */
const runs = new WeakMap<Promise<SearchIndex>, Run>();

/** Marks `run`, and every run it waits for, as one that a search waits for. */
const want = (run: Run | undefined): void => {
  for (let at = run; at !== undefined; at = at.previous) {
    at.wanted = true;
  }
};

/** Whether `run` is the state of `workspace`, or one the state waits for. */
const live = (workspace: Workspace, run: Run): boolean => {
  const value = workspace.peek(searchIndexState);
  for (let at = value === undefined ? undefined : runs.get(value); at !== undefined; at = at.previous) {
    if (at === run) {
      return true;
    }
  }
  return false;
};

/** The value of `start`, a build or carry for `workspace` after `previous`, with its run (see the file comment). */
const tracked = (
  workspace: Workspace,
  previous: Promise<SearchIndex> | undefined,
  start: (control: BuildControl, run: Run) => Promise<SearchIndex>,
): Promise<SearchIndex> => {
  const run: Run = { wanted: false, previous: previous === undefined ? undefined : runs.get(previous) };
  const control: BuildControl = {
    cancelled: () => workspace.closed || !live(workspace, run),
    paused: () => !run.wanted && workspace.busy,
  };
  const value = start(control, run);
  runs.set(value, run);
  return value;
};

/** The index of `update.to` from `index`: carried, or built again after a large change (the `carry` hook). */
export const nextSearchIndex = async (
  index: SearchIndex,
  update: StoreUpdate,
  control: BuildControl = {},
): Promise<SearchIndex> =>
  update.ids.size <= SEARCH_CARRY_LIMIT
    ? carrySearchIndex(index, update, control)
    : (await buildSearchIndex(update.to, index.layout, index.metamodel, control)).index;

/** Builds the index of the workspace's store, or takes it from the cache (see the file comment). */
const createSearchIndex = async (workspace: Workspace, control: BuildControl): Promise<SearchIndex> => {
  const [store, layout, metamodel] = await Promise.all([
    workspace.get(elementStoreState),
    workspace.get(workspaceLayoutState),
    workspace.get(metamodelState),
  ]);
  const folder = servers.has(workspace) ? undefined : usableCacheFolder(workspace, layout);
  if (folder === undefined) {
    return (await buildSearchIndex(store, layout, metamodel, control)).index;
  }
  const expected = {
    code: codeFingerprint(),
    root: canonicalRoot(workspace.root),
    digest: searchDigest(store, metamodel),
  };
  const cached = await readSearchCache(folder, expected, store, layout, metamodel);
  if (cached !== undefined) {
    return cached;
  }
  const built = await buildSearchIndex(store, layout, metamodel, control);
  if (built.exact) {
    queueCacheSave(workspace, () => saveSearchCache(folder, expected, built.index));
  }
  return built.index;
};

/**
 * The search index of a workspace's element store (`SearchIndex`), with the metamodel it was built
 * with: a change of the metamodel or of the layout resets it. Carried over a change of the store
 * (`carrySearchIndex`, one carry after the other: each waits for the index before it), or built
 * again after a change of more than `SEARCH_CARRY_LIMIT` UUIDs. A store replaced any other way (a
 * reset, a full read) resets it. See the file comment for pauses and stops. Only for this block and
 * its tests: a command reads it through `searchIndex`, which marks the build as wanted.
 */
export const searchIndexState = defineWorkspaceState(
  "search-index",
  (workspace: Workspace) => tracked(workspace, undefined, (control) => createSearchIndex(workspace, control)),
  {
    dependsOn: [elementStoreState, metamodelState],
    carry: carryStoreUpdate((value, update, workspace) =>
      tracked(workspace, value, (control, run) =>
        value.then((index) => {
          run.previous = undefined;
          return nextSearchIndex(index, update, control);
        }),
      ),
    ),
  },
);

/**
 * The search index of `workspace`'s current store (`searchIndexState`) for a search: waits for a
 * build or carry that runs, which no longer pauses for commands. When that one stops because the
 * state was reset meanwhile (`SearchBuildCancelled`), it waits for the next one, at most `attempts`
 * times in all, while the workspace is open; other errors are passed on.
 */
export const searchIndex = async (workspace: Workspace, attempts = SEARCH_ATTEMPTS): Promise<SearchIndex> => {
  for (let attempt = 1; ; attempt += 1) {
    const value = workspace.get(searchIndexState);
    want(runs.get(value));
    try {
      return await value;
    } catch (error) {
      if (!(error instanceof SearchBuildCancelled) || workspace.closed || attempt >= attempts) {
        throw error;
      }
    }
  }
};

/**
 * Starts the search index of `workspace` for a server (`warmWorkspace`): built in the background
 * `delayMs` after `after` settled (the warm-up of the model), in slices that pause while a command
 * runs, without the cache (see the file comment); a search waits for it. The workspace counts as a
 * server at once, so a search during the warm-up builds without the cache too. Never throws; a build
 * that fails is reported by the first search. The timer does not keep the process alive.
 */
export const warmSearchIndex = (
  workspace: Workspace,
  delayMs = SEARCH_WARM_DELAY_MS,
  after: Promise<unknown> = Promise.resolve(),
): void => {
  servers.add(workspace);
  const start = (): void => {
    if (!workspace.closed) {
      workspace.get(searchIndexState).catch(() => undefined);
    }
  };
  const later = (): void => {
    setTimeout(start, delayMs).unref();
  };
  after.then(later, later);
};
