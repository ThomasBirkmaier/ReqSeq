// What one Markdown file contributes to the element store (ADR-0008): read and classified at once,
// so that its YAML `Document` is dropped right after. The main thread reads with `contribution`,
// the worker threads of a cold load with `contributionSync` (read-pool.ts); both give the same.
import type { Problem } from "../catalog.js";
import type { FileReadResult, FileSnapshot, ParsedFile } from "../files/index.js";
import { readElementFile, readElementFileSync } from "../files/index.js";
import type { RepositoryLocation } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { classifyFile } from "./elements.js";

/** What one Markdown file contributes to the store; small, so no parsed `Document` is held (ADR-0008). */
export type Contribution = (
  | { readonly kind: "element"; readonly element: ElementRecord }
  | { readonly kind: "not-element"; readonly file: string }
  /** A faulty file, or one that parsed but has an invalid `id` or `type`. */
  | { readonly kind: "problem"; readonly problem: Problem }
) & {
  /** YAML warnings of a file that parsed; they come before its problem. */
  readonly warnings: readonly Problem[];
  /** The bytes read, when the file parsed; the watcher compares their hash (SR-007). */
  readonly snapshot?: FileSnapshot;
};

/** The repository of the workspace, the part a worker thread needs. */
export type RepositoryPlace = Pick<RepositoryLocation, "name" | "folder">;

export const withRepository = (problem: Problem, repository: string): Problem => ({ ...problem, repository });

/** What a file that parsed contributes; the full read and a write (`withWrittenFiles`) use it. */
export const parsedContribution = (repository: string, file: ParsedFile): Contribution => {
  const { snapshot } = file;
  const warnings = file.warnings.map((w) => withRepository(w, repository));
  const classified = classifyFile(repository, file);
  switch (classified.kind) {
    case "element":
      return { kind: "element", element: classified.element, warnings, snapshot };
    case "not-element":
      return { kind: "not-element", file: file.path, warnings, snapshot };
    case "problem":
      return { kind: "problem", problem: classified.problem, warnings, snapshot };
  }
};

const contributionOf = (repository: string, read: FileReadResult): Contribution => {
  if (read.kind === "problem") {
    return { kind: "problem", problem: withRepository(read.problem, repository), warnings: [] };
  }
  if (read.kind === "no-frontmatter") {
    return { kind: "not-element", file: read.path, warnings: [] };
  }
  return parsedContribution(repository, read.file);
};

/** Reads and classifies one file of `repository`. */
export const contribution = async (repository: RepositoryPlace, file: string): Promise<Contribution> =>
  contributionOf(repository.name, await readElementFile(repository.folder, file));

/** `contribution` with blocking reads, for a worker thread (ADR-0008). */
export const contributionSync = (repository: RepositoryPlace, file: string): Contribution =>
  contributionOf(repository.name, readElementFileSync(repository.folder, file));
