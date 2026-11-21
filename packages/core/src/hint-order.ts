// The order of the hints of one element, `workspace.check`'s after the warning of an element without a version, and
// which findings are hints (SR-026, glossary "Hinweis"): the rule `hint.list` applies to the problems of one element (`hints/list.ts`). A root module that
// imports nothing, like `problem-titles.ts`, so the display models (`displays/`, ADR-0019 point 3) and the app's
// renderer bundle use the same rule without the model.

/**
 * The codes of the hints of each state of `HINT_STATES` (`hints/list.ts`), in that order, then the since-baseline
 * hints (`SINCE_BASELINE_CODES` of `hints/since-baseline.ts`) and the outdated relations.
 */
export const CHECK_ORDER: readonly (readonly string[])[] = [
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
  ["variant.core-changed-since-baseline", "variant.core-new-since-baseline"],
  ["relation.outdated", "variant.core-changed"],
];

/**
 * The code of the warning about an element whose version cannot be computed (`noVersionProblem` of `model/view.ts`,
 * ThomasBirkmaier/ReqSeq-archive#276): a hint, since it is a warning about an element (#2231). It is the only
 * `file.faulty` warning that `element.get` and `hint.list` give (every other `file.faulty` is an error or a refusal;
 * the list commands give the same warning for an element without a current version, `listElements`), as
 * `hints/list-ref.test.ts` checks over its fixtures. No state of the check
 * gives it; `hint.list` takes it from the current versions and puts it before the hints of `CHECK_ORDER`, as
 * `workspace.check` puts the findings of the files before its states.
 */
export const NO_VERSION_CODE = "file.faulty";

const RANK: ReadonlyMap<string, number> = new Map([
  [NO_VERSION_CODE, 0],
  ...CHECK_ORDER.flatMap((codes, rank) => codes.map((code) => [code, rank + 1] as const)),
]);

/** The codes of the hints the whole-workspace path of `hint.list` can give (`NO_VERSION_CODE`, then `CHECK_ORDER`). */
export const CHECK_HINT_CODES: ReadonlySet<string> = new Set(RANK.keys());

/**
 * The problems of one element whose code `hint.list` gives as a hint (`CHECK_HINT_CODES`), in its order: the warning
 * of an element without a version (`NO_VERSION_CODE`) first, then the order of `workspace.check`; any other is left
 * out. Stable: within one state the element's own order stays.
 */
export const inCheckOrder = <P extends { readonly code: string }>(problems: readonly P[]): P[] => {
  const ranked = problems.flatMap((problem) => {
    const rank = RANK.get(problem.code);
    return rank === undefined ? [] : [{ problem, rank }];
  });
  return ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.problem);
};

/** Whether `problem` is a hint: a warning about an element (glossary "Hinweis"). */
export const isHint = <P extends { readonly severity: string; readonly elementId?: string | undefined }>(
  problem: P,
): problem is P & { readonly elementId: string } =>
  problem.severity === "warning" && problem.elementId !== undefined;
