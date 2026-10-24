import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";

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

/** True when the real folder of `absolute` (after following links) is inside the real `root`. */
export const folderInsideRoot = async (root: string, absolute: string): Promise<boolean> => {
  const [realRoot, realFolder] = await Promise.all([fs.realpath(root), fs.realpath(path.dirname(absolute))]);
  const rel = path.relative(realRoot, realFolder);
  return !path.isAbsolute(rel) && rel.split(path.sep)[0] !== "..";
};

/** The `code` of a Node file system error (they always carry one), else undefined. */
export const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

/** `replacement` when `error` has `code`, else `error` itself. */
export const replaceErrorCode = (error: unknown, code: string, replacement: Error): unknown =>
  errorCode(error) === code ? replacement : error;
