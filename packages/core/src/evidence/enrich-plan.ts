// What one test case of a JUnit file gives (SR-029; `enrich.ts`): its references resolved, then kept,
// reported, refused, left out or enriched (`Plan`).
import { enrichmentOf, criteriaOf, notInViewOf } from "./junit.js";
import type { ElementRefToken, JunitProperty, JunitTestCase } from "./junit-model.js";
import { elementRefsOf } from "./junit-model.js";
import type { EnrichOptions, Plan, RefResolution, Reported } from "./enrich-model.js";
import { ELEMENT, VERSION } from "./enrich-model.js";
import { criteriaPlanOf, nameCriteria } from "./enrich-criteria.js";
import { fitOf, keptVariantHint, skipping, variantPlanOf } from "./enrich-views.js";

/**
 * Whether a name token that names no element or several is reported: a short ID or UUID, but one
 * glued to a word only when it is a short ID with a type prefix of the metamodel, so a pytest
 * parameter such as `test_get[<UUID>]` or `test_id[A-123456]` stays silent while a typo in a pytest
 * ID such as `test_x[SR-b2c0dd]` is still reported (SR-029 AK2, SR-063 AK1; #358).
 */
const reportable = (token: ElementRefToken, prefixes: readonly string[]): boolean =>
  token.kind !== "other" &&
  (token.glued !== true ||
    (token.kind === "shortId" && prefixes.includes(token.text.slice(0, token.text.lastIndexOf("-")))));

/**
 * The elements only the name of `testCase` names, each once and none a property names already
 * (`named`). A short ID or UUID token that names no element or several is added to `reported`,
 * unless a property reported it already or `reportable` says no (#358); any other token counts
 * only when it names exactly one.
 */
const nameElements = (
  testCase: JunitTestCase,
  options: EnrichOptions,
  named: readonly string[],
  reported: Reported[],
): string[] => {
  const { resolve } = options;
  const added: string[] = [];
  for (const token of elementRefsOf(testCase, options.namePattern).filter((t) => t.source === "name")) {
    const resolution = resolve(token.text);
    if (resolution.kind === "found") {
      if (!named.includes(resolution.id) && !added.includes(resolution.id)) {
        added.push(resolution.id);
      }
    } else if (reportable(token, options.typePrefixes) && !reported.some((r) => r.ref === token.text)) {
      reported.push({ ref: token.text, resolution, matched: token.matched });
    }
  }
  return added;
};

/** What an enriched test case gives (D-026): kept, or why the reader refuses it. */
const keptPlanOf = (testCase: JunitTestCase, options: EnrichOptions): Plan => {
  const enrichment = enrichmentOf(testCase);
  if ("error" in enrichment) {
    return { kind: "invalid", testCase, reason: enrichment.error + keptVariantHint(testCase, options) };
  }
  // A criterion the reader refuses makes it give no record, so it is not counted either.
  const criteria = criteriaOf(testCase, new Set(enrichment.pairs.keys()));
  return "error" in criteria
    ? { kind: "invalid", testCase, reason: criteria.error }
    : { kind: "kept", testCase, pairs: enrichment.pairs, views: enrichment.views };
};

/** How a refusal of AK9 with several given views names the option of AK11 (input `skipNotInView`, D-029). */
const SKIP_HINT = "give skipNotInView to count it only where its requirements apply";

/**
 * What a test case to enrich gives once its references are resolved: the `reqseq:element` properties
 * `named` and the elements only its name names (`added`); see the file comment.
 */
const enrichPlanOf = (
  testCase: JunitTestCase,
  named: readonly { readonly property: JunitProperty; readonly id: string }[],
  added: readonly string[],
  options: EnrichOptions,
): Plan => {
  const ids = [...named.map((n) => n.id), ...added];
  // AK13: a criterion of the name that does not count leaves the test case unchanged, whatever its views.
  const fromName = nameCriteria(testCase, new Set(ids), options);
  if ("refused" in fromName) {
    return { kind: "criterion", testCase, reason: fromName.refused };
  }
  const variant = variantPlanOf(testCase, options);
  if ("error" in variant) {
    return { kind: "invalid", testCase, reason: variant.error };
  }
  // Each view holds the elements (AK9), the core a test case without views has too (SR-047 AK5).
  const fit = fitOf(ids, variant.views, options);
  const skip = skipping(options);
  if (!skip && fit.why.length > 0) {
    // Several views given for the whole file (a run for the core and a variant): the option of AK11
    // would enrich it where its requirements apply. One given view keeps the reason alone, whose own
    // remedy (the replacing requirement) fits better.
    const hint = (options.views?.length ?? 0) > 1 ? `; ${SKIP_HINT}` : "";
    return { kind: "invalid", testCase, reason: fit.why.map((w) => w.text).join("; ") + hint };
  }
  // AK11: an element no given view holds is left out; with none left the test case is marked (AK12).
  const left = skip ? fit.nowhere : new Set<string>();
  if (ids.every((id) => left.has(id))) {
    // With `skip` the views are the given ones (`variantPlanOf`).
    return { kind: "outside", testCase, marks: variant.views, notInView: left.size };
  }
  // A criterion the reader would refuse after enrich leaves the test case unchanged: enriched, it
  // would give no record.
  const criteria = criteriaPlanOf(testCase, ids, left, fromName, options);
  return "error" in criteria
    ? { kind: "invalid", testCase, reason: criteria.error }
    : {
        kind: "enrich",
        testCase,
        criteria,
        named: named.filter((n) => !left.has(n.id)),
        added: added.filter((id) => !left.has(id)),
        variant,
        drop: [
          ...named.filter((n) => left.has(n.id)).map((n) => n.property),
          ...criteria.drop,
          ...notInViewOf(testCase).properties,
        ],
        notInView: left.size,
      };
};

/** What `testCase` gives (see the file comment). */
export const planOf = (testCase: JunitTestCase, options: EnrichOptions): Plan => {
  const { resolve } = options;
  if (testCase.properties.some((p) => p.name === VERSION)) {
    return keptPlanOf(testCase, options);
  }
  const reported: Reported[] = [];
  const named: { property: JunitProperty; id: string }[] = [];
  // Each property on its own (a repeated property gets its own version), the raw value trimmed.
  for (const property of testCase.properties.filter((p) => p.name === ELEMENT)) {
    const ref = property.value.trim();
    const resolution: RefResolution = ref === "" ? { kind: "unknown" } : resolve(ref);
    if (resolution.kind === "found") {
      named.push({ property, id: resolution.id });
    } else {
      reported.push({ ref, resolution });
    }
  }
  const added = nameElements(
    testCase,
    options,
    named.map((n) => n.id),
    reported,
  );
  if (reported.length > 0) {
    return { kind: "reported", testCase, refs: reported };
  }
  if (named.length === 0 && added.length === 0) {
    return { kind: "none" };
  }
  return enrichPlanOf(testCase, named, added, options);
};
