// Lines of findings in element files. The element store keeps no YAML `Document` (ADR-0008), so
// the line of a value is looked up when a check reports it: only the files that have findings are
// read again, each once. A file that changed since the store read it, or cannot be read now, gives
// its problems without a line rather than a wrong one; the watcher reloads the store (SR-007).
import type { Problem } from "../catalog.js";
import type { ParsedFile } from "../files/index.js";
import { readElementFiles } from "../files/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { availableRepositories } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { keyLineOf, lineOf } from "./elements.js";

/** A problem of an element that a key path in its frontmatter points at (`[key]` or `[key, item]`). */
export interface LocatableFinding {
  readonly element: ElementRecord;
  readonly path: readonly (string | number)[];
  /**
   * `"key"`: the line is the one of the top-level key `path[0]` itself, also for a block value
   * (a finding about the key, SR-016). `"line"`: the problem has its line already and `path` is
   * not looked up (an inline reference in the text, whose line the element record keeps, SR-026
   * AK3). Otherwise the first line of the value at `path`.
   */
  readonly at?: "key" | "line";
  /** Gets `line` when the path is found in the unchanged file. */
  readonly problem: Problem;
}

/** The line of a finding in `file` (see `LocatableFinding.at`), undefined when it is not found. */
export const findingLine = (file: ParsedFile, finding: LocatableFinding): number | undefined => {
  if (finding.at === "line") {
    return finding.problem.line;
  }
  return finding.at === "key" ? keyLineOf(file, String(finding.path[0])) : lineOf(file, finding.path);
};

export interface LocateOptions {
  /** Stops reading further files; the call then rejects with the signal's reason. */
  readonly signal?: AbortSignal;
}

/** The files of one repository that are unchanged since the store read them, by path. */
const unchangedFiles = async (
  folder: string,
  elements: readonly ElementRecord[],
  options: LocateOptions,
): Promise<ReadonlyMap<string, ParsedFile>> => {
  const read = await readElementFiles(
    folder,
    elements.map((e) => e.file),
    options.signal === undefined ? {} : { signal: options.signal },
  );
  const hashes = new Map(elements.map((e) => [e.file, e.snapshot.sha256]));
  return new Map(read.files.filter((f) => hashes.get(f.path) === f.snapshot.sha256).map((f) => [f.path, f]));
};

/**
 * The problem of each of `findings` with the line of its path when the file is unchanged since the
 * store read it, as a function of the finding. Reads every file with findings once, per repository
 * with `readElementFiles` (32 at a time); a finding that was not passed gets no line.
 */
export const findingLocator = async (
  layout: WorkspaceLayout,
  findings: readonly LocatableFinding[],
  options: LocateOptions = {},
): Promise<(finding: LocatableFinding) => Problem> => {
  const byRepository = new Map<string, Map<string, ElementRecord>>();
  for (const { element } of findings) {
    const files = byRepository.get(element.repository) ?? new Map<string, ElementRecord>();
    files.set(element.file, element);
    byRepository.set(element.repository, files);
  }
  const files = new Map<string, ReadonlyMap<string, ParsedFile>>();
  for (const repository of availableRepositories(layout)) {
    const elements = byRepository.get(repository.name);
    if (elements !== undefined) {
      files.set(repository.name, await unchangedFiles(repository.folder, [...elements.values()], options));
    }
  }
  return (f) => {
    const file = files.get(f.element.repository)?.get(f.element.file);
    const line = file === undefined ? undefined : findingLine(file, f);
    return line === undefined ? f.problem : { ...f.problem, line };
  };
};

/**
 * The problems of `findings` in their order, each with the line of its path when the file is
 * unchanged since the store read it. Reads every file with findings once, per repository with
 * `readElementFiles` (32 at a time).
 */
export const locateFindings = async (
  layout: WorkspaceLayout,
  findings: readonly LocatableFinding[],
  options: LocateOptions = {},
): Promise<readonly Problem[]> => findings.map(await findingLocator(layout, findings, options));
