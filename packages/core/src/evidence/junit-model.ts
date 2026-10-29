// The JUnit XML model (ADR-0012 "JUnit XML"): the test cases of a JUnit file with what reading them
// as records (SR-093) and enriching them losslessly (SR-029) need. Built on the own XML scanner of the
// files block, so every offset is a byte offset into the original bytes: a caller splices new bytes
// in at those offsets and keeps every other byte (BOM, CRLF, non-ASCII text, formatting) unchanged.
import type { XmlAttribute, XmlElement, XmlRefusalReason } from "../files/index.js";
import { scanXml, xmlAttribute } from "../files/index.js";

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
  /** Every `<testcase>` of a `<testsuite>`, in file order. */
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
    // Children in reverse, so that the stack gives them back in file order. Test cases count only
    // inside a `<testsuite>`.
    for (const child of element.children.toReversed()) {
      if (child.name === "testsuite" || (child.name === "testcase" && element.name === "testsuite")) {
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
}

const SHORT_ID = /^[A-Z][A-Z0-9]*-[0-9a-f]{6,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The `<ref>` of `[<ref>]` or `[<ref>/<anything>]` in a test case name (ADR-0012). */
const NAME_TOKEN = /(?<=\[)[^[\]/]*(?=(?:\/[^[\]]*)?\])/g;

const kindOf = (text: string): ElementRefKind =>
  SHORT_ID.test(text) ? "shortId" : UUID.test(text) ? "uuid" : "other";

const tokens = (texts: readonly string[], source: ElementRefSource): readonly ElementRefToken[] =>
  [...new Set(texts.map((text) => text.trim()).filter((text) => text !== ""))].map((text) => ({
    text,
    kind: kindOf(text),
    source,
  }));

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
 *   pytest parameter list (`test_add[1-2]`) is never reported.
 *
 * Two texts can name the same element (an enriched file has the UUID in the property and the short
 * ID in the name): the caller deduplicates after resolving, so each element counts once (SR-033 AK2).
 */
export const elementRefsOf = (
  testCase: Pick<JunitTestCase, "name" | "properties">,
): readonly ElementRefToken[] => [
  ...tokens(
    testCase.properties
      .filter((property) => property.name === "reqseq:element")
      .map((property) => property.value),
    "property",
  ),
  ...tokens(
    Array.from(testCase.name.matchAll(NAME_TOKEN), ([token]) => token),
    "name",
  ),
];
