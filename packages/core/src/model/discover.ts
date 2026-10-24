// Finding the Markdown files of a repository, whatever its folders (SR-003, D-056): one walk over
// the folder tree, no Git call (N-036). Which of the files are elements is decided after parsing
// (elements.ts).
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import type { RepositoryLocation } from "../workspace/index.js";

/** Never read: Git's own folder (or the `.git` file of a submodule) and installed packages (workspace.schema.json). */
const SKIPPED_NAMES = new Set([".git", "node_modules"]);

/** Element files end in `.md` (ADR-0004). LogReq's temporary files end in `.logreq-tmp`, so they never match. */
export const ELEMENT_FILE_EXTENSION = ".md";

export interface DiscoveredFiles {
  /** Markdown files relative to the repository, `/` as separator, sorted by code units. */
  readonly files: readonly string[];
  /**
   * Folders that could not be listed (error) and Markdown files that are not read (warning:
   * links, an extension such as `.MD`), sorted by path; `file` is relative to the repository
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

/** Why a folder entry (not a folder) that looks like an element file is not read, or undefined to read it. */
const skipReason = (entry: Dirent): string | undefined => {
  if (entry.isSymbolicLink()) {
    return "it is a symbolic link; LogReq does not follow links";
  }
  if (!entry.isFile()) {
    return "it is not a regular file";
  }
  return entry.name.endsWith(ELEMENT_FILE_EXTENSION)
    ? undefined
    : `element files end in ${ELEMENT_FILE_EXTENSION} in lower case`;
};

/**
 * Lists every `*.md` file of an available repository, in any folder (SR-003 AK1). Left out:
 * `.git` and `node_modules`; the folders of other repositories of the workspace nested in this one
 * (`repository.excludes`, read under their own name); folders below the root that hold a `.git`
 * entry (a nested repository that is not in the workspace is not part of this one); paths for which
 * `ignored` is true (the `ignore` globs of the workspace file, `ignoreMatcher`; a matching folder is
 * skipped as a whole). Links are never followed: a linked folder is skipped, a linked `*.md` file and
 * a Markdown file with an extension such as `.MD` are reported as `file.skipped` warnings. A folder
 * that cannot be listed becomes a problem; the walk goes on.
 */
export const listMarkdownFiles = async (
  repository: RepositoryLocation,
  ignored: (relativePath: string) => boolean,
): Promise<DiscoveredFiles> => {
  const excludes = new Set(repository.excludes);
  const files: string[] = [];
  const problems = new Map<string, Problem>();
  // Relative folders still to list; "" is the repository root.
  const pending = [""];
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
        if (!excludes.has(path.join(repository.folder, relative))) {
          pending.push(relative);
        }
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(ELEMENT_FILE_EXTENSION)) {
        continue;
      }
      const reason = skipReason(entry);
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
