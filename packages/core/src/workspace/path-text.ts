// A typed local path checked by its text alone, before any file-system call (SR-131 AK5, SR-143, the
// offline rule SR-078): a path whose check would make Windows open a connection or a device is refused
// unopened. "Open workspace" (`typedWorkspaceFolder`), the folder listing (`workspace.listFolder`) and the
// SR-142 rule (`local-paths.ts`) share these rules. Main loads this module through `recent.ts` and
// `list-folder.ts`, so it imports only `node:*`.
import path from "node:path";

/** The longest path text taken, in characters. */
export const MAX_PATH_LENGTH = 4096;

/** Names Windows opens as devices, also with an extension (`nul.txt`). */
const DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/iu;

/** The path functions of `platform`. */
export const pathsOf = (platform: NodeJS.Platform): path.PlatformPath =>
  platform === "win32" ? path.win32 : path.posix;

/** A text of at most MAX_PATH_LENGTH characters without NUL. */
export const isPathText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_PATH_LENGTH && !value.includes("\0");

/** A name Windows does not open as written: trailing dots and spaces dropped, a stream, a device. */
export const unsafeOnWindows = (name: string): boolean => {
  const trimmed = name.replace(/[. ]+$/u, "");
  return trimmed === "" || name.includes(":") || DEVICE_NAME.test(trimmed);
};

export interface LocalFolderOptions {
  /** Default the platform of this process. */
  readonly platform?: NodeJS.Platform;
  /** The home folder `~` and `~/…` stand for; without it `~` is an ordinary name. */
  readonly home?: string | undefined;
  /** The folder a relative path is resolved from (absolute); without it a relative path is refused. */
  readonly base?: string | undefined;
}

/**
 * The folder a typed path names, by its text alone; undefined when it is refused. Refused: NUL, more
 * than MAX_PATH_LENGTH characters, and a relative path without `base`. On Windows an absolute path is
 * taken only on a drive (`C:\…`), after `~` is expanded and the path normalised: a UNC or device path
 * (`\\host\share`, `\\?\…`, `\\.\…`, `//host`, and the NT prefix `\??\…`, also as `/??/…`), whose check
 * would make Windows open a connection to that host (SR-078), is refused, and so is `\foo` (on the
 * current drive); a relative path is refused with a drive (`C:foo`), and resolved from `base` otherwise,
 * also on a share the workspace already lies on. A name Windows opens as a device or a stream (`CON`,
 * `nul.txt`, `a:b`) is refused too. The result is normalised (`.` and `..` by their text) and has no
 * separator at its end.
 */
export function localFolder(text: string, options: LocalFolderOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  const paths = pathsOf(platform);
  if (!isPathText(text)) {
    return undefined;
  }
  const windows = platform === "win32";
  const expanded = expandHome(text, options.home, platform);
  const absolute = paths.isAbsolute(expanded);
  const { base } = options;
  if (!absolute && (base === undefined || (windows && /^[A-Za-z]:/.test(expanded)))) {
    return undefined;
  }
  const folder = withoutTrailingSeparator(
    base === undefined || absolute ? paths.normalize(expanded) : paths.resolve(base, expanded),
    paths,
  );
  // On Windows a drive and nothing else for a typed absolute path: no UNC, device or NT path.
  const refused = windows && ((absolute && !/^[A-Za-z]:\\/.test(folder)) || hasUnsafeName(folder));
  return isPathText(folder) && !refused ? folder : undefined;
}

/**
 * `~` and `~/…` (also `~\…` on Windows) as `home`; any other text, and every text without a home, as it
 * is. The folder listing and the path arguments of the app (`appLocalPaths`) share it, so a suggestion
 * and the file a command then reads or writes agree.
 */
export const expandHome = (
  text: string,
  home: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string => {
  if (home === undefined) {
    return text;
  }
  if (text === "~") {
    return home;
  }
  return (platform === "win32" ? /^~[\\/]/ : /^~\//).test(text)
    ? pathsOf(platform).join(home, text.slice(2))
    : text;
};

/** `folder` without separators at its end, its root excepted. */
const withoutTrailingSeparator = (folder: string, paths: path.PlatformPath): string => {
  const { root } = paths.parse(folder);
  let trimmed = folder;
  while (trimmed.endsWith(paths.sep) && trimmed.length > root.length) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
};

/** Whether a name below the root of a Windows path is a device or a stream. */
const hasUnsafeName = (folder: string): boolean =>
  folder.slice(path.win32.parse(folder).root.length).split("\\").filter(Boolean).some(unsafeOnWindows);
