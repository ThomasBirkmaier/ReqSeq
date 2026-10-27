// The JUnit reader (SR-093, ADR-0012 "JUnit XML"): the records of an enriched JUnit XML file in an
// evidence folder. It reads the file's bytes only (no element store: whether a UUID names an element
// of the workspace is up to the consumers, `evidence.unknown-element` of SR-028).
//
// - A test case is enriched when it has a `logreq:version` property (D-026: "Die Fassung ergänzt die
//   Kommandozeile (D-025) nach der Durchführung"). Its `logreq:element` properties (UUIDs) name the
//   requirements; the n-th `logreq:version` is the version of the n-th `logreq:element`, so a test
//   case that names several requirements gives one record for each, with its own version (SR-033
//   AK2); an element repeated with the same version counts once. `logreq:item` and `logreq:date` are required, `logreq:variant` is optional (absent: the core).
//   Kind `verification`, method `test`, result `failed` with `<failure>` or `<error>`, else `passed`.
// - A test case that names no requirement (no `logreq:element` property, no short ID or UUID token in
//   its name) is passed over silently (SR-093 AK2): a pytest parameter list such as `test_add[1-2]`
//   or any other identifier in brackets is not a reference the reader can tell without the store.
// - A test case that names a requirement but is not enriched gives no record; the file gets one
//   `evidence.not-enriched` warning with the number of such test cases and the line of the first
//   (spec question #529 Q3).
// - An enriched test case marked `<skipped>` gives no record (ADR-0012), so it never counts as passed
//   (SR-093 AK3); it is kept as a skipped test case, a test case without execution (SR-033 AK3).
// - An enriched test case whose properties do not fit (a `logreq:element` that is no UUID, versions
//   that do not pair with the elements, a missing or malformed item, date, version or variant) gives no
//   record and an `evidence.invalid-record` error with its line, as does a file the XML scanner
//   refuses. XML whose root is not a JUnit root is no JUnit file and gives nothing.
import type { Problem } from "../catalog.js";
import { shown, zip } from "../files/index.js";
import { isUuid, isVersion } from "../model/index.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import type { EvidenceFile } from "./folders.js";
import type { JunitTestCase } from "./junit-model.js";
import { elementRefsOf, junitTestCases } from "./junit-model.js";
import type { EvidenceRecord, SkippedTestCase } from "./record.js";
import type { EvidenceFileRead, EvidenceReader } from "./state.js";

/** Where a JUnit file lies: the workspace name of its repository and the path in it. */
export type JunitLocation = Pick<EvidenceFile, "repository" | "file">;

const ELEMENT = "logreq:element";
const VERSION = "logreq:version";
const ITEM = "logreq:item";
const DATE = "logreq:date";
const VARIANT = "logreq:variant";

const isDateTime = (value: string): boolean =>
  fileSchemaValidator("common.schema.json#/$defs/dateTime")(value);

/** The trimmed values of the properties of `testCase` named `name`, in file order. */
const valuesOf = (testCase: JunitTestCase, name: string): string[] =>
  testCase.properties.filter((p) => p.name === name).map((p) => p.value.trim());

/** The `logreq:*` properties of a test case, trimmed, in file order; UUIDs in lower case. */
interface Fields {
  readonly elements: readonly string[];
  readonly versions: readonly string[];
  readonly items: readonly string[];
  readonly dates: readonly string[];
  readonly variants: readonly string[];
}

/** `value` in lower case when that is a UUID (`uuidRef` allows any case), else as it is. */
const uuidOf = (value: string): string => (isUuid(value.toLowerCase()) ? value.toLowerCase() : value);

/** Why `values` do not fit: the first value `test` rejects. (`test` returns a plain boolean, so nothing is narrowed.) */
const invalid = (
  values: readonly string[],
  name: string,
  test: (value: string) => boolean,
  what: string,
): string | undefined => {
  const value = values.find((v) => !test(v));
  return value === undefined ? undefined : `${name} "${shown(value)}" is not ${what}`;
};

/** A property given at most once (or several times with the same value): why the values do not fit. */
const conflict = (values: readonly string[], name: string): string | undefined =>
  new Set(values).size > 1 ? `${name} is given with different values` : undefined;

/** A required property: whether it is missing (absent or empty). */
const missing = (values: readonly string[], name: string): string | undefined =>
  (values[0] ?? "") === "" ? `${name} is missing` : undefined;

/** The checks of an enriched test case in the order they are reported; each gives why it does not fit. */
const CHECKS: readonly ((fields: Fields) => string | undefined)[] = [
  ({ elements }) =>
    invalid(elements, ELEMENT, isUuid, "a UUID (logreq evidence enrich-junit writes the UUID)"),
  ({ elements, versions }) =>
    elements.length === versions.length
      ? undefined
      : `${String(elements.length)} ${ELEMENT} and ${String(versions.length)} ${VERSION} properties: each element needs its version`,
  ({ versions }) => invalid(versions, VERSION, isVersion, "a version"),
  ({ items }) => conflict(items, ITEM) ?? missing(items, ITEM),
  ({ dates }) =>
    conflict(dates, DATE) ??
    missing(dates, DATE) ??
    invalid(dates, DATE, isDateTime, "a date and time with time zone"),
  ({ variants }) => conflict(variants, VARIANT) ?? invalid(variants, VARIANT, isUuid, "a UUID"),
];

/** What an enriched test case says: the element/version pairs, item, date and variant, or why it does not fit. */
export type Enrichment =
  | {
      readonly pairs: ReadonlyMap<string, string>;
      readonly item: string;
      readonly date: string;
      readonly variant?: string;
    }
  | { readonly error: string };

/**
 * What an enriched test case (one with a `logreq:version`) says, by the checks of the reader; enrich
 * (SR-029) uses it to check a test case it keeps and the file it wrote.
 */
export const enrichmentOf = (testCase: JunitTestCase): Enrichment => {
  const fields: Fields = {
    elements: valuesOf(testCase, ELEMENT).map(uuidOf),
    versions: valuesOf(testCase, VERSION),
    items: valuesOf(testCase, ITEM),
    dates: valuesOf(testCase, DATE),
    variants: valuesOf(testCase, VARIANT).map(uuidOf),
  };
  for (const check of CHECKS) {
    const error = check(fields);
    if (error !== undefined) {
      return { error };
    }
  }
  const [item = "", date = ""] = [fields.items[0], fields.dates[0]];
  const [variant] = fields.variants;
  const { elements, versions } = fields;
  // Each element once: a repeated element with the same version counts once, with another one it does not fit.
  const pairs = new Map<string, string>();
  for (const [element, version] of zip(elements, versions)) {
    const before = pairs.get(element);
    if (before !== undefined && before !== version) {
      return { error: `${ELEMENT} "${shown(element)}" is given with different versions` };
    }
    pairs.set(element, version);
  }
  return { pairs, item, date, ...(variant === undefined ? {} : { variant }) };
};

/** Whether a test case that is not enriched names a requirement: a `logreq:element` property or a short ID or UUID in its name. */
const namesElement = (testCase: JunitTestCase): boolean =>
  elementRefsOf(testCase).some((ref) => ref.source === "property" || ref.kind !== "other");

/** The name and class name of a test case as records and skipped test cases carry them (no empty class name). */
const nameOf = (testCase: JunitTestCase): { readonly name: string; readonly className?: string } => ({
  name: testCase.name,
  ...(testCase.className === "" ? {} : { className: testCase.className }),
});

/**
 * The records of a JUnit XML file (see the file comment): one per element of each enriched test case
 * that is not skipped, in file order; the skipped ones; and the problems of the file.
 */
export const readJunitRecords = (location: JunitLocation, bytes: Uint8Array): EvidenceFileRead => {
  const { repository, file } = location;
  const read = junitTestCases(bytes);
  if (read.kind === "not-junit") {
    return { records: [] };
  }
  if (read.kind === "invalid") {
    return {
      records: [],
      problems: [
        {
          code: "evidence.invalid-record",
          severity: "error",
          repository,
          file,
          line: read.line,
          message: `Not a readable JUnit XML file: ${read.message}`,
        },
      ],
    };
  }
  const records: EvidenceRecord[] = [];
  const skipped: SkippedTestCase[] = [];
  const problems: (Problem & { readonly line: number })[] = [];
  const notEnriched: JunitTestCase[] = [];
  for (const testCase of read.file.testCases) {
    if (!testCase.properties.some((p) => p.name === VERSION)) {
      if (namesElement(testCase)) {
        notEnriched.push(testCase);
      }
      continue;
    }
    const enrichment = enrichmentOf(testCase);
    if ("error" in enrichment) {
      problems.push({
        code: "evidence.invalid-record",
        severity: "error",
        repository,
        file,
        line: testCase.line,
        message: `Test case "${shown(testCase.name)}" is not read: ${enrichment.error}`,
      });
      continue;
    }
    const named = nameOf(testCase);
    if (testCase.outcome === "skipped") {
      skipped.push({
        ...named,
        elements: [...enrichment.pairs.keys()],
        repository,
        file,
        line: testCase.line,
      });
      continue;
    }
    for (const [element, version] of enrichment.pairs) {
      records.push({
        element,
        version,
        kind: "verification",
        method: "test",
        ...(enrichment.variant === undefined ? {} : { variant: enrichment.variant }),
        item: enrichment.item,
        result: testCase.outcome === "passed" ? "passed" : "failed",
        date: enrichment.date,
        testCase: named.name,
        source: "junit",
        repository,
        file,
        line: testCase.line,
        ...(named.className === undefined ? {} : { className: named.className }),
      });
    }
  }
  const [first] = notEnriched;
  if (first !== undefined) {
    problems.push({
      code: "evidence.not-enriched",
      severity: "warning",
      repository,
      file,
      line: first.line,
      message: `${String(notEnriched.length)} test case(s) name a requirement but have no ${VERSION}, so they give no record; enrich the file with logreq evidence enrich-junit`,
    });
  }
  // By line; stable, so problems on one line stay in file order.
  problems.sort((a, b) => a.line - b.line);
  return {
    records,
    ...(skipped.length === 0 ? {} : { skipped }),
    ...(problems.length === 0 ? {} : { problems }),
  };
};

/** The reader of `*.xml` files in evidence folders (`EVIDENCE_READERS`). */
export const JUNIT_READER: EvidenceReader = { extension: "xml", read: readJunitRecords };
