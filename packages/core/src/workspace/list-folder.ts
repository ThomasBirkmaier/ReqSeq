// The entries of a folder, the values that complete a path argument (SR-143, `workspace.listFolder`).
// A typed path is split at its last separator: the folder before it is listed, the name after it is the
// typed name. The folder is checked by its text first (`localFolder`, no file-system call); the listing
// reads only the folder's entries (`opendir`), never `stat`s an entry and never follows a link, so it
// opens no share and reads nothing a link points to (SR-078, SR-142): a link is listed by its name as
// kind `link`. It runs in a bounded slot of its own with a timeout (`createBoundedRunner`), so a folder
// on a share that does not answer holds only that slot, never the other file access of the process.
// One hung listing makes every later listing of the process unreadable until it returns.
//
// Known limit: where the file system gives no entry type with the names (`DT_UNKNOWN`: NFS without
// readdirplus, some FUSE file systems, XFS without `ftype`), Node finds the type with a synchronous
// `lstat` per entry on the event loop, outside the slot and its timeout. It never follows a link. On
// Windows libuv reports every reparse point (links, junctions, OneDrive and Cloud Files placeholders,
// deduplicated files, app execution aliases) as a link.
//
// Main loads this module on its own (`@reqseq/core/list-folder`), so it imports only `node:*`,
// `path-text.ts` and `recent.ts`.
import fs from "node:fs/promises";
import type { BoundedRun } from "./recent.js";
import { createBoundedRunner } from "./recent.js";
import { localFolder } from "./path-text.js";

// The slot of main for typed paths, which main's listing of "Open workspace" shares (`WorkspaceChecks`).
export { typedPathRun } from "./recent.js";

/** A listing without an answer this long after it was asked counts as unreadable. */
export const LIST_TIMEOUT_MS = 1_000;

/** At most this many entries are listed; `truncated` says that there were more. */
export const LIST_MAX_ENTRIES = 50_000;

export type FolderEntryKind = "folder" | "file" | "link";

export interface FolderEntry {
  /** The name as the file system spells it. */
  readonly name: string;
  readonly kind: FolderEntryKind;
}

/** Why a folder gives no entries: it is not there, it cannot be read (or had no answer in time). */
export type ListProblem = "missing" | "unreadable";

export interface FolderListing {
  readonly entries: FolderEntry[];
  readonly problem?: ListProblem;
  readonly truncated?: true;
}

export interface ListOptions {
  /** Also the files; folders and links always. */
  readonly files: boolean;
  /** Also the names that start with "." (the typed name starts with one). */
  readonly dots: boolean;
  /** Default the listing slot of this process; tests inject one. */
  readonly run?: BoundedRun;
  readonly timeoutMs?: number;
  /** Default `fs.promises.opendir`; tests inject one. */
  readonly opendir?: (folder: string) => Promise<AsyncIterable<FolderDirent>>;
  readonly maxEntries?: number;
}

/** What the listing reads of an entry: its name and type, from the folder alone. */
export interface FolderDirent {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

/** A typed path split at its last separator (`/`, and `\` on Windows). */
export interface TypedPath {
  /** The text up to and with the last separator; empty when there is none. */
  readonly folder: string;
  /** The text after it: the name being typed. */
  readonly name: string;
}

/** Splits `text` at its last separator; `\` is a separator only on Windows. */
export function splitTypedPath(text: string, platform: NodeJS.Platform = process.platform): TypedPath {
  const at =
    platform === "win32" ? Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\")) : text.lastIndexOf("/");
  return { folder: text.slice(0, at + 1), name: text.slice(at + 1) };
}

/** The listing slot of this process: one, so a hung listing blocks only further listings. */
const slot: BoundedRun = createBoundedRunner(1);

const kindOf = (entry: FolderDirent): FolderEntryKind | undefined =>
  entry.isDirectory() ? "folder" : entry.isSymbolicLink() ? "link" : entry.isFile() ? "file" : undefined;

/** An entry with its sort key, the NFC form of its name, computed once. */
interface Keyed {
  readonly entry: FolderEntry;
  readonly key: string;
}

/** By the code units of the key. */
const byKey = (a: Keyed, b: Keyed): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** `entries` of one group sorted by the NFC form of the name. */
const sorted = (entries: readonly FolderEntry[]): FolderEntry[] =>
  entries
    .map((entry) => ({ entry, key: entry.name.normalize("NFC") }))
    .sort(byKey)
    .map((keyed) => keyed.entry);

const problemOf = (error: unknown): ListProblem =>
  (error as { code?: unknown }).code === "ENOENT" ? "missing" : "unreadable";

/**
 * The entries of `folder` (absolute, checked by its text), sorted folders and links first, then files,
 * each by name; never rejects. Other entries (sockets, devices) are left out. ENOENT gives `missing`;
 * every other error (EACCES, EPERM, ENOTDIR, ELOOP, EIO) and no answer within the timeout give
 * `unreadable`. When more than `maxEntries` match (`truncated`), folders and links come first: the
 * first `maxEntries` of them read, then as many of the files read as fit.
 */
export async function listFolder(folder: string, options: ListOptions): Promise<FolderListing> {
  // A larger buffer than the default 32 entries: fewer round trips through the thread pool (SR-143 AK5).
  const opendir = options.opendir ?? ((dir: string) => fs.opendir(dir, { bufferSize: 1024 }));
  const max = options.maxEntries ?? LIST_MAX_ENTRIES;
  const job = async (expired: () => boolean): Promise<FolderListing> => {
    const folders: FolderEntry[] = [];
    const files: FolderEntry[] = [];
    let truncated = false;
    for await (const entry of await opendir(folder)) {
      if (expired()) {
        break;
      }
      const kind = kindOf(entry);
      if (
        kind === undefined ||
        (kind === "file" && !options.files) ||
        (entry.name.startsWith(".") && !options.dots)
      ) {
        continue;
      }
      const group = kind === "file" ? files : folders;
      if (group.length === max) {
        truncated = true;
        if (group === folders) {
          break;
        }
        continue;
      }
      group.push({ name: entry.name, kind });
    }
    const room = max - folders.length;
    truncated ||= files.length > room;
    const entries = [...sorted(folders), ...sorted(files.slice(0, room))];
    return truncated ? { entries, truncated: true } : { entries };
  };
  try {
    const listing = await (options.run ?? slot)(job, options.timeoutMs ?? LIST_TIMEOUT_MS);
    return listing === "timeout" ? { entries: [], problem: "unreadable" } : listing;
  } catch (error) {
    return { entries: [], problem: problemOf(error) };
  }
}

/** The listing of a typed path: the folder listed, the typed name, and its entries or why there are none. */
export interface TypedListing {
  /** The folder listed (absolute); missing when the text is refused (`invalid`). */
  readonly folder?: string;
  /** The typed name after the last separator. */
  readonly name: string;
  readonly entries: FolderEntry[];
  readonly problem?: ListProblem | "invalid";
  readonly truncated?: true;
}

export interface TypedListOptions extends Omit<ListOptions, "dots"> {
  /** Default the platform of this process. */
  readonly platform?: NodeJS.Platform;
  /**
   * The home folder that `~` stands for, as the path arguments of the access take it (`LocalPaths.home`,
   * and always for "Open workspace"); without it `~` is an ordinary name.
   */
  readonly home?: string | undefined;
  /** The folder a relative path is resolved from; without it the path must be absolute. */
  readonly base?: string | undefined;
  /** Called with the folder before it is listed (the SR-142 rule of the access); may reject. */
  readonly check?: (folder: string) => Promise<void>;
}

/**
 * Lists the folder of a typed path (`splitTypedPath`, `localFolder`): names that start with "." only when
 * the typed name does. A text refused by `localFolder` gives `invalid` without any file-system call.
 * Rejects only when `check` does.
 */
export async function listTypedFolder(text: string, options: TypedListOptions): Promise<TypedListing> {
  const { platform = process.platform, base, home, check, ...rest } = options;
  const typed = splitTypedPath(text, platform);
  const folder = localFolder(typed.folder, { platform, home, base });
  if (folder === undefined) {
    return { name: typed.name, entries: [], problem: "invalid" };
  }
  await check?.(folder);
  return {
    folder,
    name: typed.name,
    ...(await listFolder(folder, { ...rest, dots: typed.name.startsWith(".") })),
  };
}
