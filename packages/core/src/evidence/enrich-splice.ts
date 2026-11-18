// The bytes enrich changes (SR-029; `enrich.ts`): escaping, the splices of an enriched test case or the
// marks of one left out (AK12), at the offsets of the JUnit model, and applying them in one pass.
import { zip } from "../files/index.js";
import { NOT_IN_VIEW, notInViewOf } from "./junit.js";
import type { JunitProperty, JunitTestCase } from "./junit-model.js";
import { CRITERION_PROPERTY } from "./junit-model.js";
import type { CriteriaPlan, Plan, VariantPlan } from "./enrich-model.js";
import { DATE, ELEMENT, ITEM, sameViews, VARIANT, VERSION } from "./enrich-model.js";

/** `value` escaped for element text: `&`, `<`, `>` and a carriage return (which XML would turn into a line feed). */
export const escapeText = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\r", "&#13;");

/**
 * `value` escaped for an attribute in `quote`: as text, plus the quote, and tab and line feed as
 * character references, so they survive attribute value normalisation.
 */
export const escapeAttribute = (value: string, quote: '"' | "'"): string =>
  escapeText(value)
    .replaceAll(quote, quote === '"' ? "&quot;" : "&apos;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\n", "&#10;");

/** A change of the file: the bytes from `start` to `end` replaced by `text` (an insertion when equal). */
export interface Splice {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** Order of splices at the same offset. */
  readonly seq: number;
}

/**
 * What goes before a new property after `anchor`: the line ending and indentation of the anchor's line
 * when it stands on a line of its own (only spaces and tabs before it), else nothing (inline). Looks
 * back only to the start of that line or the first other byte, never at the whole file.
 */
const separatorAfter = (bytes: Uint8Array, anchor: JunitProperty): string => {
  // bytes[-1] is undefined, so the loop ends at the start of the file too.
  for (let i = anchor.start - 1; ; i -= 1) {
    const byte = bytes[i];
    if (byte === 0x0a) {
      const eol = bytes[i - 1] === 0x0d ? "\r\n" : "\n";
      return eol + Buffer.from(bytes.subarray(i + 1, anchor.start)).toString("latin1");
    }
    if (byte !== 0x20 && byte !== 0x09) {
      return "";
    }
  }
};

/**
 * The views of an enriched test case (AK6, AK7): each `rewrite` property gets its variant's UUID in
 * place (`replace`), and the new properties (`property`) are returned.
 */
const variantSplices = (
  variant: VariantPlan,
  replace: (existing: JunitProperty, id: string) => void,
  property: (id: string) => string,
): string[] => {
  for (const { property: existing, id } of variant.rewrite) {
    replace(existing, id);
  }
  return variant.add.map(property);
};

/**
 * The criteria of an enriched test case (AK10): each `rewrite` property gets its value in place
 * (`replace`), and the new properties (`property`) are returned.
 */
const criteriaSplices = (
  criteria: CriteriaPlan,
  replace: (existing: JunitProperty, value: string) => void,
  property: (value: string) => string,
): string[] => {
  for (const { property: existing, value } of criteria.rewrite) {
    replace(existing, value);
  }
  return criteria.add.map(property);
};

/** The removal of properties (an element left out, AK11, or a mark, AK12), with their line when they stand on one of their own. */
const dropSplices = (bytes: Uint8Array, drop: readonly JunitProperty[]): Omit<Splice, "seq">[] =>
  drop.map((existing) => ({
    start: existing.start - separatorAfter(bytes, existing).length,
    end: existing.end,
    text: "",
  }));

/** A new property element. */
const propertyText = (name: string, value: string): string =>
  `<property name="${name}" value="${escapeAttribute(value, '"')}"/>`;

/** The value of `existing` replaced in place by `value`: no splice when it is that already. */
const replaceSplices = (existing: JunitProperty, name: string, value: string): Omit<Splice, "seq">[] => {
  if (existing.value === value) {
    return [];
  }
  const at = existing.valueAt;
  if (at === undefined) {
    return [{ start: existing.start, end: existing.end, text: propertyText(name, value) }];
  }
  const text = at.quote === undefined ? escapeText(value) : escapeAttribute(value, at.quote);
  return [{ start: at.start, end: at.end, text }];
};

/** The new properties `added` (their texts) after the last one of `testCase`, or in a new block (`propertiesAt`). */
const insertionOf = (
  bytes: Uint8Array,
  testCase: JunitTestCase,
  added: readonly string[],
): Omit<Splice, "seq"> => {
  const at = testCase.propertiesAt;
  const block = `<properties>${added.join("")}</properties>`;
  switch (at.kind) {
    case "append": {
      const anchor = testCase.properties.filter((p) => p.end <= at.offset).at(-1);
      const separator = anchor === undefined ? "" : separatorAfter(bytes, anchor);
      const offset = anchor?.end ?? at.offset;
      return { start: offset, end: offset, text: added.map((p) => separator + p).join("") };
    }
    case "open-properties":
      return { start: at.start, end: at.end, text: `>${added.join("")}</properties>` };
    case "new-block":
      return { start: at.offset, end: at.offset, text: block };
    case "open-testcase":
      return { start: at.start, end: at.end, text: `>${block}</testcase>` };
  }
};

/**
 * The marks of a test case left out (AK12): none when its marks name the views `marks` already (in
 * any order or case); else the marks in place get the given views in order, the extra ones are
 * removed, and the missing ones follow the last mark (or the last property).
 */
export const markSplices = (
  bytes: Uint8Array,
  testCase: JunitTestCase,
  marks: readonly string[],
): Splice[] => {
  const existing = notInViewOf(testCase);
  if (existing.error === undefined && sameViews(existing.views, marks)) {
    return [];
  }
  const { properties } = existing;
  const splices = zip(properties, marks).flatMap(([p, id]) => replaceSplices(p, NOT_IN_VIEW, id));
  splices.push(...dropSplices(bytes, properties.slice(marks.length)));
  const missing = marks.slice(properties.length).map((id) => propertyText(NOT_IN_VIEW, id));
  const last = properties.at(-1);
  if (last === undefined) {
    splices.push(insertionOf(bytes, testCase, missing));
  } else if (missing.length > 0) {
    const separator = separatorAfter(bytes, last);
    splices.push({ start: last.end, end: last.end, text: missing.map((p) => separator + p).join("") });
  }
  return splices.map((s, i) => ({ ...s, seq: i }));
};

/** What enriching one test case changes; the splices are numbered from `seq`. */
export const splicesOf = (
  bytes: Uint8Array,
  plan: Extract<Plan, { kind: "enrich" }>,
  versions: readonly string[],
  item: string,
  date: string,
): Splice[] => {
  const { testCase, named, added, variant, criteria } = plan;
  const splices: Omit<Splice, "seq">[] = [];
  const property = propertyText;
  /** Replaces the value of `existing` in place by `value`, unless it is that already. */
  const replace = (existing: JunitProperty, name: string, value: string): void => {
    splices.push(...replaceSplices(existing, name, value));
  };
  for (const { property: existing, id } of named) {
    replace(existing, ELEMENT, id);
  }
  /** New properties; those for `propertiesAt` are collected in `rest`. */
  const rest: string[] = [];
  const lastElement = named.at(-1)?.property;
  if (lastElement === undefined) {
    rest.push(...added.map((id) => property(ELEMENT, id)));
  } else if (added.length > 0) {
    const separator = separatorAfter(bytes, lastElement);
    splices.push({
      start: lastElement.end,
      end: lastElement.end,
      text: added.map((id) => separator + property(ELEMENT, id)).join(""),
    });
  }
  rest.push(...versions.map((version) => property(VERSION, version)));
  rest.push(
    ...variantSplices(
      variant,
      (p, id) => {
        replace(p, VARIANT, id);
      },
      (id) => property(VARIANT, id),
    ),
  );
  rest.push(
    ...criteriaSplices(
      criteria,
      (p, value) => {
        replace(p, CRITERION_PROPERTY, value);
      },
      (value) => property(CRITERION_PROPERTY, value),
    ),
  );
  for (const [name, value] of [
    [ITEM, item],
    [DATE, date],
  ] as const) {
    const existing = testCase.properties.filter((p) => p.name === name);
    if (existing.length === 0) {
      rest.push(property(name, value));
    }
    for (const p of existing) {
      replace(p, name, value);
    }
  }
  splices.push(insertionOf(bytes, testCase, rest));
  // Last, so an insertion at the same offset (after the property before) comes first.
  splices.push(...dropSplices(bytes, plan.drop));
  return splices.map((s, i) => ({ ...s, seq: i }));
};

/**
 * `bytes` with `splices` applied, built with one concatenation (S5), and where each offset of `bytes`
 * lies in the result (`moved`: the offset plus what the splices before it added or removed; it is
 * called with offsets in ascending order).
 */
export const applySplices = (
  bytes: Uint8Array,
  splices: readonly Splice[],
): { readonly bytes: Uint8Array; readonly moved: (offset: number) => number } => {
  const sorted = [...splices].sort((a, b) => a.start - b.start || a.seq - b.seq);
  const parts: Uint8Array[] = [];
  /** What each splice adds (or removes, negative), by its start. */
  const deltas: { readonly start: number; readonly delta: number }[] = [];
  let at = 0;
  // The splices lie in distinct properties and insertion points, so they never overlap; the read-back
  // check would refuse the result if they did.
  for (const splice of sorted) {
    const text = Buffer.from(splice.text, "utf8");
    parts.push(bytes.subarray(at, splice.start), text);
    deltas.push({ start: splice.start, delta: text.byteLength - (splice.end - splice.start) });
    at = splice.end;
  }
  parts.push(bytes.subarray(at));
  const pending = deltas.values();
  let next = pending.next();
  let total = 0;
  const moved = (offset: number): number => {
    while (next.done !== true && next.value.start < offset) {
      total += next.value.delta;
      next = pending.next();
    }
    return offset + total;
  };
  return { bytes: Buffer.concat(parts), moved };
};
