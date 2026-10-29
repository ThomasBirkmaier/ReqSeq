// The files of the evidence folders (ADR-0012 "Reading", SR-028 AK1): every `*.md` and `*.xml` file
// below each `evidence` location of the workspace file, in any repository of the workspace, by the
// walk rules of the element store (`listFiles` of the model block): no `.git` or `node_modules`, no
// nested repository, the `ignore` globs, links never followed. Which of the files are records is up to
// the readers (`state.ts`).
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import type { ListedKind } from "../model/index.js";
import { SKIPPED_NAMES, ignoredBy, listFiles } from "../model/index.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { locate } from "../workspace/index.js";

/** The extensions of evidence files without the dot: Markdown records and JUnit XML files. */
export type EvidenceExtension = "md" | "xml";

/** What the evidence walk lists. */
export const EVIDENCE_FILES: ListedKind = { extensions: [".md", ".xml"], what: "evidence files" };

/** One file of an evidence folder. */
export interface EvidenceFile {
  /** Workspace name of its repository. */
  readonly repository: string;
  /** Relative to the repository, `/` as separator. */
  readonly file: string;
  /** The absolute path on this machine. */
  readonly absolute: string;
  /** Its extension in lower case, which picks the reader. */
  readonly ext: EvidenceExtension;
}

/** The files of all evidence folders of a workspace. */
export interface EvidenceFiles {
  /** Each file once, by location in the order of the workspace file, then by path (code units). */
  readonly files: readonly EvidenceFile[];
  /** A location lies in a repository that is not on this machine (SR-006 AK2, SR-036 AK3). */
  readonly incomplete: boolean;
  /**
   * `evidence.folder-missing` (info) for a location that does not exist in an available repository,
   * `file.skipped` (warning) for a location the walk rules leave out (a link, `.git`,
   * `node_modules`, an `ignore` glob, another or a nested repository), `file.unreadable` (error) for
   * one that cannot be looked at, and the problems of the walk (`file.unreadable`, `file.skipped`).
   */
  readonly problems: readonly Problem[];
}

/** `location.path` as the walk names folders: `/` as separator, no `.`, `""` for the repository root. */
const startOf = (relativePath: string): string => {
  const normal = path.posix.normalize(relativePath).replace(/\/+$/, "");
  return normal === "." ? "" : normal;
};

/** A `file.skipped` warning about the evidence folder `file`. */
const skippedFolder = (repository: string, file: string, reason: string): Problem => ({
  code: "file.skipped",
  severity: "warning",
  repository,
  file,
  message: `Not read: the evidence folder ${reason}`,
});

/** `lstat` of `folder`, undefined when it is not there, or the error code when it cannot be looked at. */
const lstatOf = async (folder: string): Promise<Stats | undefined | string> => {
  try {
    return await fs.lstat(folder);
  } catch (error) {
    const code = String((error as NodeJS.ErrnoException).code);
    return code === "ENOENT" || code === "ENOTDIR" ? undefined : code;
  }
};

/**
 * Why the folder `start` of a repository cannot be walked, as a problem, or undefined when it can.
 * The rules of the walk (`listFiles`) for every folder on the way, name rules first: a name it never
 * reads (`.git`, `node_modules`), an `ignore` glob, the folder of another repository of the workspace
 * (`excludes`); then on disk: a link, a folder that is not there or is a file
 * (`evidence.folder-missing`), one that cannot be looked at (`file.unreadable`), a folder with a
 * `.git` entry (a nested repository that is not part of this one).
 */
const startProblem = async (
  repository: RepositoryLocation,
  ignored: (relativePath: string) => boolean,
  start: string,
): Promise<Problem | undefined> => {
  const file = start === "" ? "." : start;
  let relative = "";
  for (const name of start === "" ? [] : start.split("/")) {
    relative = relative === "" ? name : `${relative}/${name}`;
    const folder = path.join(repository.folder, relative);
    if (SKIPPED_NAMES.has(name)) {
      return skippedFolder(repository.name, file, `lies in ${name}, which ReqSeq never reads`);
    }
    if (ignored(relative)) {
      return skippedFolder(repository.name, file, "matches an ignore glob of the workspace file");
    }
    if (repository.excludes.includes(folder)) {
      return skippedFolder(
        repository.name,
        file,
        "lies in another repository of the workspace; name that repository in the location",
      );
    }
    const stat = await lstatOf(folder);
    if (typeof stat === "string") {
      return {
        code: "file.unreadable",
        severity: "error",
        repository: repository.name,
        file,
        message: `Cannot read evidence folder: ${stat}`,
      };
    }
    if (stat?.isSymbolicLink() === true) {
      return skippedFolder(
        repository.name,
        file,
        "is or lies below a symbolic link; ReqSeq does not follow links",
      );
    }
    if (stat?.isDirectory() !== true) {
      return {
        code: "evidence.folder-missing",
        severity: "info",
        repository: repository.name,
        file,
        message: `The evidence folder ${file} does not exist`,
      };
    }
    if ((await lstatOf(path.join(folder, ".git"))) !== undefined) {
      return skippedFolder(
        repository.name,
        file,
        "lies in a nested Git repository that is not part of the workspace",
      );
    }
  }
  return undefined;
};

/**
 * The `*.md` and `*.xml` files of every evidence location of `layout` (`evidence` of the workspace
 * file), recursively. A location in a repository that is not available sets `incomplete`; one whose
 * repository the workspace file does not list is left out (the workspace layout reports it). A file
 * (or a problem of the walk) that two locations both reach is listed once.
 */
export const evidenceFiles = async (layout: WorkspaceLayout): Promise<EvidenceFiles> => {
  const ignored = ignoredBy(layout);
  const files: EvidenceFile[] = [];
  const seen = new Set<string>();
  const seenProblems = new Set<string>();
  const problems: Problem[] = [];
  let incomplete = false;
  for (const location of layout.file.evidence ?? []) {
    const { repository } = locate(layout, location);
    if (repository === undefined) {
      continue;
    }
    if (!repository.available) {
      incomplete = true;
      continue;
    }
    const start = startOf(location.path);
    const problem = await startProblem(repository, ignored, start);
    if (problem !== undefined) {
      problems.push(problem);
      continue;
    }
    const listed = await listFiles(repository, ignored, start, EVIDENCE_FILES);
    for (const listing of listed.problems) {
      // `listFiles` always names the repository and a path (`.` for its root).
      const key = `${listing.code}\n${repository.name}\n${String(listing.file)}`;
      if (!seenProblems.has(key)) {
        seenProblems.add(key);
        problems.push(listing);
      }
    }
    for (const file of listed.files) {
      const key = `${repository.name}\n${file}`;
      if (!seen.has(key)) {
        seen.add(key);
        // The walk lists only names that end in `.md` or `.xml` in lower case.
        const ext: EvidenceExtension = file.endsWith(".xml") ? "xml" : "md";
        files.push({ repository: repository.name, file, absolute: path.join(repository.folder, file), ext });
      }
    }
  }
  return { files, incomplete, problems };
};
