// For tests only: the fixtures of the pure enrich tests (SR-029, enrich*.test.ts): elements and their
// references, versions and criteria, variants, the options and the JUnit snippets.
import { assert } from "vitest";
import type {
  EnrichOptions,
  EnrichResult,
  RefResolution,
  VariantLookup,
  VersionLookup,
} from "./enrich-model.js";
import { enrichJunitBytes } from "./enrich.js";
import { junitTestCases } from "./junit-model.js";
import { nameMatcher, parseNamePattern } from "./name-pattern.js";

export const LOGIN = "0b9e7a3c-1d2f-4a5b-8c6d-825b7146fb54";
export const REPORT = "93000000-0000-4000-8000-0000000b0036";
export const LOG = "93000000-0000-4000-8000-0000000c0037";
export const SPEC = "29000000-0000-4000-8000-0000000d0038";
/** An element whose current version cannot be computed. */
export const BROKEN = "29000000-0000-4000-8000-0000000e0039";

export const V = {
  [LOGIN]: "n1:1111111111111111",
  [REPORT]: "n1:2222222222222222",
  [LOG]: "n1:3333333333333333",
  [SPEC]: "n1:4444444444444444",
} as const;

/** References as the workspace resolves them: short IDs, UUIDs in any case, the identifier SR-036. */
const NAMES: Readonly<Record<string, string>> = {
  "SR-46fb54": LOGIN,
  "SR-0b0036": REPORT,
  "SR-0c0037": LOG,
  "SR-036": SPEC,
  "SR-0e0039": BROKEN,
  [LOGIN]: LOGIN,
  [REPORT]: REPORT,
  [LOG]: LOG,
  [SPEC]: SPEC,
  [BROKEN]: BROKEN,
};

export const resolve = (ref: string): RefResolution => {
  const id = NAMES[ref] ?? NAMES[ref.toLowerCase()];
  if (id !== undefined) {
    return { kind: "found", id };
  }
  return ref === "SR-dup" || ref === "SR-aaaaaa" || ref === "dup"
    ? { kind: "ambiguous", candidates: [`${LOGIN} in system/a.md`, `${REPORT} in system/b.md`] }
    : { kind: "unknown" };
};

export const versionsOf = (ids: readonly string[]): Promise<ReadonlyMap<string, VersionLookup>> =>
  Promise.resolve(
    new Map(
      ids.map((id): [string, VersionLookup] => {
        const version = (V as Readonly<Record<string, string>>)[id];
        return [
          id,
          version === undefined
            ? { kind: "unknown", message: "a value that counts has no normal form" }
            : // Its n2 here: the same hex with the prefix n2 (ADR-0005 "Normal form 2").
              { kind: "version", version, forms: { n1: version, n2: `n2:${version.slice(3)}` } },
        ];
      }),
    ),
  );

export const DATE = "2026-10-27T10:00:00Z";

/** The current acceptance criteria of each element, by key (SR-029 AK13 checks the keys of a name). */
const CRITERIA: Readonly<Record<string, readonly unknown[]>> = {
  [LOGIN]: ["kone", "ktwo", "k7f3", "m2x9", "kfour"].map((key) => ({ key, text: key })),
  [SPEC]: ["k7f3", "kspc"].map((key) => ({ key, text: key })),
  [REPORT]: ["verify", "krep"].map((key) => ({ key, text: key })),
  [LOG]: ["klog", "klgb"].map((key) => ({ key, text: key })),
};

/** A compiled name pattern with the prefixes SR and VAR. */
export const pattern = (text: string): EnrichOptions["namePattern"] =>
  nameMatcher(parseNamePattern(text), ["SR", "VAR"]);

/** Two variants: Coast by short ID, identifier `coast` or UUID (any case), Mountain by short ID or UUID. */
export const COAST = "29000000-0000-4000-8000-0000000aaaaa";
export const MOUNTAIN = "29000000-0000-4000-8000-0000000bbbbb";
const VARIANTS: Readonly<Record<string, string>> = {
  "VAR-0aaaaa": COAST,
  coast: COAST,
  [COAST]: COAST,
  "VAR-0bbbbb": MOUNTAIN,
  [MOUNTAIN]: MOUNTAIN,
  core: "core",
};

/** The given views of Coast and the core, as the command passes them. */
export const GIVEN_COAST = { id: COAST, name: "VAR-0aaaaa" } as const;
export const GIVEN_MOUNTAIN = { id: MOUNTAIN, name: "VAR-0bbbbb" } as const;
export const GIVEN_CORE = { id: "core", name: "core" } as const;

const resolveVariant = (ref: string): VariantLookup => {
  const id = VARIANTS[ref] ?? VARIANTS[ref.toLowerCase()];
  return id === undefined ? { kind: "invalid", reason: `no variant is "${ref}"` } : { kind: "view", id };
};

/**
 * Coast excludes SR-0b0036 (REPORT), SR-0c0037 (LOG) holds only in a variant, SR-036 (SPEC) only in
 * Mountain (like SR-145 in one variant); everything else counts everywhere.
 */
/** Why records would count nowhere in the views of the tests with views: SR-036 and SR-0c0037 not in the core. */
const outOfViews = (id: string, view: string): string | undefined => {
  if (id === REPORT && view === COAST) {
    return "SR-0b0036 is excluded in VAR-0aaaaa";
  }
  if (id === SPEC && view !== MOUNTAIN) {
    return `SR-036 does not apply in ${view === COAST ? "VAR-0aaaaa" : view}`;
  }
  return id === LOG && view === "core" ? "SR-0c0037 does not apply in core" : undefined;
};

/** The default: every element counts in the core, which every test case without views has (SR-047 AK5). */
const outOfVariant = (id: string, view: string): string | undefined =>
  view === "core" ? undefined : outOfViews(id, view);

export const options = (more: Partial<EnrichOptions> = {}): EnrichOptions => ({
  resolve,
  typePrefixes: ["SR", "N"],
  versionsOf,
  item: "build-1",
  date: DATE,
  // The time of the call: the one test that reaches it fakes the clock.
  now: () => new Date(),
  name: "results.xml",
  file: "results/results.xml",
  resolveVariant,
  outOfVariant,
  criteriaOf: (id) => {
    // Asked only for an element of a criterion the name names: one of `CRITERIA`.
    const items = CRITERIA[id];
    assert(items !== undefined, `no criteria for ${id}`);
    return items;
  },
  ...more,
});

export const enrich = (xml: string | Uint8Array, more: Partial<EnrichOptions> = {}): Promise<EnrichResult> =>
  enrichJunitBytes(typeof xml === "string" ? Buffer.from(xml, "utf8") : xml, options(more));

/** `enrich` with the views of `outOfViews`, in which SR-036 and SR-0c0037 do not apply in the core. */
export const enrichViews = (
  xml: string | Uint8Array,
  more: Partial<EnrichOptions> = {},
): Promise<EnrichResult> => enrich(xml, { outOfVariant: outOfViews, ...more });

export const text = (result: EnrichResult): string => Buffer.from(result.bytes).toString("utf8");

/** `<testsuites><testsuite …>` + test cases + the end tags. */
export const suite = (cases: string, attributes = ""): string =>
  `<testsuites><testsuite name="s"${attributes}>${cases}</testsuite></testsuites>`;

export const prop = (name: string, value: string): string => `<property name="${name}" value="${value}"/>`;

/** The four properties enrich writes for one element, as one string. */
export const four = (id: string, version: string, item = "build-1", date = DATE): string =>
  prop("reqseq:element", id) +
  prop("reqseq:version", version) +
  prop("reqseq:item", item) +
  prop("reqseq:date", date);

/** Each test case with its `reqseq:*` properties as `name=value`, in file order. */
export const properties = (bytes: Uint8Array): Record<string, string[]> => {
  const read = junitTestCases(bytes);
  assert(read.kind === "junit", `expected JUnit, got ${read.kind}`);
  return Object.fromEntries(
    read.file.testCases.map((t) => [
      t.name,
      t.properties.filter((p) => p.name.startsWith("reqseq:")).map((p) => `${p.name}=${p.value}`),
    ]),
  );
};

/** The test cases that hold all four properties (UUID, version, item, date). */
export const enrichedNames = (bytes: Uint8Array): string[] =>
  Object.entries(properties(bytes))
    .filter(([, list]) =>
      ["reqseq:element=", "reqseq:version=", "reqseq:item=", "reqseq:date="].every((start) =>
        list.some((p) => p.startsWith(start) && p.length > start.length),
      ),
    )
    .map(([name]) => name);
