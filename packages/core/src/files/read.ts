// Reading element files (ADR-0007, SR-008). A faulty file becomes a problem with file, line and
// reason; it never stops the others.
import type { Stats } from "node:fs";
import { lstatSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { ParsedContent, ParsedYaml } from "./parse.js";
import { fileProblem, parseFileBytes, parseYamlFileBytes } from "./parse.js";
import { errorCode, folderInsideRoot, folderInsideRootSync, resolveInRoot } from "./paths.js";
import type { FileSnapshot } from "./snapshot.js";
import { makeSnapshot, sha256 } from "./snapshot.js";

/** A file whose frontmatter parsed. Whether it is an element (`id` and `type`) is decided by the model. */
export interface ParsedFile extends ParsedContent {
  /** Relative to the root, `/` as separator. */
  readonly path: string;
  /** Pass to `writeFileAtomic`; the write is refused when the file changed since (SR-008 AK3). */
  readonly snapshot: FileSnapshot;
}

export type FileReadResult =
  | { readonly kind: "parsed"; readonly file: ParsedFile }
  /** No frontmatter: not an element, ignored and never changed (ADR-0004, SR-003 AK2). */
  | { readonly kind: "no-frontmatter"; readonly path: string }
  /** Faulty file: reported, never written (SR-008). */
  | { readonly kind: "problem"; readonly problem: Problem };

export interface ReadFilesResult {
  /** Parsed files in the order of the input paths. */
  readonly files: readonly ParsedFile[];
  /** Markdown files without frontmatter. */
  readonly ignored: readonly string[];
  /** One error per faulty file and the YAML warnings of parsed files, in the order of the input paths. */
  readonly problems: readonly Problem[];
}

const unreadable = (
  file: string,
  reason: string,
): { readonly kind: "problem"; readonly problem: Problem } => ({
  kind: "problem",
  problem: fileProblem("file.unreadable", file, `Cannot read file: ${reason}`),
});

type RawFile =
  | { readonly kind: "bytes"; readonly file: string; readonly bytes: Uint8Array; readonly mtimeMs: number }
  | { readonly kind: "problem"; readonly problem: Problem };

/** Why a file that `lstat` found is not read, or undefined when it is a regular file. */
const statProblem = (file: string, stat: Stats): RawFile | undefined => {
  if (stat.isSymbolicLink()) {
    return unreadable(file, "it is a symbolic link; LogReq does not follow links to its files");
  }
  if (!stat.isFile()) {
    return unreadable(file, "it is not a regular file");
  }
  return undefined;
};

const OUTSIDE = "its folder is linked to a place outside the workspace";

/** The bytes of a regular file inside the root; links to files and folders linked out of it are refused. */
const readBytes = async (root: string, relativePath: string): Promise<RawFile> => {
  const { absolute, file } = resolveInRoot(root, relativePath);
  try {
    const stat = await fs.lstat(absolute);
    const problem = statProblem(file, stat);
    if (problem !== undefined) {
      return problem;
    }
    if (!(await folderInsideRoot(root, absolute))) {
      return unreadable(file, OUTSIDE);
    }
    return { kind: "bytes", file, bytes: await fs.readFile(absolute), mtimeMs: stat.mtimeMs };
  } catch (e) {
    return unreadable(file, String(errorCode(e)));
  }
};

/** `readBytes` with blocking calls, for a worker thread of the cold load (ADR-0008); the same checks and results. */
const readBytesSync = (root: string, relativePath: string): RawFile => {
  const { absolute, file } = resolveInRoot(root, relativePath);
  try {
    const stat = lstatSync(absolute);
    const problem = statProblem(file, stat);
    if (problem !== undefined) {
      return problem;
    }
    if (!folderInsideRootSync(root, absolute)) {
      return unreadable(file, OUTSIDE);
    }
    return { kind: "bytes", file, bytes: readFileSync(absolute), mtimeMs: stat.mtimeMs };
  } catch (e) {
    return unreadable(file, String(errorCode(e)));
  }
};

/** What the bytes of an element file give; `readElementFile` and `readElementFileSync` share it. */
const elementResult = (raw: RawFile): FileReadResult => {
  if (raw.kind === "problem") {
    return raw;
  }
  const { file, bytes, mtimeMs } = raw;
  const parsed = parseFileBytes(file, bytes);
  switch (parsed.kind) {
    case "problem":
      return parsed;
    case "no-frontmatter":
      return { kind: "no-frontmatter", path: file };
    case "parsed":
      return {
        kind: "parsed",
        file: {
          ...parsed.content,
          path: file,
          snapshot: makeSnapshot(file, bytes.byteLength, mtimeMs, sha256(bytes)),
        },
      };
  }
};

/**
 * Reads one element file below `root`. Never throws for a faulty, missing or linked file; returns
 * a problem with file, line and reason instead (SR-008 AK1, AK2). Throws only `input.invalid` for
 * a path outside `root`. Paths in the result are canonical (`./d/../d/a.md` is `d/a.md`).
 */
export const readElementFile = async (root: string, relativePath: string): Promise<FileReadResult> =>
  elementResult(await readBytes(root, relativePath));

/**
 * `readElementFile` with blocking calls and the same result, for the worker threads that read the
 * files of a cold load (ADR-0008, N-036): there, calls through the libuv thread pool of the process
 * cost more than they save. The main thread keeps `readElementFile`.
 */
export const readElementFileSync = (root: string, relativePath: string): FileReadResult =>
  elementResult(readBytesSync(root, relativePath));

/** A whole-file YAML document (metamodel, workspace, baseline, filter, mapping file). */
export interface YamlFile extends ParsedYaml {
  readonly path: string;
  /** Pass to `writeFileAtomic` with `{ kind: "yaml" }`. */
  readonly snapshot: FileSnapshot;
}

export type YamlReadResult =
  | { readonly kind: "parsed"; readonly file: YamlFile }
  | { readonly kind: "problem"; readonly problem: Problem };

/** Reads one YAML file below `root`; faulty files become a problem with file, line and reason. */
export const readYamlFile = async (root: string, relativePath: string): Promise<YamlReadResult> => {
  const raw = await readBytes(root, relativePath);
  if (raw.kind === "problem") {
    return raw;
  }
  const { file, bytes, mtimeMs } = raw;
  const parsed = parseYamlFileBytes(file, bytes);
  if (parsed.kind === "problem") {
    return parsed;
  }
  return {
    kind: "parsed",
    file: {
      ...parsed.content,
      path: file,
      snapshot: makeSnapshot(file, bytes.byteLength, mtimeMs, sha256(bytes)),
    },
  };
};

export interface ReadFilesOptions {
  /** Files read at the same time; bounded so 50,000 files do not exhaust file handles (N-036). */
  readonly concurrency?: number;
  /** Stops scheduling further files; the call then rejects with the signal's reason. */
  readonly signal?: AbortSignal;
}

const DEFAULT_CONCURRENCY = 32;

/**
 * Reads many files. A faulty file becomes one problem and never stops the others (SR-008 AK3).
 * The element store reads and classifies file by file instead (model/store.ts, so no parsed
 * documents pile up); this batch form is kept for the watcher's batch of changed files (SR-007).
 * Results keep the order of `relativePaths`; paths naming the same file are read once.
 */
export const readElementFiles = async (
  root: string,
  relativePaths: readonly string[],
  options: ReadFilesOptions = {},
): Promise<ReadFilesResult> => {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new CommandError(
      "input.invalid",
      `concurrency must be a positive integer, got ${String(concurrency)}`,
    );
  }
  const signal = options.signal ?? new AbortController().signal;
  const unique = [...new Set(relativePaths.map((p) => resolveInRoot(root, p).file))];
  const results: FileReadResult[] = [];
  // One shared iterator: each worker takes the next path until none are left or the call is aborted.
  const queue = unique.entries();
  const worker = async (): Promise<void> => {
    for (const [i, relativePath] of queue) {
      if (signal.aborted) {
        return;
      }
      results[i] = await readElementFile(root, relativePath);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  signal.throwIfAborted();
  const files: ParsedFile[] = [];
  const ignored: string[] = [];
  const problems: Problem[] = [];
  for (const r of results) {
    if (r.kind === "parsed") {
      files.push(r.file);
      problems.push(...r.file.warnings);
    } else if (r.kind === "no-frontmatter") {
      ignored.push(r.path);
    } else {
      problems.push(r.problem);
    }
  }
  return { files, ignored, problems };
};
