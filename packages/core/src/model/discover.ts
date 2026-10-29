// Finding the Markdown files of a repository, whatever its folders (SR-003, D-056): one walk over
// the folder tree, no Git call (N-036). Which of the files are elements is decided after parsing
// (elements.ts).
import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import type { RepositoryLocation } from "../workspace/index.js";

/** Never read: Git's own folder (or the `.git` file of a submodule) and installed packages (workspace.schema.json). */
export const SKIPPED_NAMES: ReadonlySet<string> = new Set([".git", "node_modules"]);

/** Element files end in `.md` (ADR-0004). ReqSeq's temporary files end in `.reqseq-tmp`, so they never match. */
export const ELEMENT_FILE_EXTENSION = ".md";

export interface DiscoveredFiles {
  /** The files listed, relative to the repository, `/` as separator, sorted by code units. */
  readonly files: readonly string[];
  /**
   * Folders that could not be listed (error) and files of the kind listed that are not read
   * (warning: links, an extension such as `.MD`), sorted by path; `file` is relative to the repository
   * (`.` for its root).
   */
  readonly problems: readonly Problem[];
}

const unlistable = (repository: string, folder: string, error: unknown): Problem => ({
  code: "file.unreadable",
  severity: "error",
  repository,
  file: folder,
  message: `Cannot read folder: ${String((error as NodeJS.ErrnoException).code)}`,
});

const skipped = (repository: string, file: string, reason: string): Problem => ({
  code: "file.skipped",
  severity: "warning",
  repository,
  file,
  message: `Not read: ${reason}`,
});

/** What a walk lists: files ending in one of `extensions` (lower case), named `what` in messages. */
export interface ListedKind {
  /** Extensions with the dot, in lower case (`.md`). */
  readonly extensions: readonly string[];
  /** How a `file.skipped` message names the files (`element files`). */
  readonly what: string;
}

/** The files the element store reads (ADR-0004). */
const ELEMENT_FILES: ListedKind = { extensions: [ELEMENT_FILE_EXTENSION], what: "element files" };

/** The extension of `name` in `kind` when it ends in one in any case, else undefined. */
const extensionIn = (name: string, kind: ListedKind): string | undefined =>
  kind.extensions.find((extension) => name.toLowerCase().endsWith(extension));

/** Why a folder entry (not a folder) that looks like a file of `kind` is not read, or undefined to read it. */
const skipReason = (entry: Dirent, kind: ListedKind): string | undefined => {
  if (entry.isSymbolicLink()) {
    return "it is a symbolic link; ReqSeq does not follow links";
  }
  if (!entry.isFile()) {
    return "it is not a regular file";
  }
  return kind.extensions.some((extension) => entry.name.endsWith(extension))
    ? undefined
    : `${kind.what} end in ${kind.extensions.join(" or ")} in lower case`;
};

/**
 * Lists every `*.md` file of an available repository, in any folder (SR-003 AK1). Left out:
 * `.git` and `node_modules`; the folders of other repositories of the workspace nested in this one
 * (`repository.excludes`, read under their own name); folders below the root that hold a `.git`
 * entry (a nested repository that is not in the workspace is not part of this one); paths for which
 * `ignored` is true (the `ignore` globs of the workspace file, `ignoreMatcher`, which compares in
 * NFC; it gets each path as `readdir` spells it; a matching folder is skipped as a whole). Links
 * are never followed: a linked folder is skipped, a linked `*.md` file and a Markdown file with an
 * extension such as `.MD` are reported as `file.skipped` warnings. A folder that cannot be listed
 * becomes a problem; the walk goes on.
 */
export const listMarkdownFiles = (
  repository: RepositoryLocation,
  ignored: (relativePath: string) => boolean,
): Promise<DiscoveredFiles> => listFiles(repository, ignored, "", ELEMENT_FILES);

/**
 * `listMarkdownFiles` for any `kind` of file and from the folder `start` (relative to the
 * repository, `/` as separator, `""` for its root) down: the same rules, and the files and problems
 * relative to the repository. The evidence block lists the `*.md` and `*.xml` files of an evidence
 * folder with it (ADR-0012). `start` must be a folder the caller has checked (no link, it exists);
 * when it cannot be listed, that is the one problem.
 */
export const listFiles = async (
  repository: RepositoryLocation,
  ignored: (relativePath: string) => boolean,
  start: string,
  kind: ListedKind,
): Promise<DiscoveredFiles> => {
  const excludes = new Set(repository.excludes);
  const files: string[] = [];
  const problems = new Map<string, Problem>();
  // Relative folders still to list; "" is the repository root.
  const pending = [start];
  for (let folder = pending.pop(); folder !== undefined; folder = pending.pop()) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(path.join(repository.folder, folder), { withFileTypes: true });
    } catch (error) {
      const file = folder === "" ? "." : folder;
      problems.set(file, unlistable(repository.name, file, error));
      continue;
    }
    if (folder !== "" && entries.some((e) => e.name === ".git")) {
      continue;
    }
    for (const entry of entries) {
      const relative = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (SKIPPED_NAMES.has(entry.name) || ignored(relative)) {
        continue;
      }
      if (entry.isDirectory()) {
        // `excludes` and `repository.folder` come from the native realpath (layout.ts), which gives
        // the names as `readdir` does, so plain strings compare like with like.
        if (!excludes.has(path.join(repository.folder, relative))) {
          pending.push(relative);
        }
        continue;
      }
      if (extensionIn(entry.name, kind) === undefined) {
        continue;
      }
      const reason = skipReason(entry, kind);
      if (reason === undefined) {
        files.push(relative);
      } else {
        problems.set(relative, skipped(repository.name, relative, reason));
      }
    }
  }
  // Default sort: UTF-16 code units, the same on every file system and OS.
  files.sort();
  const sorted = [...problems].sort(([a], [b]) => Number(a > b) - Number(a < b));
  return { files, problems: sorted.map(([, problem]) => problem) };
};

/** `lstat` of `absolute`, or undefined when nothing is there. */
const lstatIfThere = async (absolute: string): Promise<Stats | undefined> => {
  try {
    return await fs.lstat(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

/** Whether the walk can list `folder`: it opens it, as `readdir` does; any error means it cannot. */
const canList = async (folder: string): Promise<boolean> => {
  try {
    const dir = await fs.opendir(folder);
    await dir.close();
    return true;
  } catch {
    return false;
  }
};

/** Why the walk would leave out a path (`NewFileProblem`), or a name that is not portable. */
export type NewFileRule =
  | "skipped-name"
  | "ignored"
  | "nested-repository"
  | "git-entry"
  | "link"
  | "unreadable"
  | "not-a-folder"
  | "spelling"
  | "not-portable"
  | "invisible";

/** A rule of the walk that leaves out `path` (relative to the repository, `/`; `.` for its folder). */
export interface NewFileProblem {
  readonly rule: NewFileRule;
  readonly path: string;
  /** With `spelling`: the folder as it is spelled on disk. */
  readonly existing?: string;
  /** With `invisible`: the first such character as a code point, `U+200B`. */
  readonly character?: string;
}

/**
 * What `newFileTarget` says about a file ReqSeq is to create: refused with the problem, or listed
 * once created under `file` (the path as given, or with its existing folders spelled as on disk).
 */
export type NewFileTarget =
  | { readonly kind: "refused"; readonly problem: NewFileProblem }
  | { readonly kind: "listed"; readonly file: string };

/** The rule of the walk that leaves out `relative` by its name, an `ignore` glob or a nested repository. */
const nameRule = (
  repository: RepositoryLocation,
  ignored: (relativePath: string) => boolean,
  relative: string,
): NewFileRule | undefined => {
  if (SKIPPED_NAMES.has(path.posix.basename(relative))) {
    return "skipped-name";
  }
  if (ignored(relative)) {
    return "ignored";
  }
  return repository.excludes.includes(path.join(repository.folder, relative))
    ? "nested-repository"
    : undefined;
};

/** The rule of the walk that leaves out the existing path `absolute` as a folder to go into. */
const folderRule = async (absolute: string, stat: Stats): Promise<NewFileRule | undefined> => {
  if (stat.isSymbolicLink()) {
    return "link";
  }
  if (!stat.isDirectory()) {
    return "not-a-folder";
  }
  if ((await lstatIfThere(path.join(absolute, ".git"))) !== undefined) {
    return "git-entry";
  }
  return (await canList(absolute)) ? undefined : "unreadable";
};

/** `relative` (an existing path) as the file system spells it, relative to the repository with `/`. */
const spelledOnDisk = async (repository: RepositoryLocation, relative: string): Promise<string> => {
  // The native `realpath` gives the names as stored (and resolves links above the repository).
  const [root, real] = await Promise.all([
    fs.realpath(repository.folder),
    fs.realpath(path.join(repository.folder, relative)),
  ]);
  return path.relative(root, real).split(path.sep).join("/");
};

/**
 * Whether `listMarkdownFiles` lists `file` (relative to the repository, `/` as separator, a name
 * ending in `.md`), checked along its path only: a few `lstat` and `opendir` calls and no walk, for
 * a file ReqSeq has just created (#166). The rules are those of the walk: no folder or file named
 * `.git` or `node_modules` or matched by `ignored`; every folder above the file a real folder (not
 * a link) without a `.git` entry and not the folder of a nested repository (`repository.excludes`),
 * and the repository folder and every folder above the file one the walk can open (an unreadable
 * folder is a listing problem there, and nothing below it is listed); the file itself a regular
 * file. The path must also be spelled as the folders are: on a file system that ignores case
 * (Windows, macOS), `Requirements/a.md` names `requirements/a.md`, which the walk lists under its
 * own spelling. A path that is gone is not listed; other errors reject.
 */
export const listsFile = async (
  repository: RepositoryLocation,
  ignored: (relativePath: string) => boolean,
  file: string,
): Promise<boolean> => {
  if (!(await canList(repository.folder))) {
    return false;
  }
  let folder = "";
  for (const name of file.split("/").slice(0, -1)) {
    folder = folder === "" ? name : `${folder}/${name}`;
    const absolute = path.join(repository.folder, folder);
    if (nameRule(repository, ignored, folder) !== undefined) {
      return false;
    }
    const stat = await lstatIfThere(absolute);
    if (stat === undefined || (await folderRule(absolute, stat)) !== undefined) {
      return false;
    }
  }
  const absolute = path.join(repository.folder, file);
  if (
    nameRule(repository, ignored, file) !== undefined ||
    (await lstatIfThere(absolute))?.isFile() !== true
  ) {
    return false;
  }
  return (await spelledOnDisk(repository, file)) === file;
};

/** Names Windows reserves for devices, with or without an extension (`NUL`, `com1.md`, `CONIN$`). */
const DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu;

/** A short name of the 8.3 shape Windows gives a long name (`GIT~1`, `NODE_M~1`, `PROGRA~1.TXT`). */
const SHORT_NAME = /^[^.~]{1,6}~\d{1,6}(?:\.[^.]{0,3})?$/u;

/** Characters Windows refuses in a name, besides the control characters. */
const WINDOWS_REFUSED = /[<>:"|?*]/;

/**
 * The rule that leaves out a name wherever the repository is checked out (repositories move between
 * operating systems): a name that Windows or macOS take for `.git` or `node_modules` (any case,
 * trailing dots and spaces dropped) is `skipped-name`; one that Windows changes or refuses
 * (a trailing dot or space, `<>:"|?*`, a control character, a device name, a short name such as
 * `GIT~1`) is `not-portable`.
 */
const portableRule = (name: string): NewFileRule | undefined => {
  if (isSkippedOnSomeSystem(name)) {
    return "skipped-name";
  }
  return windowsChanges(name) || SHORT_NAME.test(name) ? "not-portable" : undefined;
};

/**
 * Whether Windows or macOS take `name` for `.git` or `node_modules` (any case, trailing dots and
 * spaces dropped).
 */
export const isSkippedOnSomeSystem = (name: string): boolean =>
  SKIPPED_NAMES.has(name.toLowerCase().replace(/[. ]+$/, ""));

/**
 * Whether Windows changes or refuses `name`: a trailing dot or space, one of `<>:"|?*`, a control
 * character or a device name (`NUL`, `com1.png`).
 */
export const windowsChanges = (name: string): boolean =>
  /\p{Cc}/u.test(name) || /[. ]$/.test(name) || WINDOWS_REFUSED.test(name) || DEVICE_NAME.test(name);

/**
 * Invisible format characters (zero-width and direction marks, the byte order mark, the soft
 * hyphen): a name with one looks like another name, and HFS+ drops some of them (Git's protectHFS
 * list), so `.g\u200cit` names `.git` there.
 */
const INVISIBLE = /\p{Cf}/u;

/** The first invisible format character of `name` as a code point (`U+200B`), or undefined. */
const invisibleIn = (name: string): string | undefined => {
  const match = INVISIBLE.exec(name);
  // `Number` gives a number type for the code point of a match, which always has one.
  return match === null
    ? undefined
    : `U+${Number(match[0].codePointAt(0)).toString(16).toUpperCase().padStart(4, "0")}`;
};

const refused = (problem: NewFileProblem): NewFileTarget => ({ kind: "refused", problem });

/** `newFileTarget`; `respell` is false on the second judgement of a path respelled as on disk. */
const judgeNewFile = async (
  repository: RepositoryLocation,
  ignored: (relativePath: string) => boolean,
  file: string,
  respell: boolean,
): Promise<NewFileTarget> => {
  if (!(await canList(repository.folder))) {
    return refused({ rule: "unreadable", path: "." });
  }
  const names = file.split("/");
  let relative = "";
  let existing = true;
  let deepest: string | undefined;
  for (const [index, name] of names.entries()) {
    relative = relative === "" ? name : `${relative}/${name}`;
    const rule = portableRule(name) ?? nameRule(repository, ignored, relative);
    if (rule !== undefined) {
      return refused({ rule, path: relative });
    }
    // The file name is ReqSeq's own (`fileNameFor`); only the folders above it are looked at.
    if (index === names.length - 1) {
      continue;
    }
    if (existing) {
      const absolute = path.join(repository.folder, relative);
      const stat = await lstatIfThere(absolute);
      if (stat !== undefined) {
        const problem = await folderRule(absolute, stat);
        if (problem !== undefined) {
          return refused({ rule: problem, path: relative });
        }
        deepest = relative;
        continue;
      }
      existing = false;
    }
    // A folder ReqSeq is to create; one that exists may keep such a name.
    const character = invisibleIn(name);
    if (character !== undefined) {
      return refused({ rule: "invisible", path: relative, character });
    }
  }
  if (deepest !== undefined) {
    const spelled = await spelledOnDisk(repository, deepest);
    if (spelled !== deepest) {
      // Only the normal form differs (an NFD folder on macOS, NFC input): the same folder, so the
      // file goes there under the spelling on disk, judged again by the names the walk sees.
      return respell && spelled.normalize("NFC") === deepest.normalize("NFC")
        ? judgeNewFile(repository, ignored, `${spelled}${file.slice(deepest.length)}`, false)
        : refused({ rule: "spelling", path: deepest, existing: spelled });
    }
  }
  return { kind: "listed", file };
};

/**
 * Whether `listMarkdownFiles` would list `file` (relative to the repository, `/` as separator,
 * inside it, its last name one ReqSeq gives) once ReqSeq has created it and the folders above it
 * that are missing (#183), and under which path. Every name of the path must be portable
 * (`portableRule`) and pass the name rules of the walk (`.git`, `node_modules`, `ignore` globs,
 * nested repositories); every folder above the file that exists must be one the walk goes into (a
 * real folder, not a link, without a `.git` entry, one it can open), and so must the repository
 * folder; below the first missing folder only the names count, and a folder to create must not
 * hold an invisible format character (`invisible`, #194). The existing folders must be spelled as
 * on disk (`spelling`, with `existing`): on a file system that ignores case, `.GIT` or
 * `Requirements` would name `.git` or `requirements`. A spelling that differs from the one on disk
 * only in its Unicode normal form (NFC, NFD) names the same folder where the file system ignores
 * the normal form (macOS): the path is then judged again as spelled on disk, and `file` of the
 * result is that spelling (#194). `ignored` gets each path as given and then as spelled on disk;
 * `ignoreMatcher` compares both in NFC, so a glob names a folder in either normal form (#218).
 * ReqSeq checks this before it writes anything, so it never writes below `.git` (D-036) and never
 * creates an element that the walk cannot see. The order is the walk's, name by name: the name
 * rules first, then the folder on disk. Errors other than "not there" reject.
 */
export const newFileTarget = (
  repository: RepositoryLocation,
  ignored: (relativePath: string) => boolean,
  file: string,
): Promise<NewFileTarget> => judgeNewFile(repository, ignored, file, true);
