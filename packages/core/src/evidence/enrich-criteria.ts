// The acceptance criteria of a test case enrich plans (SR-029 AK10, AK13; `enrich.ts`): those its name
// gives, its hand-written `reqseq:criterion` properties, and the text the read-back compares.
import { shown } from "../files/index.js";
import type { CriterionRef as CriterionValue } from "../model/index.js";
import { compareCriterionRefs, criterionKey, isCriterionKey } from "../model/index.js";
import type { JunitProperty, JunitTestCase } from "./junit-model.js";
import { CRITERION_PROPERTY, criterionRefsOf } from "./junit-model.js";
import type { CriteriaPlan, EnrichOptions } from "./enrich-model.js";
import { ELEMENT, isUuidOf } from "./enrich-model.js";
import { commandTitle } from "../runtime/command-titles.js";

/**
 * Criteria by element (the criteria of `criteriaOf`, or a set), as a text to compare with the
 * read-back: the elements by UUID, the criteria in the reader's order (`compareCriterionRefs`), so the
 * order of the properties plays no part.
 */
export const criteriaText = (
  criteria: ReadonlyMap<string, ReadonlyMap<CriterionValue, unknown> | ReadonlySet<CriterionValue>>,
): string =>
  JSON.stringify(
    [...criteria]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([element, named]) => [element, [...named.keys()].sort(compareCriterionRefs)]),
  );

/** A criterion number as the property writes it: a whole number from 1, no sign, no leading zero. */
const CRITERION_NUMBER = /^[1-9][0-9]*$/;

/** The criterion of a `reqseq:criterion` value after its colon: a number or a key; undefined for another form. */
const criterionValueOf = (text: string): CriterionValue | undefined => {
  if (isCriterionKey(text)) {
    return text;
  }
  const n = Number(text);
  return CRITERION_NUMBER.test(text) && Number.isSafeInteger(n) ? n : undefined;
};

/**
 * The element and criterion of a hand-written `reqseq:criterion` `<ref>:<n>` or `<ref>:<key>` of a
 * test case to enrich that names the elements `elements`, or why it is refused (SR-029 AK10, see the
 * file comment).
 */
const handCriterion = (
  property: JunitProperty,
  elements: ReadonlySet<string>,
  options: EnrichOptions,
): { readonly id: string; readonly n: CriterionValue; readonly ref: string } | { readonly error: string } => {
  const text = property.value.trim();
  // The last colon: an identifier may hold one, a number or key never.
  const colon = text.lastIndexOf(":");
  const ref = colon < 0 ? "" : text.slice(0, colon).trim();
  const n = criterionValueOf(text.slice(colon + 1));
  if (ref === "" || n === undefined) {
    return {
      error: `${CRITERION_PROPERTY} "${shown(text)}" is not <element reference>:<number from 1 or criterion key>`,
    };
  }
  const resolution = options.resolve(ref);
  if (resolution.kind === "found" && elements.has(resolution.id)) {
    return { id: resolution.id, n, ref };
  }
  const what =
    resolution.kind === "found"
      ? `no ${ELEMENT} of the test case`
      : resolution.kind === "ambiguous"
        ? `more than one element (${resolution.candidates.join(", ")})`
        : "no element";
  return { error: `${CRITERION_PROPERTY} "${shown(text)}" names ${what}` };
};

/** The remedy for criteria without key (SR-204 AK3). */
const assignKeys = (ref: string): string =>
  `give the acceptance criteria of ${ref} criterion keys with ${commandTitle("element.assignCriterionKeys")}`;

/** How many of the criteria `items` carry the criterion key `key`. */
const carriers = (items: readonly unknown[], key: string): number =>
  items.filter((item) => criterionKey(item) === key).length;

/**
 * Why the criterion `criterion` that `text` names for the element written `ref` (`criterionRefsOf`)
 * does not count against the current criteria `items` (AK13), with what to write instead; undefined
 * for a key exactly one criterion carries (SR-204: a double key counts for neither).
 */
const refusedCriterion = (
  ref: string,
  text: string,
  criterion: CriterionValue,
  items: readonly unknown[],
): string | undefined => {
  const byPattern = !text.startsWith("[");
  const named = `"${shown(text)}"${byPattern ? " (read by the name pattern)" : ""}`;
  if (typeof criterion === "number") {
    const key = criterionKey(items[criterion - 1]);
    if (criterion <= items.length && key === undefined) {
      return `${named} names an acceptance criterion by its number, which has no criterion key yet; ${assignKeys(ref)} and name it by its key`;
    }
    const instead =
      key === undefined || carriers(items, key) !== 1
        ? "its criterion key from the element file"
        : byPattern
          ? `its criterion key, ${key}`
          : `its criterion key, [${ref}/AK-${key}]`;
    return `${named} names an acceptance criterion by its number; name it by ${instead}`;
  }
  const count = carriers(items, criterion);
  if (count === 1) {
    return undefined;
  }
  const which = count === 0 ? "no acceptance criterion" : `${String(count)} acceptance criteria`;
  const instead =
    count === 0 && items.length > 0 && items.every((item) => criterionKey(item) === undefined)
      ? assignKeys(ref)
      : "name the key from the element file";
  return `${named} names the criterion key ${criterion}, which ${which} of ${ref} in its current version ${count === 0 ? "carries" : "carry"}; ${instead}`;
};

/**
 * The criteria the name of a test case gives for the elements `elements` (`criterionRefsOf`), in name
 * order, without those of an element the name also names without a criterion (all of them); or why
 * it is not enriched (AK13): a malformed criterion, a number, or a key that not exactly one current
 * criterion carries, of one of them.
 */
export const nameCriteria = (
  testCase: JunitTestCase,
  elements: ReadonlySet<string>,
  options: EnrichOptions,
): [string, CriterionValue][] | { readonly refused: string } => {
  const found: [string, CriterionValue][] = [];
  const whole = new Set<string>();
  for (const { ref, criterion, text, malformed } of criterionRefsOf(testCase.name, options.namePattern)) {
    const resolution = ref === "" ? undefined : options.resolve(ref);
    if (resolution?.kind !== "found" || !elements.has(resolution.id)) {
      continue;
    }
    if (malformed !== undefined) {
      return {
        refused: `"${shown(malformed)}" names no acceptance criterion: write AK- and its criterion key from the element file`,
      };
    }
    if (criterion === undefined) {
      whole.add(resolution.id);
      continue;
    }
    const refused = refusedCriterion(ref, text, criterion, options.criteriaOf(resolution.id));
    if (refused !== undefined) {
      return { refused };
    }
    found.push([resolution.id, criterion]);
  }
  return found.filter(([id]) => !whole.has(id));
};

/**
 * The criteria of a test case to enrich that names the elements `ids` (SR-029 AK10, see the file
 * comment), or why it is not enriched: each hand-written `reqseq:criterion` is kept and gets its UUID
 * in place (`handCriterion`), or is removed when its element is left out (`left`, AK11); each
 * criterion of the name (`fromName`, `nameCriteria`) of an element not left out that no property
 * names yet is added once.
 */
export const criteriaPlanOf = (
  testCase: JunitTestCase,
  ids: readonly string[],
  left: ReadonlySet<string>,
  fromName: readonly [string, CriterionValue][],
  options: EnrichOptions,
): CriteriaPlan | { readonly error: string } => {
  const elements = new Set(ids);
  const numbers = new Map<string, Set<CriterionValue>>();
  /** Adds `n` for `id`; false when it was there. */
  const put = (id: string, n: CriterionValue): boolean => {
    const set = numbers.get(id) ?? new Set<CriterionValue>();
    numbers.set(id, set);
    const added = !set.has(n);
    set.add(n);
    return added;
  };
  const rewrite: { property: JunitProperty; value: string }[] = [];
  const drop: JunitProperty[] = [];
  for (const property of testCase.properties.filter((p) => p.name === CRITERION_PROPERTY)) {
    const hand = handCriterion(property, elements, options);
    if ("error" in hand) {
      return hand;
    }
    if (left.has(hand.id)) {
      drop.push(property);
      continue;
    }
    if (!isUuidOf(hand.ref, hand.id)) {
      rewrite.push({ property, value: `${hand.id}:${String(hand.n)}` });
    }
    put(hand.id, hand.n);
  }
  const add = fromName.flatMap(([id, n]) => (!left.has(id) && put(id, n) ? [`${id}:${String(n)}`] : []));
  return { rewrite, add, drop, text: criteriaText(numbers) };
};
