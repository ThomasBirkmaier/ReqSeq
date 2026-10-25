// Findings of the whole workspace carried over a change of the element store (#184, ADR-0008):
// after a save or a watcher batch, a finding state looks again only at the element files that
// changed (and those a state names as depending on them) and keeps the located problems of every
// other file, instead of finding and locating everything again on its next read.
import type { Problem } from "../catalog.js";
import type { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { findingLocator, locateFindings } from "./locate.js";
import type { StoreUpdate } from "./store.js";
import { byPath } from "./store.js";

/** The findings of one element of the new store, in the order its state gives them. */
export type FindingsOf = (element: ElementRecord) => readonly LocatableFinding[];

export interface CarryProblemsOptions {
  /** How to find an element's findings in the store after the update. */
  readonly findingsOf: Promise<FindingsOf>;
  /**
   * The elements of the new store whose files did not change but that have to be looked at again,
   * because their findings depend on other elements (a target, a short ID in the message): a list
   * of them, or a test that every element of the store is put to. Default: none.
   */
  readonly again?: Promise<((element: ElementRecord) => boolean) | readonly ElementRecord[]>;
  /**
   * Whether the state has no problems at all after the update, as a full build gives none (a
   * metamodel that is not valid, #208, #220): then nothing is kept, found or located, and neither
   * `findingsOf` nor `again` is awaited. Default: no.
   */
  readonly skip?: Promise<boolean>;
}

/** A kept problem with its place in store order. */
interface Kept {
  readonly problem: Problem;
  readonly repository: string;
  /** Index of its repository in `StoreUpdate.repositories`. */
  readonly at: number;
  readonly file: string;
}

/** Findings of one element with its place in store order. */
interface Group {
  readonly at: number;
  readonly file: string;
  readonly findings: readonly LocatableFinding[];
}

/** Whether a kept problem comes before a group in store order: by repository, then by `byPath`. */
const earlier = (a: Kept, b: Group): boolean => a.at < b.at || (a.at === b.at && byPath(a.file, b.file) < 0);

/**
 * The problems of a finding state after `update`, from `old`, its problems before (per element in
 * store order, each with its repository and file): the problems of every element file that did not
 * change are kept as they are, with their lines; the elements of the changed files (and those
 * `again` names) get their findings from `findingsOf` and are located (`locateFindings`, which reads
 * just those files). The result is in store order, as a full build gives it. With a list (or no)
 * `again`, only the problems before and the changed files are walked, never all elements: a save
 * costs as little as the files it wrote (N-036). Problems without a repository or file, or of a
 * repository the store no longer has, cannot be placed, so then everything is found again.
 */
export const carryProblems = async (
  workspace: Workspace,
  old: Promise<readonly Problem[]>,
  update: StoreUpdate,
  options: CarryProblemsOptions,
): Promise<readonly Problem[]> => {
  // The layout is taken now, with the update, not after the wait for `skip`.
  const layoutNow = workspace.get(workspaceLayoutState);
  if (await (options.skip ?? false)) {
    return [];
  }
  const [before, findingsOf, again, layout] = await Promise.all([
    old,
    options.findingsOf,
    options.again ?? [],
    layoutNow,
  ]);
  const index = new Map(update.repositories.map((r, i) => [r.repository, i]));
  const placed: Kept[] = [];
  for (const problem of before) {
    const { repository, file } = problem;
    const at = repository === undefined ? undefined : index.get(repository);
    if (repository === undefined || at === undefined || file === undefined) {
      return locateFindings(layout, update.to.elements.flatMap(findingsOf));
    }
    placed.push({ problem, repository, at, file });
  }
  return typeof again === "function"
    ? walk(layout, placed, update, findingsOf, again)
    : merge(layout, placed, update, findingsOf, again);
};

/** Every element of the new store in order: changed files and those `again` names are found again. */
const walk = async (
  layout: WorkspaceLayout,
  placed: readonly Kept[],
  update: StoreUpdate,
  findingsOf: FindingsOf,
  again: (element: ElementRecord) => boolean,
): Promise<readonly Problem[]> => {
  /** The problems before, by repository and file (no string per element: 50,000 of them, N-036). */
  const byFile = new Map<string, Map<string, Problem[]>>();
  for (const { problem, repository, file } of placed) {
    const files = byFile.get(repository) ?? new Map<string, Problem[]>();
    byFile.set(repository, files);
    const list = files.get(file);
    if (list === undefined) {
      files.set(file, [problem]);
    } else {
      list.push(problem);
    }
  }
  /** Kept problems and findings to locate, in store order. */
  const parts: ({ readonly kept: Problem } | { readonly found: LocatableFinding })[] = [];
  const fresh: LocatableFinding[] = [];
  for (const element of update.to.elements) {
    if (update.files.get(element.repository)?.has(element.file) === true || again(element)) {
      for (const found of findingsOf(element)) {
        fresh.push(found);
        parts.push({ found });
      }
    } else {
      for (const kept of byFile.get(element.repository)?.get(element.file) ?? []) {
        parts.push({ kept });
      }
    }
  }
  const locate = await findingLocator(layout, fresh);
  return parts.map((part) => ("kept" in part ? part.kept : locate(part.found)));
};

/**
 * The problems before without those of the changed files and of `also`, merged in store order
 * with the findings of these files in the new store; no walk over all elements.
 */
const merge = async (
  layout: WorkspaceLayout,
  placed: readonly Kept[],
  update: StoreUpdate,
  findingsOf: FindingsOf,
  also: readonly ElementRecord[],
): Promise<readonly Problem[]> => {
  const changed = new Map<string, Set<string>>();
  for (const [repository, files] of update.files) {
    changed.set(repository, new Set(files));
  }
  for (const { repository, file } of also) {
    changed.set(repository, (changed.get(repository) ?? new Set()).add(file));
  }
  const groups: Group[] = [];
  update.repositories.forEach((contents, at) => {
    for (const file of [...(changed.get(contents.repository) ?? [])].sort(byPath)) {
      const now = contents.files.get(file);
      if (now?.kind === "element") {
        groups.push({ at, file, findings: findingsOf(now.element) });
      }
    }
  });
  const locate = await findingLocator(
    layout,
    groups.flatMap((g) => g.findings),
  );
  const kept = placed.filter(({ repository, file }) => changed.get(repository)?.has(file) !== true);
  const out: Problem[] = [];
  const rest = kept.values();
  let head = rest.next();
  for (const group of groups) {
    while (head.done !== true && earlier(head.value, group)) {
      out.push(head.value.problem);
      head = rest.next();
    }
    for (const finding of group.findings) {
      out.push(locate(finding));
    }
  }
  for (; head.done !== true; head = rest.next()) {
    out.push(head.value.problem);
  }
  return out;
};
