// The model cache of a working copy (ADR-0008, SR-082): `model.json` in the cache folder of the copy
// holds what each Markdown file contributed to the element store, with the snapshot it was read
// with and the inode and change time of the file (decimal strings of `lstat` with `bigint`, so a
// 64-bit file ID on Windows keeps every bit). A start lists the files, `lstat`s each one that
// has an entry and reuses the entry when size, modification time, inode and change time still match,
// so only new and changed files are read. Nothing in it is trusted as a whole except its header:
// every entry is checked against its file before it is used.
import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { Problem } from "../catalog.js";
import type { FileSnapshot } from "../files/index.js";
import { PRODUCT_VERSION } from "../product.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { availableRepositories, canonicalRoot, readCacheFile, writeCacheFile } from "../workspace/index.js";
import type { Contribution } from "./contribution.js";
import type { LoadedStore } from "./store.js";
import { isUuid } from "./uuid.js";

/** A contribution the cache can hold: one of a file that parsed, so it has the snapshot of its bytes. */
export type CachedContribution = Contribution & { readonly snapshot: FileSnapshot };

/**
 * An entry of the cache: the contribution and what `lstat` gave for its file when the cache was
 * written, the inode (unsigned, `inoKey`) and the change time in nanoseconds as decimal strings. A
 * file ID on Windows has 64 bits and is often above 2 ** 53, where a JS number loses its low bits.
 */
export interface CacheEntry {
  readonly contribution: CachedContribution;
  readonly ino: string;
  readonly ctimeNs: string;
}

/** The name of the model cache in the cache folder of a copy (`cacheFolder(root)`). */
export const MODEL_CACHE_FILE = "model.json";

/**
 * The format of `model.json`; a cache of another format is discarded. 4: element records carry the
 * inline references of their text (`ElementRecord.references`, #240). 5: and those in the string
 * values of their frontmatter (`ElementRecord.propertyReferences`, SR-127). 6: and their `reqseq:`
 * links whose target is no UUID (`ElementRecord.unresolvedLinks`, #176).
 */
export const MODEL_CACHE_FORMAT = 6;

/**
 * An entry whose modification time lies less than this before the start of the load that wrote it
 * is read again (a "racy" entry): a file changed again within the resolution of its time stamp
 * (2 s on FAT, 1 s on HFS+ and ext3, a few ms on ext4) may keep its size and time. A file whose
 * change time lies less than this before the start of the load is not written to the cache at all:
 * its inode and change time are taken when the cache is written, so a change between the read and
 * the write that keeps size and mtime (`cp -p`) would otherwise go unseen.
 */
export const RACY_MS = 2_000;

/**
 * The cache is not written again while fewer than this many entries are out of date (changed, gone,
 * racy or new) and they are fewer than `STALE_SHARE` of the files: reading them again at the next
 * start costs less than writing the whole cache (about 1.4 s at 50,000 files).
 */
export const STALE_FILES = 1_000;
export const STALE_SHARE = 0.01;

/** Files `lstat`ed between two turns of the event loop, so that a server stays responsive. */
const STAT_CHUNK = 2_000;

/** What a load may take from the cache: the entries of one repository that still match their files. */
export type Reuse = (
  repository: RepositoryLocation,
  files: readonly string[],
) => Promise<{ readonly reused: ReadonlyMap<string, Contribution>; readonly read: readonly string[] }>;

/** One repository of a model cache. */
export interface CachedRepository {
  /** The canonical folder it was read from; entries count only while the repository lies there. */
  readonly folder: string;
  readonly files: ReadonlyMap<string, CacheEntry>;
}

/** A model cache as read from `model.json`, header checked. */
export interface ModelCache {
  /** When the load that wrote it started (ms since the epoch); see `RACY_MS`. */
  readonly startedAt: number;
  /** By workspace name of the repository. */
  readonly repositories: ReadonlyMap<string, CachedRepository>;
}

/** The folder of core's code: `src` when tests run the sources, `dist` in a build. */
const CODE_FOLDER = fileURLToPath(new URL("../", import.meta.url));

/** Written into `dist` by core's build (`scripts/build/code-fingerprint.mjs`), next to the code it describes. */
export const FINGERPRINT_FILE = "code-fingerprint.json";

/** The incremental build information of `tsc -b` in `dist`; a newer one than the fingerprint names means stale. */
const BUILD_INFO = ".tsbuildinfo";

/** Files that make up the code: scripts and the JSON they embed (contracts, standard model). */
const CODE_FILE = /\.(?:[cm]?js|ts|json)$/;
/** Never part of it: tests, type declarations, installed packages and the fingerprint itself. */
const NOT_CODE = /\.test\.|\.d\.ts$|(?:^|\/)node_modules\/|^code-fingerprint\.json$/;

const sha256Of = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/** The text of `file`, or "" when there is none. */
const textOf = (file: string): string => (existsSync(file) ? readFileSync(file, "utf8") : "");

/**
 * SHA-256 over the product version, the dependencies of core's `package.json` (exact versions of the
 * YAML parser and the schema validator) and the names and bytes of every code file in `folder`
 * (scripts and JSON; tests, type declarations and installed packages left out). What a file
 * contributes depends on all of them (parsing, classification, messages).
 */
export const computeCodeFingerprint = (folder: string): string => {
  const hash = createHash("sha256");
  const manifest: unknown = JSON.parse(textOf(path.join(folder, "..", "package.json")) || "{}");
  const dependencies = (manifest as { readonly dependencies?: unknown }).dependencies ?? {};
  hash.update(`${PRODUCT_VERSION}\0${JSON.stringify(dependencies)}\0`);
  const files = readdirSync(folder, { recursive: true, encoding: "utf8" })
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => CODE_FILE.test(file) && !NOT_CODE.test(file))
    .filter((file) => lstatSync(path.join(folder, file)).isFile())
    .sort();
  for (const file of files) {
    hash.update(`${file}\0`).update(readFileSync(path.join(folder, file)));
  }
  return hash.digest("hex");
};

/** What core's build writes into `FINGERPRINT_FILE` for `folder` (its `dist`). */
export const fingerprintFile = (folder: string): string =>
  `${JSON.stringify({ fingerprint: computeCodeFingerprint(folder), buildInfo: sha256Of(textOf(path.join(folder, BUILD_INFO))) })}\n`;

/**
 * The fingerprint `FINGERPRINT_FILE` in `folder` names, while the build information of `tsc -b`
 * there is the one it was written with (none in a packaged build); undefined otherwise.
 */
const builtFingerprint = (folder: string): string | undefined => {
  const file = path.join(folder, FINGERPRINT_FILE);
  if (!existsSync(file)) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  const { fingerprint, buildInfo } = value as {
    readonly fingerprint?: unknown;
    readonly buildInfo?: unknown;
  };
  const info = path.join(folder, BUILD_INFO);
  if (typeof fingerprint !== "string" || (existsSync(info) && buildInfo !== sha256Of(textOf(info)))) {
    return undefined;
  }
  return fingerprint;
};

const fingerprints = new Map<string, string>();

/**
 * The fingerprint of core's code in `folder`, once per process: the one core's build wrote, else
 * computed from the files (the sources in tests, a build whose fingerprint is missing or stale). A
 * cache written by other code, also a development build of the same version, is discarded.
 */
export const codeFingerprint = (folder: string = CODE_FOLDER): string => {
  const known = fingerprints.get(folder);
  if (known !== undefined) {
    return known;
  }
  const fingerprint = builtFingerprint(folder) ?? computeCodeFingerprint(folder);
  fingerprints.set(folder, fingerprint);
  return fingerprint;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isProblem = (value: unknown): value is Problem =>
  fileSchemaValidator("common.schema.json#/$defs/problem")(value);

const LINE_ENDINGS: readonly unknown[] = ["\n", "\r\n"];

/** Whether `value` is a decimal string of a whole number of zero or more, as `String` writes a bigint. */
const isDecimal = (value: unknown): value is string =>
  typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value);

/** Whether `value` is a snapshot of `file` as `makeSnapshot` makes it. */
const isSnapshotOf = (value: unknown, file: string): value is Record<string, unknown> =>
  isRecord(value) &&
  value["path"] === file &&
  typeof value["size"] === "number" &&
  typeof value["mtimeMs"] === "number" &&
  typeof value["sha256"] === "string";

const isOptionalText = (value: unknown): boolean => value === undefined || typeof value === "string";

/**
 * Whether `value` is a list of inline references as `textReferences` makes it (one or more), or,
 * with `inProperty`, as `propertyReferences` makes it: each also with the key of its property and,
 * for a list, its position.
 */
const isReferences = (value: unknown, inProperty: boolean): boolean =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (r: unknown) =>
      isRecord(r) &&
      isUuid(r["id"]) &&
      typeof r["line"] === "number" &&
      Number.isInteger(r["line"]) &&
      r["line"] >= 1 &&
      isOptionalText(r["version"]) &&
      isOptionalText(r["repository"]) &&
      (inProperty
        ? typeof r["key"] === "string" &&
          (r["item"] === undefined ||
            (typeof r["item"] === "number" && Number.isInteger(r["item"]) && r["item"] >= 0))
        : r["key"] === undefined && r["item"] === undefined),
  );

/** Whether `value` is a list of links as `storedUnresolvedLinks` makes it (one or more). */
const isUnresolvedLinks = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (l: unknown) =>
      isRecord(l) &&
      typeof l["target"] === "string" &&
      l["target"] !== "" &&
      typeof l["line"] === "number" &&
      Number.isInteger(l["line"]) &&
      l["line"] >= 1 &&
      isOptionalText(l["key"]) &&
      (l["item"] === undefined ||
        (typeof l["key"] === "string" &&
          typeof l["item"] === "number" &&
          Number.isInteger(l["item"]) &&
          l["item"] >= 0)),
  );

/** Whether the optional link lists of an element record have the shape `classifyFile` gives them. */
const hasLinksOfRecord = (value: Readonly<Record<string, unknown>>): boolean =>
  (value["references"] === undefined || isReferences(value["references"], false)) &&
  (value["propertyReferences"] === undefined || isReferences(value["propertyReferences"], true)) &&
  (value["unresolvedLinks"] === undefined || isUnresolvedLinks(value["unresolvedLinks"]));

/** Whether `value` is the record of an element in `file` of repository `name`, as `classifyFile` makes it. */
const isElementOf = (value: unknown, file: string, name: string): value is Record<string, unknown> =>
  isRecord(value) &&
  value["file"] === file &&
  value["repository"] === name &&
  typeof value["id"] === "string" &&
  typeof value["type"] === "string" &&
  isRecord(value["data"]) &&
  hasLinksOfRecord(value) &&
  LINE_ENDINGS.includes(value["eol"]) &&
  (value["closingEol"] === "" || LINE_ENDINGS.includes(value["closingEol"])) &&
  typeof value["bom"] === "boolean";

/** Whether the part of `contribution` that its kind adds has the shape a read gives. */
const kindFits = (contribution: Record<string, unknown>, file: string, name: string): boolean => {
  switch (contribution["kind"]) {
    case "element":
      return isElementOf(contribution["element"], file, name);
    case "not-element":
      return contribution["file"] === file;
    case "problem":
      return isProblem(contribution["problem"]);
    default:
      return false;
  }
};

/**
 * The entry `[file, contribution, ino, ctimeNs]` of repository `name` as the store holds it:
 * snapshots frozen (`makeSnapshot`) and shared with the element, as a read gives them. Undefined
 * when it does not have the shape the cache writes, so the whole cache is discarded.
 */
const reviveEntry = (entry: unknown, name: string): readonly [string, CacheEntry] | undefined => {
  if (!Array.isArray(entry) || entry.length !== 4) {
    return undefined;
  }
  const [file, contribution, ino, ctimeNs] = entry as unknown[];
  if (
    typeof file !== "string" ||
    !isDecimal(ino) ||
    !isDecimal(ctimeNs) ||
    !isRecord(contribution) ||
    !isSnapshotOf(contribution["snapshot"], file) ||
    !Array.isArray(contribution["warnings"]) ||
    !contribution["warnings"].every(isProblem) ||
    !kindFits(contribution, file, name)
  ) {
    return undefined;
  }
  const snapshot = Object.freeze(contribution["snapshot"]);
  if (isRecord(contribution["element"])) {
    contribution["element"]["snapshot"] = snapshot;
  }
  return [file, { contribution: contribution as unknown as CachedContribution, ino, ctimeNs }];
};

const reviveRepository = (value: unknown): readonly [string, CachedRepository] | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const { name, folder, files } = value;
  if (typeof name !== "string" || typeof folder !== "string" || !Array.isArray(files)) {
    return undefined;
  }
  const entries = new Map<string, CacheEntry>();
  for (const entry of files) {
    const revived = reviveEntry(entry, name);
    if (revived === undefined) {
      return undefined;
    }
    entries.set(...revived);
  }
  return [name, { folder, files: entries }];
};

/**
 * The model cache in `text`, or undefined when it is not one ReqSeq can use: not JSON, another
 * format, written by other code (`code`), for another root, or with an entry of the wrong shape.
 */
export const parseModelCache = (
  text: string,
  root: string,
  code: string = codeFingerprint(),
): ModelCache | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    !isRecord(value) ||
    value["format"] !== MODEL_CACHE_FORMAT ||
    value["code"] !== code ||
    value["root"] !== root ||
    typeof value["startedAt"] !== "number" ||
    !Array.isArray(value["repositories"])
  ) {
    return undefined;
  }
  const repositories = new Map<string, CachedRepository>();
  for (const repository of value["repositories"]) {
    const revived = reviveRepository(repository);
    if (revived === undefined) {
      return undefined;
    }
    repositories.set(...revived);
  }
  return { startedAt: value["startedAt"], repositories };
};

/**
 * Whether JSON gives `value` back exactly: only `null`, strings, booleans, finite numbers other than
 * `-0`, arrays without holes and objects whose prototype is `Object.prototype`, without cycles
 * (`ancestors` holds the objects on the way down). Anything else (a `Date` of `!!timestamp`, a
 * `Uint8Array` of `!!binary`, a `Set` or `Map` of `!!set` and `!!omap`, `.inf`, `.nan`, `-0`, an
 * alias that contains itself) makes the entry stay out of the cache. An object shared by two keys
 * (an alias) comes back as two equal objects.
 */
const exactInJson = (value: unknown, ancestors: Set<object> = new Set()): boolean => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  const items: readonly unknown[] | undefined = Array.isArray(value)
    ? prototype === Array.prototype && Object.keys(value).length === value.length
      ? value
      : undefined
    : prototype === Object.prototype
      ? Object.values(value)
      : undefined;
  if (items === undefined) {
    return false;
  }
  ancestors.add(value);
  const exact = items.every((item) => exactInJson(item, ancestors));
  ancestors.delete(value);
  return exact;
};

/**
 * The JSON of a contribution that JSON gives back exactly, else undefined. It never throws: a value
 * that fails while it is checked or written (a getter that throws) only keeps the entry out.
 */
const cacheableJson = (contribution: Contribution): string | undefined => {
  try {
    return contribution.snapshot !== undefined && exactInJson(contribution)
      ? JSON.stringify(contribution)
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * `lstat` of a file with `bigint`, without throwing; undefined when it is not there or cannot be
 * read. It costs about 0.01 s more than without at 50,000 files (0.17 s instead of 0.16 s on Linux).
 */
const lstatQuietly = (file: string): BigIntStats | undefined => {
  try {
    return lstatSync(file, { bigint: true, throwIfNoEntry: false });
  } catch {
    return undefined;
  }
};

/**
 * The milliseconds of a time in nanoseconds, the same number as the `mtimeMs` or `ctimeMs` of an
 * `lstat` without `bigint` (Node computes it from the seconds and nanoseconds the same way), so it
 * can be compared with the `mtimeMs` of a snapshot. Before 1970 the two may differ in the last bit;
 * such a file is only read again.
 */
const msOf = (ns: bigint): number => Number(ns / 1_000_000_000n) * 1e3 + Number(ns % 1_000_000_000n) / 1e6;

/**
 * The inode of a `bigint` `lstat` as the cache keeps it: unsigned. Node fills the stats from a
 * signed 64-bit array, so an inode of 2 ** 63 or more (NTFS file IDs with a high sequence number,
 * ReFS, network and FUSE file systems, overlayfs) comes out negative.
 */
export const inoKey = (ino: bigint): string => String(BigInt.asUintN(64, ino));

/**
 * What the cache keeps of a `bigint` `lstat` of a file: `[ino, ctimeNs]` as decimal strings, or
 * undefined for a change time before 1970 (negative), which stays out of the cache.
 */
export const statKeys = (
  stat: Pick<BigIntStats, "ino" | "ctimeNs">,
): readonly [ino: string, ctimeNs: string] | undefined =>
  stat.ctimeNs < 0n ? undefined : [inoKey(stat.ino), String(stat.ctimeNs)];

/**
 * What a reader that keeps parsed files in memory (the baseline reader) compares to tell whether a
 * file changed since it was read at `readAt`: size, modification time, inode and change time of a
 * `bigint` `lstat` taken before the read, as one string. Undefined while a change could go unseen,
 * as for the cache entries above: the file changed (modification or change time, the later one)
 * less than `RACY_MS` before `readAt`, or its change time lies before 1970. Such a file is read
 * again on the next use.
 */
export const changeStamp = (
  stat: Pick<BigIntStats, "size" | "mtimeNs" | "ino" | "ctimeNs">,
  readAt: number,
): string | undefined => {
  const keys = statKeys(stat);
  const latest = stat.mtimeNs > stat.ctimeNs ? stat.mtimeNs : stat.ctimeNs;
  return keys === undefined || msOf(latest) >= readAt - RACY_MS
    ? undefined
    : `${String(stat.size)}:${String(stat.mtimeNs)}:${keys[0]}:${keys[1]}`;
};

/**
 * `model.json` for `store`: every file whose contribution has a snapshot, survives JSON exactly and
 * still has the size and modification time of its snapshot and whose change time lies at least
 * `RACY_MS` before `startedAt`, with its inode and change time now, per repository of the store.
 * `startedAt` is when the load of `store` started.
 */
export const serializeModelCache = (
  root: string,
  store: LoadedStore,
  startedAt: number,
  code: string = codeFingerprint(),
): string => {
  const repositories = store.repositories.map(({ repository, location, files }) => {
    const entries: string[] = [];
    for (const [file, contribution] of files) {
      const text = cacheableJson(contribution);
      const stat = text === undefined ? undefined : lstatQuietly(path.join(location.folder, file));
      const keys = stat === undefined ? undefined : statKeys(stat);
      if (
        text !== undefined &&
        keys !== undefined &&
        stat?.isFile() === true &&
        Number(stat.size) === contribution.snapshot?.size &&
        msOf(stat.mtimeNs) === contribution.snapshot.mtimeMs &&
        msOf(stat.ctimeNs) < startedAt - RACY_MS
      ) {
        entries.push(`[${JSON.stringify(file)},${text},"${keys[0]}","${keys[1]}"]`);
      }
    }
    const folder = JSON.stringify(canonicalRoot(location.folder));
    return `{"name":${JSON.stringify(repository)},"folder":${folder},"files":[${entries.join(",")}]}`;
  });
  const header = `"format":${String(MODEL_CACHE_FORMAT)},"code":${JSON.stringify(code)},"root":${JSON.stringify(root)},"startedAt":${String(startedAt)}`;
  return `{${header},"repositories":[${repositories.join(",")}]}\n`;
};

/** Whether `entry` (from a cache written by a load that started at `startedAt`) still matches its file. */
const stillMatches = (
  folder: string,
  file: string,
  { contribution: { snapshot }, ino, ctimeNs }: CacheEntry,
  startedAt: number,
): boolean => {
  if (snapshot.mtimeMs >= startedAt - RACY_MS) {
    return false;
  }
  // Blocking: 50,000 calls take about 0.2 s, through the libuv thread pool about 1.5 s (N-036).
  const stat = lstatQuietly(path.join(folder, file));
  return (
    stat?.isFile() === true &&
    Number(stat.size) === snapshot.size &&
    msOf(stat.mtimeNs) === snapshot.mtimeMs &&
    inoKey(stat.ino) === ino &&
    String(stat.ctimeNs) === ctimeNs
  );
};

/** The use of one model cache by one load: which entries it reused, and whether the cache is out of date. */
class CacheUse {
  readonly #cache: ModelCache | undefined;
  readonly #reused = new WeakSet<Contribution>();
  #count = 0;
  /** Files read again although they had an entry: their new state replaces the entry. */
  #replaced = 0;

  constructor(cache: ModelCache | undefined) {
    this.#cache = cache;
  }

  readonly split: Reuse = async (repository, files) => {
    const cache = this.#cache;
    const cached = cache?.repositories.get(repository.name);
    const reused = new Map<string, Contribution>();
    const read: string[] = [];
    if (cache === undefined || cached?.folder !== canonicalRoot(repository.folder)) {
      return { reused, read: files };
    }
    for (const [index, file] of files.entries()) {
      if (index > 0 && index % STAT_CHUNK === 0) {
        await nextTurn();
      }
      const entry = cached.files.get(file);
      if (entry !== undefined && stillMatches(repository.folder, file, entry, cache.startedAt)) {
        reused.set(file, entry.contribution);
        this.#reused.add(entry.contribution);
        this.#count += 1;
      } else {
        read.push(file);
        this.#replaced += entry === undefined ? 0 : 1;
      }
    }
    return { reused, read };
  };

  /**
   * Whether the cache should be written again for `store`: there is none, or `STALE_FILES` or more
   * files are out of date (an entry gone with its file or its repository, or a file read that the
   * cache can hold: new, changed or racy), or at least `STALE_SHARE` of them.
   */
  outOfDate(store: LoadedStore): boolean {
    if (this.#cache === undefined) {
      return true;
    }
    const entries = [...this.#cache.repositories.values()].reduce((sum, r) => sum + r.files.size, 0);
    let fresh = 0;
    for (const { files } of store.repositories) {
      for (const contribution of files.values()) {
        if (!this.#reused.has(contribution) && cacheableJson(contribution) !== undefined) {
          fresh += 1;
        }
      }
    }
    // Entries gone (not reused and not read again), and files read that the cache can hold.
    const stale = entries - this.#count - this.#replaced + fresh;
    return stale > 0 && (stale >= STALE_FILES || stale >= STALE_SHARE * (this.#count + fresh));
  }
}

/** The saves of the model cache of a workspace, one after the other; closing the workspace waits for them. */
const savesState = defineWorkspaceState(
  "model-cache-saves",
  (): { tail: Promise<void> } => ({ tail: Promise.resolve() }),
  { dispose: (queue) => queue.tail },
);

/**
 * Queues `write` behind the other saves of the cache of `workspace` (the model cache, the search
 * index), one after the other; closing the workspace waits for them. A workspace that is closed
 * writes nothing any more. `write` must not reject.
 */
export const queueCacheSave = (workspace: Workspace, write: () => Promise<void>): void => {
  let queue: { tail: Promise<void> };
  try {
    queue = workspace.get(savesState);
  } catch {
    // Closed while loading: nothing is written any more.
    return;
  }
  queue.tail = queue.tail.then(write);
};

/** Writes `model.json` for `store`; a failure is ignored, since the cache only saves time. */
const save = async (folder: string, root: string, store: LoadedStore, startedAt: number): Promise<void> => {
  // Let the callers waiting for the store go first.
  await nextTurn();
  try {
    await writeCacheFile(folder, MODEL_CACHE_FILE, serializeModelCache(root, store, startedAt));
  } catch {
    // A folder that cannot be written (read-only, full): the next start reads the files again.
  }
};

/** Reads the model cache in `folder`; undefined when there is none or it cannot be read or used. */
export const readModelCache = async (folder: string, root: string): Promise<ModelCache | undefined> => {
  let text: string | undefined;
  try {
    text = await readCacheFile(folder, MODEL_CACHE_FILE);
  } catch {
    return undefined;
  }
  return text === undefined ? undefined : parseModelCache(text, root);
};

/**
 * The canonical name of `folder` (`canonicalRoot`), also before it exists: the nearest folder above
 * it that exists is resolved, and the rest of the name is appended. So a cache folder that does not
 * exist yet but lies, through a symbolic link, inside a repository is still recognised.
 */
const canonicalFolder = (folder: string): string => {
  let existing = path.resolve(folder);
  const rest: string[] = [];
  while (!existsSync(existing) && path.dirname(existing) !== existing) {
    rest.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  return canonicalRoot(path.join(canonicalRoot(existing), ...rest));
};

/**
 * Whether `folder` is a repository folder of `layout` or lies inside one (also through a symbolic link,
 * and before it exists). A cache file there would become part of a working tree.
 */
export const insideRepository = (folder: string, layout: WorkspaceLayout): boolean => {
  const canonical = canonicalFolder(folder);
  return availableRepositories(layout).some((repository) => {
    const relative = path.relative(canonicalRoot(repository.folder), canonical);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
};

/**
 * The cache folder of `workspace` (`WorkspaceOptions.cacheFolder`) when it has one that lies
 * outside every repository of `layout`; undefined otherwise. The cache must not become part of a
 * working tree (ADR-0008).
 */
export const usableCacheFolder = (workspace: Workspace, layout: WorkspaceLayout): string | undefined => {
  const folder = workspace.cacheFolder;
  return folder === undefined || insideRepository(folder, layout) ? undefined : folder;
};

/**
 * Loads the element store of `workspace` through the model cache in `folder` (ADR-0008, SR-082):
 * `load` reads every file the cache cannot give (`Reuse`), and when the cache is out of date, it is
 * written again in the background (`workspace.close()` waits for it). A cache folder inside a
 * repository of `layout` is never used: the cache must not become part of a working tree. `now` is
 * the clock the racy rules (`RACY_MS`) compare with.
 */
export const loadThroughCache = async (
  workspace: Workspace,
  folder: string,
  layout: WorkspaceLayout,
  load: (reuse: Reuse | undefined) => Promise<LoadedStore>,
  now: () => number = Date.now,
): Promise<LoadedStore> => {
  if (insideRepository(folder, layout)) {
    return load(undefined);
  }
  const startedAt = now();
  const root = canonicalRoot(workspace.root);
  const use = new CacheUse(await readModelCache(folder, root));
  const store = await load(use.split);
  if (use.outOfDate(store)) {
    queueCacheSave(workspace, () => save(folder, root, store, startedAt));
  }
  return store;
};
