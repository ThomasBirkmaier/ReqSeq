// The open hints of a workspace (SR-026, D-042): "Das Tool muss alle offenen Hinweise eines
// Arbeitsbereichs in einer Liste und am jeweiligen Element zeigen." `hint.list` lists them.
//
// - Which findings are hints: the glossary defines "Hinweis" (synonym "Warnung") as "Meldung des
//   Tools, dass ein Element geprüft werden sollte ... Ein Hinweis blockiert nichts und ändert keinen
//   Status." So a hint is a finding of severity `warning` that names an element (`elementId`,
//   `isHint`). They come from the same whole-workspace states as `workspace.check`: the states of
//   `HINT_STATES`, then the outdated relations and inline references (SR-025). Errors (a faulty file,
//   a duplicate UUID, a missing target: the SRs do not call them "Hinweis"), info and warnings about
//   no element (`file.yaml-warning`, `file.skipped`, `metamodel.meaning-unassigned`) are not hints.
//   The hints of a core change (`variant.core-changed`, SR-045, SR-103) join in stage 5.
// - Each hint is the problem as the check gives it (AK1): kind (`code`), the element (`elementId`,
//   `repository`, `file`, `line`, and its short ID `elementShortId` for display, #310), the target
//   where it has one (`targetId`) and the reason (`message`; an outdated relation names both
//   versions and their dates, D-013). Order: the order of the check.
// - Filters (AK2), combined with AND; within `kind` and `type` any of the values: `kind` the code;
//   `type` the type of the element or one it extends (SR-012, as the filter language counts
//   subtypes); `package` the elements whose property with the meaning `packages` lists the package;
//   `variant` the elements that apply in the variant by their validity (`appliesIn`: without a
//   validity in every variant, glossary "Gültigkeit"); `ref` the hints of one element. A hint whose
//   element is not in the store (none: every state reports elements of the store) matches no
//   element filter.
// - The dates of outdated relations are asked of Git only for the hints that pass the filters.
// - `incomplete` (SR-006 AK2): a repository of the workspace file is not on this machine, so the
//   hints of its elements are not listed.
import type { CommandName, Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import {
  allowsType,
  metamodelState,
  propertyWithMeaning,
  requireMeaning,
  typesWithMeaning,
} from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import {
  currentVersions,
  elementStoreState,
  relationKey,
  relationTypeProblemsState,
  requiredProblemsState,
  resolveRef,
  shortIdState,
  supersededTargetProblemsState,
  unknownProblemsState,
  valueKindProblemsState,
} from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { derivationCycleProblemsState } from "../trace/index.js";
import type { View } from "../variants/index.js";
import {
  appliesIn,
  resolveView,
  supersededValidityProblemsState,
  validityEntries,
  validityOf,
  validityTarget,
} from "../variants/index.js";
import { availableRepositories, workspaceLayoutState } from "../workspace/index.js";
import { outdatedEvidenceProblemsState } from "./evidence.js";
import type { OutdatedFinding } from "./outdated.js";
import { datedProblems, outdatedRelationsState } from "./outdated.js";

const COMMAND: CommandName = "hint.list";

/**
 * The whole-workspace finding states that can give hints, in the order of `workspace.check`
 * (`FINDING_STATES`; the outdated relations follow them). Its other states give errors only:
 * duplicate UUIDs (SR-088) and missing targets (SR-089).
 */
export const HINT_STATES = [
  requiredProblemsState, // SR-015
  unknownProblemsState, // SR-016
  supersededTargetProblemsState, // SR-072
  supersededValidityProblemsState, // SR-040
  valueKindProblemsState, // SR-085
  relationTypeProblemsState, // SR-086
  derivationCycleProblemsState, // SR-090
  outdatedEvidenceProblemsState, // SR-025 AK4
] as const;

/** Whether `problem` is a hint: a warning about an element (glossary "Hinweis"). */
export const isHint = (problem: Problem): problem is Problem & { readonly elementId: string } =>
  problem.severity === "warning" && problem.elementId !== undefined;

/** The key of the property with the meaning `packages` and whether it holds a list. */
interface PackagesKey {
  readonly key: string;
  readonly many: boolean;
}

/** The filters of `hint.list` with their references resolved; a filter left out matches every hint. */
export interface HintFilter {
  readonly kinds?: ReadonlySet<string>;
  readonly types?: readonly string[];
  /** The package, and the property with the meaning `packages` (undefined when it holds no relations: no element lists a package). */
  readonly package?: { readonly element: ElementRecord; readonly key: PackagesKey | undefined };
  readonly variant?: View;
  readonly ref?: ElementRecord;
}

/** What resolving the filters reads. */
interface FilterContext {
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
}

/** The input `hint.list` takes. */
interface HintListInput {
  readonly kind?: readonly string[];
  readonly type?: readonly string[];
  readonly package?: string;
  readonly variant?: string;
  readonly ref?: string;
}

/** `key` with whether it holds a list, when it holds relations (`relationKey`); else undefined. */
const relationEntry = (metamodel: Metamodel, key: string): PackagesKey | undefined => {
  const relation = relationKey(metamodel, key);
  return relation === undefined ? undefined : { key, many: relation.many };
};

/**
 * The package `ref` names: the metamodel needs the meanings `packages` and `package`
 * (`metamodel.meaning-unassigned`, SR-013 AK3), and the element a type with the meaning `package`
 * (`input.invalid`).
 */
const resolvePackage = (context: FilterContext, ref: string): NonNullable<HintFilter["package"]> => {
  const { metamodel, store, shortIds } = context;
  requireMeaning(metamodel, "packages", COMMAND);
  requireMeaning(metamodel, "package", COMMAND);
  const element = resolveRef(store, shortIds, ref);
  if (!typesWithMeaning(metamodel, "package").some((t) => t.key === element.type)) {
    throw new CommandError(
      "input.invalid",
      `${ref} is no package: package takes an element whose type has the meaning package`,
      { command: COMMAND, fields: ["package"] },
    );
  }
  const property = propertyWithMeaning(metamodel, "packages");
  return { element, key: property && relationEntry(metamodel, property.key) };
};

/** The filters of `input`, resolved (`ref.unknown`, `ref.ambiguous`, see `resolvePackage` and `resolveView`). */
export const resolveHintFilter = (context: FilterContext, input: HintListInput): HintFilter => ({
  ...(input.kind === undefined ? {} : { kinds: new Set(input.kind) }),
  ...(input.type === undefined ? {} : { types: input.type }),
  ...(input.package === undefined ? {} : { package: resolvePackage(context, input.package) }),
  ...(input.variant === undefined
    ? {}
    : { variant: resolveView(context, input.variant, COMMAND, "variant") }),
  ...(input.ref === undefined ? {} : { ref: resolveRef(context.store, context.shortIds, input.ref) }),
});

/**
 * Whether the property with the meaning `packages` of `element` lists `pkg`: an entry that names
 * it by UUID, in the repository the entry names or the element's own (D-058), read as the validity
 * is read (`validityEntries`, `validityTarget`: both are relation-valued properties, ADR-0004).
 */
const listsPackage = (element: ElementRecord, pkg: NonNullable<HintFilter["package"]>): boolean =>
  validityEntries(pkg.key, element).some((entry) => {
    const target = validityTarget(entry.value, element);
    return target?.id === pkg.element.id && target.repository === pkg.element.repository;
  });

/** Whether the element `element` of a hint passes the element filters of `filter`. */
const elementMatches = (
  element: ElementRecord | undefined,
  filter: HintFilter,
  context: { readonly metamodel: Metamodel },
): boolean => {
  if (element === undefined) {
    return false;
  }
  const { types, ref, variant } = filter;
  return (
    (types === undefined || types.some((type) => allowsType([type], element.type, context.metamodel))) &&
    (filter.package === undefined || listsPackage(element, filter.package)) &&
    (variant === undefined || appliesIn(validityOf(context.metamodel), element, variant)) &&
    (ref === undefined || ref === element)
  );
};

/** Whether `filter` has a filter on the element of a hint. */
const filtersElements = (filter: HintFilter): boolean =>
  filter.types !== undefined ||
  filter.package !== undefined ||
  filter.variant !== undefined ||
  filter.ref !== undefined;

/**
 * The record of the element of each hint by its UUID and its repository and file: the element's own
 * (`elementRepository`, `elementFile`) when the problem names another file (outdated evidence names
 * its record file), else the problem's. That names the copy when several files share a UUID
 * (SR-088). A problem that names no record of its UUID that way is about the only record of the
 * UUID when there is one.
 */
const recordFinder =
  (store: ElementStore): ((problem: Problem & { readonly elementId: string }) => ElementRecord | undefined) =>
  (problem) => {
    const records = store.byId.get(problem.elementId) ?? [];
    const repository = problem.elementRepository ?? problem.repository;
    const file = problem.elementFile ?? problem.file;
    const [only] = records;
    return (
      records.find((e) => e.repository === repository && e.file === file) ??
      (records.length === 1 ? only : undefined)
    );
  };

/**
 * The hints of `problems` and `outdated` (in this order) that pass `filter`, the outdated ones with
 * the dates of both versions (`datedProblems`, asked only for these); each with the short ID of its
 * element (`elementShortId`) when the element is in the store.
 */
export const hintsOf = async (
  workspace: Workspace,
  context: { readonly metamodel: Metamodel; readonly store: ElementStore; readonly shortIds: ShortIds },
  filter: HintFilter,
  problems: Iterable<Problem>,
  outdated: readonly OutdatedFinding[],
): Promise<Problem[]> => {
  const recordOf = recordFinder(context.store);
  const byElement = filtersElements(filter);
  const passes = (problem: Problem): problem is Problem & { readonly elementId: string } =>
    isHint(problem) &&
    (filter.kinds === undefined || filter.kinds.has(problem.code)) &&
    (!byElement || elementMatches(recordOf(problem), filter, context));
  const hints: Problem[] = [];
  for (const problem of problems) {
    if (passes(problem)) {
      const record = recordOf(problem);
      hints.push(
        record === undefined ? problem : { ...problem, elementShortId: context.shortIds.of(record) },
      );
    }
  }
  const named = outdated
    .filter((f) => passes(f.problem))
    .map((f) => ({ ...f, problem: { ...f.problem, elementShortId: context.shortIds.of(f.element) } }));
  for (const problem of await datedProblems(workspace, named)) {
    hints.push(problem);
  }
  return hints;
};

/** `hint.list`: the open hints of `workspace` that pass the filters of `input` (see the file comment). */
export const listHints = async (
  workspace: Workspace,
  input: HintListInput,
): Promise<{ readonly hints: Problem[]; readonly incomplete: boolean }> => {
  const [layout, metamodel, store, shortIds] = await Promise.all([
    workspace.get(workspaceLayoutState),
    workspace.get(metamodelState),
    workspace.get(elementStoreState),
    workspace.get(shortIdState),
  ]);
  const filter = resolveHintFilter({ metamodel, store, shortIds }, input);
  const incomplete = availableRepositories(layout).length < layout.repositories.length;
  if (!metamodel.valid) {
    // No hints against a metamodel that is not valid: its errors are the findings (#208, #220).
    return { hints: [], incomplete };
  }
  // The images the watcher does not report are checked first, as the check does (ADR-0008).
  await currentVersions(workspace);
  const problems: Problem[] = [];
  for (const state of HINT_STATES) {
    for (const problem of await workspace.get(state)) {
      problems.push(problem);
    }
  }
  const outdated = await workspace.get(outdatedRelationsState);
  return {
    hints: await hintsOf(workspace, { metamodel, store, shortIds }, filter, problems, outdated),
    incomplete,
  };
};
