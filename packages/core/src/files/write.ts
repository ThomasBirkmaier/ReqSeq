// Atomic writes (ADR-0007). `files` is the only module that writes to disk (docs/architecture).
//
// Replace: write and fsync a temp file next to the target, then check the target's bytes on disk
// against the snapshot and that they still parse, and rename at once; a rename that fails
// transiently is retried together with the check. The window between check and rename is a few
// system calls long; a change made by another program inside it is lost. Two ReqSeq processes on
// one working copy are not locked against each other.
//
// Create: write and fsync a temp file, then hard-link it to the target, which never replaces an
// existing file. Where hard links are not supported the file is created exclusively in place, and
// the content is written a second time (so chunk content is a function giving a new iterable).
//
// Content is a string (UTF-8), bytes, or chunks: a function that gives an iterable of strings and
// bytes, called once per pass, for a text larger than one string (`jsonChunks`, #277). Chunks are
// written one by one, hashed and counted as they go, so the snapshot is that of the whole file.
//
// After a rename or link the folder is fsynced, best effort (Windows cannot open folders).
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";
import { parseFileBytes, parseYamlFileBytes } from "./parse.js";
import { readJsonlFile } from "./jsonl-data.js";
import { errorCode, folderInsideRoot, replaceErrorCode, resolveInRoot } from "./paths.js";
import { retry, TRANSIENT_CODES } from "./retry.js";
import type { FileSnapshot } from "./snapshot.js";
import { makeSnapshot, sha256 } from "./snapshot.js";
import { scanXml } from "./xml-scan.js";

/** Temp files are `.<file name>.<8 hex>.reqseq-tmp` in the target's folder (watchers ignore them). */
export const TEMP_FILE_PATTERN = /^\..+\.[0-9a-f]{8}\.reqseq-tmp$/;

export const isTempFile = (fileName: string): boolean => TEMP_FILE_PATTERN.test(fileName);

/**
 * Which "still parses" check guards a replace: `element` (default) for Markdown element files,
 * `yaml` for whole-file YAML documents (metamodel, workspace, baseline, filter, mapping), `xml` for
 * XML files the own scanner reads (a JUnit file `evidence.enrichJunit` rewrites, SR-029) and `jsonl`
 * for ReqSeq data files (`data.store`, SR-062, #319; `jsonl-data.ts`), which are read in pieces.
 */
export type FileKind = "element" | "yaml" | "xml" | "jsonl";

export interface WriteOptions {
  readonly kind?: FileKind;
}

/**
 * What `writeFileAtomic` writes: a string (as UTF-8), bytes as they are, or chunks: a function that
 * gives a new iterable of strings (as UTF-8) and bytes each time it is called (once per pass).
 */
export type FileContent = string | Uint8Array | (() => Iterable<string | Uint8Array>);

/** Content as chunks; a string or bytes are one chunk (a string is never iterated by character). */
const chunksOf = (content: FileContent): (() => Iterable<string | Uint8Array>) =>
  typeof content === "function" ? content : () => [content];

/** What a pass wrote. */
interface Written {
  readonly mtimeMs: number;
  readonly size: number;
  readonly sha256: string;
}

const tempPathFor = (absolute: string): string =>
  path.join(
    path.dirname(absolute),
    `.${path.basename(absolute)}.${randomBytes(4).toString("hex")}.reqseq-tmp`,
  );

const NO_HARD_LINKS: readonly string[] = ["EPERM", "ENOTSUP", "ENOSYS"];
/** No write permission, or a read-only file system (e.g. a read-only metamodel repository, SR-018 AK2). */
const NOT_WRITABLE: readonly string[] = ["EACCES", "EPERM", "EROFS"];

const changedOnDisk = (file: string, reason: string): CommandError =>
  new CommandError("file.changed-on-disk", `Not written: ${file} ${reason}. Read it again first.`);

/** Why the current bytes must not be written over, or undefined when they still parse (`jsonl`: below). */
const REFUSAL: Readonly<
  Record<Exclude<FileKind, "jsonl">, (file: string, bytes: Uint8Array) => string | undefined>
> = {
  element: (file, bytes) => {
    const current = parseFileBytes(file, bytes);
    return current.kind === "problem"
      ? `is faulty (${current.problem.code}); fix it by hand`
      : current.kind === "no-frontmatter"
        ? "has no frontmatter; ReqSeq never changes such files"
        : undefined;
  },
  yaml: (file, bytes) => {
    const current = parseYamlFileBytes(file, bytes);
    return current.kind === "problem" ? `is faulty (${current.problem.code}); fix it by hand` : undefined;
  },
  xml: (_file, bytes) => {
    const current = scanXml(bytes);
    return current.kind === "refused"
      ? `is no readable XML (line ${String(current.line)}); fix it by hand`
      : undefined;
  },
};

/** Passes CommandErrors on and maps raw Node errors to codes of `common.schema.json#/$defs/error`. */
const toCommandError = (error: unknown, file: string, replacing: boolean): CommandError => {
  if (error instanceof CommandError) {
    return error;
  }
  const code = errorCode(error);
  if (code === undefined) {
    // No file system error: the content itself failed (a chunk function that threw, such as a
    // serialiser on a value JSON cannot hold). Its text stays in `cause`.
    return new CommandError(
      "internal",
      `Not written: ${file} (its content could not be produced)`,
      undefined,
      {
        cause: error,
      },
    );
  }
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
 * Creates `target` exclusively, writes the chunks of one pass and fsyncs it; returns its mtime, size
 * and hash. A replaced file keeps its permission bits (`mode`); a new file gets the default (umask
 * applies).
 */
const writeNew = async (
  target: string,
  file: string,
  chunks: () => Iterable<string | Uint8Array>,
  mode: number | undefined,
): Promise<Written> => {
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
    const hash = createHash("sha256");
    let size = 0;
    for (const chunk of chunks()) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      hash.update(bytes);
      size += bytes.byteLength;
      // Each call writes from the current position of the handle, after the chunk before.
      await handle.writeFile(bytes);
    }
    if (mode !== undefined) {
      await handle.chmod(mode);
    }
    await handle.sync();
    const { mtimeMs } = await handle.stat();
    written = true;
    return { mtimeMs, size, sha256: hash.digest("hex") };
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
  options: WriteOptions,
): Promise<void> => {
  await inspectTarget(absolute, file);
  const kind = options.kind ?? "element";
  let refusal: string | undefined;
  try {
    if (kind === "jsonl") {
      // Read in pieces and hashed as it goes: a data file may be larger than one string (#319).
      const read = await readJsonlFile(absolute);
      if (read.sha256 !== expected.sha256) {
        throw changedOnDisk(file, "changed on disk since it was read");
      }
      refusal = read.dataFile ? undefined : "is not a ReqSeq data file; ReqSeq replaces only its own";
    } else {
      const bytes = await fs.readFile(absolute);
      if (sha256(bytes) !== expected.sha256) {
        throw changedOnDisk(file, "changed on disk since it was read");
      }
      refusal = REFUSAL[kind](file, bytes);
    }
  } catch (e) {
    throw replaceErrorCode(e, "ENOENT", changedOnDisk(file, "was removed since it was read"));
  }
  if (refusal !== undefined) {
    throw new CommandError("file.faulty", `Not written: ${file} ${refusal}`);
  }
};

/**
 * Gives the written temp file its name `absolute` as a hard link, which never replaces a file; where
 * hard links are not supported, `absolute` is created exclusively and written a second time.
 */
const nameNew = async (
  absolute: string,
  file: string,
  temp: string,
  chunks: () => Iterable<string | Uint8Array>,
  written: Written,
): Promise<Written> => {
  try {
    await fs.link(temp, absolute);
    return written;
  } catch (linkError) {
    const code = String(errorCode(linkError));
    if (!NO_HARD_LINKS.includes(code)) {
      throw replaceErrorCode(linkError, "EEXIST", changedOnDisk(file, "already exists"));
    }
  }
  try {
    return await writeNew(absolute, file, chunks, undefined);
  } catch (exclusiveError) {
    throw replaceErrorCode(exclusiveError, "EEXIST", changedOnDisk(file, "already exists"));
  }
};

const create = async (
  absolute: string,
  file: string,
  temp: string,
  chunks: () => Iterable<string | Uint8Array>,
): Promise<Written> => {
  try {
    await fs.lstat(absolute);
  } catch (e) {
    if (errorCode(e) !== "ENOENT") {
      throw e;
    }
    return nameNew(absolute, file, temp, chunks, await writeNew(temp, file, chunks, undefined));
  }
  throw changedOnDisk(file, "already exists");
};

const replace = async (
  absolute: string,
  file: string,
  temp: string,
  chunks: () => Iterable<string | Uint8Array>,
  expected: FileSnapshot,
  options: WriteOptions,
): Promise<Written> => {
  const mode = await inspectTarget(absolute, file);
  const written = await writeNew(temp, file, chunks, mode);
  // The check runs again before every rename attempt, so a save made while a transient error is
  // retried is never overwritten.
  await retry(async () => {
    await checkUnchanged(absolute, file, expected, options);
    await fs.rename(temp, absolute);
  }, TRANSIENT_CODES);
  return written;
};

/**
 * Writes `content` (a string as UTF-8, bytes as they are, such as an image, or chunks, see
 * `FileContent`) to `relativePath`
 * below `root` atomically and returns the snapshot of the written file.
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
  content: FileContent,
  expected: FileSnapshot | null,
  options: WriteOptions = {},
): Promise<FileSnapshot> => {
  const { absolute, file } = resolveInRoot(root, relativePath);
  if (expected !== null && expected.path !== file) {
    throw new CommandError("internal", `Not written: the snapshot belongs to ${expected.path}, not ${file}`);
  }
  const chunks = chunksOf(content);
  const temp = tempPathFor(absolute);
  try {
    if (!(await folderInsideRoot(root, absolute))) {
      throw new CommandError(
        "input.invalid",
        `Not written: the folder of ${file} is linked outside the workspace`,
      );
    }
    const written =
      expected === null
        ? await create(absolute, file, temp, chunks)
        : await replace(absolute, file, temp, chunks, expected, options);
    await syncFolder(path.dirname(absolute));
    return makeSnapshot(file, written.size, written.mtimeMs, written.sha256);
  } catch (e) {
    throw toCommandError(e, file, expected !== null);
  } finally {
    await removeQuietly(temp);
  }
};

/** One file `createFilesAtomic` creates: its path below the root and its content (a string as UTF-8). */
export interface NewFile {
  readonly path: string;
  /** Chunks are read while the temp file is written, and again where hard links are missing. */
  readonly content: FileContent;
}

/**
 * Removes `absolute` while its bytes are still those of SHA-256 `expected`: true when it is gone,
 * false when it holds something else or cannot be removed.
 */
const removeOwn = async (absolute: string, expected: string): Promise<boolean> => {
  try {
    if (sha256(await fs.readFile(absolute)) !== expected) {
      return false;
    }
    await fs.rm(absolute);
    return true;
  } catch (e) {
    return errorCode(e) === "ENOENT";
  }
};

/**
 * Creates every file of `files` below `root`, all or nothing (`reqif.import`, ADR-0013 "Import"),
 * and returns each with its snapshot, in the order given. Each is first written and fsynced as a temp file
 * next to its target; only when all are on disk does each get its name (`nameNew`). When one fails,
 * the files this call named are removed again while their bytes are still the ones it wrote, every
 * temp file is removed and the error is thrown; a named file that changed meanwhile is left and
 * listed in `details.written`. So the call removes only files it created itself, never one that was
 * there before (D-045). Refuses like `writeFileAtomic` with `expected` null.
 *
 * All or nothing holds for errors, not for a crash: a crash between two names leaves the files
 * named so far and the temp files (second links to the same bytes, which the element walk and the
 * watchers ignore), and the fallback without hard links writes the target in place (#530).
 */
export const createFilesAtomic = async <T extends NewFile>(
  root: string,
  files: readonly T[],
): Promise<{ readonly file: T; readonly snapshot: FileSnapshot }[]> => {
  const temps: string[] = [];
  const staged: {
    readonly given: T;
    readonly absolute: string;
    readonly file: string;
    readonly temp: string;
    readonly chunks: () => Iterable<string | Uint8Array>;
    readonly written: Written;
  }[] = [];
  const named: { readonly absolute: string; readonly file: string; readonly sha256: string }[] = [];
  const done: { readonly file: T; readonly snapshot: FileSnapshot }[] = [];
  let current = "";
  try {
    for (const given of files) {
      const { absolute, file } = resolveInRoot(root, given.path);
      current = file;
      if (!(await folderInsideRoot(root, absolute))) {
        throw new CommandError(
          "input.invalid",
          `Not written: the folder of ${file} is linked outside the workspace`,
        );
      }
      const temp = tempPathFor(absolute);
      const chunks = chunksOf(given.content);
      temps.push(temp);
      staged.push({
        given,
        absolute,
        file,
        temp,
        chunks,
        written: await writeNew(temp, file, chunks, undefined),
      });
    }
    for (const s of staged) {
      current = s.file;
      const w = await nameNew(s.absolute, s.file, s.temp, s.chunks, s.written);
      named.push({ absolute: s.absolute, file: s.file, sha256: w.sha256 });
      done.push({ file: s.given, snapshot: makeSnapshot(s.file, w.size, w.mtimeMs, w.sha256) });
    }
    // Once per folder, not per file (N-036: an import of 50,000 elements into one folder).
    for (const folder of new Set(staged.map((s) => path.dirname(s.absolute)))) {
      await syncFolder(folder);
    }
  } catch (e) {
    const kept: string[] = [];
    for (const n of named) {
      if (!(await removeOwn(n.absolute, n.sha256))) {
        kept.push(n.file);
      }
    }
    const error = toCommandError(e, current, false);
    throw kept.length === 0
      ? error
      : new CommandError(error.code, error.message, { ...error.details, written: kept }, { cause: error });
  } finally {
    for (const temp of temps) {
      await removeQuietly(temp);
    }
  }
  return done;
};
