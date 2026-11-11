import { realpathSync } from "node:fs";
import path from "node:path";
import { CommandError } from "../catalog.js";

/** `name` as Windows and macOS compare it: lower case, trailing dots and spaces dropped. */
export const systemForm = (name: string): string => name.toLowerCase().replace(/[. ]+$/, "");

/**
 * Whether some system takes `name` for `.git` (D-036): as `isSkippedOnSomeSystem` of the walk does
 * (`systemForm`), and also without invisible format characters (HFS+ ignores some, `.g\u200cit`),
 * without an NTFS stream suffix (`.git::$INDEX_ALLOCATION`), and as the short name `GIT~1`.
 */
export const isTakenForGit = (name: string): boolean => {
  const visible = name.replace(/\p{Cf}/gu, "").replace(/:.*$/su, "");
  return systemForm(visible) === ".git" || /^git~\d{1,6}$/iu.test(visible);
};

/** `relativePath` with `/` as separator, as used in problems and snapshots on every OS (N2). */
export const toPosix = (relativePath: string): string => relativePath.split(path.sep).join("/");

/** A path inside the root: absolute for the file system, canonical relative (`/`) for snapshots and problems. */
export interface RootPath {
  readonly absolute: string;
  /** Normalised relative path (`./d/../d/a.md` becomes `d/a.md`), `/` as separator. */
  readonly file: string;
}

/** Resolves `relativePath` inside `root`; refuses anything that leaves it or is the root itself. */
export const resolveInRoot = (root: string, relativePath: string): RootPath => {
  const absolute = path.resolve(root, relativePath);
  const rel = path.relative(path.resolve(root), absolute);
  if (path.isAbsolute(relativePath)) {
    // The message never echoes an absolute path (problems and errors are the same on every machine).
    throw new CommandError("input.invalid", "Path must be relative to the workspace root");
  }
  if (path.isAbsolute(rel) || rel === "" || rel.split(path.sep)[0] === "..") {
    throw new CommandError("input.invalid", `Path is not inside the workspace: ${toPosix(relativePath)}`);
  }
  return { absolute, file: toPosix(rel) };
};

/** Whether the real folder `realFolder` is the real root `realRoot` or below it. */
const insideReal = (realRoot: string, realFolder: string): boolean => {
  const rel = path.relative(realRoot, realFolder);
  return !path.isAbsolute(rel) && rel.split(path.sep)[0] !== "..";
};

/**
 * True when the real folder of `absolute` (after following links) is inside the real `root`; only
 * for files the folder walk listed (no link on their path), as other paths need `linksStayInside`
 * first (#294).
 */
export const folderInsideRootSync = (root: string, absolute: string): boolean =>
  insideReal(realpathSync.native(root), realpathSync.native(path.dirname(absolute)));

/** The `code` of a Node file system error (they always carry one), else undefined. */
export const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

/** `replacement` when `error` has `code`, else `error` itself. */
export const replaceErrorCode = (error: unknown, code: string, replacement: Error): unknown =>
  errorCode(error) === code ? replacement : error;
