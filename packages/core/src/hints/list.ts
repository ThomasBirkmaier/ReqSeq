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
//   The outdated relations include the changed core requirements at their replacements
//   (`variant.core-changed`, SR-045), which the `variant` filter lists for the variants of the
//   replacement's validity. The core requirements changed or new since a variant's newest baseline
//   (SR-103, `since-baseline.ts`) follow the states, before the outdated relations; they are at the
//   variant, which every view holds (SR-043 AK10), so the `variant` filter lists them only for that
//   variant. Only the variants whose hints can pass the filters are computed (`sinceBaselineVariants`).
// - Each hint is the problem as the check gives it (AK1): kind (`code`), the element (`elementId`,
//   `repository`, `file`, `line`, and its short ID `elementShortId` for display, #310, added by
//   `invoke` to every problem that names an element, #315), the target
//   where it has one (`targetId`) and the reason (`message`; an outdated relation names both
//   versions and their dates, D-013). Order: the order of the check.
// - Filters (AK2), combined with AND; within `kind` and `type` any of the values: `kind` the code;
//   `type` the type of the element or one it extends (SR-012, as the filter language counts
//   subtypes); `package` the elements whose property with the meaning `packages` lists the package;
//   `variant` the elements the view of the variant holds (`viewRuleOf`: without a validity in every
//   variant, glossary "Gültigkeit", unless the variant excludes or replaces it); `ref` the hints of
//   one element. A hint whose element is not in the store (none: every state reports elements of
//   the store) matches no element filter.
// - Pages (#146, as `trace.chain`): every hint that passes the filters is found and counted (`total`);
//   the output holds `limit` hints from `offset`, in the order above.
// - The dates of outdated relations are asked of Git only for the hints of the page.
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
  duplicateIdentifierProblemsState,
  elementStoreState,
  itemLimitProblemsState,
  problemElement,
  relationKey,
  relationLimitProblemsState,
  relationTypeProblemsState,
  requiredProblemsState,
  resolveRef,
  shortIdState,
  statementProblemsState,
  statusProblemsState,
  supersededTargetProblemsState,
  unknownProblemsState,
  unresolvedLinkProblemsState,
  valueKindProblemsState,
} from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { derivationCycleProblemsState, noParentProblemsState } from "../trace/index.js";
import type { ResolvedView, ViewRule } from "../variants/index.js";
import {
  nestedVariantsState,
  resolveView,
  supersededValidityProblemsState,
  targetNotCoreProblemsState,
  validityEntries,
  validityTarget,
  variantsOf,
  viewRuleOf,
} from "../variants/index.js";
import { availableRepositories, workspaceLayoutState } from "../workspace/index.js";
import { outdatedEvidenceProblemsState } from "./evidence.js";
import { SINCE_BASELINE_CODES, sinceBaselineProblems } from "./since-baseline.js";
import type { OutdatedFinding } from "./outdated.js";
import { datedProblems, outdatedRelationsState } from "./outdated.js";

const COMMAND: CommandName = "hint.list";

/**
 * The whole-workspace finding states that can give hints, in the order of `workspace.check`
 * (`FINDING_STATES`; the outdated relations follow them). Its other states give no hint: duplicate
 * UUIDs (SR-088) and missing targets (SR-089) give errors only, and the findings of the evidence
 * records (SR-028) name no element by `elementId` (spec question #533 Q2).
 */
export const HINT_STATES = [
  requiredProblemsState, // SR-015
  unknownProblemsState, // SR-016
  statusProblemsState, // #306
  statementProblemsState, // #667
  supersededTargetProblemsState, // SR-072
  supersededValidityProblemsState, // SR-040
  nestedVariantsState, // SR-039
  targetNotCoreProblemsState, // SR-041 AK8
  valueKindProblemsState, // SR-085
  itemLimitProblemsState, // SR-171
  relationTypeProblemsState, // SR-086
  relationLimitProblemsState, // SR-152
  duplicateIdentifierProblemsState, // #305
  unresolvedLinkProblemsState, // #176
  derivationCycleProblemsState, // SR-090
  noParentProblemsState, // SR-022 AK6
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
  readonly variant?: ResolvedView;
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
  readonly limit: number;
  readonly offset: number;
}

/** A page of hints: `limit` hints from `offset`. */
export interface HintPage {
  readonly limit: number;
  readonly offset: number;
}

const EVERY_HINT: HintPage = { limit: Number.POSITIVE_INFINITY, offset: 0 };

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

/** Whether the element `element` of a hint passes the element filters of `filter`; `view` is the rule of its variant. */
const elementMatches = (
  element: ElementRecord | undefined,
  filter: HintFilter,
  context: { readonly metamodel: Metamodel },
  view: ViewRule | undefined,
): boolean => {
  if (element === undefined) {
    return false;
  }
  const { types, ref } = filter;
  return (
    (types === undefined || types.some((type) => allowsType([type], element.type, context.metamodel))) &&
    (filter.package === undefined || listsPackage(element, filter.package)) &&
    (view === undefined || view.includes(element)) &&
    (ref === undefined || ref === element)
  );
};

/**
 * The variants whose since-baseline hints can pass `filter` (SR-103): none when `kind` names neither
 * code or the view is the core; else the variant of `variant`, the element of `ref` or every variant,
 * as far as they pass the element filters. A since-baseline hint is at its variant, which every view
 * holds (SR-043 AK10), so `variant` lists only that variant's.
 */
const sinceBaselineVariants = (
  context: { readonly metamodel: Metamodel; readonly store: ElementStore },
  filter: HintFilter,
): readonly ElementRecord[] => {
  const { kinds, variant, ref } = filter;
  if (
    variant?.kind === "core" ||
    (kinds !== undefined && ![...SINCE_BASELINE_CODES].some((c) => kinds.has(c)))
  ) {
    return [];
  }
  const candidates =
    variant !== undefined
      ? [variant.variant]
      : ref !== undefined
        ? [ref]
        : variantsOf(context.store, context.metamodel);
  return candidates.filter((candidate) => elementMatches(candidate, filter, context, undefined));
};

/** Whether `filter` has a filter on the element of a hint. */
const filtersElements = (filter: HintFilter): boolean =>
  filter.types !== undefined ||
  filter.package !== undefined ||
  filter.variant !== undefined ||
  filter.ref !== undefined;

/**
 * The hints of `problems` and `outdated` (in this order) that pass `filter`: the page `page` (every
 * hint by default) and `total`, the number of all that pass. The outdated ones of the page carry the
 * dates of both versions (`datedProblems`, asked only for these). The short ID of each hint's
 * element (`elementShortId`) is added where every problem leaves the runtime (`invoke`, #315).
 */
export const hintsOf = async (
  workspace: Workspace,
  context: { readonly metamodel: Metamodel; readonly store: ElementStore },
  filter: HintFilter,
  problems: Iterable<Problem>,
  outdated: readonly OutdatedFinding[],
  page: HintPage = EVERY_HINT,
): Promise<{ readonly hints: Problem[]; readonly total: number }> => {
  const byElement = filtersElements(filter);
  const view =
    filter.variant === undefined ? undefined : viewRuleOf({ workspace, ...context }, filter.variant);
  const passes = (problem: Problem): problem is Problem & { readonly elementId: string } =>
    isHint(problem) &&
    (filter.kinds === undefined || filter.kinds.has(problem.code)) &&
    (!byElement || elementMatches(problemElement(context.store, problem), filter, context, view));
  const found: Problem[] = [];
  for (const problem of problems) {
    if (passes(problem)) {
      found.push(problem);
    }
  }
  const late = outdated.filter((f) => passes(f.problem));
  const end = page.offset + page.limit;
  const from = Math.max(0, page.offset - found.length);
  const dated = await datedProblems(workspace, late.slice(from, Math.max(from, end - found.length)));
  return { hints: [...found.slice(page.offset, end), ...dated], total: found.length + late.length };
};

/** `hint.list`: the open hints of `workspace` that pass the filters of `input` (see the file comment). */
export const listHints = async (
  workspace: Workspace,
  input: HintListInput,
): Promise<{ readonly hints: Problem[]; readonly total: number; readonly incomplete: boolean }> => {
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
    return { hints: [], total: 0, incomplete };
  }
  // The images the watcher does not report are checked first, as the check does (ADR-0008).
  await currentVersions(workspace);
  const problems: Problem[] = [];
  for (const state of HINT_STATES) {
    for (const problem of await workspace.get(state)) {
      problems.push(problem);
    }
  }
  const variants = sinceBaselineVariants({ metamodel, store }, filter);
  if (variants.length > 0) {
    for (const problem of await sinceBaselineProblems(
      { workspace, layout, metamodel, store, shortIds },
      variants,
    )) {
      problems.push(problem);
    }
  }
  const outdated = await workspace.get(outdatedRelationsState);
  const page = { limit: input.limit, offset: input.offset };
  return {
    ...(await hintsOf(workspace, { metamodel, store }, filter, problems, outdated, page)),
    incomplete,
  };
};
