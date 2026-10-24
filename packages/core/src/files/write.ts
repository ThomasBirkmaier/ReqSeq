// Atomic writes (ADR-0007). `files` is the only module that writes to disk (docs/architecture).
//
// Replace: write and fsync a temp file next to the target, then check the target's bytes on disk
// against the snapshot and that they still parse, and rename at once; a rename that fails
// transiently is retried together with the check. The window between check and rename is a few
// system calls long; a change made by another program inside it is lost. Two LogReq processes on
// one working copy are not locked against each other.
//
// Create: write and fsync a temp file, then hard-link it to the target, which never replaces an
// existing file. Where hard links are not supported the file is created exclusively in place.
//
// After a rename or link the folder is fsynced, best effort (Windows cannot open folders).
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";
import { parseFileBytes, parseYamlFileBytes } from "./parse.js";
import { errorCode, folderInsideRoot, replaceErrorCode, resolveInRoot } from "./paths.js";
import { retry, TRANSIENT_CODES } from "./retry.js";
import type { FileSnapshot } from "./snapshot.js";
import { makeSnapshot, sha256 } from "./snapshot.js";

/** Temp files are `.<file name>.<8 hex>.logreq-tmp` in the target's folder (watchers ignore them). */
export const TEMP_FILE_PATTERN = /^\..+\.[0-9a-f]{8}\.logreq-tmp$/;

export const isTempFile = (fileName: string): boolean => TEMP_FILE_PATTERN.test(fileName);

/**
 * Which "still parses" check guards a replace: `element` (default) for Markdown element files,
 * `yaml` for whole-file YAML documents (metamodel, workspace, baseline, filter, mapping).
 */
export type FileKind = "element" | "yaml";

export interface WriteOptions {
  readonly kind?: FileKind;
}

const tempPathFor = (absolute: string): string =>
  path.join(
    path.dirname(absolute),
    `.${path.basename(absolute)}.${randomBytes(4).toString("hex")}.logreq-tmp`,
  );

const NO_HARD_LINKS: readonly string[] = ["EPERM", "ENOTSUP", "ENOSYS"];
/** No write permission, or a read-only file system (e.g. a read-only metamodel repository, SR-018 AK2). */
const NOT_WRITABLE: readonly string[] = ["EACCES", "EPERM", "EROFS"];

const changedOnDisk = (file: string, reason: string): CommandError =>
  new CommandError("file.changed-on-disk", `Not written: ${file} ${reason}. Read it again first.`);

/** Why the current bytes must not be written over, or undefined when they still parse. */
const REFUSAL: Readonly<Record<FileKind, (file: string, bytes: Uint8Array) => string | undefined>> = {
  element: (file, bytes) => {
    const current = parseFileBytes(file, bytes);
    return current.kind === "problem"
      ? `is faulty (${current.problem.code}); fix it by hand`
      : current.kind === "no-frontmatter"
        ? "has no frontmatter; LogReq never changes such files"
        : undefined;
  },
  yaml: (file, bytes) => {
    const current = parseYamlFileBytes(file, bytes);
    return current.kind === "problem" ? `is faulty (${current.problem.code}); fix it by hand` : undefined;
  },
};

/** Passes CommandErrors on and maps raw Node errors to codes of `common.schema.json#/$defs/error`. */
const toCommandError = (error: unknown, file: string, replacing: boolean): CommandError => {
  if (error instanceof CommandError) {
    return error;
  }
  const code = String(errorCode(error));
  if (code !== "ENOENT") {
    return new CommandError("internal", `Not written: ${file} (${code})`);
  }
  return replacing
    ? changedOnDisk(file, "was removed since it was read")
    : new CommandError("file.folder-missing", `Not written: the folder of ${file} does not exist`);
};

/** Best effort: never masks the original error or a successful commit. */
const removeQuietly = async (file: string): Promise<void> => {
  try {
    await retry(() => fs.rm(file, { force: true }), TRANSIENT_CODES);
  } catch {
    // A leftover temp file matches TEMP_FILE_PATTERN and is ignored by watchers and listings.
  }
};

/** Best effort: makes the rename or link durable where the OS allows fsync on a folder. */
const syncFolder = async (folder: string): Promise<void> => {
  try {
    const handle = await fs.open(folder, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Not supported on Windows and some file systems; the data itself is already fsynced.
  }
};

/**
 * Creates `target` exclusively, writes and fsyncs it; returns its mtime. A replaced file keeps its
 * permission bits (`mode`); a new file gets the default (umask applies).
 */
const writeNew = async (
  target: string,
  file: string,
  bytes: Uint8Array,
  mode: number | undefined,
): Promise<number> => {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(target, "wx", mode === undefined ? 0o666 : 0o600);
  } catch (e) {
    const code = String(errorCode(e));
    throw NOT_WRITABLE.includes(code)
      ? new CommandError("file.read-only", `Not written: the folder of ${file} is not writable (${code})`)
      : e;
  }
  let written = false;
  try {
    await handle.writeFile(bytes);
    if (mode !== undefined) {
      await handle.chmod(mode);
    }
    await handle.sync();
    const { mtimeMs } = await handle.stat();
    written = true;
    return mtimeMs;
  } finally {
    await handle.close();
    if (!written) {
      // This call created `target` exclusively a moment ago, so removing the partial file deletes
      // no element (D-045) and nothing anyone else wrote.
      await removeQuietly(target);
    }
  }
};

/** The existing target as a writable regular file; returns its permission bits. */
const inspectTarget = async (absolute: string, file: string): Promise<number> => {
  let stat: { mode: number; isFile: () => boolean; isSymbolicLink: () => boolean };
  try {
    stat = await fs.lstat(absolute);
  } catch (e) {
    throw replaceErrorCode(e, "ENOENT", changedOnDisk(file, "was removed since it was read"));
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new CommandError(
      "file.not-regular",
      `Not written: ${file} is a symbolic link or not a regular file`,
    );
  }
  if ((stat.mode & 0o200) === 0) {
    throw new CommandError("file.read-only", `Not written: ${file} is read-only`);
  }
  return stat.mode & 0o777;
};

/** Refuses unless the bytes on disk are still those of `expected` and still parse (SR-008 AK3). */
const checkUnchanged = async (
  absolute: string,
  file: string,
  expected: FileSnapshot,
  kind: FileKind,
): Promise<void> => {
  await inspectTarget(absolute, file);
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(absolute);
  } catch (e) {
    throw replaceErrorCode(e, "ENOENT", changedOnDisk(file, "was removed since it was read"));
  }
  if (sha256(bytes) !== expected.sha256) {
    throw changedOnDisk(file, "changed on disk since it was read");
  }
  const refusal = REFUSAL[kind](file, bytes);
  if (refusal !== undefined) {
    throw new CommandError("file.faulty", `Not written: ${file} ${refusal}`);
  }
};

const create = async (absolute: string, file: string, temp: string, bytes: Uint8Array): Promise<number> => {
  try {
    await fs.lstat(absolute);
  } catch (e) {
    if (errorCode(e) !== "ENOENT") {
      throw e;
    }
    const mtimeMs = await writeNew(temp, file, bytes, undefined);
    try {
      await fs.link(temp, absolute);
      return mtimeMs;
    } catch (linkError) {
      const code = String(errorCode(linkError));
      if (!NO_HARD_LINKS.includes(code)) {
        throw replaceErrorCode(linkError, "EEXIST", changedOnDisk(file, "already exists"));
      }
    }
    try {
      return await writeNew(absolute, file, bytes, undefined);
    } catch (exclusiveError) {
      throw replaceErrorCode(exclusiveError, "EEXIST", changedOnDisk(file, "already exists"));
    }
  }
  throw changedOnDisk(file, "already exists");
};

const replace = async (
  absolute: string,
  file: string,
  temp: string,
  bytes: Uint8Array,
  expected: FileSnapshot,
  kind: FileKind,
): Promise<number> => {
  const mode = await inspectTarget(absolute, file);
  const mtimeMs = await writeNew(temp, file, bytes, mode);
  // The check runs again before every rename attempt, so a save made while a transient error is
  // retried is never overwritten.
  await retry(async () => {
    await checkUnchanged(absolute, file, expected, kind);
    await fs.rename(temp, absolute);
  }, TRANSIENT_CODES);
  return mtimeMs;
};

/**
 * Writes `content` (UTF-8) to `relativePath` below `root` atomically and returns the snapshot of
 * the written file.
 * - `expected` is the snapshot of a successful read: the file is replaced only while its bytes on
 *   disk are unchanged and still parse as `options.kind`; otherwise `file.changed-on-disk` or
 *   `file.faulty`.
 * - `expected` null creates a new file and refuses with `file.changed-on-disk` when one exists.
 * Also refuses symbolic links (`file.not-regular`), read-only files and folders (`file.read-only`),
 * missing folders (`file.folder-missing`) and folders linked out of the root (`input.invalid`).
 */
export const writeFileAtomic = async (
  root: string,
  relativePath: string,
  content: string,
  expected: FileSnapshot | null,
  options: WriteOptions = {},
): Promise<FileSnapshot> => {
  const { absolute, file } = resolveInRoot(root, relativePath);
  if (expected !== null && expected.path !== file) {
    throw new CommandError("internal", `Not written: the snapshot belongs to ${expected.path}, not ${file}`);
  }
  const bytes = Buffer.from(content, "utf8");
  const temp = tempPathFor(absolute);
  try {
    if (!(await folderInsideRoot(root, absolute))) {
      throw new CommandError(
        "input.invalid",
        `Not written: the folder of ${file} is linked outside the workspace`,
      );
    }
    const mtimeMs =
      expected === null
        ? await create(absolute, file, temp, bytes)
        : await replace(absolute, file, temp, bytes, expected, options.kind ?? "element");
    await syncFolder(path.dirname(absolute));
    return makeSnapshot(file, bytes.byteLength, mtimeMs, sha256(bytes));
  } catch (e) {
    throw toCommandError(e, file, expected !== null);
  } finally {
    await removeQuietly(temp);
  }
};
