// The options, results and plans of `evidence.enrichJunit` (SR-029, `enrich.ts`), the property names
// it writes and the small helpers its parts share.
import type { Problem } from "../catalog.js";
import { shown } from "../files/index.js";
import type { ViewId } from "../generated/types.js";
import type { VersionForms } from "../model/index.js";
import type { JunitProperty, JunitTestCase } from "./junit-model.js";
import type { NameMatch } from "./name-pattern.js";

export const COMMAND = "evidence.enrichJunit";

export const ELEMENT = "reqseq:element";
export const VERSION = "reqseq:version";
export const ITEM = "reqseq:item";
export const DATE = "reqseq:date";
export const VARIANT = "reqseq:variant";

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
  /**
   * The acceptance criteria items of the current version of the element `id` (a found one), against
   * which the criterion keys of a name are checked (AK13).
   */
  readonly criteriaOf: (id: string) => readonly unknown[];
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

export const isUuidText = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.toLowerCase());

/** What one test case gives. */
export type Plan =
  | { readonly kind: "none" }
  | {
      readonly kind: "kept";
      readonly testCase: JunitTestCase;
      readonly pairs: ReadonlyMap<string, string>;
      /** The views of its `reqseq:variant` properties as the reader reads them (`core` without one). */
      readonly views: readonly ViewId[];
    }
  | { readonly kind: "invalid"; readonly testCase: JunitTestCase; readonly reason: string }
  /** Its name names an acceptance criterion that the current version does not have by key (AK13). */
  | { readonly kind: "criterion"; readonly testCase: JunitTestCase; readonly reason: string }
  | {
      readonly kind: "reported";
      readonly testCase: JunitTestCase;
      readonly refs: readonly Reported[];
    }
  /**
   * Every element it names applies in none of the given views (AK11): it gets no requirement, only a
   * mark for each of `marks`, the given views (AK12).
   */
  | {
      readonly kind: "outside";
      readonly testCase: JunitTestCase;
      readonly marks: readonly string[];
      readonly notInView: number;
    }
  | {
      readonly kind: "enrich";
      readonly testCase: JunitTestCase;
      readonly criteria: CriteriaPlan;
      /** The `reqseq:element` properties and the element each names, in file order. */
      readonly named: readonly { readonly property: JunitProperty; readonly id: string }[];
      /** Elements only the name names, to append. */
      readonly added: readonly string[];
      readonly variant: VariantPlan;
      /** Properties to remove: those of the elements left out (AK11), and every mark (AK12). */
      readonly drop: readonly JunitProperty[];
      /** The elements left out, as no given view holds them (AK11). */
      readonly notInView: number;
    };

/** The criteria an enriched test case gets (SR-029 AK10): how they are written, and how they read back. */
export interface CriteriaPlan {
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
export interface VariantPlan {
  /** Its views after enrich, each once: `core` or a variant's UUID. */
  readonly views: readonly string[];
  /** Existing `reqseq:variant` properties whose value becomes the variant's UUID (AK7). */
  readonly rewrite: readonly { readonly property: JunitProperty; readonly id: string }[];
  /** New `reqseq:variant` values, in the order given (AK6). */
  readonly add: readonly string[];
}

export const testCaseText = (testCase: JunitTestCase): string =>
  `Test case "${shown(testCase.name)}" (line ${String(testCase.line)})`;

export const nameOf = (testCase: JunitTestCase): Pick<UnknownRef, "testCase" | "className" | "line"> => ({
  testCase: testCase.name,
  ...(testCase.className === "" ? {} : { className: testCase.className }),
  line: testCase.line,
});

/** The trimmed values of the properties named `name`. */
export const valuesOf = (testCase: JunitTestCase, name: string): string[] =>
  testCase.properties.filter((p) => p.name === name).map((p) => p.value.trim());

/** The view `core` as `outOfVariant` takes it (`viewIdOf`). */
export const CORE = "core";

/** Whether two lists of distinct views hold the same views. */
export const sameViews = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && b.every((view) => a.includes(view));

/** Whether `value` is the UUID `id` already (any case). */
export const isUuidOf = (value: string, id: string): boolean =>
  isUuidText(value) && value.toLowerCase() === id;

/** A reference that names no element or more than one, with what it names. */
export interface Reported {
  readonly ref: string;
  readonly resolution: RefResolution;
  /** The text the name pattern matched, for a short ID it built (AK5). */
  readonly matched?: string | undefined;
}
