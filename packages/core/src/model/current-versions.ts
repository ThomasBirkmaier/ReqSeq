// The current version of every element (ADR-0005, ADR-0008, #259): what SR-025 compares the stored
// versions of relations and inline references with, and later the element hints (SR-026), the
// check of a merge request (SR-092) and the evidence status (SR-031). The store keeps no text, so
// the version of an element needs its file again, and the images its text embeds.
//
// - Built once per element store, on first use, in the calling thread: each file is read again with
//   blocking calls (`readElementBodySync`), the YAML is not parsed again when the bytes are those
//   of the store's snapshot, and the images are looked up only for a text that embeds one. Slices
//   of at most `SLICE_MS` (and `CHUNK` files), with a turn of the event loop between them, so a
//   server keeps answering (SR-082, N-036). Measured at N-036 (50,000 elements, 200,000 relations,
//   4 cores, local runs of the performance suite): 4 to 5 s; reading through the libuv thread pool (`fs.promises`)
//   took about 11 s.
// - Not kept in the model cache (ADR-0008): the cached start (SR-082) needs no version.
// - A store change of the watcher or of ReqSeq's own writes (`applyStoreChange`, `recordWrites`) is
//   carried: the records it changed get their version again, every other entry is kept. A change of
//   the metamodel (which properties count) or of the layout (the `ignore` globs) resets it.
// - The version the store computed while reading a file (`loadedVersionsOf`, #439) is taken
//   without reading the file again when its type counts the same properties now (the fingerprint of
//   `typeVersioningOf`) and an `lstat` of the file still gives the size and time of the store's
//   snapshot; otherwise the file is read as above. So a version is that of the bytes the store read,
//   as all store data is, and a file changed outside ReqSeq to another size or time is read again
//   even before the watcher's batch (S4 of the plan review); a same-size change within the time
//   resolution waits for that batch. Elements that embed images have none (they are checked on use).
// - After a metamodel change the cached versions keep the old fingerprint (#755). The first build
//   reads those files as above and collects each version it computed from the bytes of the
//   snapshot for an element a read would give one (no image link) whose loaded version is missing
//   or of another fingerprint; when there is one, the model cache is written again with them
//   (`saveVersionsAgain`, in the background), so the next start takes them without a read. Any
//   number is enough: unlike changed files, these never become fresh on their own. No other file
//   is read for it.
// - Images are no Markdown files, and the watcher drops their events (ADR-0008). Each version keeps
//   what the lookup of its images found (`ImageSeen`); `currentVersions` checks it on use and
//   computes the versions of elements whose images changed again.
import fs from "node:fs";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { CommandError } from "../catalog.js";
import { readElementBodySync } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { settledValue } from "../runtime/settled.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { classifyFile } from "./elements.js";
import type { ImageMemo, ImageSeen, ImageSource, LookedUpImages } from "./images.js";
import { imageLinks, imageMemo, imagesUnchanged, lookUpImages, mapBounded } from "./images.js";
import type { LoadedVersion, Versioning } from "./loaded-version.js";
import { typeVersioningOf, versioningOf } from "./loaded-version.js";
import { saveVersionsAgain } from "./model-cache.js";
import type { ElementStore } from "./store.js";
import { carryStoreUpdate, elementStoreState, ignoredBy, loadedVersionsOf } from "./store.js";
import { NORMAL_FORM } from "../version/version.js";
import { elementVersion, notComputableMessage, versionOrRangeError } from "./view.js";

/** The current version of one element, or why it has none. */
export type CurrentVersion =
  | {
      readonly kind: "version";
      /** The version of its file as it is now (ADR-0005). */
      readonly version: string;
      /** What the lookup of each image its text embeds found, for the check on use (`imagesUnchanged`). */
      readonly images: readonly ImageSeen[];
      /**
       * The element as its file holds it now, when the file changed since the store read it (same
       * UUID): `version` is of this element, not of the record of the store.
       */
      readonly element?: ElementRecord;
    }
  | {
      readonly kind: "unknown";
      /**
       * `not-in-file`: its file no longer holds the element (gone, not readable, faulty, another
       * UUID); `image-unreadable`: an embedded image or a folder above it cannot be read;
       * `not-computable`: a value that counts has no normal form (`.inf`, `.nan`, ADR-0005).
       */
      readonly reason: "not-in-file" | "image-unreadable" | "not-computable";
      readonly message: string;
    };

/** The current versions of the elements of one store. */
export interface CurrentVersions {
  /** The store the versions are of; derive what else a command needs from it (ADR-0008). */
  readonly store: ElementStore;
  readonly layout: WorkspaceLayout;
  readonly metamodel: Metamodel;
  /** Every element record of `store`. */
  readonly byRecord: ReadonlyMap<ElementRecord, CurrentVersion>;
}

/** The current version of `record`, or undefined when it has none (`CurrentVersion`) or is not in the store. */
export const currentVersionOf = (versions: CurrentVersions, record: ElementRecord): string | undefined => {
  const entry = versions.byRecord.get(record);
  return entry?.kind === "version" ? entry.version : undefined;
};

/** Blocking work before the event loop gets a turn, in ms. */
const SLICE_MS = 20;

/** Files read at most before the event loop gets a turn. */
const CHUNK = 500;

/** No image link: nothing to look up. */
const NO_IMAGES: LookedUpImages = { images: [], seen: [] };

/** What computing versions needs, shared by the elements of one run. */
interface Run {
  readonly metamodel: Metamodel;
  readonly repositories: ReadonlyMap<string, RepositoryLocation>;
  readonly ignored: (relativePath: string) => boolean;
  /** Folder listings and image hashes of this run. */
  readonly memo: ImageMemo;
  /** The versions the store computed while reading (`loadedVersionsOf`). */
  readonly loaded: ReadonlyMap<ElementRecord, LoadedVersion>;
  /** What counts for a version now, to compare with a loaded one; undefined: none is taken. */
  readonly versioning: Versioning | undefined;
  /**
   * When given, collects the versions for the model cache (#755): of each record whose file was read
   * with the bytes of its snapshot and whose loaded version is missing or has another fingerprint,
   * where a read now would give one (`loadedVersion`: no image link).
   */
  readonly relearned?: Map<ElementRecord, LoadedVersion>;
}

/** `versioningOf` of each metamodel, so a page does not hash the types again. */
const versioningByMetamodel = new WeakMap<Metamodel, Versioning | undefined>();

const versioningNow = (metamodel: Metamodel): Versioning | undefined => {
  if (!versioningByMetamodel.has(metamodel)) {
    versioningByMetamodel.set(metamodel, versioningOf(metamodel));
  }
  return versioningByMetamodel.get(metamodel);
};

const runOf = (versions: Pick<CurrentVersions, "store" | "layout" | "metamodel">): Run => ({
  metamodel: versions.metamodel,
  repositories: new Map(versions.layout.repositories.map((r) => [r.name, r])),
  ignored: ignoredBy(versions.layout),
  memo: imageMemo(),
  loaded: loadedVersionsOf(versions.store),
  versioning: versioningNow(versions.metamodel),
});

/** No image looked up: the `images` of every loaded version, shared and frozen. */
const NO_SEEN: readonly ImageSeen[] = Object.freeze([]);

/**
 * The entry of `record` from the version the store computed while reading its file, when that still
 * holds: the type counts the same properties (fingerprint) and the file has the size and time of the
 * store's snapshot. Undefined otherwise: the file is read (`versionNow`).
 */
const loadedEntry = (run: Run, record: ElementRecord): CurrentVersion | undefined => {
  const loaded = run.loaded.get(record);
  const version = loaded?.byForm[NORMAL_FORM];
  const repository = run.repositories.get(record.repository);
  if (
    loaded === undefined ||
    version === undefined ||
    repository === undefined ||
    run.versioning === undefined ||
    typeVersioningOf(run.versioning, record.type).fingerprint !== loaded.fingerprint
  ) {
    return undefined;
  }
  let stats: fs.Stats | undefined;
  try {
    stats = fs.lstatSync(path.join(repository.folder, ...record.file.split("/")), {
      throwIfNoEntry: false,
    });
  } catch {
    // ENOTDIR, ELOOP, EACCES, EPERM: the file is read as before, which reports why.
    return undefined;
  }
  return stats?.isFile() === true &&
    stats.size === record.snapshot.size &&
    stats.mtimeMs === record.snapshot.mtimeMs
    ? { kind: "version", version, images: NO_SEEN }
    : undefined;
};

const notInFile = (record: ElementRecord, why: string): CurrentVersion => ({
  kind: "unknown",
  reason: "not-in-file",
  message: `${record.file} of repository ${record.repository} ${why}`,
});

/**
 * The version of `record` from its file as it is now: the text of the bytes the store read, or, when
 * the file changed since, the element the file holds now when it still has the record's UUID.
 */
const versionNow = async (run: Run, record: ElementRecord): Promise<CurrentVersion> => {
  const repository = run.repositories.get(record.repository);
  if (repository === undefined) {
    return notInFile(record, "is not in a repository of the workspace");
  }
  const read = readElementBodySync(repository.folder, record.file, record.snapshot);
  let element = record;
  let body: string;
  if (read.kind === "same") {
    body = read.body;
  } else {
    if (read.read.kind !== "parsed") {
      return notInFile(record, `no longer holds the element ${record.id}`);
    }
    const now = classifyFile(record.repository, read.read.file);
    if (now.kind !== "element" || now.element.id !== record.id) {
      return notInFile(record, `no longer holds the element ${record.id}`);
    }
    element = now.element;
    body = read.read.file.body;
  }
  const source: ImageSource = { repository, ignored: run.ignored };
  const links = imageLinks(record.file, body, run.ignored);
  let found: LookedUpImages;
  try {
    found = links.length === 0 ? NO_IMAGES : await lookUpImages(source, links, run.memo);
  } catch (error) {
    // `file.faulty`; anything else is a bug.
    if (!(error instanceof CommandError)) {
      throw error;
    }
    return { kind: "unknown", reason: "image-unreadable", message: error.message };
  }
  // A number that counts and is not finite (`.inf`, `.nan`) has no canonical form; anything else is a bug.
  const version = versionOrRangeError(() => elementVersion(element, body, run.metamodel, found.images));
  if (version instanceof RangeError) {
    return { kind: "unknown", reason: "not-computable", message: notComputableMessage(record, version) };
  }
  if (read.kind === "same" && links.length === 0) {
    relearn(run, record, body, version);
  }
  return { kind: "version", version, images: found.seen, ...(element === record ? {} : { element }) };
};

/**
 * Keeps `version`, computed from the bytes of `record`'s snapshot (its text `body`), in `run.relearned`
 * when the record's loaded version is missing or has another fingerprint than its type has now, and a
 * read would give one: no image link even to an ignored path, as `loadedVersion` tests it.
 */
const relearn = (run: Run, record: ElementRecord, body: string, version: string): void => {
  if (run.relearned === undefined || run.versioning === undefined) {
    return;
  }
  const { fingerprint } = typeVersioningOf(run.versioning, record.type);
  if (run.loaded.get(record)?.fingerprint !== fingerprint && imageLinks(record.file, body).length === 0) {
    run.relearned.set(record, { byForm: { [NORMAL_FORM]: version }, fingerprint });
  }
};

/**
 * The entries of `records`: kept from `known` where it has the record, computed otherwise, in
 * slices of at most `SLICE_MS` and `CHUNK` files with a turn of the event loop between them.
 */
const entriesOf = async (
  run: Run,
  records: readonly ElementRecord[],
  known: ReadonlyMap<ElementRecord, CurrentVersion> = new Map(),
): Promise<Map<ElementRecord, CurrentVersion>> => {
  const byRecord = new Map<ElementRecord, CurrentVersion>();
  let read = 0;
  let since = performance.now();
  for (const record of records) {
    const kept = known.get(record);
    if (kept !== undefined) {
      byRecord.set(record, kept);
      continue;
    }
    const loaded = loadedEntry(run, record);
    // A loaded version costs an lstat, so it counts towards the slice like a read.
    byRecord.set(record, loaded ?? (await versionNow(run, record)));
    read += 1;
    if (read >= CHUNK || performance.now() - since >= SLICE_MS) {
      await nextTurn();
      read = 0;
      since = performance.now();
    }
  }
  return byRecord;
};

/**
 * The current version of every element of `store` (`CurrentVersions`). With `relearned`, it also
 * collects the versions the model cache should hold again (`Run.relearned`, #755).
 */
export const buildCurrentVersions = async (
  store: ElementStore,
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  relearned?: Map<ElementRecord, LoadedVersion>,
): Promise<CurrentVersions> => ({
  store,
  layout,
  metamodel,
  byRecord: await entriesOf(
    { ...runOf({ store, layout, metamodel }), ...(relearned === undefined ? {} : { relearned }) },
    store.elements,
  ),
});

/**
 * `versions` for the store `store` (a change of the watcher or a write, #184): every record that is
 * the same object in both keeps its entry, every other record of `store` gets its version again.
 */
export const carryCurrentVersions = async (
  versions: CurrentVersions,
  store: ElementStore,
): Promise<CurrentVersions> => ({
  ...versions,
  store,
  byRecord: await entriesOf(runOf({ ...versions, store }), store.elements, versions.byRecord),
});

/**
 * The current versions of a workspace, built on first use and kept with its element store
 * (`buildCurrentVersions`). Carried over a change of the store (`carryCurrentVersions`); reset with
 * the metamodel or the layout. Read it through `currentVersions`, which checks the images.
 */
export const currentVersionsState = defineWorkspaceState(
  "current-versions",
  async (workspace): Promise<CurrentVersions> => {
    const [store, layout, metamodel] = await Promise.all([
      workspace.get(elementStoreState),
      workspace.get(workspaceLayoutState),
      workspace.get(metamodelState),
    ]);
    const relearned = new Map<ElementRecord, LoadedVersion>();
    const versions = await buildCurrentVersions(store, layout, metamodel, relearned);
    // Read files whose cached versions are of another metamodel: the cache keeps their new ones (#755).
    saveVersionsAgain(workspace, store, relearned);
    return versions;
  },
  {
    dependsOn: [elementStoreState, metamodelState],
    carry: carryStoreUpdate((value, update) => value.then((old) => carryCurrentVersions(old, update.to))),
  },
);

/** Whether the entry of `record` is to be computed again: one without a version, or whose images changed. */
const stale = async (run: Run, record: ElementRecord, entry: CurrentVersion): Promise<boolean> => {
  const repository = run.repositories.get(record.repository);
  if (entry.kind !== "version" || repository === undefined) {
    return true;
  }
  const source: ImageSource = { repository, ignored: run.ignored };
  return !(await imagesUnchanged(source, entry.images, run.memo).catch(() => false));
};

/**
 * Whether two entries of one record say the same: the version and what its images were found as,
 * or the same reason and message. The element a changed file holds now is not compared (JSON
 * leaves out a property that is undefined).
 */
const sameEntry = (a: CurrentVersion, b: CurrentVersion): boolean =>
  JSON.stringify({ ...a, element: undefined }) === JSON.stringify({ ...b, element: undefined });

/**
 * `versions` with the entries computed again of every element whose embedded images changed on
 * disk (`imagesUnchanged`; an error while looking counts as a change) and of every element without
 * a version (its file or images may be readable again), or `versions` itself when no entry came out
 * different. The watcher does not report images (ADR-0008), so a version kept across its batches
 * is checked here; elements with images are checked `mapBounded` at a time.
 */
export const checkImages = async (versions: CurrentVersions): Promise<CurrentVersions> => {
  const run = runOf(versions);
  const candidates = [...versions.byRecord].filter(([, e]) => e.kind !== "version" || e.images.length > 0);
  const checked = await mapBounded(candidates, async ([record, entry]) =>
    (await stale(run, record, entry)) ? [[record, entry] as const] : [],
  );
  const again = checked.flat();
  if (again.length === 0) {
    return versions;
  }
  const known = new Map(versions.byRecord);
  for (const [record] of again) {
    known.delete(record);
  }
  const byRecord = await entriesOf(run, versions.store.elements, known);
  const before = new Map(again);
  let changed = false;
  for (const [record, after] of byRecord) {
    const old = before.get(record);
    if (old === undefined) {
      continue;
    }
    if (sameEntry(after, old)) {
      byRecord.set(record, old);
    } else {
      changed = true;
    }
  }
  return changed ? { ...versions, byRecord } : versions;
};

/** The check of a kept state that is running, by the state's value, so concurrent callers share it. */
const checking = new WeakMap<Promise<CurrentVersions>, Promise<CurrentVersions>>();

/**
 * The current version of every element of `workspace` (`currentVersionsState`), with a kept state
 * checked first (`checkImages`): when an entry came out different, the state is replaced, so that
 * the states built on it are reset. A state built by this call is not checked again; callers while
 * a check runs share it.
 */
export const currentVersions = async (workspace: Workspace): Promise<CurrentVersions> => {
  const kept = workspace.peek(currentVersionsState);
  const value = workspace.get(currentVersionsState);
  if (kept === undefined) {
    return value;
  }
  const running = checking.get(value);
  if (running !== undefined) {
    return running;
  }
  const check = (async () => {
    const versions = await value;
    const result = await checkImages(versions);
    if (result !== versions) {
      await workspace.replace(currentVersionsState, value, Promise.resolve(result));
    }
    return result;
  })();
  checking.set(value, check);
  const forget = (): void => {
    checking.delete(value);
  };
  void check.then(forget, forget);
  return check;
};

/**
 * The current versions the workspace keeps when their build has ended, else undefined: never waits
 * for a build that is running (`settledValue`; ADR-0008: single-element paths such as `element.get`
 * read the versions of the targets they need instead). The kept versions are not checked
 * (`checkImages`); a caller checks the entries it uses (`currentVersionsOf`). A build that failed
 * rejects here as it would in `currentVersions`: it is a bug (every expected failure is an
 * `unknown` entry).
 */
export const currentVersionsIfBuilt = (workspace: Workspace): Promise<CurrentVersions | undefined> =>
  settledValue(workspace.peek(currentVersionsState));

/**
 * A list of at least this share of the store (1 / `WHOLE_STORE_SHARE` of its elements) builds and
 * keeps the versions of the whole store (`currentVersions`): it reads most files anyway.
 */
const WHOLE_STORE_SHARE = 4;

/**
 * The entries of `versions` for the records of `page` that need no new computation: as `checkImages`
 * checks them (`stale`), but only those of `page`, so a page does not look at the images of the
 * whole store.
 */
const keptFor = async (
  run: Run,
  versions: CurrentVersions,
  page: ReadonlySet<ElementRecord>,
): Promise<Map<ElementRecord, CurrentVersion>> => {
  const kept = new Map<ElementRecord, CurrentVersion>();
  // One lookup per record of the page, not a walk over the whole store (N-036).
  for (const record of page) {
    const entry = versions.byRecord.get(record);
    if (entry !== undefined) {
      kept.set(record, entry);
    }
  }
  const candidates = [...kept].filter(([, e]) => e.kind !== "version" || e.images.length > 0);
  const checked = await mapBounded(candidates, async ([record, entry]) =>
    (await stale(run, record, entry)) ? [record] : [],
  );
  for (const record of checked.flat()) {
    kept.delete(record);
  }
  return kept;
};

/**
 * The current versions of `records` only, in their order and each record once, for a command that
 * shows some elements (`listElements`, the hints of one element in its view, SR-026 AK3). Taken
 * from the versions the workspace keeps when their build has ended (`currentVersionsIfBuilt`: a
 * build that is running is not waited for), each checked as `checkImages` checks it but only for
 * these records (`keptFor`); when none are built and `records` are a large share of the store
 * (`WHOLE_STORE_SHARE`), the versions of the whole store are built and kept first. Every other record's version is computed from its file as
 * `buildCurrentVersions` does. A page of a large workspace thus reads only its own files, also in a
 * fresh CLI process (N-036), and builds no state. The kept state is not changed.
 */
export const currentVersionsOf = async (
  workspace: Workspace,
  records: readonly ElementRecord[],
): Promise<ReadonlyMap<ElementRecord, CurrentVersion>> => {
  const [store, layout, metamodel] = await Promise.all([
    workspace.get(elementStoreState),
    workspace.get(workspaceLayoutState),
    workspace.get(metamodelState),
  ]);
  const versions =
    (await currentVersionsIfBuilt(workspace)) ??
    (records.length * WHOLE_STORE_SHARE >= store.elements.length
      ? await currentVersions(workspace)
      : undefined);
  const run = runOf({ store, layout, metamodel });
  const known = versions === undefined ? undefined : await keptFor(run, versions, new Set(records));
  return entriesOf(run, records, known);
};
