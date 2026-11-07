// The entries of a folder, the values that complete a path argument (SR-143, `workspace.listFolder`).
// A typed path is split at its last separator: the folder before it is listed, the name after it is the
// typed name. The folder is checked by its text first (`localFolder`, no file-system call); the listing
// reads only the folder's entries (`opendir`), never `stat`s an entry and never follows a link, so it
// opens no share and reads nothing a link points to (SR-078, SR-142): a link is listed by its name as
// kind `link`. It runs in a bounded slot of its own with a timeout (`createBoundedRunner`), so a folder
// on a share that does not answer holds only that slot, never the other file access of the process.
//
// Main loads this module on its own (`@reqseq/core/list-folder`), so it imports only `node:*`,
// `path-text.ts` and `recent.ts`.
import fs from "node:fs/promises";
import type { BoundedRun } from "./recent.js";
import { createBoundedRunner } from "./recent.js";
import { localFolder } from "./path-text.js";

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

const RANK: Readonly<Record<FolderEntryKind, number>> = { folder: 0, link: 0, file: 1 };

const kindOf = (entry: FolderDirent): FolderEntryKind | undefined =>
  entry.isDirectory() ? "folder" : entry.isSymbolicLink() ? "link" : entry.isFile() ? "file" : undefined;

/** Folders and links first, then files; each by the code units of the NFC form of the name. */
const byKindAndName = (a: FolderEntry, b: FolderEntry): number => {
  const rank = RANK[a.kind] - RANK[b.kind];
  if (rank !== 0) {
    return rank;
  }
  const x = a.name.normalize("NFC");
  const y = b.name.normalize("NFC");
  return x < y ? -1 : x > y ? 1 : 0;
};

const problemOf = (error: unknown): ListProblem =>
  (error as { code?: unknown }).code === "ENOENT" ? "missing" : "unreadable";

/**
 * The entries of `folder` (absolute, checked by its text), sorted folders and links first, then files,
 * each by name; never rejects. Other entries (sockets, devices) are left out. ENOENT gives `missing`;
 * every other error (EACCES, EPERM, ENOTDIR, ELOOP, EIO) and no answer within the timeout give
 * `unreadable`. When more than `maxEntries` match, the first that many read are listed (`truncated`).
 */
export async function listFolder(folder: string, options: ListOptions): Promise<FolderListing> {
  const opendir = options.opendir ?? ((dir: string) => fs.opendir(dir));
  const max = options.maxEntries ?? LIST_MAX_ENTRIES;
  const job = async (expired: () => boolean): Promise<FolderListing> => {
    const entries: FolderEntry[] = [];
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
      if (entries.length === max) {
        truncated = true;
        break;
      }
      entries.push({ name: entry.name, kind });
    }
    entries.sort(byKindAndName);
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
  /** The home folder, which `~` stands for when `base` is not given. */
  readonly home: string;
  /**
   * The folder a relative path is resolved from; without it the path must be absolute (`~` for home).
   * With it, `~` is an ordinary name, as the commands resolve a path argument.
   */
  readonly base?: string;
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
  const folder = localFolder(typed.folder, base === undefined ? { platform, home } : { platform, base });
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
