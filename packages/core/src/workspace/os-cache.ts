// The cache folder of the OS user, and the folder of Node's compile cache of the CLI in it (#178).
// No other imports, so the CLI binary can load it before it enables that cache (`@reqseq/core/os-cache`).
import os from "node:os";
import path from "node:path";

/** Where the OS keeps caches; tests pass their own values. */
export interface CacheEnvironment {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
}

/** The `CacheEnvironment` of this process. */
export const processEnvironment = (): CacheEnvironment => ({
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
 * The folder of Node's compile cache of the CLI (#178): `<OS cache>/reqseq/node-compile-cache`, one per OS
 * user and shared by all working copies. It holds only compiled code of ReqSeq, nothing of a working copy,
 * so SR-081 AK2 (caches separate per copy) does not apply to it (assumption, #882). Node keys its entries
 * by its version and checks each against the source, so a stale or lost entry costs only time.
 */
export function compileCacheFolder(environment: CacheEnvironment = processEnvironment()): string {
  const paths = environment.platform === "win32" ? path.win32 : path.posix;
  return paths.join(osCacheFolder(environment), "reqseq", "node-compile-cache");
}
