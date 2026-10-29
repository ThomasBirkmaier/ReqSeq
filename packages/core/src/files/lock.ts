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

/** Text and modification time of `file`, or `undefined` when it is gone. */
const readLock = async (file: string): Promise<FoundLock | undefined> => {
  try {
    const [text, stat] = await retry(
      () => Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]),
      TRANSIENT_CODES,
    );
    return { text, modified: stat.mtimeMs };
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
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

/** Create `file` with `text` exclusively: false when it exists. A failed write leaves no file behind. */
const createExclusive = async (file: string, text: string): Promise<boolean> => {
  let handle: fs.FileHandle;
  try {
    // On Windows a file that is being removed while another process has it open refuses for a moment.
    handle = await retry(() => fs.open(file, "wx", 0o600), TRANSIENT_CODES);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      return false;
    }
    throw error;
  }
  try {
    await handle.writeFile(text, "utf8");
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await removeQuietly(file);
    throw error;
  }
  return true;
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
  if (!(await createExclusive(breaker, lockText()))) {
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
    await retry(() => fs.rm(file, { force: true }), TRANSIENT_CODES);
    return true;
  } finally {
    await removeQuietly(breaker);
  }
};

/**
 * Take the lock file `file` (absolute path): create it exclusively with mode 0600 (missing folders with
 * 0700), holding this process ID. Resolves `undefined` while another start holds it: its process runs and
 * it was taken less than LOCK_STALE_MS ago. A stale lock is broken and taken. Rejects with the Node error
 * when the folder or the file cannot be created, read or removed.
 */
export async function lockPrivateFile(file: string): Promise<PrivateLock | undefined> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const own = lockText();
  const release = async (): Promise<void> => {
    try {
      if ((await fs.readFile(file, "utf8")) === own) {
        await retry(() => fs.rm(file, { force: true }), TRANSIENT_CODES);
      }
    } catch {
      // Gone already, or it cannot be removed: stale once this process ends.
    }
  };
  for (let attempt = 1; attempt <= LOCK_ATTEMPTS; attempt++) {
    if (await createExclusive(file, own)) {
      return { file, release };
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
