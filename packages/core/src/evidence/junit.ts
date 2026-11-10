// The JUnit reader (SR-093, ADR-0012 "JUnit XML"): the records of an enriched JUnit XML file in an
// evidence folder. It reads the file's bytes only (no element store: whether a UUID names an element
// of the workspace is up to the consumers, `evidence.unknown-element` of SR-028).
//
// - A test case is enriched when it has a `reqseq:version` property (D-026: "Die Fassung ergänzt die
//   Kommandozeile (D-025) nach der Durchführung"). Its `reqseq:element` properties (UUIDs) name the
//   requirements; the n-th `reqseq:version` is the version of the n-th `reqseq:element`, so a test
//   case that names several requirements gives one record for each, with its own version (SR-033
//   AK2); an element repeated with the same version counts once. `reqseq:item` and `reqseq:date` are
//   required. Kind `verification`, method `test`, result `failed` with `<failure>` or `<error>`, else
//   `passed`.
// - `reqseq:variant` is repeatable (SR-093 AK5, D-026): each value is a variant UUID (any case, kept in
//   lower case) or `core` (any case). Without the property the test case is for the core; with one or
//   more, for exactly the views they name, each once, in the order of their first property. It gives
//   one record per view and element (views outer, elements inner), all with the same place, name,
//   item, date, result and criteria; the record for the core carries no `variant`, so each counts
//   only in its view (SR-047), the core's also in every variant of a `variant-independent`
//   repository (SR-173). An older ReqSeq reads a test case with two values as
//   `evidence.invalid-record` (no compatibility before 1.0).
// - A test case that names no requirement (no `reqseq:element` property, no short ID or UUID token in
//   its name) is passed over silently (SR-093 AK2): a pytest parameter list such as `test_add[1-2]`
//   or any other identifier in brackets is not a reference the reader can tell without the store.
// - A test case that names a requirement but is not enriched gives no record; the file gets one
//   `evidence.not-enriched` warning with the number of such test cases and the line of the first
//   (spec question ThomasBirkmaier/ReqSeq-archive#529 Q3).
// - An enriched test case marked `<skipped>` gives no record (ADR-0012), so it never counts as passed
//   (SR-093 AK3); it is kept as one skipped test case, a test case without execution (SR-033 AK3),
//   whatever views it names.
// - An enriched test case whose properties do not fit (a `reqseq:element` that is no UUID, versions
//   that do not pair with the elements, a missing or malformed item, date or version, a variant that is
//   neither a UUID nor `core`) gives no record and an `evidence.invalid-record` error with its line, as
//   does a file the XML scanner refuses. XML whose root is not a JUnit root is no JUnit file and gives
//   nothing.
// - The `reqseq:criterion` properties of an enriched test case name acceptance criteria (D-072,
//   SR-093 AK4): `<element UUID>:<n>`, `n` a whole number from 1 without leading zero, one property
//   per pair. Each element's record gets the numbers that name it (ascending, each once, with the line
//   of the property that names each first, for SR-028 AK5); an element no property names holds for
//   all its criteria. A value of another form, or whose UUID is not one of the test case's
//   `reqseq:element`, is `evidence.invalid-record` at the line of that property, and the test case
//   gives no record. Only enriched test cases are looked at: enrich resolves a hand-written
//   reference first (#961), and a file enriched before criteria existed holds for all of them.
import type { Problem } from "../catalog.js";
import { shown, zip } from "../files/index.js";
import type { ViewId } from "../generated/types.js";
import { isUuid, isVersion } from "../model/index.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import type { EvidenceFile } from "./folders.js";
import type { JunitTestCase } from "./junit-model.js";
import { CRITERION_PROPERTY, elementRefsOf, junitTestCases } from "./junit-model.js";
import type { EvidenceRecord, SkippedTestCase } from "./record.js";
import { withCriterionLines } from "./record.js";
import type { EvidenceFileRead, EvidenceReader } from "./state.js";

/** Where a JUnit file lies: the workspace name of its repository and the path in it. */
export type JunitLocation = Pick<EvidenceFile, "repository" | "file">;

const ELEMENT = "reqseq:element";
const VERSION = "reqseq:version";
const ITEM = "reqseq:item";
const DATE = "reqseq:date";
const VARIANT = "reqseq:variant";
/** The view of the core as a `reqseq:variant` value names it (`viewIdOf`). */
const CORE = "core";

const isDateTime = (value: string): boolean =>
  fileSchemaValidator("common.schema.json#/$defs/dateTime")(value);

/** The trimmed values of the properties of `testCase` named `name`, in file order. */
const valuesOf = (testCase: JunitTestCase, name: string): string[] =>
  testCase.properties.filter((p) => p.name === name).map((p) => p.value.trim());

/** The `reqseq:*` properties of a test case, trimmed, in file order; UUIDs in lower case. */
interface Fields {
  readonly elements: readonly string[];
  readonly versions: readonly string[];
  readonly items: readonly string[];
  readonly dates: readonly string[];
  readonly variants: readonly string[];
}

/** `value` in lower case when that is a UUID (`uuidRef` allows any case), else as it is. */
const uuidOf = (value: string): string => (isUuid(value.toLowerCase()) ? value.toLowerCase() : value);

/** A `reqseq:variant` value as a view: `core` in any case as `core`, a UUID in lower case, else as it is. */
const viewOf = (value: string): string => (value.toLowerCase() === CORE ? CORE : uuidOf(value));

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
    invalid(elements, ELEMENT, isUuid, "a UUID (reqseq evidence enrich-junit writes the UUID)"),
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
  ({ variants }) => invalid(variants, VARIANT, (v) => v === CORE || isUuid(v), "a UUID or core"),
];

/** What an enriched test case says: the element/version pairs, item, date and views, or why it does not fit. */
export type Enrichment =
  | {
      readonly pairs: ReadonlyMap<string, string>;
      readonly item: string;
      readonly date: string;
      /**
       * The views it is for (`core` or a variant's UUID), each once, in the order of their first
       * `reqseq:variant`; `["core"]` without the property (SR-093 AK5).
       */
      readonly views: readonly ViewId[];
    }
  | { readonly error: string };

/**
 * What an enriched test case (one with a `reqseq:version`) says, by the checks of the reader; enrich
 * (SR-029) uses it to check a test case it keeps and the file it wrote.
 */
export const enrichmentOf = (testCase: JunitTestCase): Enrichment => {
  const fields: Fields = {
    elements: valuesOf(testCase, ELEMENT).map(uuidOf),
    versions: valuesOf(testCase, VERSION),
    items: valuesOf(testCase, ITEM),
    dates: valuesOf(testCase, DATE),
    variants: valuesOf(testCase, VARIANT).map(viewOf),
  };
  for (const check of CHECKS) {
    const error = check(fields);
    if (error !== undefined) {
      return { error };
    }
  }
  const [item = "", date = ""] = [fields.items[0], fields.dates[0]];
  const views = fields.variants.length === 0 ? [CORE] : [...new Set(fields.variants)];
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
  return { pairs, item, date, views };
};

/** A criterion number as the property writes it: a whole number from 1, no sign, no leading zero. */
const CRITERION_NUMBER = /^[1-9][0-9]*$/;

/**
 * The criteria of an enriched test case by element (see the file comment): for each element some
 * `reqseq:criterion` names, the line of each number it names, in ascending order; or why a property
 * does not fit, with its line.
 */
export const criteriaOf = (
  testCase: JunitTestCase,
  elements: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlyMap<number, number>> | { readonly error: string; readonly line: number } => {
  const found = new Map<string, Map<number, number>>();
  for (const { name, value, line } of testCase.properties) {
    if (name !== CRITERION_PROPERTY) {
      continue;
    }
    const text = value.trim();
    // The last colon: a UUID has none, so no regular expression has to find the split (linear).
    const colon = text.lastIndexOf(":");
    const element = uuidOf(text.slice(0, colon));
    const digits = text.slice(colon + 1);
    const criterion = Number(digits);
    if (!isUuid(element) || !CRITERION_NUMBER.test(digits) || !Number.isSafeInteger(criterion)) {
      return {
        error: `${CRITERION_PROPERTY} "${shown(text)}" is not <element UUID>:<number from 1>`,
        line,
      };
    }
    if (!elements.has(element)) {
      return {
        error: `${CRITERION_PROPERTY} "${shown(text)}" names no ${ELEMENT} of the test case`,
        line,
      };
    }
    const lines = found.get(element) ?? new Map<number, number>();
    found.set(element, lines);
    // A number named twice counts once, at its first line.
    lines.set(criterion, lines.get(criterion) ?? line);
  }
  return new Map(
    [...found].map(([element, lines]) => [element, new Map([...lines].sort(([a], [b]) => a - b))]),
  );
};

/** Whether a test case that is not enriched names a requirement: a `reqseq:element` property or a short ID or UUID in its name. */
const namesElement = (testCase: JunitTestCase): boolean =>
  elementRefsOf(testCase).some((ref) => ref.source === "property" || ref.kind !== "other");

/** The name and class name of a test case as records and skipped test cases carry them (no empty class name). */
const nameOf = (testCase: JunitTestCase): { readonly name: string; readonly className?: string } => ({
  name: testCase.name,
  ...(testCase.className === "" ? {} : { className: testCase.className }),
});

/**
 * The records of an enriched test case that is not skipped: one per view and element (views outer),
 * with the numbers `criteria` gives for the element (see the file comment).
 */
const recordsOf = (
  testCase: JunitTestCase,
  enrichment: Extract<Enrichment, { readonly pairs: unknown }>,
  criteria: ReadonlyMap<string, ReadonlyMap<number, number>>,
  { repository, file }: JunitLocation,
): EvidenceRecord[] => {
  const named = nameOf(testCase);
  const pairs = [...enrichment.pairs];
  return enrichment.views.flatMap((view) =>
    pairs.map(([element, version]) => {
      const lines = criteria.get(element);
      const record: EvidenceRecord = {
        element,
        version,
        kind: "verification",
        method: "test",
        ...(view === CORE ? {} : { variant: view }),
        item: enrichment.item,
        result: testCase.outcome === "passed" ? "passed" : "failed",
        date: enrichment.date,
        testCase: named.name,
        source: "junit",
        repository,
        file,
        line: testCase.line,
        ...(named.className === undefined ? {} : { className: named.className }),
        ...(lines === undefined ? {} : { criteria: [...lines.keys()] }),
      };
      return lines === undefined ? record : withCriterionLines(record, lines);
    }),
  );
};

/**
 * The records of a JUnit XML file (see the file comment): one per view and element of each enriched
 * test case that is not skipped, in file order; the skipped ones; and the problems of the file.
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
    const criteria = criteriaOf(testCase, new Set(enrichment.pairs.keys()));
    if ("error" in criteria) {
      problems.push({
        code: "evidence.invalid-record",
        severity: "error",
        repository,
        file,
        line: criteria.line,
        message: `Test case "${shown(testCase.name)}" is not read: ${criteria.error}`,
      });
      continue;
    }
    const named = nameOf(testCase);
    if (testCase.outcome !== "skipped") {
      records.push(...recordsOf(testCase, enrichment, criteria, location));
    } else {
      skipped.push({
        ...named,
        elements: [...enrichment.pairs.keys()],
        repository,
        file,
        line: testCase.line,
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
      message: `${String(notEnriched.length)} test case(s) name a requirement but have no ${VERSION}, so they give no record: enrich the file with reqseq evidence enrich-junit, unless enrich-junit --skip-not-in-view left them out because their requirements apply in none of the given views`,
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
