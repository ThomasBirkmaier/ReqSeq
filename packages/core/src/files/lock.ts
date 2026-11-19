// Lock files of ReqSeq outside the working tree, e.g. the one around the start of the local API, so that
// two `reqseq serve api` for the same working copy never both write `api.json` (ADR-0009). A lock is a
// private file (mode 0600) created with exclusive create, which every file system that ReqSeq runs on
// (NTFS, ext4, APFS, ...) makes atomic: of two processes that create it at the same time, one gets it.
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { errorCode } from "./paths.js";
import { retry, TRANSIENT_CODES } from "./retry.js";

/**
 * Age after which a lock counts as stale even when its process ID runs (a reused ID) or the file names none
 * (a start that crashed while writing it). Taking and giving back a lock spans about a second.
 */
export const LOCK_STALE_MS = 30_000;

/**
 * The retries of the lock's own file operations. On Windows a lock file that was just given back can stay
 * pending deletion while a scanner or indexer has it open, and creating or reading it fails with EPERM for
 * longer than the default window of about 0.2 s (#720): 10 attempts wait about 0.9 s in total. Every
 * create and read of the lock and every removal that has to succeed uses it.
 */
const LOCK_RETRY = { attempts: 10, delayMs: 20 } as const;

/** How often a stale lock is broken and taken again before the lock counts as held. */
const LOCK_ATTEMPTS = 3;

/** A lock that this process holds. */
export interface PrivateLock {
  /** Absolute path of the lock file. */
  readonly file: string;
  /**
   * Removes the lock file while it is still this lock's own. Never rejects: a lock file that cannot be
   * removed turns stale when this process ends, or after LOCK_STALE_MS.
   */
  release(): Promise<void>;
}

/** Whether a process with this ID runs; one of another user (EPERM) runs too. Not an ID: false. */
export function processRuns(pid: unknown): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid < 1) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

/** The text of a new lock of this process: its ID, a nonce that makes it unique, and when it was taken. */
const lockText = (): string =>
  JSON.stringify({ pid: process.pid, nonce: randomBytes(16).toString("hex"), created: Date.now() });

/** A lock file as found on disk. */
interface FoundLock {
  readonly text: string;
  readonly modified: number;
}

/** The numbers under `pid` and `created` in the text of a lock file (none yet, or not JSON: undefined). */
const fieldsOf = (text: string): { pid?: number | undefined; created?: number | undefined } => {
  try {
    const value: unknown = JSON.parse(text);
    const fields = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const number = (name: string): number | undefined =>
      typeof fields[name] === "number" ? fields[name] : undefined;
    return { pid: number("pid"), created: number("created") };
  } catch {
    return {};
  }
};

/**
 * A lock is stale when its process does not run, or when the time it was taken (`created`; for a broken
 * lock its modification time) is more than LOCK_STALE_MS away from now: older (a reused process ID), or
 * newer (a clock that went back). A young lock without a process ID is one that is being written.
 */
const isStale = (lock: FoundLock, now: number): boolean => {
  const { pid, created } = fieldsOf(lock.text);
  if (pid !== undefined && !processRuns(pid)) {
    return true;
  }
  return Math.abs(now - (created ?? lock.modified)) > LOCK_STALE_MS;
};

/**
 * The errors that count as a refusal of a file that is still there, on every platform. Windows gives EPERM
 * for a file that is pending deletion (or whose rights deny it) and EBUSY for one that another program
 * holds open. An unreadable file on Linux or macOS fails with EACCES, which is no refusal.
 */
const REFUSED_CODES: readonly string[] = ["EPERM", "EBUSY"];

/**
 * Whether `error` refuses a `file` that its folder still lists. On Windows a lock file given back can stay
 * pending deletion for longer than the retries wait (#1944). Such a lock file is still there, so it counts
 * as held, not as a file that cannot be written: a folder where no file can be created lists none (one that
 * cannot be listed counts as such).
 */
const refusedWhileListed = async (error: unknown, file: string): Promise<boolean> => {
  if (!REFUSED_CODES.includes(errorCode(error) ?? "")) {
    return false;
  }
  try {
    return (await fs.readdir(path.dirname(file))).includes(path.basename(file));
  } catch {
    return false;
  }
};

/**
 * Text and modification time of `file`, or `undefined` when it is gone. A file that Windows refuses while
 * its folder lists it reads as a lock without a process ID, of its modification time where `stat` gives
 * one and else of now: held while young, stale when old.
 */
const readLock = async (file: string): Promise<FoundLock | undefined> => {
  try {
    const [text, stat] = await retry(
      () => Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]),
      TRANSIENT_CODES,
      LOCK_RETRY,
    );
    return { text, modified: stat.mtimeMs };
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    if (await refusedWhileListed(error, file)) {
      // Dated by its modification time where `stat` gives one, so that an old lock refused for good turns
      // stale; without one it is dated now and counts as held.
      const stat = await fs.stat(file).catch(() => undefined);
      return { text: "", modified: stat?.mtimeMs ?? Date.now() };
    }
    throw error;
  }
};

const sameLock = (a: FoundLock, b: FoundLock): boolean => a.text === b.text && a.modified === b.modified;

const removeQuietly = async (file: string): Promise<void> => {
  try {
    await fs.rm(file, { force: true });
  } catch {
    // Left behind, it turns stale when this process ends.
  }
};

/**
 * What an exclusive create found: `created` it, a file that `exists` already, or one that is `refused`
 * while its folder lists it (`refusedWhileListed`).
 */
type Created = "created" | "exists" | "refused";

/** What a failed exclusive create of `file` found: `exists`, `refused`, or `undefined` for neither. */
const foundBy = async (error: unknown, file: string): Promise<Exclude<Created, "created"> | undefined> => {
  if (errorCode(error) === "EEXIST") {
    return "exists";
  }
  return (await refusedWhileListed(error, file)) ? "refused" : undefined;
};

/**
 * Create `file` with `text` exclusively. A failed write leaves no file behind. A refusal whose name is no
 * longer listed may have been given back between the last try and the listing: one more create decides.
 */
const createExclusive = async (file: string, text: string): Promise<Created> => {
  let handle: fs.FileHandle;
  try {
    // On Windows a file that is being removed while another process has it open refuses for a moment.
    handle = await retry(() => fs.open(file, "wx", 0o600), TRANSIENT_CODES, LOCK_RETRY);
  } catch (error) {
    const found = await foundBy(error, file);
    if (found !== undefined) {
      return found;
    }
    if (!REFUSED_CODES.includes(errorCode(error) ?? "")) {
      throw error;
    }
    try {
      handle = await fs.open(file, "wx", 0o600);
    } catch (again) {
      const foundAgain = await foundBy(again, file);
      if (foundAgain !== undefined) {
        return foundAgain;
      }
      throw again;
    }
  }
  try {
    await handle.writeFile(text, "utf8");
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await removeQuietly(file);
    throw error;
  }
  return "created";
};

/**
 * Break the stale lock `file` found as `stale`. Only one start at a time may break a lock: the one that
 * creates `<file>.break` exclusively. It removes the lock only while its text and modification time are
 * still those of the stale lock, so a lock that another start took meanwhile stays. True when the lock is
 * gone or a crashed breaker was cleared, so the lock may be tried again; false when it counts as held
 * (another start breaks it, or took it).
 */
const breakStale = async (file: string, stale: FoundLock): Promise<boolean> => {
  const breaker = `${file}.break`;
  const created = await createExclusive(breaker, lockText());
  if (created === "refused") {
    // Another start breaks it, or just did.
    return false;
  }
  if (created === "exists") {
    // A breaker that crashed leaves its file behind: once it is stale and still the same, remove it and
    // try again, so this start can break the lock itself.
    const other = await readLock(breaker);
    if (other === undefined || !isStale(other, Date.now())) {
      return false;
    }
    const again = await readLock(breaker);
    if (again === undefined || !sameLock(again, other)) {
      return false;
    }
    await removeQuietly(breaker);
    return true;
  }
  try {
    const now = await readLock(file);
    if (now === undefined) {
      // Broken by another start meanwhile, which may take it again at any moment: never remove it here.
      return true;
    }
    if (!sameLock(now, stale)) {
      return false;
    }
    await retry(() => fs.rm(file, { force: true }), TRANSIENT_CODES, LOCK_RETRY);
    return true;
  } finally {
    await removeQuietly(breaker);
  }
};

/**
 * Take the lock file `file` (absolute path): create it exclusively with mode 0600 (missing folders with
 * 0700), holding this process ID. Resolves `undefined` while another start holds it: its process runs and
 * it was taken less than LOCK_STALE_MS ago. A lock file that its folder lists but that cannot be opened
 * (EPERM or EBUSY after the retries, `refusedWhileListed`) is being given back or held: a refused create
 * is tried again up to LOCK_ATTEMPTS times and then counts as held; a refused read is dated by the file's
 * modification time (else now), so a young lock counts as held after one try and an old one is broken and
 * taken. A stale lock is broken and taken. Rejects with the Node error when the folder or the file cannot
 * be created, read or removed.
 */
export async function lockPrivateFile(file: string): Promise<PrivateLock | undefined> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const own = lockText();
  const release = async (): Promise<void> => {
    try {
      if ((await retry(() => fs.readFile(file, "utf8"), TRANSIENT_CODES, LOCK_RETRY)) === own) {
        await retry(() => fs.rm(file, { force: true }), TRANSIENT_CODES, LOCK_RETRY);
      }
    } catch {
      // Gone already, or it cannot be removed: stale once this process ends.
    }
  };
  for (let attempt = 1; attempt <= LOCK_ATTEMPTS; attempt++) {
    const created = await createExclusive(file, own);
    if (created === "created") {
      return { file, release };
    }
    if (created === "refused") {
      // Still being given back, also when this start just broke it: try again.
      continue;
    }
    const held = await readLock(file);
    if (held === undefined) {
      // Given back meanwhile.
      continue;
    }
    if (!isStale(held, Date.now()) || !(await breakStale(file, held))) {
      return undefined;
    }
  }
  return undefined;
}
