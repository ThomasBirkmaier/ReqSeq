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
//   `repository`, `file`, `line`, and its short ID `elementShortId` for display, ThomasBirkmaier/ReqSeq-archive#310, added by
//   `invoke` to every problem that names an element, ThomasBirkmaier/ReqSeq-archive#315), the target
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
// - Counts per kind (`kinds`, AK6): in the same pass, over every hint that passes, in the order of
//   each kind's first hint; with `kind` also each named kind without a hint, count 0, after them in
//   the order `kind` names them, so a kind asked for without a hint has count 0 (AK6). The titles of the
//   element and the target (`elementTitle`, `targetTitle`) are added with their short IDs by `invoke`,
//   the view of outdated evidence (`view`) by its state (`evidence.ts`).
// - The dates of outdated relations are asked of Git only for the hints of the page.
// - `ref` takes the single-element path of `element.get` (#145, ADR-0008): the hints at the element
//   as `showElement` gives them with `elementHints` (dated), not the whole-workspace states, so it
//   builds neither the incoming index nor the cycles of the store. They are put into the order of
//   the check by code (`CHECK_ORDER`, a stable sort keeps the element's order within one state; a code
//   the check gives no hint with, such as `element.get`'s `file.faulty` of ThomasBirkmaier/ReqSeq-archive#276, is left out), the
//   other filters apply as above, and since-baseline hints are computed only where
//   `sinceBaselineVariants` admits the element; the page applies as above. The image check of
//   `currentVersions` is left out, as at `element.get`.
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
import type { ElementRecord, ElementStore, ShortIds, ShowContext } from "../model/index.js";
import {
  currentVersions,
  duplicateIdentifierProblemsState,
  elementStoreState,
  itemLimitProblemsState,
  criterionKeyProblemsState,
  problemElement,
  relationKey,
  relationLimitProblemsState,
  relationTypeProblemsState,
  requiredProblemsState,
  resolveRef,
  shortIdState,
  showElement,
  statementProblemsState,
  statusProblemsState,
  supersededTargetProblemsState,
  unknownProblemsState,
  unresolvedLinkProblemsState,
  valueKindProblemsState,
  crossRepositoryTitleProblemsState,
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
import { elementHints } from "./element.js";
import { outdatedEvidenceProblemsState } from "./evidence.js";
import { SINCE_BASELINE_CODES, sinceBaselineProblems } from "./since-baseline.js";
import type { OutdatedFinding } from "./outdated.js";
import { datedProblems, outdatedRelationsState } from "./outdated.js";

const COMMAND: CommandName = "hint.list";

/**
 * The whole-workspace finding states that can give hints, in the order of `workspace.check`
 * (`FINDING_STATES`; the outdated relations follow them). Its other states give no hint: duplicate
 * UUIDs (SR-088) and missing targets (SR-089) give errors only, and the findings of the evidence
 * records (SR-028) name no element by `elementId` (spec question ThomasBirkmaier/ReqSeq-archive#533 Q2).
 */
export const HINT_STATES = [
  requiredProblemsState, // SR-015
  unknownProblemsState, // SR-016
  statusProblemsState, // ThomasBirkmaier/ReqSeq-archive#306
  statementProblemsState, // #667
  supersededTargetProblemsState, // SR-072
  supersededValidityProblemsState, // SR-040
  nestedVariantsState, // SR-039
  targetNotCoreProblemsState, // SR-041 AK8
  valueKindProblemsState, // SR-085
  itemLimitProblemsState, // SR-171
  criterionKeyProblemsState, // SR-204 AK10
  relationTypeProblemsState, // SR-086
  relationLimitProblemsState, // SR-152
  duplicateIdentifierProblemsState, // ThomasBirkmaier/ReqSeq-archive#305
  crossRepositoryTitleProblemsState, // SR-005 AK4
  unresolvedLinkProblemsState, // #176
  derivationCycleProblemsState, // SR-090
  noParentProblemsState, // SR-022 AK6
  outdatedEvidenceProblemsState, // SR-025 AK4
] as const;

/**
 * The codes of the hints of each state of `HINT_STATES`, in that order, then the since-baseline
 * hints and the outdated relations: the order of `workspace.check` for the hints of one element.
 */
const CHECK_ORDER: readonly (readonly string[])[] = [
  ["element.missing-required"],
  ["element.unknown-property", "element.unknown-type"],
  ["element.missing-status", "element.status-not-allowed"],
  ["element.statement-without-text"],
  ["relation.target-superseded"],
  ["variant.superseded-in-validity"],
  ["variant.nested"],
  ["variant.target-not-core"],
  ["element.wrong-value-kind"],
  ["element.too-many-items"],
  ["element.criterion-key-missing", "element.criterion-key-invalid", "element.criterion-key-duplicate"],
  ["relation.not-allowed"],
  ["relation.too-few", "relation.too-many"],
  ["element.duplicate-identifier"],
  ["relation.cross-repository-title"],
  ["relation.not-a-link", "relation.reference-style", "relation.unresolved-link"],
  ["trace.cycle"],
  ["trace.no-parent"],
  ["evidence.outdated"],
  [...SINCE_BASELINE_CODES],
  ["relation.outdated", "variant.core-changed"],
];

const RANK: ReadonlyMap<string, number> = new Map(
  CHECK_ORDER.flatMap((codes, rank) => codes.map((code) => [code, rank] as const)),
);

/** The codes of the hints the whole-workspace path of `hint.list` can give (`CHECK_ORDER`). */
export const CHECK_HINT_CODES: ReadonlySet<string> = new Set(RANK.keys());

/**
 * The problems of one element whose code the check gives as a hint (`CHECK_ORDER`), in the order of
 * `workspace.check`; any other (such as the `file.faulty` warning of an element without a version
 * that `element.get` adds, ThomasBirkmaier/ReqSeq-archive#276) is left out. Stable: within one state the element's own order stays.
 */
export const inCheckOrder = (problems: readonly Problem[]): Problem[] => {
  const ranked = problems.flatMap((problem) => {
    const rank = RANK.get(problem.code);
    return rank === undefined ? [] : [{ problem, rank }];
  });
  return ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.problem);
};

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

/** The number of hints of one kind (`code`) that pass the filters. */
export interface KindCount {
  readonly code: Problem["code"];
  readonly count: number;
}

/** What `hint.list` gives before `incomplete`: `kinds` first, so that readers show them before the hints. */
export interface HintsFound {
  readonly kinds: KindCount[];
  readonly hints: Problem[];
  readonly total: number;
}

/**
 * The counts per kind of `counted` (in their order, the order of each kind's first hint), then each
 * kind of `kinds` (the `kind` filter, in its order) without a hint, with 0.
 */
const kindCounts = (
  counted: ReadonlyMap<string, number>,
  kinds: ReadonlySet<string> | undefined,
): KindCount[] => {
  const zero = [...(kinds ?? [])].filter((code) => !counted.has(code)).map((code) => [code, 0] as const);
  return [...counted, ...zero].map(([code, count]) => ({ code: code as Problem["code"], count }));
};

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
 * hint by default), `total`, the number of all that pass, and `kinds`, their number per kind
 * (`kindCounts`). The outdated ones of the page carry the
 * dates of both versions (`datedProblems`, asked only for these). The short ID of each hint's
 * element (`elementShortId`) is added where every problem leaves the runtime (`invoke`, ThomasBirkmaier/ReqSeq-archive#315).
 */
export const hintsOf = async (
  workspace: Workspace,
  context: { readonly metamodel: Metamodel; readonly store: ElementStore },
  filter: HintFilter,
  problems: Iterable<Problem>,
  outdated: readonly OutdatedFinding[],
  page: HintPage = EVERY_HINT,
): Promise<HintsFound> => {
  const byElement = filtersElements(filter);
  const view =
    filter.variant === undefined ? undefined : viewRuleOf({ workspace, ...context }, filter.variant);
  const passes = (problem: Problem): problem is Problem & { readonly elementId: string } =>
    isHint(problem) &&
    (filter.kinds === undefined || filter.kinds.has(problem.code)) &&
    (!byElement || elementMatches(problemElement(context.store, problem), filter, context, view));
  const counted = new Map<string, number>();
  /** Whether `problem` passes, counted by its kind when it does. */
  const counts = (problem: Problem): boolean => {
    if (!passes(problem)) {
      return false;
    }
    counted.set(problem.code, (counted.get(problem.code) ?? 0) + 1);
    return true;
  };
  const found: Problem[] = [];
  for (const problem of problems) {
    if (counts(problem)) {
      found.push(problem);
    }
  }
  const late = outdated.filter((f) => counts(f.problem));
  const end = page.offset + page.limit;
  const from = Math.max(0, page.offset - found.length);
  const dated = await datedProblems(workspace, late.slice(from, Math.max(from, end - found.length)));
  return {
    kinds: kindCounts(counted, filter.kinds),
    hints: [...found.slice(page.offset, end), ...dated],
    total: found.length + late.length,
  };
};

/**
 * The page `page` of the hints of `filter.ref` that pass `filter`, with `kinds` and `total`, by the
 * single-element path (see the file comment): no whole-workspace state of the hints is built.
 */
const hintsOfElement = async (
  context: ShowContext,
  filter: HintFilter & { readonly ref: ElementRecord },
  page: HintPage,
): Promise<HintsFound> => {
  const { ref } = filter;
  const since = sinceBaselineVariants(context, filter).includes(ref);
  const shown = await showElement(
    context,
    ref.id,
    (inner, record) => elementHints(inner, record, true, since),
    false,
    { repository: ref.repository, file: ref.file },
  );
  return hintsOf(context.workspace, context, filter, inCheckOrder(shown.element.problems), [], page);
};

/** `hint.list`: the open hints of `workspace` that pass the filters of `input` (see the file comment). */
export const listHints = async (
  workspace: Workspace,
  input: HintListInput,
): Promise<HintsFound & { readonly incomplete: boolean }> => {
  const [layout, metamodel, store, shortIds] = await Promise.all([
    workspace.get(workspaceLayoutState),
    workspace.get(metamodelState),
    workspace.get(elementStoreState),
    workspace.get(shortIdState),
  ]);
  const filter = resolveHintFilter({ metamodel, store, shortIds }, input);
  const incomplete = availableRepositories(layout).length < layout.repositories.length;
  if (!metamodel.valid) {
    // No hints against a metamodel that is not valid: its errors are the findings (ThomasBirkmaier/ReqSeq-archive#208, ThomasBirkmaier/ReqSeq-archive#220).
    return { kinds: kindCounts(new Map(), filter.kinds), hints: [], total: 0, incomplete };
  }
  const page = { limit: input.limit, offset: input.offset };
  if (filter.ref !== undefined) {
    const context = { workspace, layout, metamodel, store, shortIds };
    return { ...(await hintsOfElement(context, { ...filter, ref: filter.ref }, page)), incomplete };
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
  return {
    ...(await hintsOf(workspace, { metamodel, store }, filter, problems, outdated, page)),
    incomplete,
  };
};
