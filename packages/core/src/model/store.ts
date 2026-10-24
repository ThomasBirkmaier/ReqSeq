// The element store (ADR-0008): every element file of every available repository of the workspace,
// found by its frontmatter in whatever folder it lies (SR-003, SR-004 AK1, D-056). Relations name
// their target by UUID only, so moving a file to another folder changes nothing for them (SR-003 AK3).
import type { Problem } from "../catalog.js";
import { readElementFile } from "../files/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { availableRepositories, workspaceLayoutState } from "../workspace/index.js";
import { listMarkdownFiles } from "./discover.js";
import type { ElementRecord } from "./elements.js";
import { classifyFile } from "./elements.js";
import { ignoreMatcher } from "./ignore.js";

/** A file of a repository of the workspace. */
export interface RepositoryFile {
  /** Workspace name of the repository. */
  readonly repository: string;
  /** Relative to the repository, `/` as separator. */
  readonly file: string;
}

export interface ElementStore {
  /** All elements, by repository in the order of the workspace file, then by file path (code units). */
  readonly elements: readonly ElementRecord[];
  /**
   * Elements by UUID, in the order of `elements`. More than one record when files share a UUID
   * (a copied file); reporting that is SR-088.
   */
  readonly byId: ReadonlyMap<string, readonly ElementRecord[]>;
  /** Markdown files that are not elements (SR-003 AK2). LogReq never writes them. */
  readonly nonElements: readonly RepositoryFile[];
  /**
   * With `repository` set, per repository in the order of the workspace file: folders that cannot
   * be listed and Markdown files that are not read (links, `.MD`), then per file in path order its
   * faulty YAML or content (SR-008), YAML warnings and invalid `id` or `type`. A faulty file never
   * stops the others (SR-008 AK3).
   */
  readonly problems: readonly Problem[];
}

/** Files read at the same time; bounded so 50,000 files do not exhaust file handles (N-036). */
const READ_CONCURRENCY = 32;

/** What one Markdown file contributes to the store; small, so no parsed `Document` is held (ADR-0008). */
type Contribution =
  | { readonly kind: "element"; readonly element: ElementRecord; readonly warnings: readonly Problem[] }
  | { readonly kind: "not-element"; readonly file: string; readonly warnings: readonly Problem[] }
  /** `warnings` are the YAML warnings of a file that parsed but has an invalid `id` or `type`. */
  | { readonly kind: "problem"; readonly problem: Problem; readonly warnings: readonly Problem[] };

const withRepository = (problem: Problem, repository: string): Problem => ({ ...problem, repository });

/** Reads and classifies one file at once, so that its YAML `Document` is dropped right after. */
const contribution = async (repository: RepositoryLocation, file: string): Promise<Contribution> => {
  const read = await readElementFile(repository.folder, file);
  if (read.kind === "problem") {
    return { kind: "problem", problem: withRepository(read.problem, repository.name), warnings: [] };
  }
  if (read.kind === "no-frontmatter") {
    return { kind: "not-element", file: read.path, warnings: [] };
  }
  const warnings = read.file.warnings.map((w) => withRepository(w, repository.name));
  const classified = classifyFile(repository.name, read.file);
  switch (classified.kind) {
    case "element":
      return { kind: "element", element: classified.element, warnings };
    case "not-element":
      return { kind: "not-element", file: read.file.path, warnings };
    case "problem":
      return { kind: "problem", problem: classified.problem, warnings };
  }
};

/** Reads `files` of a repository with bounded parallelism; the results keep the order of `files`. */
const readRepository = async (
  repository: RepositoryLocation,
  files: readonly string[],
): Promise<readonly Contribution[]> => {
  const results: Contribution[] = [];
  // One shared iterator: each worker takes the next file until none are left.
  const queue = files.entries();
  const worker = async (): Promise<void> => {
    for (const [i, file] of queue) {
      results[i] = await contribution(repository, file);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, worker));
  return results;
};

/**
 * Reads the element files of every available repository of `layout` (a missing one is skipped,
 * SR-004 AK3). One folder walk per repository and bounded parallel reads, each file classified as
 * soon as it is read; no call of the version control program (N-036).
 */
export const loadElements = async (layout: WorkspaceLayout): Promise<ElementStore> => {
  const ignored = ignoreMatcher(layout.file.ignore ?? []);
  const elements: ElementRecord[] = [];
  const nonElements: RepositoryFile[] = [];
  const problems: Problem[] = [];
  for (const repository of availableRepositories(layout)) {
    const listed = await listMarkdownFiles(repository, ignored);
    for (const problem of listed.problems) {
      problems.push(problem);
    }
    for (const result of await readRepository(repository, listed.files)) {
      for (const warning of result.warnings) {
        problems.push(warning);
      }
      if (result.kind === "problem") {
        problems.push(result.problem);
      } else if (result.kind === "element") {
        elements.push(result.element);
      } else {
        nonElements.push({ repository: repository.name, file: result.file });
      }
    }
  }
  const byId = new Map<string, ElementRecord[]>();
  for (const element of elements) {
    const same = byId.get(element.id);
    if (same === undefined) {
      byId.set(element.id, [element]);
    } else {
      same.push(element);
    }
  }
  return { elements, byId, nonElements, problems };
};

/**
 * The element store of a workspace, read on first use and kept until reset. Reading it again
 * (`workspace.reset(elementStoreState)`, e.g. by the watcher, SR-007, or a new `Workspace`) finds
 * every element where it lies now. Resetting the workspace layout resets it too.
 */
export const elementStoreState = defineWorkspaceState(
  "elements",
  async (workspace): Promise<ElementStore> => loadElements(await workspace.get(workspaceLayoutState)),
  { dependsOn: [workspaceLayoutState] },
);
