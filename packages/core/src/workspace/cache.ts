// The cache folder of a working copy (ADR-0008, SR-081 AK2): `<OS cache>/logreq/<sha256 of the canonical
// workspace root>/`, never inside a repository and never shared between copies. The token file of the
// local API lives there (ADR-0009); the model cache follows with SR-081 and SR-082.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PrivateLock } from "../files/index.js";
import { lockPrivateFile, removePrivateFile, writePrivateFile } from "../files/index.js";

export { LOCK_STALE_MS, processRuns } from "../files/index.js";
export type { PrivateLock } from "../files/index.js";

/** Where the OS keeps caches; tests pass their own values. */
export interface CacheEnvironment {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
}

const processEnvironment = (): CacheEnvironment => ({
  platform: process.platform,
  env: process.env,
  home: os.homedir(),
});

/** An environment variable that names an absolute folder, else `undefined`. */
const absoluteVariable = (value: string | undefined, platform: NodeJS.Platform): string | undefined =>
  value !== undefined && (platform === "win32" ? path.win32 : path.posix).isAbsolute(value)
    ? value
    : undefined;

/**
 * The cache folder of the OS user: `%LOCALAPPDATA%` on Windows, `~/Library/Caches` on macOS, else
 * `$XDG_CACHE_HOME` or `~/.cache` (XDG Base Directory). A variable that is not an absolute path is ignored.
 */
export function osCacheFolder(environment: CacheEnvironment = processEnvironment()): string {
  const { platform, env, home } = environment;
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (platform === "win32") {
    return absoluteVariable(env["LOCALAPPDATA"], platform) ?? paths.join(home, "AppData", "Local");
  }
  return platform === "darwin"
    ? paths.join(home, "Library", "Caches")
    : (absoluteVariable(env["XDG_CACHE_HOME"], platform) ?? paths.join(home, ".cache"));
}

/**
 * The root as one name per folder: absolute, with symbolic links resolved (`realpath`), and in lower case on
 * Windows, whose paths ignore case. A root that does not exist keeps its absolute path.
 */
export function canonicalRoot(root: string, platform: NodeJS.Platform = process.platform): string {
  const absolute = (platform === "win32" ? path.win32 : path.posix).resolve(root);
  let real: string;
  try {
    real = realpathSync.native(absolute);
  } catch {
    real = absolute;
  }
  return platform === "win32" ? real.toLowerCase() : real;
}

/**
 * The cache folder of the working copy with this root (resolved against the current folder). Two names of
 * the same folder (a symbolic link, another case on Windows) give the same cache folder.
 */
export function cacheFolder(root: string, environment: CacheEnvironment = processEnvironment()): string {
  const paths = environment.platform === "win32" ? path.win32 : path.posix;
  const hash = createHash("sha256").update(canonicalRoot(root, environment.platform), "utf8").digest("hex");
  return paths.join(osCacheFolder(environment), "logreq", hash);
}

/** Read errors that mean "there is no such file". */
const MISSING: readonly string[] = ["ENOENT", "ENOTDIR"];

/** Names of cache files: lower case, digits and dashes, `.json`; never a path. */
const CACHE_FILE = /^[a-z][a-z0-9-]*\.json$/;

/**
 * Write a private file (mode 0600) into a cache folder (`cacheFolder(root)` for a working copy) and
 * return its absolute path. Throws a plain `Error` for a name that is not a plain cache file name (a
 * programming error); a failing write rejects with the Node error.
 */
export async function writeCacheFile(folder: string, name: string, text: string): Promise<string> {
  const file = cacheFile(folder, name);
  await writePrivateFile(file, text);
  return file;
}

/** The path of a cache file; throws a plain `Error` for a name that is not a plain cache file name. */
const cacheFile = (folder: string, name: string): string => {
  if (!CACHE_FILE.test(name)) {
    throw new Error(`not a cache file name: ${name}`);
  }
  return path.join(folder, name);
};

/**
 * The text of a cache file, or `undefined` when there is none (also when a folder on its path is a file).
 * With `maxBytes`, a file larger than that gives `undefined` as well, and at most `maxBytes + 1` bytes of
 * it are read (a file that the app reads on every event of the folder, e.g. `activity.json`). Rejects with
 * the Node error otherwise.
 */
export async function readCacheFile(
  folder: string,
  name: string,
  maxBytes?: number,
): Promise<string | undefined> {
  const file = cacheFile(folder, name);
  try {
    if (maxBytes === undefined) {
      return await fs.readFile(file, "utf8");
    }
    return await readAtMost(file, maxBytes);
  } catch (error) {
    if (MISSING.includes(String((error as NodeJS.ErrnoException).code))) {
      return undefined;
    }
    throw error;
  }
}

/**
 * The text of `file` when it has at most `maxBytes` bytes, else undefined. It reads at most `maxBytes + 1`
 * bytes, and judges the bytes it read, not a size looked at before (a file written in place meanwhile).
 */
const readAtMost = async (file: string, maxBytes: number): Promise<string | undefined> => {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    let bytesRead: number;
    do {
      ({ bytesRead } = await handle.read(buffer, length, buffer.length - length, length));
      length += bytesRead;
    } while (bytesRead > 0 && length < buffer.length);
    return length > maxBytes ? undefined : buffer.toString("utf8", 0, length);
  } finally {
    await handle.close();
  }
};

/** Remove a cache file if it is there. Rejects with the Node error when it cannot be removed. */
export async function removeCacheFile(folder: string, name: string): Promise<void> {
  await removePrivateFile(cacheFile(folder, name));
}

/**
 * Take the lock `<name>.lock` of a cache file (`lockPrivateFile`), e.g. around the check and the write of
 * `api.json` (ADR-0009). Resolves `undefined` while another process holds it.
 */
export async function lockCacheFile(folder: string, name: string): Promise<PrivateLock | undefined> {
  return lockPrivateFile(`${cacheFile(folder, name)}.lock`);
}
