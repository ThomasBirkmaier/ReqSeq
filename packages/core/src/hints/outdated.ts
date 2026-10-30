// Outdated relations and inline references (SR-025, D-013, D-042): a relation or reference stores
// the version of its target (ADR-0004); when that is not the current version of the target
// (ADR-0005, `currentVersionsState`, #259), the relation is outdated, and the check reports it
// until someone confirms the hint (SR-027 writes the current version into the relation).
//
// - What is checked: every item of a relation kind and of a relation-valued property
//   (`relationItems`; ADR-0004: validity and packages carry a version like any relation and become
//   outdated too), and every inline reference of the text (`ElementRecord.references`, SR-066 AK3)
//   and of the properties marked `markdown` (`referencesOf`, SR-127 AK3), of every element, whatever
//   its type.
// - Only a stored version of normal form 1 is compared (the only one there is, ADR-0005), and only
//   with a target that is `available` (`targetState`, `referenceTargetState`). A target that is
//   missing (SR-089), ambiguous (SR-088), in a repository that is not on this machine (SR-006) or in
//   one the workspace file does not list (#193) is another finding, not an outdated one; so is an
//   item without a valid `version` (SR-085). A reference without `version` stores no version and is
//   not reported (it gets one on the next save, ADR-0004); nor is a target whose current version is
//   unknown (`CurrentVersion` `unknown`: its file no longer holds it, an image cannot be read).
//   Relations stored in a repository that is not on this machine cannot be read (spec question
//   #262, option 1); the check reports that repository as missing (SR-006).
// - Each finding (`OutdatedFinding`) keeps its source, target, both versions and a problem: code
//   `relation.outdated` (`variant.core-changed` for a replacement in a variant onto a core
//   requirement, `core-changed.ts`, SR-045), severity `warning` (a "Hinweis", D-042; SR-019 AK2 ends
//   the check with exit code 1 for it, ADR-0009), the source's repository and file, the line of the
//   item or link, `elementId` (the source), `targetId`, `storedVersion`, `currentVersion` and `hintId`
//   (`hint-id.ts`, which `hint.confirm` resolves). `datedProblems` adds the dates of both versions
//   (`storedDate`, `currentDate`, D-013) per call; they are not kept in the state, since a new commit
//   moves no file and a kept state would show old dates.
// - Lines: one rule for items and links: the line in the file as it is now when the file is
//   unchanged since the store read it, none when it changed (`locateOutdated`). Item lines come from
//   a scan of the frontmatter text (`textLineOf`), the YAML is parsed only where the text is written
//   in another layout; a link has its line from the store.
// - Order: elements in store order; per element its relations in the order of the keys in the
//   file, then of the items, then its references in text order.
// - Carried over a save or a watcher batch (#184, ADR-0008) when every changed UUID keeps its
//   repositories and types (no short ID and no target resolution changes) and the incoming index of
//   the store before the change is there (the state builds it and depends on `incomingState`, so the
//   index is carried first, #273): only the changed files and the
//   sources of relations and references to a changed UUID are looked at again. Otherwise it is
//   built again.
// - Cost (N-036): the current versions (#259, built once per store), the incoming index, one pass
//   over the relations of the store with a map lookup per target, in slices (SR-082); the files of
//   sources with an outdated relation are read again as text for the lines.
import type { Problem } from "../catalog.js";
import { readElementFrontmatterSync } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import type {
  CurrentVersions,
  ElementRecord,
  ElementStore,
  LocatableFinding,
  ShortIds,
  ValuePath,
} from "../model/index.js";
import {
  currentVersionOf,
  currentVersionsOf,
  currentVersionsState,
  elementLabel,
  elementStoreState,
  hasId,
  incomingFor,
  incomingState,
  isN1Version,
  isOutdatedVersion,
  placeOfReference,
  referenceTargetState,
  referencesOf,
  relationItems,
  relationKey,
  shortIdState,
  targetState,
} from "../model/index.js";
import { frontmatterLines, textLineOf } from "../model/item-lines.js";
import { findingLocator } from "../model/locate.js";
import type { StoreUpdate } from "../model/store.js";
import { carryStoreUpdate } from "../model/store.js";
import type { VersionDateRequest } from "../model/version-date.js";
import { prepareVersionDates, versionDates } from "../model/version-date.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { availableRepositories, workspaceLayoutState } from "../workspace/index.js";
import { isCoreChange } from "./core-changed.js";
import type { ConfirmableCode } from "./hint-id.js";
import { CORE_CHANGED_CODE, OUTDATED_CODE, hintIdOf } from "./hint-id.js";
import { forEachSliced } from "./slices.js";

/** What the check needs: where targets are, their current versions, and short IDs for messages (SR-084). */
export interface OutdatedContext {
  readonly layout: Pick<WorkspaceLayout, "repositories">;
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
  /** The current version of every element; its `store` is the store whose relations are checked. */
  readonly versions: CurrentVersions;
}

/** One outdated relation item or inline reference. */
export interface OutdatedFinding {
  /** The source, which stores the relation. */
  readonly element: ElementRecord;
  readonly target: ElementRecord;
  /** The version the item or link stores, and the current version of the target. */
  readonly stored: string;
  readonly current: string;
  /** The stable ID of the hint (`hint-id.ts`), as its problem names it (`hintId`). */
  readonly hintId: string;
  /** Without dates (`datedProblems` adds them); with the line where it is known. */
  readonly problem: Problem;
}

/** A finding before its line is known: an item has the path of its value, a link its line from the store. */
export interface Candidate {
  readonly finding: OutdatedFinding;
  readonly path?: ValuePath;
}

/** The current version of `target` when it is not `stored`; else undefined. */
const outdatedAgainst = (
  versions: CurrentVersions,
  target: ElementRecord,
  stored: string,
): string | undefined => {
  const current = currentVersionOf(versions, target);
  return isOutdatedVersion(stored, current) ? current : undefined;
};

/** The problem of an outdated relation or link of `element` (without line and dates). */
const problemOf = (
  element: ElementRecord,
  target: ElementRecord,
  message: string,
  versions: { readonly stored: string; readonly current: string },
  hintId: string,
  code: ConfirmableCode = OUTDATED_CODE,
): Problem => ({
  code,
  severity: "warning",
  message,
  repository: element.repository,
  file: element.file,
  elementId: element.id,
  targetId: target.id,
  storedVersion: versions.stored,
  currentVersion: versions.current,
  hintId,
});

/** Where the targets of links are looked up: the store and the repositories on this machine. */
interface LinkContext {
  readonly layout: Pick<WorkspaceLayout, "repositories">;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
}

/** A relation item or inline reference that stores a version of normal form 1 of an available target. */
type StoredLink = { readonly stored: string; readonly target: ElementRecord } & (
  | {
      readonly kind: "relation";
      readonly key: string;
      /** How messages name the relation kind or property. */
      readonly label: string;
      readonly path: ValuePath;
      /** The `repository` the item names, as written. */
      readonly named: unknown;
    }
  | {
      readonly kind: "reference";
      /** The `repository` of the link as written. */
      readonly repository: string | undefined;
      /** The place of the link among the links of the text with the same target, repository and version (the `n` of the hint ID). */
      readonly occurrence: number;
      readonly line: number;
      /** The property (`markdown`, SR-127) and the position of the value in its list; none for the text. */
      readonly key?: string;
      readonly item?: number;
    }
);

/** Each inline reference of `element` (text order; the properties marked `markdown` first) that `eachStoredLink` gives. */
const eachStoredReference = (
  element: ElementRecord,
  { layout, metamodel, store }: LinkContext,
  visit: (link: StoredLink) => void,
): void => {
  /** How often each target, repository and version occurred in the text, or in all values of one property, so far. */
  const seen = new Map<string, number>();
  for (const reference of referencesOf(element, metamodel)) {
    const { id, repository, version: stored, key, item } = reference;
    const place = JSON.stringify([key ?? null, id, repository ?? null, stored ?? null]);
    const occurrence = (seen.get(place) ?? 0) + 1;
    seen.set(place, occurrence);
    if (!isN1Version(stored)) {
      continue;
    }
    const state = referenceTargetState(layout, store, element.repository, reference);
    if (state.kind === "available") {
      const { line } = reference;
      visit({
        kind: "reference",
        repository,
        occurrence,
        line,
        stored,
        target: state.element,
        ...(key === undefined ? {} : { key }),
        ...(item === undefined ? {} : { item }),
      });
    }
  }
};

/**
 * Each relation item of `element` (keys in file order, then items), then each inline reference (in
 * text order), that stores a version of normal form 1 of a target that is `available`: the links
 * the outdated check compares (see the file comment).
 */
const eachStoredLink = (
  element: ElementRecord,
  context: LinkContext,
  visit: (link: StoredLink) => void,
): void => {
  const { layout, metamodel, store } = context;
  for (const [key, value] of Object.entries(element.data)) {
    const relation = relationKey(metamodel, key);
    if (relation === undefined) {
      continue;
    }
    for (const [path, item] of relationItems(key, relation, value)) {
      if (!hasId(item)) {
        continue;
      }
      const stored = item["version"];
      if (!isN1Version(stored)) {
        continue;
      }
      const state = targetState(layout, store, element.repository, item);
      if (state.kind === "available") {
        const { label } = relation;
        visit({
          kind: "relation",
          key,
          label,
          path,
          named: item["repository"],
          stored,
          target: state.element,
        });
      }
    }
  }
  eachStoredReference(element, context, visit);
};

/** The finding of `link` of `element`, whose target's current version is `current`. */
const candidateOf = (
  element: ElementRecord,
  link: StoredLink,
  current: string,
  context: OutdatedContext,
): Candidate => {
  const { stored, target } = link;
  const place = { sourceRepository: element.repository, file: element.file, source: element.id };
  const versions = { stored, current };
  if (link.kind === "relation") {
    const { key, named } = link;
    // A replacement in a variant onto a changed core requirement is one hint of its own (SR-045 AK1).
    const code = isCoreChange(context.metamodel, element, key, target) ? CORE_CHANGED_CODE : OUTDATED_CODE;
    const hintId = hintIdOf({
      kind: "relation",
      code,
      ...place,
      key,
      target: target.id,
      ...(typeof named === "string" ? { repository: named } : {}),
      version: stored,
    });
    const message =
      code === CORE_CHANGED_CODE
        ? `Core requirement ${elementLabel(context, target)}, which ${elementLabel(context, element)} replaces, has changed since the replacement stored its version`
        : `${link.label} of ${elementLabel(context, element)} points to an older version of ${elementLabel(context, target)}`;
    const problem = problemOf(element, target, message, versions, hintId, code);
    return { path: link.path, finding: { element, target, stored, current, hintId, problem } };
  }
  const { repository, occurrence, key } = link;
  const hintId = hintIdOf({
    kind: "reference",
    code: OUTDATED_CODE,
    ...place,
    target: target.id,
    ...(repository === undefined ? {} : { repository }),
    version: stored,
    occurrence,
    ...(key === undefined ? {} : { property: key }),
  });
  const message = `Reference in ${placeOfReference(link)} of ${elementLabel(context, element)} points to an older version of ${elementLabel(context, target)}`;
  const problem = { ...problemOf(element, target, message, versions, hintId), line: link.line };
  return { finding: { element, target, stored, current, hintId, problem } };
};

/** The outdated relations, then references, of `element`, before their lines are looked up, appended to `out`. */
const candidatesInto = (element: ElementRecord, context: OutdatedContext, out: Candidate[]): void => {
  const { versions } = context;
  eachStoredLink(element, { ...context, store: versions.store }, (link) => {
    const current = outdatedAgainst(versions, link.target, link.stored);
    if (current !== undefined) {
      out.push(candidateOf(element, link, current, context));
    }
  });
};

/** The outdated relations, then references, of one element, before their lines are looked up. */
const candidatesOf = (element: ElementRecord, context: OutdatedContext): Candidate[] => {
  const out: Candidate[] = [];
  candidatesInto(element, context, out);
  return out;
};

/** `problem` without its line. */
const withoutLine = ({ line: _line, ...problem }: Problem): Problem => problem;

/**
 * The findings of `candidates` in their order, with lines by one rule: when the source file is
 * unchanged since the store read it, the line of the item (`textLineOf` on the frontmatter text;
 * the YAML is parsed, `findingLocator`, only for items written in another layout) or of the link
 * (from the store); no line when the file changed since or cannot be read. Each source file is read
 * once, in slices (SR-082).
 */
const locateOutdated = async (
  layout: WorkspaceLayout,
  candidates: readonly Candidate[],
): Promise<OutdatedFinding[]> => {
  const sources = new Map<string, Set<ElementRecord>>();
  for (const { finding } of candidates) {
    const { element } = finding;
    sources.set(element.repository, (sources.get(element.repository) ?? new Set()).add(element));
  }
  // The lines of each source's frontmatter, split once per file.
  const frontmatters = new Map<ElementRecord, readonly string[] | undefined>();
  for (const repository of availableRepositories(layout)) {
    await forEachSliced(sources.get(repository.name) ?? [], (element) => {
      const text = readElementFrontmatterSync(repository.folder, element.file, element.snapshot);
      frontmatters.set(element, text === undefined ? undefined : frontmatterLines(text));
    });
  }
  const parse = new Map<number, LocatableFinding>();
  const out: OutdatedFinding[] = [];
  await forEachSliced(candidates, ({ finding, path }) => {
    const lines = frontmatters.get(finding.element);
    const line = lines === undefined || path === undefined ? undefined : textLineOf(lines, path);
    if (lines === undefined) {
      out.push({ ...finding, problem: withoutLine(finding.problem) });
    } else if (path !== undefined && line === undefined) {
      parse.set(out.length, { element: finding.element, path, problem: finding.problem });
      out.push(finding);
    } else {
      out.push(line === undefined ? finding : { ...finding, problem: { ...finding.problem, line } });
    }
  });
  if (parse.size === 0) {
    return out;
  }
  const locate = await findingLocator(layout, [...parse.values()]);
  return out.map((finding, at) => {
    const parsed = parse.get(at);
    return parsed === undefined ? finding : { ...finding, problem: locate(parsed) };
  });
};

/**
 * The outdated relations and inline references of one element, with lines as the whole-workspace
 * state gives them; `datedProblems` gives their problems with dates.
 */
export const outdatedFindingsOf = async (
  layout: WorkspaceLayout,
  element: ElementRecord,
  context: OutdatedContext,
): Promise<OutdatedFinding[]> => locateOutdated(layout, candidatesOf(element, context));

/** What the outdated hints of one element in its view read: the states `element.get` works on. */
export interface ShownContext {
  readonly workspace: Workspace;
  readonly layout: WorkspaceLayout;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
}

/**
 * The outdated relations and inline references of `element` as its view shows them (SR-026 AK3),
 * by the same rules as the whole-workspace state, before their lines are known: an item has the
 * path of its value (the view looks it up in the file it has just read), a link its line in that
 * file. `element` may be the element as its file holds it now; its targets are looked up in the
 * store. The current versions are those of the workspace when their build has ended; otherwise
 * only the targets' versions are read, each from its file (`currentVersionsOf`; ADR-0008: a single
 * element never waits for the whole build).
 */
export const outdatedOfShown = async (
  context: ShownContext,
  element: ElementRecord,
): Promise<Candidate[]> => {
  const { workspace, layout, metamodel, store, shortIds } = context;
  const targets = new Set<ElementRecord>();
  eachStoredLink(element, context, (link) => {
    targets.add(link.target);
  });
  if (targets.size === 0) {
    return [];
  }
  const byRecord = await currentVersionsOf(workspace, [...targets]);
  const versions: CurrentVersions = { store, layout, metamodel, byRecord };
  return candidatesOf(element, { layout, metamodel, shortIds, versions });
};

/**
 * The elements of `elements` that store at least one outdated relation, relation property or inline
 * reference, by the rule of `outdatedOfShown` (the `relation.outdated` hints of element.get, which
 * the modeline counts): for the marks of trace.graph (SR-111 AK4). One `currentVersionsOf` for the
 * targets of all of them; no finding, message or hint ID is built.
 */
export const outdatedAmong = async (
  context: Omit<ShownContext, "shortIds">,
  elements: readonly ElementRecord[],
): Promise<ReadonlySet<ElementRecord>> => {
  const { workspace, layout, metamodel, store } = context;
  const links = new Map<ElementRecord, StoredLink[]>();
  const targets = new Set<ElementRecord>();
  for (const element of elements) {
    const stored: StoredLink[] = [];
    eachStoredLink(element, context, (link) => {
      stored.push(link);
      targets.add(link.target);
    });
    links.set(element, stored);
  }
  const outdated = new Set<ElementRecord>();
  if (targets.size === 0) {
    return outdated;
  }
  const byRecord = await currentVersionsOf(workspace, [...targets]);
  const versions: CurrentVersions = { store, layout, metamodel, byRecord };
  for (const [element, stored] of links) {
    if (stored.some((link) => outdatedAgainst(versions, link.target, link.stored) !== undefined)) {
      outdated.add(element);
    }
  }
  return outdated;
};

/** The findings of every element of `elements`, in order, before their lines are looked up; in slices (SR-082). */
const candidatesOfAll = async (
  elements: Iterable<ElementRecord>,
  context: OutdatedContext,
): Promise<Candidate[]> => {
  const out: Candidate[] = [];
  await forEachSliced(elements, (element) => {
    candidatesInto(element, context, out);
  });
  return out;
};

/** Repository and type of each record of `id`, in store order. */
const places = (store: ElementStore, id: string): string =>
  JSON.stringify((store.byId.get(id) ?? []).map((r) => [r.repository, r.type]));

/** The files of `update` and the sources of relations and links to its UUIDs, by repository. */
const filesAgain = (update: StoreUpdate, index: ReturnType<typeof incomingFor>): Map<string, Set<string>> => {
  const again = new Map<string, Set<string>>();
  const add = (repository: string, file: string): void => {
    again.set(repository, (again.get(repository) ?? new Set()).add(file));
  };
  for (const [repository, files] of update.files) {
    for (const file of files) {
      add(repository, file);
    }
  }
  for (const id of update.ids) {
    for (const { source } of [
      ...(index.relationsById.get(id) ?? []),
      ...(index.referencesById.get(id) ?? []),
    ]) {
      add(source.repository, source.file);
    }
  }
  return again;
};

/**
 * The findings after `update` from `old`: the elements of `again` are looked at anew, every other
 * keeps its findings (with their lines), in store order as a build gives them.
 */
const carried = async (
  old: readonly OutdatedFinding[],
  update: StoreUpdate,
  again: ReadonlyMap<string, ReadonlySet<string>>,
  layout: WorkspaceLayout,
  context: OutdatedContext,
): Promise<OutdatedFinding[]> => {
  const kept = new Map<string, Map<string, OutdatedFinding[]>>();
  for (const finding of old) {
    const { repository, file } = finding.element;
    const files = kept.get(repository) ?? new Map<string, OutdatedFinding[]>();
    kept.set(repository, files);
    files.set(file, [...(files.get(file) ?? []), finding]);
  }
  const fresh = await candidatesOfAll(
    update.to.elements.filter((e) => again.get(e.repository)?.has(e.file) === true),
    context,
  );
  const located = await locateOutdated(layout, fresh);
  const byFile = new Map<ElementRecord, OutdatedFinding[]>();
  for (const finding of located) {
    byFile.set(finding.element, [...(byFile.get(finding.element) ?? []), finding]);
  }
  return update.to.elements.flatMap((element) =>
    again.get(element.repository)?.has(element.file) === true
      ? (byFile.get(element) ?? [])
      : (kept.get(element.repository)?.get(element.file) ?? []),
  );
};

/** The context of the outdated check on the states of `workspace` (read synchronously by a carry hook). */
const contextOf = async (
  workspace: Workspace,
): Promise<{ readonly layout: WorkspaceLayout; readonly context: OutdatedContext }> => {
  const [metamodel, layout, versions, shortIds] = await Promise.all([
    workspace.get(metamodelState),
    workspace.get(workspaceLayoutState),
    workspace.get(currentVersionsState),
    workspace.get(shortIdState),
  ]);
  return { layout, context: { layout, metamodel, shortIds, versions } };
};

/** Every finding of the store of `context`, located; builds the incoming index of that store too. */
const buildAll = async (
  workspace: Workspace,
  layout: WorkspaceLayout,
  context: OutdatedContext,
): Promise<OutdatedFinding[]> => {
  // So that a later change of the store can be carried (#273): the sources of relations to a changed UUID.
  incomingFor(workspace, context.versions.store, context.metamodel);
  return locateOutdated(layout, await candidatesOfAll(context.versions.store.elements, context));
};

/**
 * Every outdated relation and inline reference of the workspace (SR-025) as findings without dates
 * (`datedProblems` gives the problems with dates): per element in store order its relations, then
 * its references. Kept until the element store, the metamodel or the current versions are reset;
 * carried over a change of the store (see the file comment).
 */
export const outdatedRelationsState = defineWorkspaceState(
  "outdated-relations",
  async (workspace): Promise<readonly OutdatedFinding[]> => {
    const metamodel = await workspace.get(metamodelState);
    // Nothing against a metamodel that is not valid: its errors are the findings (#208, #220).
    if (!metamodel.valid) {
      return [];
    }
    const { layout, context } = await contextOf(workspace);
    return buildAll(workspace, layout, context);
  },
  {
    // The incoming index too: so that it is carried first and the hook finds the index of the store before the change.
    dependsOn: [elementStoreState, metamodelState, shortIdState, currentVersionsState, incomingState],
    carry: carryStoreUpdate((value, update, workspace) => {
      const index = workspace.peek(incomingState)?.get(update.from);
      const same = [...update.ids].every((id) => places(update.from, id) === places(update.to, id));
      if (index === undefined || !same) {
        return undefined;
      }
      // Synchronously, so these are the states carried over the same update.
      const states = contextOf(workspace);
      return (async () => {
        const [old, { layout, context }] = await Promise.all([value, states]);
        if (!context.metamodel.valid) {
          return [];
        }
        // An index built with another metamodel may name other relations: as if there were none.
        // Nearly unreachable: a change of the metamodel resets this state (`dependsOn`) before any carry.
        return index.metamodel === context.metamodel
          ? carried(old, update, filesAgain(update, index), layout, context)
          : buildAll(workspace, layout, context);
      })();
    }),
  },
);

/** How a message shows the date of a version (D-013): the date, or why there is none (ADR-0005). */
const shown = (date: string | null): string => date ?? "no date (not committed, or Git cannot tell)";

/**
 * The problems of `findings` with the dates of the stored and the current version (D-013, ADR-0005
 * "Version date"), both named in the message. One `versionDates` call for all of them: one walk
 * per target file, whatever the number of relations to it. A date is `null` for content no commit
 * has, and when Git cannot tell (no repository, shallow clone, git missing).
 */
export const datedProblems = async (
  workspace: Workspace,
  findings: readonly OutdatedFinding[],
): Promise<Problem[]> => {
  if (findings.length === 0) {
    return [];
  }
  const context = {
    workspace,
    layout: await workspace.get(workspaceLayoutState),
    metamodel: await workspace.get(metamodelState),
  };
  const requests = new Map<string, VersionDateRequest>();
  const request = (target: ElementRecord, version: string): string => {
    const key = JSON.stringify([target.repository, target.file, target.id, version]);
    if (!requests.has(key)) {
      requests.set(key, { repository: target.repository, file: target.file, id: target.id, version });
    }
    return key;
  };
  const pending = findings.map(({ problem, target, stored, current }) => ({
    problem,
    stored: request(target, stored),
    current: request(target, current),
  }));
  const asked = [...requests.values()];
  await prepareVersionDates(context, asked);
  const answers = await versionDates(context, asked);
  const dates = new Map([...requests.keys()].map((key, i) => [key, answers[i] ?? null]));
  return pending.map(({ problem, stored, current }) => {
    const storedDate = dates.get(stored) ?? null;
    const currentDate = dates.get(current) ?? null;
    return {
      ...problem,
      message: `${problem.message}: stored version from ${shown(storedDate)}, current version from ${shown(currentDate)}`,
      storedDate,
      currentDate,
    };
  });
};
