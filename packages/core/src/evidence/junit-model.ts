// The JUnit XML model (ADR-0012 "JUnit XML"): the test cases of a JUnit file with what reading them
// as records (SR-093) and enriching them losslessly (SR-029) need. Built on the own XML scanner of the
// files block, so every offset is a byte offset into the original bytes: a caller splices new bytes
// in at those offsets and keeps every other byte (BOM, CRLF, non-ASCII text, formatting) unchanged.
import type { XmlAttribute, XmlElement, XmlRefusalReason } from "../files/index.js";
import { scanXml, xmlAttribute } from "../files/index.js";
import type { NameMatch } from "./name-pattern.js";

/**
 * The property that names an acceptance criterion of an element of the test case (D-072, SR-093
 * AK4): `<element UUID>:<n>`, repeatable, one per pair (ADR-0012 "Decision").
 */
export const CRITERION_PROPERTY = "reqseq:criterion";

/** passed unless the test case has `<error>`, `<failure>` or `<skipped>` (ADR-0012). */
export type JunitOutcome = "passed" | "failed" | "error" | "skipped";

/** A `<property>` of a test case. Offsets are byte offsets into the file. */
export interface JunitProperty {
  readonly name: string;
  /** The `value` attribute, or the text of the element when it has none. */
  readonly value: string;
  readonly line: number;
  /** The `<` of `<property`. */
  readonly start: number;
  /** The byte after the property element. */
  readonly end: number;
  /**
   * Where the value is written, for replacing it in place (an existing `reqseq:*` property is
   * replaced, never written twice):
   * - the text between the quotes of the `value` attribute, with `quote` (`"` or `'`): a new value
   *   must be escaped for that quote;
   * - the content of `<property name="…">text</property>` when it has no `value` attribute
   *   (no `quote`: escape `<` and `&`).
   *
   * Undefined for `<property name="…"/>` without a value: replace the whole property (`start`..`end`).
   */
  readonly valueAt?: { readonly start: number; readonly end: number; readonly quote?: '"' | "'" };
}

/**
 * Where an enrich writes new `<property>` elements (byte offsets into the file):
 * - `append`: the test case has a `<properties>` block; insert the properties at `offset` (before `</properties>`);
 * - `open-properties`: the test case has an empty `<properties/>`; replace the bytes from `start` to `end` (`/>`)
 *   by `>`, the properties and `</properties>`;
 * - `new-block`: the test case has no `<properties>`; insert `<properties>…</properties>` at `offset`, right after
 *   the start tag of `<testcase>` (pytest writes it there);
 * - `open-testcase`: the test case closes itself (`<testcase …/>`); replace the bytes from `start` to `end` (`/>`)
 *   by `>`, a `<properties>` block and `</testcase>`.
 */
export type JunitPropertiesAt =
  | { readonly kind: "append"; readonly offset: number }
  | { readonly kind: "open-properties"; readonly start: number; readonly end: number }
  | { readonly kind: "new-block"; readonly offset: number }
  | { readonly kind: "open-testcase"; readonly start: number; readonly end: number };

export interface JunitTestCase {
  /** The `name` attribute, `""` when absent. */
  readonly name: string;
  /** The `classname` attribute, `""` when absent. */
  readonly className: string;
  /** Line of `<testcase`, from 1. */
  readonly line: number;
  /** The `timestamp` of the nearest enclosing `<testsuite>` or `<testsuites>` that has one. */
  readonly timestamp?: string;
  /** Every `<property>` of every `<properties>` block of the test case, in file order. */
  readonly properties: readonly JunitProperty[];
  readonly outcome: JunitOutcome;
  /** The `<` of `<testcase` and the byte after the test case. */
  readonly start: number;
  readonly end: number;
  readonly propertiesAt: JunitPropertiesAt;
}

export interface JunitSuite {
  /** The `name` attribute, `""` when absent. */
  readonly name: string;
  readonly line: number;
  readonly timestamp?: string;
}

export interface JunitFile {
  readonly root: "testsuites" | "testsuite";
  /** The file starts with a UTF-8 byte order mark. */
  readonly bom: boolean;
  /** Every `<testsuite>`, nested ones included, in file order. */
  readonly suites: readonly JunitSuite[];
  /** Every `<testcase>` of a `<testsuite>` or directly below `<testsuites>` (#670), in file order. */
  readonly testCases: readonly JunitTestCase[];
}

export type JunitReadOutcome =
  | { readonly kind: "junit"; readonly file: JunitFile }
  /** Well-formed XML whose root is neither `testsuites` nor `testsuite`: not a JUnit file, skipped silently. */
  | { readonly kind: "not-junit"; readonly root: string }
  /** The scanner refused the file (S3 of the stage 4 plan review: `evidence.invalid-record` with the line). */
  | {
      readonly kind: "invalid";
      readonly reason: XmlRefusalReason;
      readonly message: string;
      readonly line: number;
    };

const OUTCOMES: readonly (readonly [string, JunitOutcome])[] = [
  ["error", "error"],
  ["failure", "failed"],
  ["skipped", "skipped"],
];

const outcomeOf = (testCase: XmlElement): JunitOutcome =>
  OUTCOMES.find(([child]) => testCase.children.some((element) => element.name === child))?.[1] ?? "passed";

const valueAt = (element: XmlElement, attribute: XmlAttribute | undefined): JunitProperty["valueAt"] => {
  if (attribute !== undefined) {
    return { start: attribute.valueStart, end: attribute.valueEnd, quote: attribute.quote };
  }
  return element.selfClosing ? undefined : { start: element.contentStart, end: element.contentEnd };
};

const propertyOf = (element: XmlElement): JunitProperty => {
  const value = xmlAttribute(element, "value");
  const at = valueAt(element, value);
  return {
    name: xmlAttribute(element, "name")?.value ?? "",
    value: value?.value ?? element.text,
    line: element.line,
    start: element.start,
    end: element.end,
    ...(at === undefined ? {} : { valueAt: at }),
  };
};

const propertiesAtOf = (testCase: XmlElement, block: XmlElement | undefined): JunitPropertiesAt => {
  if (testCase.selfClosing) {
    return { kind: "open-testcase", start: testCase.contentEnd, end: testCase.end };
  }
  if (block === undefined) {
    return { kind: "new-block", offset: testCase.contentStart };
  }
  return block.selfClosing
    ? { kind: "open-properties", start: block.contentEnd, end: block.end }
    : { kind: "append", offset: block.contentEnd };
};

const stamp = (timestamp: string | undefined): { readonly timestamp?: string } =>
  timestamp === undefined ? {} : { timestamp };

const testCaseOf = (element: XmlElement, timestamp: string | undefined): JunitTestCase => {
  const blocks = element.children.filter((child) => child.name === "properties");
  const properties = blocks.flatMap((block) =>
    block.children.filter((child) => child.name === "property").map(propertyOf),
  );
  return {
    name: xmlAttribute(element, "name")?.value ?? "",
    className: xmlAttribute(element, "classname")?.value ?? "",
    line: element.line,
    ...stamp(timestamp),
    properties,
    outcome: outcomeOf(element),
    start: element.start,
    end: element.end,
    propertiesAt: propertiesAtOf(element, blocks[0]),
  };
};

const SUITE_NAMES: ReadonlySet<string> = new Set(["testsuite", "testsuites"]);

/** The suites and test cases below `root` in file order, walked with an explicit stack (no recursion). */
const collect = (root: XmlElement): Pick<JunitFile, "suites" | "testCases"> => {
  const suites: JunitSuite[] = [];
  const testCases: JunitTestCase[] = [];
  const stack: { readonly element: XmlElement; readonly timestamp: string | undefined }[] = [
    { element: root, timestamp: undefined },
  ];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { element } = next;
    if (element.name === "testcase") {
      testCases.push(testCaseOf(element, next.timestamp));
      continue;
    }
    const timestamp = xmlAttribute(element, "timestamp")?.value ?? next.timestamp;
    if (element.name === "testsuite") {
      suites.push({
        name: xmlAttribute(element, "name")?.value ?? "",
        line: element.line,
        ...stamp(timestamp),
      });
    }
    // Children in reverse, so that the stack gives them back in file order. Test cases count inside a
    // `<testsuite>` and directly below `<testsuites>`, where the Node test runner writes them (#670).
    for (const child of element.children.toReversed()) {
      if (child.name === "testsuite" || (child.name === "testcase" && SUITE_NAMES.has(element.name))) {
        stack.push({ element: child, timestamp });
      }
    }
  }
  return { suites, testCases };
};

/**
 * Reads the bytes of a JUnit XML file: its suites and test cases with byte offsets, or `not-junit`
 * for other XML (root neither `testsuites` nor `testsuite`), or `invalid` when the scanner refused it.
 */
export const junitTestCases = (bytes: Uint8Array): JunitReadOutcome => {
  const scanned = scanXml(bytes);
  if (scanned.kind === "refused") {
    return { kind: "invalid", reason: scanned.reason, message: scanned.message, line: scanned.line };
  }
  const { root, bom } = scanned.document;
  if (root.name !== "testsuites" && root.name !== "testsuite") {
    return { kind: "not-junit", root: root.name };
  }
  return { kind: "junit", file: { root: root.name, bom, ...collect(root) } };
};

/**
 * How a reference token is written (`common.schema.json` patterns): a short ID (`SR-46fb54`), a UUID
 * (version 4, in any case, as `uuidRef`) or any other text (an identifier such as `SR-036`, a pytest
 * parameter list such as `1-2`).
 */
export type ElementRefKind = "shortId" | "uuid" | "other";

/** Where a reference comes from: a `reqseq:element` property, or a token of the test case name. */
export type ElementRefSource = "property" | "name";

export interface ElementRefToken {
  /** As written (trimmed); the caller normalises it when it resolves it. */
  readonly text: string;
  readonly kind: ElementRefKind;
  readonly source: ElementRefSource;
  /** For a token the name pattern found (SR-029 AK5): the text it matched; `text` is the short ID built. */
  readonly matched?: string;
  /**
   * For a name token whose `[` follows a letter, mark, digit or underscore, as pytest writes a
   * parameter (`test_get[<UUID>]`, #358): enrich reports it, when it names no element, only as a
   * short ID with a type prefix of the metamodel (a typo in a pytest ID).
   */
  readonly glued?: true;
}

const SHORT_ID = /^[A-Z][A-Z0-9]*-[0-9a-f]{6,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The `<ref>` of `[<ref>]` or `[<ref>/<anything>]` in a test case name (ADR-0012). */
const NAME_TOKEN = /(?<=\[)[^[\]/]*(?=(?:\/[^[\]]*)?\])/g;

/**
 * Ends in a letter, mark, digit or underscore: a bracket right after one is glued to a word, as
 * pytest writes its parameters.
 */
const WORD = /[\p{L}\p{M}\p{N}_]$/u;

const kindOf = (text: string): ElementRefKind =>
  SHORT_ID.test(text) ? "shortId" : UUID.test(text) ? "uuid" : "other";

/** One text as written: `glued` for a name token right after a word (`test_get[<UUID>]`, #358). */
interface Written {
  readonly text: string;
  readonly glued: boolean;
}

/** Each text once, trimmed; written both ways, it counts as not glued. */
const tokens = (texts: readonly Written[], source: ElementRefSource): readonly ElementRefToken[] => {
  const glued = new Map<string, boolean>();
  for (const { text, glued: g } of texts) {
    const trimmed = text.trim();
    if (trimmed !== "") {
      glued.set(trimmed, (glued.get(trimmed) ?? true) && g);
    }
  }
  return [...glued].map(([text, g]) => ({ text, kind: kindOf(text), source, ...(g ? { glued: true } : {}) }));
};

/**
 * The element references of a test case, each text once per source, in this order: the values of
 * its `reqseq:element` properties (`source: "property"`), then the `[<ref>]` and `[<ref>/<anything>]`
 * tokens of its name (`source: "name"`).
 *
 * Each comes classified by syntax only; resolving is left to the caller (SR-029, SR-093) with these
 * rules (ADR-0012 "JUnit XML"):
 * - a property is an explicit statement: a property value that does not name exactly one element is
 *   reported, whatever its kind;
 * - a name token of kind `shortId` or `uuid` that names no element is unknown; a name token of kind
 *   `other` counts only when it names exactly one element and is otherwise ignored silently, so a
 *   pytest parameter list (`test_add[1-2]`) is never reported. A token glued to a word (`glued`: its
 *   `[` right after a letter, mark, digit or underscore, as pytest writes `test_get[<UUID>]`) that
 *   names no element is reported only as a short ID with a type prefix of the metamodel, so
 *   pytest's data IDs do not make enrich fail (#358).
 *
 * With `pattern` (`evidence.enrichJunit` only, SR-029 AK5) the short IDs it finds in the name follow,
 * each once, as name tokens of kind `shortId` with the `matched` text; a short ID the brackets give
 * already is not repeated.
 *
 * Two texts can name the same element (an enriched file has the UUID in the property and the short
 * ID in the name): the caller deduplicates after resolving, so each element counts once (SR-033 AK2).
 */
export const elementRefsOf = (
  testCase: Pick<JunitTestCase, "name" | "properties">,
  pattern?: (name: string) => readonly NameMatch[],
): readonly ElementRefToken[] => {
  const found: ElementRefToken[] = [
    ...tokens(
      testCase.properties
        .filter((property) => property.name === "reqseq:element")
        .map((property) => ({ text: property.value, glued: false })),
      "property",
    ),
    ...tokens(
      Array.from(testCase.name.matchAll(NAME_TOKEN), (match) => ({
        text: match[0],
        // The character before the `[` (the match starts after it).
        glued: WORD.test(testCase.name.slice(0, match.index - 1)),
      })),
      "name",
    ),
  ];
  if (pattern === undefined) {
    return found;
  }
  const texts = new Set(found.filter((t) => t.source === "name").map((t) => t.text));
  for (const { shortId, matched } of pattern(testCase.name)) {
    if (!texts.has(shortId)) {
      texts.add(shortId);
      found.push({ text: shortId, kind: "shortId", source: "name", matched });
    }
  }
  return found;
};

/** A reference of a test case name with the acceptance criterion it names, if any (`criterionRefsOf`). */
export interface CriterionRef {
  /** As written (trimmed): the `<ref>` of a bracket token, or the short ID a name pattern built. */
  readonly ref: string;
  /** The criterion it names (1 or more); absent for a reference that names the whole requirement. */
  readonly criterion?: number;
  /** The text as written when it tries to name a criterion but names none (`[SR-036/AK0]`, `[SR-036/AK]`). */
  readonly malformed?: string;
}

/** `[<ref>]` or `[<ref>/<suffix>]` in a test case name: the tokens of `NAME_TOKEN`, with the suffix. */
const BRACKET = /\[[^[\]/]*(?:\/[^[\]]*)?\]/g;
/** A suffix that tries to name an acceptance criterion: `AK` alone or before a digit, ASCII case-insensitive. */
const AK_LIKE = /^AK(?:[0-9]|$)/i;
/** The suffix that names one: `AK<n>`, n from 1 without leading zero, at most 9 digits (as `{ak}`). */
const AK_SUFFIX = /^AK[1-9][0-9]{0,8}$/i;
/** The digits of `{ak}` that name a criterion. */
const AK_DIGITS = /^[1-9][0-9]*$/;

/** Criterion `digits` when `ok`, else `text` as malformed. */
const criterionOf = (
  ok: boolean,
  digits: string,
  text: string,
): Pick<CriterionRef, "criterion" | "malformed"> =>
  ok ? { criterion: Number(digits) } : { malformed: text };

/**
 * Every reference of the name of a test case with the acceptance criterion it names (SR-029 AK10), in
 * name order and not deduplicated: `[<ref>/AK<n>]` names criterion n, and with `pattern` a match
 * with `{ak}` names that one; n is a number from 1 without leading zero. A suffix `AK` alone or before
 * a digit that is no such `AK<n>` (`AK0`, `AK02`, `AK`, `AK2a`), and `{ak}` that is none (`0`, `03`),
 * are `malformed`. A token without suffix or with another one (`[SR-036]`, `[SR-036/slow]`) and a
 * match of a pattern without `{ak}` name the whole requirement. The caller resolves the references,
 * as for `elementRefsOf`.
 */
export const criterionRefsOf = (
  name: string,
  pattern?: (name: string) => readonly NameMatch[],
): readonly CriterionRef[] => {
  const refs: CriterionRef[] = [];
  for (const [token] of name.matchAll(BRACKET)) {
    const inner = token.slice(1, -1);
    const slash = inner.indexOf("/");
    const ref = slash < 0 ? inner : inner.slice(0, slash);
    const suffix = slash < 0 ? "" : inner.slice(slash + 1).trim();
    refs.push({
      ref: ref.trim(),
      ...(AK_LIKE.test(suffix) ? criterionOf(AK_SUFFIX.test(suffix), suffix.slice(2), token) : {}),
    });
  }
  for (const { shortId, matched, ak } of pattern?.(name) ?? []) {
    refs.push({ ref: shortId, ...(ak === undefined ? {} : criterionOf(AK_DIGITS.test(ak), ak, matched)) });
  }
  return refs;
};
