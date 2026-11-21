// The views of a test case enrich plans (SR-029 AK6 to AK9, AK11; `enrich.ts`): the views it gets, how
// its `reqseq:variant` properties are written, and where its elements would count nowhere.
import { shown } from "../files/index.js";
import type { JunitProperty, JunitTestCase } from "./junit-model.js";
import type { EnrichOptions, GivenView, Plan, VariantPlan } from "./enrich-model.js";
import { CORE, isUuidOf, isUuidText, valuesOf, VARIANT } from "./enrich-model.js";

/** Why records of the elements would count nowhere in a view, view by view (`fitOf`). */
interface Fit {
  /** Each element and view in which its records would count nowhere, with why (views outer). */
  readonly why: readonly { readonly id: string; readonly text: string }[];
  /** The elements that count in none of the views (none when no view is checked). */
  readonly nowhere: ReadonlySet<string>;
}

/** Where the records of the elements `ids` would count nowhere among `views` (AK9, AK11). */
export const fitOf = (ids: readonly string[], views: readonly string[], options: EnrichOptions): Fit => {
  const elements = [...new Set(ids)];
  const why = views.flatMap((view) =>
    elements.flatMap((id) => {
      const text = options.outOfVariant(id, view);
      return text === undefined ? [] : [{ id, text }];
    }),
  );
  const outIn = (id: string): number => why.filter((w) => w.id === id).length;
  return { why, nowhere: new Set(elements.filter((id) => views.length > 0 && outIn(id) === views.length)) };
};

/** Whether elements no given view holds are left out (AK11): only with given views. */
export const skipping = (options: EnrichOptions): boolean =>
  options.skipNotInView === true && options.views !== undefined;

/** Whether `view` is among the given views. */
export const isGiven = (given: readonly GivenView[], view: string): boolean =>
  given.some((g) => g.id === view);

/** The given views as messages name them. */
export const givenNames = (given: readonly GivenView[]): string => given.map((v) => v.name).join(", ");

/**
 * Why a kept test case does not fit (AK8, AK9, AK11), or undefined: one of its views is not among the
 * given ones, or it names an element that does not count in one of its views (with `skipNotInView`:
 * in none of them). `ids`: the elements of its UUIDs that the workspace has. It stays unchanged either
 * way. A variant the workspace does not have is not checked; the core is, also the one a test case
 * has without a `reqseq:variant` (SR-047 AK5).
 */
export const keptVariantProblem = (
  plan: Extract<Plan, { kind: "kept" }>,
  ids: readonly string[],
  options: EnrichOptions,
): string | undefined => {
  const given = options.views;
  const other = given === undefined ? [] : plan.views.filter((view) => !isGiven(given, view));
  if (given !== undefined && other.length > 0) {
    const what = other.map((view) => (view === CORE ? "the core" : `the variant ${view}`)).join(" and ");
    return `it is enriched already for ${what}, outside the given views (${givenNames(given)}); an enriched test case is never changed`;
  }
  const checked = plan.views.filter(
    (view) =>
      // A variant the workspace does not have: nothing to check against, as for an unknown element.
      view === CORE || options.resolveVariant(view).kind !== "invalid",
  );
  const fit = fitOf(ids, checked, options);
  const why = skipping(options) ? fit.why.filter((w) => fit.nowhere.has(w.id)) : fit.why;
  return why.length === 0 ? undefined : why.map((w) => w.text).join("; ");
};

/**
 * `; it names the variant <uuid>, …` when a kept test case gives its `reqseq:variant` by short ID or
 * identifier (which the reader refuses): enrich does not rewrite an enriched test case
 * (D-026: version from the tested state; spec question ThomasBirkmaier/ReqSeq-archive#529 Q5), so it
 * says which UUID to write.
 */
export const keptVariantHint = (testCase: JunitTestCase, options: EnrichOptions): string => {
  // `core` is no variant, and the reader reads it.
  const value = valuesOf(testCase, VARIANT).find((v) => !isUuidText(v) && v.toLowerCase() !== CORE);
  const lookup = value === undefined ? undefined : options.resolveVariant(value);
  return lookup?.kind === "view"
    ? `; it names the variant ${lookup.id}: write that UUID, as enrich never changes an enriched test case`
    : "";
};

/**
 * The views the `reqseq:variant` properties of a test case to enrich name (AK7), each with the first
 * value that names it, and those to rewrite as the variant's UUID; or why one names no view.
 */
const ownViewsOf = (
  testCase: JunitTestCase,
  options: EnrichOptions,
):
  | { readonly own: ReadonlyMap<string, string>; readonly rewrite: VariantPlan["rewrite"] }
  | { readonly error: string } => {
  const own = new Map<string, string>();
  const rewrite: { property: JunitProperty; id: string }[] = [];
  for (const property of testCase.properties.filter((p) => p.name === VARIANT)) {
    const value = property.value.trim();
    const lookup = options.resolveVariant(value);
    if (lookup.kind === "invalid") {
      return { error: `${VARIANT} "${shown(value)}" names no variant: ${lookup.reason}` };
    }
    own.set(lookup.id, own.get(lookup.id) ?? value);
    if (lookup.id !== CORE && !isUuidOf(value, lookup.id)) {
      rewrite.push({ property, id: lookup.id });
    }
  }
  return { own, rewrite };
};

/**
 * The views of a test case to enrich (AK6 to AK8), or why it is not enriched: each `reqseq:variant`
 * must name a view (a variant by UUID, short ID or identifier, or `core`), and with given views each
 * of its own must be among them. With given views it gets all of them, else its own (the core without
 * one). The elements are checked against them apart (`fitOf`).
 */
export const variantPlanOf = (
  testCase: JunitTestCase,
  options: EnrichOptions,
): VariantPlan | { readonly error: string } => {
  const read = ownViewsOf(testCase, options);
  if ("error" in read) {
    return read;
  }
  const { own, rewrite } = read;
  const given = options.views;
  const other = given === undefined ? undefined : [...own].find(([id]) => !isGiven(given, id));
  if (given !== undefined && other !== undefined) {
    return {
      error: `${VARIANT} "${shown(other[1])}" names a view that is not among the given ones (${givenNames(given)})`,
    };
  }
  const views = given?.map((g) => g.id) ?? (own.size === 0 ? [CORE] : [...own.keys()]);
  // The core alone needs no property: a test case without one is for the core.
  const implied = own.size === 0 && views.length === 1 && views[0] === CORE;
  return {
    views,
    rewrite,
    add: implied ? [] : views.filter((view) => !own.has(view)),
  };
};
