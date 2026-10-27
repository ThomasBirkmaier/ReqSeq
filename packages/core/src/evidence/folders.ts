// The files of the evidence folders (ADR-0012 "Reading", SR-028 AK1): every `*.md` and `*.xml` file
// below each `evidence` location of the workspace file, in any repository of the workspace, by the
// walk rules of the element store (`listFiles` of the model block): no `.git` or `node_modules`, no
// nested repository, the `ignore` globs, links never followed. Which of the files are records is up to
// the readers (`state.ts`).
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import type { ListedKind } from "../model/index.js";
import { ignoredBy, listFiles } from "../model/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
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
   * `file.skipped` (warning) for a location that is or lies below a link, and the problems of the
   * walk (`file.unreadable`, `file.skipped`).
   */
  readonly problems: readonly Problem[];
}

/** `location.path` as the walk names folders: `/` as separator, no `.`, `""` for the repository root. */
const startOf = (relativePath: string): string => {
  const normal = path.posix.normalize(relativePath).replace(/\/+$/, "");
  return normal === "." ? "" : normal;
};

/** Why the folder `start` of a repository cannot be walked, as a problem, or undefined when it can. */
const startProblem = async (
  repository: string,
  root: string,
  start: string,
): Promise<Problem | undefined> => {
  const file = start === "" ? "." : start;
  let folder = root;
  for (const name of start === "" ? [] : start.split("/")) {
    folder = path.join(folder, name);
    const stat = await fs.lstat(folder).catch(() => undefined);
    if (stat?.isSymbolicLink() === true) {
      return {
        code: "file.skipped",
        severity: "warning",
        repository,
        file,
        message:
          "Not read: the evidence folder is or lies below a symbolic link; LogReq does not follow links",
      };
    }
    if (stat?.isDirectory() !== true) {
      return {
        code: "evidence.folder-missing",
        severity: "info",
        repository,
        file,
        message: `The evidence folder ${file} does not exist`,
      };
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
    const problem = await startProblem(repository.name, repository.folder, start);
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
