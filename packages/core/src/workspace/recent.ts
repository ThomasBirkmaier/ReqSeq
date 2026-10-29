// The workspaces the app opened last (SR-131): `<OS cache>/reqseq/recent-workspaces.json`
// (`schemas/recent-workspaces.schema.json`, ADR-0008 cache part), the most recent first, at most 20,
// one per folder. The app's core process records the root it opened (`model/recent-record.ts`); the
// app's main process reads the list and checks which roots still hold a workspace.
//
// "Open workspace" also takes a typed folder path (AK5): `typedWorkspaceFolder` checks it by its text
// alone, before any file-system call, and `findTypedWorkspace` finds the workspace from it upwards.
//
// Main loads this module on its own (`@reqseq/core/recent-workspaces`), so it imports only `node:*`,
// `cache.ts` (with the private-file part of the files block) and `workspace-file.ts`: no schema
// validator, no command. Main makes no synchronous file-system call through it: reading the list never
// resolves a root again (the canonical `key` is stored), and the existence check is asynchronous and
// bounded (`createExistenceChecker`).
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { RecentWorkspacesFile } from "../generated/types.js";
import type { CacheEnvironment } from "./cache.js";
import { canonicalRoot, lockCacheFile, osCacheFolder, readCacheFile, writeCacheFile } from "./cache.js";
import { WORKSPACE_FILE } from "./workspace-file.js";

/** The file in `<OS cache>/reqseq/`. */
export const RECENT_WORKSPACES_FILE = "recent-workspaces.json";

/** How many workspaces the list keeps (a product choice of SR-131, named in its PR). */
export const RECENT_WORKSPACES_KEEP = 20;

/** A larger file is not ReqSeq's: it reads as an empty list, and the next open overwrites it. */
export const RECENT_WORKSPACES_MAX_BYTES = 64 * 1024;

/** The longest root the list holds, in characters (as the app's main process accepts one). */
export const MAX_ROOT_LENGTH = 4096;

/** An existence check that has no answer this long after it was asked counts as missing (`"timeout"`). */
export const EXISTS_TIMEOUT_MS = 1_000;

/** At most this many `stat`s of the existence check run at once (libuv has 4 threads). */
export const EXISTS_SLOTS = 2;

/** How long a record waits once for a lock that another process holds, before it skips. */
export const LOCK_RETRY_MS = 200;

const FORMAT = 1;

/** An RFC 3339 date and time (`common.schema.json#/$defs/dateTime`). */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

/** One entry of the list. */
export interface RecentWorkspace {
  /** The absolute root as it was opened last; shown, and opened as it is. */
  readonly root: string;
  /** The canonical root (`canonicalRoot`) when it was opened: two names of one folder are one entry. */
  readonly key: string;
  /** When it was opened last (RFC 3339). */
  readonly opened: string;
}

/** An entry with whether its root still holds `reqseq-workspace.yaml`. */
export interface RecentWorkspaceState extends RecentWorkspace {
  readonly exists: boolean;
}

/**
 * Whether `<root>/reqseq-workspace.yaml` is a file, or `"timeout"` when its check had no answer in time
 * (a share that does not answer). A timeout counts as missing wherever only existence matters.
 */
export type ExistenceAnswer = boolean | "timeout";

/** Answers, for each root, whether `<root>/reqseq-workspace.yaml` is a file (in the order of the roots). */
export type ExistenceChecker = (roots: readonly string[]) => Promise<readonly ExistenceAnswer[]>;

export interface ExistenceOptions {
  /** Default `fs.promises.stat`; tests inject one. */
  readonly stat?: (file: string) => Promise<{ isFile(): boolean }>;
  readonly timeoutMs?: number;
  readonly slots?: number;
}

const pathsOf = (platform: NodeJS.Platform): path.PlatformPath =>
  platform === "win32" ? path.win32 : path.posix;

const platformOf = (environment: CacheEnvironment | undefined): NodeJS.Platform =>
  environment?.platform ?? process.platform;

/** `<OS cache>/reqseq`, the folder of the list (next to the cache folders of the copies). */
export function recentWorkspacesFolder(environment?: CacheEnvironment): string {
  return pathsOf(platformOf(environment)).join(osCacheFolder(environment), "reqseq");
}

/** The key of a root: its canonical name (absolute, links resolved, lower case on Windows). */
export function workspaceKey(root: string, platform: NodeJS.Platform = process.platform): string {
  return canonicalRoot(root, platform);
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

/** A text of at most MAX_ROOT_LENGTH characters without NUL (a root or a key the list can hold). */
const isPathText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_ROOT_LENGTH && !value.includes("\0");

const isRoot = (value: unknown, platform: NodeJS.Platform): value is string =>
  isPathText(value) && pathsOf(platform).isAbsolute(value);

const isEntry = (value: unknown, platform: NodeJS.Platform): value is RecentWorkspace =>
  isRecord(value) &&
  isRoot(value["root"], platform) &&
  isPathText(value["key"]) &&
  value["key"] !== "" &&
  typeof value["opened"] === "string" &&
  DATE_TIME.test(value["opened"]);

/**
 * The entries of the text of the file: none for no file, and for content that is not JSON, of another
 * format or with an entry of the wrong shape (the next record overwrites it). A key listed twice counts
 * once (the first), and at most RECENT_WORKSPACES_KEEP are kept.
 */
export function parseRecentWorkspaces(
  text: string | undefined,
  platform: NodeJS.Platform = process.platform,
): readonly RecentWorkspace[] {
  let data: unknown;
  try {
    data = JSON.parse(text ?? "null");
  } catch {
    return [];
  }
  if (!isRecord(data) || data["format"] !== FORMAT || !Array.isArray(data["workspaces"])) {
    return [];
  }
  const entries: readonly unknown[] = data["workspaces"];
  if (!entries.every((entry) => isEntry(entry, platform))) {
    return [];
  }
  const seen = new Set<string>();
  const list: RecentWorkspace[] = [];
  for (const { root, key, opened } of entries) {
    if (!seen.has(key)) {
      seen.add(key);
      list.push({ root, key, opened });
    }
  }
  return list.slice(0, RECENT_WORKSPACES_KEEP);
}

/** The text of the file for `workspaces`; the oldest are left out while it would be too large. */
const serialize = (workspaces: readonly RecentWorkspace[]): string => {
  let kept = workspaces.slice(0, RECENT_WORKSPACES_KEEP);
  const render = (): string =>
    `${JSON.stringify({ format: FORMAT, workspaces: kept } satisfies RecentWorkspacesFile, null, 2)}\n`;
  let text = render();
  // One entry is far below the bound (its root has at most MAX_ROOT_LENGTH characters).
  while (Buffer.byteLength(text, "utf8") > RECENT_WORKSPACES_MAX_BYTES) {
    kept = kept.slice(0, -1);
    text = render();
  }
  return text;
};

/** The list, the most recent first; empty when there is none or it cannot be read. Never rejects. */
export async function readRecentWorkspaces(
  environment?: CacheEnvironment,
): Promise<readonly RecentWorkspace[]> {
  try {
    const text = await readCacheFile(
      recentWorkspacesFolder(environment),
      RECENT_WORKSPACES_FILE,
      RECENT_WORKSPACES_MAX_BYTES,
    );
    return parseRecentWorkspaces(text, platformOf(environment));
  } catch {
    return [];
  }
}

export interface RememberOptions {
  readonly environment?: CacheEnvironment;
  /** The time of the open; default now. */
  readonly now?: Date;
  /** The key of the root when the caller computed it already (`workspaceKey`). */
  readonly key?: string;
}

/**
 * Puts `root` (absolute) first in the list, as opened now: the entry with the same key goes, and the
 * list keeps RECENT_WORKSPACES_KEEP. Read, change and write run under the lock of the file; while
 * another process holds it, the record waits once (LOCK_RETRY_MS) and then skips: the list is a
 * convenience. Resolves `true` when recorded, `false` when skipped (also for a root that is not absolute,
 * holds NUL or is longer than MAX_ROOT_LENGTH, and for a key that long); rejects with the Node error when
 * the file cannot be written.
 */
export async function rememberWorkspace(root: string, options: RememberOptions = {}): Promise<boolean> {
  const { environment } = options;
  const platform = platformOf(environment);
  if (!isRoot(root, platform)) {
    return false;
  }
  const key = options.key ?? workspaceKey(root, platform);
  // Links resolved, the key can be longer than the root; a list with it would not read.
  if (!isPathText(key) || key === "") {
    return false;
  }
  const folder = recentWorkspacesFolder(environment);
  let lock = await lockCacheFile(folder, RECENT_WORKSPACES_FILE);
  if (lock === undefined) {
    await sleep(LOCK_RETRY_MS);
    lock = await lockCacheFile(folder, RECENT_WORKSPACES_FILE);
  }
  if (lock === undefined) {
    return false;
  }
  try {
    let text: string | undefined;
    try {
      text = await readCacheFile(folder, RECENT_WORKSPACES_FILE, RECENT_WORKSPACES_MAX_BYTES);
    } catch {
      // Unreadable (a folder in its place, no rights): it is replaced.
      text = undefined;
    }
    const opened = (options.now ?? new Date()).toISOString();
    const rest = parseRecentWorkspaces(text, platform).filter((entry) => entry.key !== key);
    await writeCacheFile(folder, RECENT_WORKSPACES_FILE, serialize([{ root, key, opened }, ...rest]));
    return true;
  } finally {
    await lock.release();
  }
}

/** Whether `<root>/reqseq-workspace.yaml` is a file; never rejects. The root itself, never a folder above. */
const holdsWorkspace = async (
  stat: NonNullable<ExistenceOptions["stat"]>,
  root: string,
): Promise<boolean> => {
  try {
    return (await stat(path.join(root, WORKSPACE_FILE))).isFile();
  } catch {
    return false;
  }
};

/**
 * An existence check with a bound on the threads it takes and on the time it takes. A `stat` that hangs
 * (a share or an automount that does not answer) cannot be cancelled and keeps its libuv thread, so:
 * - at most `slots` `stat`s run at once, across all calls of this checker; a slot is freed only when its
 *   `stat` returns, never at the timeout;
 * - `timeoutMs` counts from the call: a root without an answer by then is `"timeout"`, and a root still
 *   waiting for a slot then gets no `stat` at all.
 */
export function createExistenceChecker(options: ExistenceOptions = {}): ExistenceChecker {
  const stat = options.stat ?? fs.stat;
  const timeoutMs = options.timeoutMs ?? EXISTS_TIMEOUT_MS;
  const slots = options.slots ?? EXISTS_SLOTS;
  let running = 0;
  const queue: (() => Promise<void>)[] = [];
  const pump = (): void => {
    while (running < slots) {
      const job = queue.shift();
      if (job === undefined) {
        return;
      }
      running += 1;
      void job().finally(() => {
        running -= 1;
        pump();
      });
    }
  };
  return (roots) =>
    new Promise((resolve) => {
      const found = roots.map((): ExistenceAnswer => "timeout");
      let left = roots.length;
      let done = false;
      const jobs: (() => Promise<void>)[] = [];
      const finish = (): void => {
        done = true;
        clearTimeout(timer);
        // Roots still waiting for a slot get no `stat`.
        for (const job of jobs) {
          const at = queue.indexOf(job);
          if (at >= 0) {
            queue.splice(at, 1);
          }
        }
        resolve(found);
      };
      for (const [index, root] of roots.entries()) {
        jobs.push(async () => {
          const holds = await holdsWorkspace(stat, root);
          if (!done) {
            found[index] = holds;
            left -= 1;
            if (left === 0) {
              finish();
            }
          }
        });
      }
      const timer = setTimeout(finish, timeoutMs);
      if (left === 0) {
        finish();
        return;
      }
      queue.push(...jobs);
      pump();
    });
}

/**
 * The existence checks of a process: one for the list, one for the root a person chose, one for the
 * folders of a typed path. Each has slots of its own, so a `stat` that hangs in one never blocks another.
 */
export interface WorkspaceChecks {
  /** The roots of the list when it is shown: EXISTS_SLOTS `stat`s at once. */
  readonly list: ExistenceChecker;
  /**
   * The root of the list chosen to open (it is checked again): one slot of its own, so roots of the list
   * that hang on a dead share cannot keep a local workspace from opening. A root that hangs in the list
   * counts as missing there and is never chosen to open.
   */
  readonly chosen: ExistenceChecker;
  /**
   * The folders of a typed path (`findTypedWorkspace`): one slot of its own, so a typed path on a dead
   * mount blocks only further typed paths, never the choice of a root of the list.
   */
  readonly typed: ExistenceChecker;
}

/** The three checkers of a process; `stat` and the timeout for tests. */
export function createWorkspaceChecks(
  options: Pick<ExistenceOptions, "stat" | "timeoutMs"> = {},
): WorkspaceChecks {
  return {
    list: createExistenceChecker(options),
    chosen: createExistenceChecker({ ...options, slots: 1 }),
    typed: createExistenceChecker({ ...options, slots: 1 }),
  };
}

/** The checkers of this process (the app's main process uses them): at most 4 `stat`s at once. */
const checks: WorkspaceChecks = createWorkspaceChecks();

/**
 * Whether `<root>/reqseq-workspace.yaml` is a file, within EXISTS_TIMEOUT_MS; never rejects. By default
 * with the checker for a chosen root (`WorkspaceChecks.chosen`).
 */
export async function workspaceExists(
  root: string,
  check: ExistenceChecker = checks.chosen,
): Promise<boolean> {
  const [exists] = await check([root]);
  return exists === true;
}

/** The list with whether each root still holds a workspace (`createExistenceChecker`); never rejects. */
export async function recentWorkspaceStates(
  options: { readonly environment?: CacheEnvironment; readonly check?: ExistenceChecker } = {},
): Promise<readonly RecentWorkspaceState[]> {
  const list = await readRecentWorkspaces(options.environment);
  const exists = await (options.check ?? checks.list)(list.map((entry) => entry.root));
  return list.map((entry, index) => ({ ...entry, exists: exists[index] === true }));
}

export interface TypedPathOptions {
  /** Default the platform of this process. */
  readonly platform?: NodeJS.Platform;
  /** The home folder, which `~` stands for (`os.homedir()`). */
  readonly home: string;
}

/**
 * The folder a typed path names (SR-131 AK5), by its text alone, before any file-system call; undefined
 * when it is refused. `~` and `~/…` stand for the home folder. Refused: a relative path, NUL and more than
 * MAX_ROOT_LENGTH characters. On Windows only a path on a drive (`C:\…`) is taken, after `~` is expanded
 * and the path normalised: a UNC or device path (`\\host\share`, `\\?\…`, `\\.\…`, `//host`, and the NT
 * prefix `\??\…`, also as `/??/…`), whose check would make Windows open a connection to that host
 * (SR-078), is refused, and so is `\foo` (relative to the current drive). A mapped network drive (`Z:\…`)
 * is a path on a drive: its check reaches the share, the user's choice, as for an automounted path
 * (ADR-0010). The path is normalised (`.` and `..` by their text) and has no separator at its end.
 */
export function typedWorkspaceFolder(text: string, options: TypedPathOptions): string | undefined {
  const platform = options.platform ?? process.platform;
  const paths = pathsOf(platform);
  if (!isPathText(text)) {
    return undefined;
  }
  const windows = platform === "win32";
  const home = windows ? /^~[\\/]/ : /^~\//;
  const expanded =
    text === "~" ? options.home : home.test(text) ? paths.join(options.home, text.slice(2)) : text;
  if (!paths.isAbsolute(expanded)) {
    return undefined;
  }
  let folder = paths.normalize(expanded);
  while (folder.endsWith(paths.sep) && folder.length > paths.parse(folder).root.length) {
    folder = folder.slice(0, -1);
  }
  // On Windows a drive and nothing else: no UNC, device or NT path, and no path on the current drive.
  const local = !windows || /^[A-Za-z]:\\/.test(folder);
  return isPathText(folder) && local ? folder : undefined;
}

/**
 * The nearest folder, from `folder` (absolute, from `typedWorkspaceFolder`) upwards, whose
 * `reqseq-workspace.yaml` is a file, as `--workspace` of the CLI finds it; undefined when none up to the
 * root of the file system has one. Each folder is checked with the bounded checker for typed paths
 * (`WorkspaceChecks.typed`). A folder whose check timed out ends the walk with undefined: a slow level
 * never opens a workspace above the folder that was meant. Never rejects.
 */
export async function findTypedWorkspace(
  folder: string,
  options: { readonly platform?: NodeJS.Platform; readonly check?: ExistenceChecker } = {},
): Promise<string | undefined> {
  const paths = pathsOf(options.platform ?? process.platform);
  const check = options.check ?? checks.typed;
  for (let dir = folder; ;) {
    const [exists] = await check([dir]);
    if (exists === true) {
      return dir;
    }
    if (exists === "timeout") {
      return undefined;
    }
    const parent = paths.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}
