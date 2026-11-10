// Enriching a JUnit XML file (SR-029, ADR-0012 "JUnit XML", "Enriching"): `evidence.enrichJunit` adds
// to each test case that names a requirement the UUID, the current version, the item (Prüfling) and
// the date, so that the JUnit reader (SR-093) assigns it without further input (AK3).
//
// - References: every `reqseq:element` property in file order, then the name tokens of the test case
//   (`elementRefsOf`). A property is an explicit statement: one that names no element or more than
//   one is reported. A name token of the form of a short ID or UUID is reported the same way; one
//   glued to a word as pytest writes a parameter (`test_get[<UUID>]`, #358) only when it is a short
//   ID with a type prefix of the metamodel (a typo in a pytest ID); any other name token (an
//   identifier such as `[SR-036]`, a pytest parameter list) counts only when it names exactly one
//   element. Elements named twice count once.
// - With a name pattern (`namePattern`, AK5, `name-pattern.ts`) the short IDs it finds in the name are
//   name tokens of the form of a short ID too, so one that names no element or several is reported.
// - Acceptance criteria (SR-029 AK10, D-072): a name token `[<ref>/AK<n>]` and a name pattern match
//   whose `{ak}` is n (from 1, no leading zero) give a `reqseq:criterion`
//   `<UUID>:<n>` for the element the reference names (`criterionRefsOf`). An element the name also
//   names without a criterion (`[SR-x] [SR-x/AK2]`) gets none from the name: the test holds for all
//   its criteria; another suffix (`/slow`) names the whole requirement too. A suffix `AK` that is no
//   such number (`AK0`, `AK02`, `AK`, `AK2a`), and `{ak}` that is none, leave the test case unchanged
//   as `evidence.invalid-record`: enriched without it, it would hold for every criterion. A hand-written `reqseq:criterion` `<ref>:<n>` (short ID, UUID or identifier) is
//   kept, with its reference replaced by the UUID in place; the criteria of the name that no property
//   names yet are appended, each once. One that is malformed, or names no element of the test case,
//   leaves the test case unchanged and is `evidence.invalid-record`. The read-back compares the
//   criteria per element.
// - A test case that names no element (no property, no token that names one) counts in
//   `withoutReference` (AK4); kept, reported and refused test cases do not.
// - A test case with a reported reference stays unchanged and is listed (AK2, spec question ThomasBirkmaier/ReqSeq-archive#529 Q1);
//   the others are enriched and the file is written.
// - A test case enriched by this call or kept that names an element of a type without the meaning
//   `requirement` (a need, say) gives `evidence.kind-mismatch` (warning), as `workspace.check` reports
//   its record afterwards (D-012, #628): the record counts for no status (#843). It is enriched all the
//   same: the file says what the test names, and a validation may still be recorded by hand.
// - A test case that already has a `reqseq:version` is never changed: its version is the one it was
//   tested against (D-026, spec question ThomasBirkmaier/ReqSeq-archive#529 Q5, assumption "keep"). A kept version that is no longer
//   current gives `evidence.outdated` (warning); one the reader rejects `evidence.invalid-record`.
//   It may name several views (`reqseq:variant` with variants and `core`, SR-093 AK5); with given
//   views it fits only when each of its views is among them, and each of its views must hold its
//   elements (AK8, AK9; with `skipNotInView` one of them, AK11).
// - Views (AK6 to AK9, AK11): the given views (`variant`: variants and `core`) go into each test case
//   enriched, one `reqseq:variant` per view (none for the core alone); a test case's own views must be
//   among them (AK8). Each view must hold each element (AK9); with `skipNotInView`, an element that no
//   given view holds is left out of the test case instead (`notInView`), and the others are enriched.
// - The bytes are spliced at the offsets of the JUnit model, so every other byte stays (BOM, CRLF,
//   comments, CDATA, layout). The result is read back with the reader's checks before it is written
//   (ADR-0007 pattern): a difference is `internal`, and nothing is written.
// - Writing (ADR-0002 rule 5): the input in place, or `output`; an existing `output` only when it is a
//   JUnit file; never below a `.git` folder (D-036); through `writeFileAtomic` with the `xml` guard.
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { readFileSnapshot, shown, writeFileAtomic, zip } from "../files/index.js";
import type { FileSnapshot } from "../files/index.js";
import type { EvidenceEnrichJunitInput, EvidenceEnrichJunitOutput, ViewId } from "../generated/types.js";
import { metamodelState, typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord, VersionForms } from "../model/index.js";
import {
  currentVersionsOf,
  elementStoreState,
  NORMAL_FORM,
  ownEvidenceWrite,
  resolveRef,
  sameVersion,
  shortIdState,
} from "../model/index.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import type { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { resolveView } from "../variants/index.js";
import { refuseGit, shownPath, workspaceLayoutState } from "../workspace/index.js";
import { criteriaOf, enrichmentOf } from "./junit.js";
import type { ElementRefToken, JunitProperty, JunitTestCase } from "./junit-model.js";
import { CRITERION_PROPERTY, criterionRefsOf, elementRefsOf, junitTestCases } from "./junit-model.js";
import type { NameMatch } from "./name-pattern.js";
import { nameMatcher, parseNamePattern } from "./name-pattern.js";
import type { ViewContext } from "./in-variant.js";
import { outOfView } from "./in-variant.js";
import { evidenceReadState } from "./state.js";

const COMMAND = "evidence.enrichJunit";

const ELEMENT = "reqseq:element";
const VERSION = "reqseq:version";
const ITEM = "reqseq:item";
const DATE = "reqseq:date";
const VARIANT = "reqseq:variant";

/** What a reference names (`resolveRef` without the throw). */
export type RefResolution =
  | { readonly kind: "found"; readonly id: string }
  | { readonly kind: "unknown" }
  /** `candidates`: each element it names, for the message. */
  | { readonly kind: "ambiguous"; readonly candidates: readonly string[] };

/** The current version of an element, or why it has none (`CurrentVersion`). */
export type VersionLookup =
  | {
      readonly kind: "version";
      /** The version written into the test case (the form the tool writes). */
      readonly version: string;
      /** The version in every normal form, to compare a stored one in its form (ADR-0005). */
      readonly forms: VersionForms;
    }
  | { readonly kind: "unknown"; readonly message: string };

/** What a `reqseq:variant` value names: a view (a variant's UUID, or `core`), or why it names none. */
export type VariantLookup =
  { readonly kind: "view"; readonly id: string } | { readonly kind: "invalid"; readonly reason: string };

/** A view given for every test case (SR-029 AK6): a variant or the core. */
export interface GivenView {
  /** The variant's UUID, or `core`. */
  readonly id: string;
  /** How messages name it: its short ID, or `core`. */
  readonly name: string;
}

/** One reported reference (`unknown` of the output). */
export interface UnknownRef {
  readonly testCase: string;
  readonly className?: string;
  readonly line: number;
  readonly ref: string;
}

export interface EnrichOptions {
  /** What a reference names (a short ID, a UUID, an identifier, any text). */
  readonly resolve: (ref: string) => RefResolution;
  /**
   * The type prefixes of the metamodel: a short ID glued to a word with one of them is still
   * reported when it names no element (a typo in a pytest ID, SR-029 AK2; #358).
   */
  readonly typePrefixes: readonly string[];
  /** The current versions of the elements by UUID; called once, with each element once. */
  readonly versionsOf: (ids: readonly string[]) => Promise<ReadonlyMap<string, VersionLookup>>;
  readonly item: string;
  /** The given date; else the fallback (`dateFor`). */
  readonly date?: string | undefined;
  /** The time of the call, for the last fallback of the date. */
  readonly now: () => Date;
  /** The base name of the file, for error messages (ADR-0009). */
  readonly name: string;
  /** The file as problems name it (relative to the workspace root, or absolute). */
  readonly file: string;
  /** Appended to the message of an unknown reference, e.g. that a repository is not on this machine. */
  readonly unknownNote?: string;
  /**
   * The views every enriched test case gets (AK6), each once and at least one; absent: each keeps its
   * own, if any.
   */
  readonly views?: readonly GivenView[] | undefined;
  /**
   * With `views`: an element that applies in none of them is left out of a test case instead of
   * refusing the test case (AK11); without `views` it does nothing.
   */
  readonly skipNotInView?: boolean | undefined;
  /** What a `reqseq:variant` value of a test case names (AK7): a variant, or `core`. */
  readonly resolveVariant: (ref: string) => VariantLookup;
  /**
   * Why a record of the element `id` for the view `view` (a variant's UUID, or `core`) would count
   * nowhere (excluded, replaced or not valid there), as a sentence that names both; undefined when it
   * counts (AK9).
   */
  readonly outOfVariant: (id: string, view: string) => string | undefined;
  /**
   * The type and repository of the element `id` when a verification record cannot name it (its type
   * has no meaning `requirement`, D-012), else undefined (#843); absent: no element is checked.
   */
  readonly notRequirement?: ((id: string) => NotRequirement | undefined) | undefined;
  /** The compiled name pattern (AK5, `nameMatcher`); absent: brackets and properties only. */
  readonly namePattern?: ((name: string) => readonly NameMatch[]) | undefined;
}

/** An element a verification record cannot name (`notRequirement`). */
export interface NotRequirement {
  readonly type: string;
  readonly repository: string;
}

export interface EnrichResult {
  /** The new bytes; the input itself when nothing changed. */
  readonly bytes: Uint8Array;
  readonly changed: boolean;
  /** Test cases that name an element and are enriched, by this call or before. */
  readonly testCases: number;
  /** Test cases that name no element (AK4). */
  readonly withoutReference: number;
  /** Elements left out of a test case, once per test case, as no given view holds them (AK11). */
  readonly notInView: number;
  readonly unknown: readonly UnknownRef[];
  readonly problems: readonly Problem[];
}

const isDateTime = (value: string): boolean =>
  fileSchemaValidator("common.schema.json#/$defs/dateTime")(value);

const isUuidText = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.toLowerCase());

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
interface Splice {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** Order of splices at the same offset. */
  readonly seq: number;
}

/** What one test case gives. */
type Plan =
  | { readonly kind: "none" }
  | {
      readonly kind: "kept";
      readonly testCase: JunitTestCase;
      readonly pairs: ReadonlyMap<string, string>;
      /** The views of its `reqseq:variant` properties as the reader reads them (`core` without one). */
      readonly views: readonly ViewId[];
    }
  | { readonly kind: "invalid"; readonly testCase: JunitTestCase; readonly reason: string }
  | {
      readonly kind: "reported";
      readonly testCase: JunitTestCase;
      readonly refs: readonly Reported[];
    }
  /** Every element it names applies in none of the given views (AK11): it stays unchanged. */
  | { readonly kind: "outside"; readonly notInView: number }
  | {
      readonly kind: "enrich";
      readonly testCase: JunitTestCase;
      readonly criteria: CriteriaPlan;
      /** The `reqseq:element` properties and the element each names, in file order. */
      readonly named: readonly { readonly property: JunitProperty; readonly id: string }[];
      /** Elements only the name names, to append. */
      readonly added: readonly string[];
      readonly variant: VariantPlan;
      /** Properties to remove: those of the elements left out (AK11). */
      readonly drop: readonly JunitProperty[];
      /** The elements left out, as no given view holds them (AK11). */
      readonly notInView: number;
    };

/** The criteria an enriched test case gets (SR-029 AK10): how they are written, and how they read back. */
interface CriteriaPlan {
  /** Hand-written `reqseq:criterion` properties whose value becomes `<UUID>:<n>`, with that value. */
  readonly rewrite: readonly { readonly property: JunitProperty; readonly value: string }[];
  /** New `reqseq:criterion` values (`<UUID>:<n>`) for the criteria only the name names, in name order. */
  readonly add: readonly string[];
  /** Hand-written `reqseq:criterion` properties of an element left out (AK11), to remove. */
  readonly drop: readonly JunitProperty[];
  /** All of them as the reader reads them back (`criteriaText`). */
  readonly text: string;
}

/** The views an enriched test case gets, and how they are written (AK6, AK7). */
interface VariantPlan {
  /** Its views after enrich, each once: `core` or a variant's UUID. */
  readonly views: readonly string[];
  /** The views whose elements are checked (AK9): all of them, none for the core no view implies. */
  readonly checked: readonly string[];
  /** Existing `reqseq:variant` properties whose value becomes the variant's UUID (AK7). */
  readonly rewrite: readonly { readonly property: JunitProperty; readonly id: string }[];
  /** New `reqseq:variant` values, in the order given (AK6). */
  readonly add: readonly string[];
}

const testCaseText = (testCase: JunitTestCase): string =>
  `Test case "${shown(testCase.name)}" (line ${String(testCase.line)})`;

const nameOf = (testCase: JunitTestCase): Pick<UnknownRef, "testCase" | "className" | "line"> => ({
  testCase: testCase.name,
  ...(testCase.className === "" ? {} : { className: testCase.className }),
  line: testCase.line,
});

/** The trimmed values of the properties named `name`. */
const valuesOf = (testCase: JunitTestCase, name: string): string[] =>
  testCase.properties.filter((p) => p.name === name).map((p) => p.value.trim());

/** The view `core` as `outOfVariant` takes it (`viewIdOf`). */
const CORE = "core";

/** Why records of the elements would count nowhere in a view, view by view (`fitOf`). */
interface Fit {
  /** Each element and view in which its records would count nowhere, with why (views outer). */
  readonly why: readonly { readonly id: string; readonly text: string }[];
  /** The elements that count in none of the views (none when no view is checked). */
  readonly nowhere: ReadonlySet<string>;
}

/** Where the records of the elements `ids` would count nowhere among `views` (AK9, AK11). */
const fitOf = (ids: readonly string[], views: readonly string[], options: EnrichOptions): Fit => {
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
const skipping = (options: EnrichOptions): boolean =>
  options.skipNotInView === true && options.views !== undefined;

/** Whether `view` is among the given views. */
const isGiven = (given: readonly GivenView[], view: string): boolean => given.some((g) => g.id === view);

/** The given views as messages name them. */
const givenNames = (given: readonly GivenView[]): string => given.map((v) => v.name).join(", ");

/**
 * Why a kept test case does not fit (AK8, AK9, AK11), or undefined: one of its views is not among the
 * given ones, or it names an element that does not count in one of its views (with `skipNotInView`:
 * in none of them). `ids`: the elements of its UUIDs that the workspace has. It stays unchanged either
 * way. A variant the workspace does not have is not checked, nor the core it has without a
 * `reqseq:variant`, unless the core is given.
 */
const keptVariantProblem = (
  plan: Extract<Plan, { kind: "kept" }>,
  ids: readonly string[],
  options: EnrichOptions,
): string | undefined => {
  const given = options.views;
  const other = given === undefined ? [] : plan.views.filter((view) => !isGiven(given, view));
  if (given !== undefined && other.length > 0) {
    const what = other.map((view) => (view === CORE ? "the core" : `the variant ${view}`)).join(" and ");
    return `it is enriched already for ${what}, outside the given views (${givenNames(given)}); an enriched test case is never changed (D-026: version from the tested state; spec question ThomasBirkmaier/ReqSeq-archive#529 Q5)`;
  }
  const named = plan.testCase.properties.some((p) => p.name === VARIANT);
  const checked = plan.views.filter((view) =>
    // A variant the workspace does not have: nothing to check against, as for an unknown element.
    view === CORE ? named || given !== undefined : options.resolveVariant(view).kind !== "invalid",
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
const keptVariantHint = (testCase: JunitTestCase, options: EnrichOptions): string => {
  // `core` is no variant, and the reader reads it.
  const value = valuesOf(testCase, VARIANT).find((v) => !isUuidText(v) && v.toLowerCase() !== CORE);
  const lookup = value === undefined ? undefined : options.resolveVariant(value);
  return lookup?.kind === "view"
    ? `; it names the variant ${lookup.id}: write that UUID, as enrich never changes an enriched test case (D-026: version from the tested state; spec question ThomasBirkmaier/ReqSeq-archive#529 Q5)`
    : "";
};

/** Whether `value` is the UUID `id` already (any case). */
const isUuidOf = (value: string, id: string): boolean => isUuidText(value) && value.toLowerCase() === id;

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
const variantPlanOf = (
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
    checked: given === undefined && own.size === 0 ? [] : views,
    rewrite,
    add: implied ? [] : views.filter((view) => !own.has(view)),
  };
};

/** A reference that names no element or more than one, with what it names. */
interface Reported {
  readonly ref: string;
  readonly resolution: RefResolution;
  /** The text the name pattern matched, for a short ID it built (AK5). */
  readonly matched?: string | undefined;
}

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

/**
 * Criteria by element (the numbers of `criteriaOf`, or a set), as a text to compare with the read-back:
 * the elements by UUID, the numbers ascending, so the order of the properties plays no part.
 */
const criteriaText = (
  criteria: ReadonlyMap<string, ReadonlyMap<number, unknown> | ReadonlySet<number>>,
): string =>
  JSON.stringify(
    [...criteria]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([element, numbers]) => [element, [...numbers.keys()].sort((x, y) => x - y)]),
  );

/** A criterion number as the property writes it: a whole number from 1, no sign, no leading zero. */
const CRITERION_NUMBER = /^[1-9][0-9]*$/;

/**
 * The element and number of a hand-written `reqseq:criterion` `<ref>:<n>` of a test case to enrich
 * that names the elements `elements`, or why it is refused (SR-029 AK10, see the file comment).
 */
const handCriterion = (
  property: JunitProperty,
  elements: ReadonlySet<string>,
  options: EnrichOptions,
): { readonly id: string; readonly n: number; readonly ref: string } | { readonly error: string } => {
  const text = property.value.trim();
  // The last colon: an identifier may hold one, a number never.
  const colon = text.lastIndexOf(":");
  const ref = colon < 0 ? "" : text.slice(0, colon).trim();
  const digits = text.slice(colon + 1);
  const n = Number(digits);
  if (ref === "" || !CRITERION_NUMBER.test(digits) || !Number.isSafeInteger(n)) {
    return { error: `${CRITERION_PROPERTY} "${shown(text)}" is not <element reference>:<number from 1>` };
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

/**
 * The criteria the name of a test case gives for the elements `elements` (`criterionRefsOf`), in name
 * order, without those of an element the name also names without a criterion (all of them); or why
 * it is not enriched: a malformed criterion of one of them.
 */
const nameCriteria = (
  testCase: JunitTestCase,
  elements: ReadonlySet<string>,
  options: EnrichOptions,
): [string, number][] | { readonly error: string } => {
  const found: [string, number][] = [];
  const whole = new Set<string>();
  for (const { ref, criterion, malformed } of criterionRefsOf(testCase.name, options.namePattern)) {
    const resolution = ref === "" ? undefined : options.resolve(ref);
    if (resolution?.kind !== "found" || !elements.has(resolution.id)) {
      continue;
    }
    if (malformed !== undefined) {
      // Enriched without it, the test case would hold for every criterion of the element (D-072).
      return {
        error: `"${shown(malformed)}" names no acceptance criterion: write AK and a number from 1 without leading zero`,
      };
    }
    if (criterion === undefined) {
      whole.add(resolution.id);
    } else {
      found.push([resolution.id, criterion]);
    }
  }
  return found.filter(([id]) => !whole.has(id));
};

/**
 * The criteria of a test case to enrich that names the elements `ids` (SR-029 AK10, see the file
 * comment), or why it is not enriched: each hand-written `reqseq:criterion` is kept and gets its UUID
 * in place (`handCriterion`), or is removed when its element is left out (`left`, AK11); each
 * criterion of the name (`nameCriteria`) of an element not left out that no property names yet is
 * added once.
 */
const criteriaPlanOf = (
  testCase: JunitTestCase,
  ids: readonly string[],
  left: ReadonlySet<string>,
  options: EnrichOptions,
): CriteriaPlan | { readonly error: string } => {
  const elements = new Set(ids);
  const numbers = new Map<string, Set<number>>();
  /** Adds `n` for `id`; false when it was there. */
  const put = (id: string, n: number): boolean => {
    const set = numbers.get(id) ?? new Set<number>();
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
  const fromName = nameCriteria(testCase, new Set(ids.filter((id) => !left.has(id))), options);
  if ("error" in fromName) {
    return fromName;
  }
  const add = fromName.flatMap(([id, n]) => (put(id, n) ? [`${id}:${String(n)}`] : []));
  return { rewrite, add, drop, text: criteriaText(numbers) };
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
  const variant = variantPlanOf(testCase, options);
  if ("error" in variant) {
    return { kind: "invalid", testCase, reason: variant.error };
  }
  const fit = fitOf(ids, variant.checked, options);
  const skip = skipping(options);
  if (!skip && fit.why.length > 0) {
    return { kind: "invalid", testCase, reason: fit.why.map((w) => w.text).join("; ") };
  }
  // AK11: an element no given view holds is left out; the test case stays unchanged when none is left.
  const left = skip ? fit.nowhere : new Set<string>();
  if (ids.every((id) => left.has(id))) {
    return { kind: "outside", notInView: left.size };
  }
  // A criterion the reader would refuse after enrich leaves the test case unchanged: enriched, it
  // would give no record.
  const criteria = criteriaPlanOf(testCase, ids, left, options);
  return "error" in criteria
    ? { kind: "invalid", testCase, reason: criteria.error }
    : {
        kind: "enrich",
        testCase,
        criteria,
        named: named.filter((n) => !left.has(n.id)),
        added: added.filter((id) => !left.has(id)),
        variant,
        drop: [...named.filter((n) => left.has(n.id)).map((n) => n.property), ...criteria.drop],
        notInView: left.size,
      };
};

/** What `testCase` gives (see the file comment). */
const planOf = (testCase: JunitTestCase, options: EnrichOptions): Plan => {
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
/** The message of a reported reference (N2: the test case, its line, the reference). */
const reportedMessage = (
  testCase: JunitTestCase,
  { ref, resolution, matched }: Reported,
  note: string,
): string => {
  const pattern = matched === undefined ? "" : ` (read as "${shown(matched)}" by the name pattern)`;
  const what = ref === "" ? `an empty ${ELEMENT} property` : `"${shown(ref)}"${pattern}`;
  return resolution.kind === "ambiguous"
    ? `${testCaseText(testCase)}: ${what} names more than one element (${resolution.candidates.join(", ")}); give the full UUID`
    : `${testCaseText(testCase)}: no element has the reference ${what}${note}`;
};

/** The date a test case gets: given, else its own valid one, else the suite's with time zone, else now. */
const dateFor = (testCase: JunitTestCase, options: EnrichOptions): string => {
  if (options.date !== undefined) {
    return options.date;
  }
  const own = valuesOf(testCase, DATE);
  const [first] = own;
  if (first !== undefined && own.every((d) => d === first) && isDateTime(first)) {
    return first;
  }
  const suite = testCase.timestamp?.trim();
  return suite !== undefined && isDateTime(suite) ? suite : options.now().toISOString();
};

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

/** The removal of the properties of an element left out (AK11), with their line when they stand on one of their own. */
const dropSplices = (bytes: Uint8Array, drop: readonly JunitProperty[]): Omit<Splice, "seq">[] =>
  drop.map((existing) => ({
    start: existing.start - separatorAfter(bytes, existing).length,
    end: existing.end,
    text: "",
  }));

/** What enriching one test case changes; the splices are numbered from `seq`. */
const splicesOf = (
  bytes: Uint8Array,
  plan: Extract<Plan, { kind: "enrich" }>,
  versions: readonly string[],
  item: string,
  date: string,
): Splice[] => {
  const { testCase, named, added, variant, criteria } = plan;
  const splices: Omit<Splice, "seq">[] = [];
  const property = (name: string, value: string): string =>
    `<property name="${name}" value="${escapeAttribute(value, '"')}"/>`;
  /** Replaces the value of `existing` in place by `value`, unless it is that already. */
  const replace = (existing: JunitProperty, name: string, value: string): void => {
    if (existing.value === value) {
      return;
    }
    const at = existing.valueAt;
    if (at === undefined) {
      splices.push({ start: existing.start, end: existing.end, text: property(name, value) });
    } else {
      const text = at.quote === undefined ? escapeText(value) : escapeAttribute(value, at.quote);
      splices.push({ start: at.start, end: at.end, text });
    }
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
  const at = testCase.propertiesAt;
  const block = `<properties>${rest.join("")}</properties>`;
  switch (at.kind) {
    case "append": {
      const anchor = testCase.properties.filter((p) => p.end <= at.offset).at(-1);
      const separator = anchor === undefined ? "" : separatorAfter(bytes, anchor);
      const offset = anchor?.end ?? at.offset;
      splices.push({ start: offset, end: offset, text: rest.map((p) => separator + p).join("") });
      break;
    }
    case "open-properties":
      splices.push({ start: at.start, end: at.end, text: `>${rest.join("")}</properties>` });
      break;
    case "new-block":
      splices.push({ start: at.offset, end: at.offset, text: block });
      break;
    case "open-testcase":
      splices.push({ start: at.start, end: at.end, text: `>${block}</testcase>` });
      break;
  }
  // Last, so an insertion at the same offset (after the property before) comes first.
  splices.push(...dropSplices(bytes, plan.drop));
  return splices.map((s, i) => ({ ...s, seq: i }));
};

/**
 * `bytes` with `splices` applied, built with one concatenation (S5), and where each offset of `bytes`
 * lies in the result (`moved`: the offset plus what the splices before it added or removed; it is
 * called with offsets in ascending order).
 */
const applySplices = (
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

/** What a test case enriched by this call must read back as, and where it lies in the file as read. */
export interface Intended {
  readonly name: string;
  readonly className: string;
  readonly outcome: JunitTestCase["outcome"];
  /** The `<` of `<testcase` and the byte after the test case, in the file as read. */
  readonly start: number;
  readonly end: number;
  readonly pairs: ReadonlyMap<string, string>;
  readonly item: string;
  readonly date: string;
  /** Its views (`core` or a variant's UUID), each once, as enrich writes them; undefined compares as the core alone. */
  readonly views?: readonly string[] | undefined;
  /** Its criteria as `criteriaText` gives them; undefined for none checked. */
  readonly criteria?: string | undefined;
}

const NOT_READ_BACK = "Enrich produced a file that does not read back; nothing written";

const SUITE_START = Buffer.from("<testsuite>");
const SUITE_END = Buffer.from("</testsuite>");

/** Whether two lists of distinct views hold the same views. */
const sameViews = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && b.every((view) => a.includes(view));

/** Whether the criteria of `testCase` read back, as `wanted` (`criteriaText`) when it is given. */
const criteriaReadBack = (
  testCase: JunitTestCase,
  pairs: ReadonlyMap<string, string>,
  wanted: string | undefined,
): boolean => {
  const criteria = criteriaOf(testCase, new Set(pairs.keys()));
  return !("error" in criteria) && (wanted === undefined || criteriaText(criteria) === wanted);
};

/**
 * Whether `testCase`, the bytes of one enriched `<testcase>` element of the result, reads back as
 * `wanted` says: one test case with the same name, class name and outcome that gives exactly the
 * intended pairs, item, date and view by the reader's checks (`enrichmentOf`).
 */
export const readsBackAs = (testCase: Uint8Array, wanted: Intended): boolean => {
  const read = junitTestCases(Buffer.concat([SUITE_START, testCase, SUITE_END]));
  const cases = read.kind === "junit" ? read.file.testCases : [];
  const [a] = cases;
  if (
    cases.length !== 1 ||
    a?.name !== wanted.name ||
    a.className !== wanted.className ||
    a.outcome !== wanted.outcome
  ) {
    return false;
  }
  const got = enrichmentOf(a);
  return (
    !("error" in got) &&
    criteriaReadBack(a, got.pairs, wanted.criteria) &&
    got.item === wanted.item.trim() &&
    got.date === wanted.date &&
    // Exactly the views enrich writes, in any order (the core alone without the property).
    sameViews(got.views, wanted.views ?? [CORE]) &&
    got.pairs.size === wanted.pairs.size &&
    [...wanted.pairs].every(([id, version]) => got.pairs.get(id) === version)
  );
};

/**
 * Reads the result back (B3 of the plan review) without a model of the whole result (S1 of the PR
 * review): the bytes outside the enriched test cases must be those of `input` (the file as read, which
 * scanned), so the test cases not to be enriched are unchanged (N1), and each enriched `<testcase>`
 * element must read back as intended (`readsBackAs`). `intended` is in file order; `moved` gives where
 * an offset of `input` lies in `out` and is called with offsets in ascending order. Throws `internal`
 * on any difference.
 */
export const checkReadBack = (
  input: Uint8Array,
  out: Uint8Array,
  moved: (offset: number) => number,
  intended: readonly Intended[],
): void => {
  const same = (a: Uint8Array, b: Uint8Array): void => {
    if (Buffer.compare(a, b) !== 0) {
      throw new CommandError("internal", NOT_READ_BACK);
    }
  };
  let from = 0;
  let outFrom = 0;
  for (const wanted of intended) {
    const start = moved(wanted.start);
    same(input.subarray(from, wanted.start), out.subarray(outFrom, start));
    const end = moved(wanted.end);
    if (!readsBackAs(out.subarray(start, end), wanted)) {
      throw new CommandError("internal", NOT_READ_BACK);
    }
    from = wanted.end;
    outFrom = end;
  }
  same(input.subarray(from), out.subarray(outFrom));
};

/** A problem of a test case: it has the line of the `<testcase>`. */
type LinedProblem = Problem & { readonly line: number };

/** What the test cases of a file give, put together. */
interface Outcome {
  readonly unknown: UnknownRef[];
  readonly problems: LinedProblem[];
  readonly splices: Splice[];
  readonly intended: Intended[];
  count: number;
  withoutReference: number;
  notInView: number;
}

/** What the plans need: the lookups and the values, for `addPlan`. */
interface Context {
  readonly bytes: Uint8Array;
  readonly options: EnrichOptions;
  readonly resolutions: ReadonlyMap<string, RefResolution>;
  readonly versions: ReadonlyMap<string, VersionLookup>;
  readonly where: { readonly file: string };
}

/** The elements a plan names: those to enrich, or the UUIDs a kept test case gives. */
const idsOf = (plan: Extract<Plan, { kind: "enrich" | "kept" }>): readonly string[] =>
  plan.kind === "enrich" ? [...plan.named.map((n) => n.id), ...plan.added] : [...plan.pairs.keys()];

/**
 * `evidence.kind-mismatch` (warning) for each of the elements `ids` of `testCase` that a verification
 * record cannot name, as `workspace.check` gives it for the record (`recordKindProblems`, #843).
 */
const kindProblems = (testCase: JunitTestCase, ids: readonly string[], context: Context): LinedProblem[] =>
  ids.flatMap((id): LinedProblem[] => {
    const other = context.options.notRequirement?.(id);
    return other === undefined
      ? []
      : [
          {
            code: "evidence.kind-mismatch",
            severity: "warning",
            ...context.where,
            line: testCase.line,
            targetId: id,
            targetRepository: other.repository,
            message: `${testCaseText(testCase)} names element ${id} of type ${other.type}, so its record counts for no status: a verification record names a requirement (D-012)`,
          },
        ];
  });

/** Adds what enriching one planned test case gives to `outcome`. */
const addEnriched = (outcome: Outcome, plan: Extract<Plan, { kind: "enrich" }>, context: Context): void => {
  const ids = idsOf(plan);
  const lookups = ids.map((id) => ({ id, entry: context.versions.get(id) }));
  const current = lookups.flatMap(({ entry }) => (entry?.kind === "version" ? [entry.version] : []));
  if (current.length < ids.length) {
    for (const { id, entry } of lookups) {
      if (entry?.kind !== "version") {
        outcome.problems.push({
          code: "file.faulty",
          severity: "error",
          ...context.where,
          line: plan.testCase.line,
          elementId: id,
          message: `${testCaseText(plan.testCase)} is not enriched: element ${id} has no current version (${entry?.message ?? "it is not in the workspace"})`,
        });
      }
    }
    return;
  }
  const { options } = context;
  const date = dateFor(plan.testCase, options);
  const own = splicesOf(context.bytes, plan, current, options.item, date);
  const base = outcome.splices.length;
  outcome.splices.push(...own.map((s) => ({ ...s, seq: base + s.seq })));
  const { name, className, start, end } = plan.testCase;
  outcome.intended.push({
    name,
    className,
    outcome: plan.testCase.outcome,
    start,
    end,
    pairs: new Map(zip(ids, current)),
    item: options.item,
    date,
    views: plan.variant.views,
    criteria: plan.criteria.text,
  });
  outcome.count += 1;
  outcome.notInView += plan.notInView;
  outcome.problems.push(...kindProblems(plan.testCase, ids, context));
};

/** Adds what one planned test case gives to `outcome`. */
const addPlan = (outcome: Outcome, plan: Plan, context: Context): void => {
  const { where, options } = context;
  switch (plan.kind) {
    case "none":
      outcome.withoutReference += 1;
      return;
    case "outside":
      outcome.notInView += plan.notInView;
      return;
    case "invalid":
      outcome.problems.push({
        code: "evidence.invalid-record",
        severity: "error",
        ...where,
        line: plan.testCase.line,
        message: `${testCaseText(plan.testCase)} is not enriched: ${plan.reason}`,
      });
      return;
    case "reported":
      for (const reported of plan.refs) {
        outcome.unknown.push({ ...nameOf(plan.testCase), ref: reported.ref });
        outcome.problems.push({
          code:
            reported.resolution.kind === "ambiguous"
              ? "evidence.ambiguous-element"
              : "evidence.unknown-element",
          severity: "error",
          ...where,
          line: plan.testCase.line,
          message: reportedMessage(plan.testCase, reported, options.unknownNote ?? ""),
        });
      }
      return;
    case "kept": {
      const ids = [...plan.pairs.keys()].flatMap((uuid) => {
        const resolution = context.resolutions.get(uuid);
        return resolution?.kind === "found" ? [resolution.id] : [];
      });
      const variant = keptVariantProblem(plan, ids, options);
      if (variant !== undefined) {
        outcome.problems.push({
          code: "evidence.invalid-record",
          severity: "error",
          ...where,
          line: plan.testCase.line,
          message: `${testCaseText(plan.testCase)} does not fit: ${variant}`,
        });
        return;
      }
      outcome.count += 1;
      outcome.problems.push(...keptProblems(plan, context), ...kindProblems(plan.testCase, ids, context));
      return;
    }
    case "enrich":
      addEnriched(outcome, plan, context);
  }
};

/** Problems by line, stable (problems of one test case keep their order). */
const byLine = (problems: readonly LinedProblem[]): Problem[] =>
  [...problems].sort((a, b) => a.line - b.line);

/** What planning a file gives: the result, the splices, and what the read-back checks. */
interface Planned {
  readonly result: Omit<EnrichResult, "bytes" | "changed">;
  readonly splices: readonly Splice[];
  readonly intended: readonly Intended[];
}

/**
 * Reads and plans the file. Its JUnit model lives only in this call, so it can be freed before the
 * result is read back (S1 of the PR review).
 */
const planFile = async (bytes: Uint8Array, options: EnrichOptions): Promise<Planned> => {
  const read = junitTestCases(bytes);
  if (read.kind === "invalid") {
    throw new CommandError(
      "file.faulty",
      `Not enriched: ${options.name} is no readable XML (line ${String(read.line)}): ${read.message}`,
      { file: options.name, line: read.line },
    );
  }
  if (read.kind === "not-junit") {
    throw new CommandError(
      "input.invalid",
      `${options.name} is not a JUnit XML file: its root is <${shown(read.root)}>, not <testsuites> or <testsuite>`,
      { file: options.name, reason: "not-junit" },
    );
  }
  const testCases = read.file.testCases;
  const plans = testCases.map((testCase) => planOf(testCase, options));
  // The UUIDs of kept test cases are looked up too, to tell whether their versions are current.
  const resolutions = new Map<string, RefResolution>();
  for (const plan of plans.filter((p) => p.kind === "kept")) {
    for (const id of idsOf(plan)) {
      resolutions.set(id, resolutions.get(id) ?? options.resolve(id));
    }
  }
  const wanted = new Set(plans.filter((p) => p.kind === "enrich").flatMap(idsOf));
  for (const resolution of resolutions.values()) {
    if (resolution.kind === "found") {
      wanted.add(resolution.id);
    }
  }
  const versions =
    wanted.size === 0 ? new Map<string, VersionLookup>() : await options.versionsOf([...wanted]);
  const context: Context = { bytes, options, resolutions, versions, where: { file: options.file } };
  const outcome: Outcome = {
    unknown: [],
    problems: [],
    splices: [],
    intended: [],
    count: 0,
    withoutReference: 0,
    notInView: 0,
  };
  for (const plan of plans) {
    addPlan(outcome, plan, context);
  }
  return {
    result: {
      testCases: outcome.count,
      withoutReference: outcome.withoutReference,
      notInView: outcome.notInView,
      unknown: outcome.unknown,
      problems: byLine(outcome.problems),
    },
    splices: outcome.splices,
    intended: outcome.intended,
  };
};

/**
 * Enriches the bytes of a JUnit XML file (see the file comment). Pure apart from the injected
 * lookups: reads and writes no file. Throws `file.faulty` for a file the XML scanner refuses,
 * `input.invalid` for XML that is no JUnit file, `internal` when the result does not read back.
 */
export const enrichJunitBytes = async (bytes: Uint8Array, options: EnrichOptions): Promise<EnrichResult> => {
  const { result, splices, intended } = await planFile(bytes, options);
  if (splices.length === 0) {
    return { bytes, changed: false, ...result };
  }
  const out = applySplices(bytes, splices);
  checkReadBack(bytes, out.bytes, out.moved, intended);
  return { bytes: out.bytes, changed: true, ...result };
};

/**
 * What a kept test case gives (B1): `evidence.outdated` (warning) for a kept version that is no
 * longer current, `evidence.unknown-element` or `evidence.ambiguous-element` (warning) for a UUID
 * that names no element or several, as `workspace.check` reports them.
 */
const keptProblems = (
  plan: Extract<Plan, { kind: "kept" }>,
  { resolutions, versions, where }: Context,
): LinedProblem[] =>
  [...plan.pairs].flatMap(([uuid, stored]): LinedProblem[] => {
    const resolution = resolutions.get(uuid);
    const line = plan.testCase.line;
    if (resolution?.kind !== "found") {
      return [
        {
          code: resolution?.kind === "ambiguous" ? "evidence.ambiguous-element" : "evidence.unknown-element",
          severity: "warning",
          ...where,
          line,
          targetId: uuid,
          message: `${testCaseText(plan.testCase)} is enriched already and names element ${uuid}, which ${resolution?.kind === "ambiguous" ? "several files share" : "the workspace does not have"}; it is kept as it is`,
        },
      ];
    }
    const current = versions.get(resolution.id);
    return current?.kind === "version" && !sameVersion(stored, current.forms)
      ? [
          {
            code: "evidence.outdated",
            severity: "warning",
            ...where,
            line,
            elementId: resolution.id,
            storedVersion: stored,
            currentVersion: current.version,
            message: `${testCaseText(plan.testCase)} is enriched already with version ${stored}, which is no longer current; it is kept (D-026: the version it was tested against)`,
          },
        ]
      : [];
  });

/** The real folder of `file`; `file.folder-missing` when it does not exist. */
const realFolder = async (file: string): Promise<string> => {
  try {
    return await fs.realpath(path.dirname(file));
  } catch {
    throw new CommandError(
      "file.folder-missing",
      `Not written: the folder of ${path.basename(file)} does not exist`,
      { file: path.basename(file) },
    );
  }
};

/** The input file: its bytes and snapshot, or `input.invalid` naming only its base name. */
const readInput = async (file: string): Promise<{ bytes: Uint8Array; snapshot: FileSnapshot }> => {
  const name = path.basename(file);
  const read = await readFileSnapshot(path.dirname(file), name);
  if (read.kind === "read") {
    return read;
  }
  throw read.missing
    ? new CommandError("input.invalid", `The file ${name} does not exist`, {
        file: name,
        reason: "source-missing",
      })
    : new CommandError("input.invalid", `Cannot enrich ${name}: ${read.problem.message}`, {
        file: name,
        reason: "source-unreadable",
      });
};

/**
 * The snapshot an existing `output` is replaced under, or null to create it (B2): only a JUnit file
 * is replaced; anything else is `file.faulty` and stays untouched.
 */
const outputSnapshot = async (
  file: string,
): Promise<{ readonly snapshot: FileSnapshot; readonly bytes: Uint8Array } | null> => {
  const name = path.basename(file);
  const read = await readFileSnapshot(path.dirname(file), name);
  if (read.kind === "problem") {
    if (read.missing) {
      return null;
    }
    throw new CommandError(
      "file.faulty",
      `Not written: ${name} cannot be replaced: ${read.problem.message}`,
      {
        file: name,
      },
    );
  }
  if (junitTestCases(read.bytes).kind !== "junit") {
    throw new CommandError(
      "file.faulty",
      `Not written: ${name} is not a JUnit XML file; ReqSeq replaces only JUnit files`,
      { file: name },
    );
  }
  return read;
};

/** `; the workspace is incomplete (...)` when repositories of the workspace are not on this machine. */
const incompleteNote = (layout: WorkspaceLayout): string => {
  const names = layout.repositories.filter((r) => !r.available).map((r) => r.name);
  return names.length === 0
    ? ""
    : `; the workspace is incomplete, the element may lie in a repository that is not on this machine (${names.join(", ")})`;
};

/** A candidate of `ref.ambiguous` (`resolveRef`). */
interface Candidate {
  readonly id: string;
  readonly repository: string;
  readonly file: string;
}

/**
 * `resolve` (`resolveRef` of the store) as a `RefResolution`: `ref.unknown` and `ref.ambiguous` become
 * results, any other error passes on. Remembers the record of every element found in `found`.
 */
export const resolverOf =
  (resolve: (ref: string) => ElementRecord, found: Map<string, ElementRecord>) =>
  (ref: string): RefResolution => {
    try {
      const record = resolve(ref);
      found.set(record.id, record);
      return { kind: "found", id: record.id };
    } catch (error) {
      if (error instanceof CommandError && error.code === "ref.unknown") {
        return { kind: "unknown" };
      }
      if (error instanceof CommandError && error.code === "ref.ambiguous") {
        // resolveRef always gives the candidates of `ref.ambiguous`.
        const { candidates } = error.details as { readonly candidates: readonly Candidate[] };
        return {
          kind: "ambiguous",
          candidates: candidates.map((c) => `${c.id} in ${c.repository}/${c.file}`),
        };
      }
      throw error;
    }
  };

/**
 * The given views (AK6) through `resolveView`, each once in the order first given: a variant, or
 * `core`, whose records count in the core, and in every view of an element of a `variant-independent`
 * repository (SR-173).
 */
const givenViews = (
  views: ViewContext,
  refs: readonly string[] | undefined,
  variants: Map<string, ElementRecord>,
): GivenView[] | undefined => {
  if (refs === undefined) {
    return undefined;
  }
  const given = new Map<string, GivenView>();
  for (const ref of refs) {
    const view = resolveView(views, ref, COMMAND, "variant", true);
    if (view.kind === "core") {
      given.set(CORE, { id: CORE, name: CORE });
    } else {
      variants.set(view.variant.id, view.variant);
      given.set(view.variant.id, { id: view.variant.id, name: views.shortIds.of(view.variant) });
    }
  }
  return [...given.values()];
};

/**
 * What a `reqseq:variant` of a test case names (AK7), through `resolveView`: a variant, or `core`; any
 * refusal (no element, several, no variant, a metamodel without variants) is a result. Remembers each
 * variant found.
 * `unknownNote` follows the reason when no element has the reference, as for an unknown element.
 */
export const variantResolverOf = (
  views: ViewContext,
  variants: Map<string, ElementRecord>,
  unknownNote = "",
): ((ref: string) => VariantLookup) => {
  /** One lookup per distinct value: a CI file repeats the same variant in every test case. */
  const known = new Map<string, VariantLookup>();
  return (ref) => {
    const before = known.get(ref);
    if (before !== undefined) {
      return before;
    }
    const lookup = lookupVariant(views, variants, ref, unknownNote);
    known.set(ref, lookup);
    return lookup;
  };
};

/** One lookup of `variantResolverOf`. */
const lookupVariant = (
  views: ViewContext,
  variants: Map<string, ElementRecord>,
  ref: string,
  unknownNote: string,
): VariantLookup => {
  try {
    const view = resolveView(views, ref, COMMAND, VARIANT, true);
    if (view.kind === "core") {
      return { kind: "view", id: CORE };
    }
    variants.set(view.variant.id, view.variant);
    return { kind: "view", id: view.variant.id };
  } catch (error) {
    if (error instanceof CommandError) {
      return { kind: "invalid", reason: error.message + (error.code === "ref.unknown" ? unknownNote : "") };
    }
    throw error;
  }
};

/**
 * `outOfVariant` over the records `resolve` and `resolveVariant` found (`outOfView`, as
 * `evidence.record` refuses a record, SR-047 AK4). An element or variant not found counts: enrich asks
 * only for those it found.
 */
export const outOfVariantOf =
  (
    views: ViewContext,
    found: ReadonlyMap<string, ElementRecord>,
    variants: ReadonlyMap<string, ElementRecord>,
  ) =>
  (id: string, viewId: string): string | undefined => {
    const element = found.get(id);
    const variant = variants.get(viewId);
    if (element === undefined || (variant === undefined && viewId !== CORE)) {
      return undefined;
    }
    const out = outOfView(
      views,
      element,
      variant === undefined ? { kind: "core" } : { kind: "variant", variant },
    );
    return out === undefined ? undefined : `${views.shortIds.of(element)} ${out.why}`;
  };

/**
 * `evidence.enrichJunit` (SR-029): enriches the JUnit file `input.file` (a local path, relative to
 * the workspace root or absolute) and writes it in place or to `input.output` (see the file comment).
 */
export const enrichJunitFile = async (
  workspace: Workspace,
  input: EvidenceEnrichJunitInput,
): Promise<EvidenceEnrichJunitOutput> => {
  // The pattern's syntax first: a refusal touches no file.
  const pattern = input.namePattern === undefined ? undefined : parseNamePattern(input.namePattern);
  if (input.skipNotInView === true && input.variant === undefined) {
    throw new CommandError(
      "input.invalid",
      "skipNotInView applies only to the views given in variant: give them for the whole file",
      { command: COMMAND, fields: ["skipNotInView"], reason: "skip-without-views" },
    );
  }
  const layout = await workspace.get(workspaceLayoutState);
  const main = await fs.realpath(layout.root);
  const source = path.resolve(workspace.root, input.file);
  const target = input.output === undefined ? source : path.resolve(workspace.root, input.output);
  const { bytes, snapshot } = await readInput(source);
  const sourceFolder = await realFolder(source);
  const targetFolder = await realFolder(target);
  refuseGit(targetFolder, target);
  const inPlace =
    path.join(targetFolder, path.basename(target)) === path.join(sourceFolder, path.basename(source));
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const metamodel = await workspace.get(metamodelState);
  const found = new Map<string, ElementRecord>();
  const views: ViewContext = { workspace, metamodel, store, shortIds };
  const variants = new Map<string, ElementRecord>();
  const given = givenViews(views, input.variant, variants);
  // The metamodel is valid here: a write is refused while it is not (`workspace.read-only`).
  const requirements = new Set(typesWithMeaning(metamodel, "requirement").map((t) => t.key));
  const typePrefixes = metamodel.effectiveTypes.map((t) => t.prefix);
  const result = await enrichJunitBytes(bytes, {
    typePrefixes,
    resolve: resolverOf((ref) => resolveRef(store, shortIds, ref), found),
    versionsOf: async (ids) => {
      const wanted = new Set(ids);
      const records = [...found.values()].filter((record) => wanted.has(record.id));
      const entries = await currentVersionsOf(workspace, records);
      return new Map(
        [...entries].map(([record, entry]): [string, VersionLookup] => [
          record.id,
          entry.kind === "version"
            ? { kind: "version", version: entry.forms[NORMAL_FORM], forms: entry.forms }
            : entry,
        ]),
      );
    },
    item: input.item,
    date: input.date,
    now: () => new Date(),
    name: path.basename(source),
    file: shownPath(layout, main, sourceFolder, source),
    unknownNote: incompleteNote(layout),
    views: given,
    skipNotInView: input.skipNotInView,
    resolveVariant: variantResolverOf(views, variants, incompleteNote(layout)),
    outOfVariant: outOfVariantOf(views, found, variants),
    notRequirement: (id) => {
      const record = found.get(id);
      return record === undefined || requirements.has(record.type)
        ? undefined
        : { type: record.type, repository: record.repository };
    },
    namePattern: pattern === undefined ? undefined : nameMatcher(pattern, typePrefixes),
  });
  const output = {
    testCases: result.testCases,
    withoutReference: result.withoutReference,
    notInView: result.notInView,
    unknown: [...result.unknown],
    problems: [...result.problems],
  };
  // Nothing to change: the input is not rewritten, but a given output is still written (it is the file
  // the caller asked for), unless it holds these bytes already.
  if (inPlace && !result.changed) {
    return { ...output, files: [] };
  }
  const existing = inPlace ? { snapshot, bytes } : await outputSnapshot(target);
  if (!inPlace && existing !== null && Buffer.from(existing.bytes).equals(result.bytes)) {
    return { ...output, files: [] };
  }
  const written = await writeFileAtomic(
    path.dirname(target),
    path.basename(target),
    result.bytes,
    existing?.snapshot ?? null,
    {
      kind: "xml",
    },
  );
  // The written file may lie in an evidence folder: read the records again, so app, API and MCP see
  // it at once. Unconditional for any written path: cheap. The watcher then leaves this read alone
  // for the file while it holds these bytes (#785).
  ownEvidenceWrite(workspace, target, written.sha256);
  await workspace.reset(evidenceReadState);
  return { ...output, files: [shownPath(layout, main, targetFolder, target)] };
};
