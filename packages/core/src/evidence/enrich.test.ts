// The pure enrich of a JUnit XML file (SR-029, evidence/enrich.ts): the bytes in, the bytes out, with
// an injected resolver and injected current versions. The command on a workspace is tested in
// commands/evidence/enrichJunit.test.ts, the CLI in packages/cli/test/e2e/evidence-enrich-junit.test.ts.
import { describe, expect, it, vi } from "vitest";
import type {
  EnrichOptions,
  EnrichResult,
  Intended,
  RefResolution,
  VariantLookup,
  VersionLookup,
} from "./enrich.js";
import { checkReadBack, enrichJunitBytes, escapeAttribute, escapeText, readsBackAs } from "./enrich.js";
import { readJunitRecords } from "./junit.js";
import { junitTestCases } from "./junit-model.js";
import { nameMatcher, parseNamePattern } from "./name-pattern.js";

const LOGIN = "0b9e7a3c-1d2f-4a5b-8c6d-825b7146fb54";
const REPORT = "93000000-0000-4000-8000-0000000b0036";
const LOG = "93000000-0000-4000-8000-0000000c0037";
const SPEC = "29000000-0000-4000-8000-0000000d0038";
/** An element whose current version cannot be computed. */
const BROKEN = "29000000-0000-4000-8000-0000000e0039";

const V = {
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

const resolve = (ref: string): RefResolution => {
  const id = NAMES[ref] ?? NAMES[ref.toLowerCase()];
  if (id !== undefined) {
    return { kind: "found", id };
  }
  return ref === "SR-dup" || ref === "SR-aaaaaa" || ref === "dup"
    ? { kind: "ambiguous", candidates: [`${LOGIN} in system/a.md`, `${REPORT} in system/b.md`] }
    : { kind: "unknown" };
};

const versionsOf = (ids: readonly string[]): Promise<ReadonlyMap<string, VersionLookup>> =>
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

const DATE = "2026-10-27T10:00:00Z";

/** A compiled name pattern with the prefixes SR and VAR. */
const pattern = (text: string): EnrichOptions["namePattern"] =>
  nameMatcher(parseNamePattern(text), ["SR", "VAR"]);

/** Two variants: Coast by short ID, identifier `coast` or UUID (any case), Mountain by short ID or UUID. */
const COAST = "29000000-0000-4000-8000-0000000aaaaa";
const MOUNTAIN = "29000000-0000-4000-8000-0000000bbbbb";
const VARIANTS: Readonly<Record<string, string>> = {
  "VAR-0aaaaa": COAST,
  coast: COAST,
  [COAST]: COAST,
  "VAR-0bbbbb": MOUNTAIN,
  [MOUNTAIN]: MOUNTAIN,
  core: "core",
};

/** The given views of Coast and the core, as the command passes them. */
const GIVEN_COAST = { id: COAST, name: "VAR-0aaaaa" } as const;
const GIVEN_MOUNTAIN = { id: MOUNTAIN, name: "VAR-0bbbbb" } as const;
const GIVEN_CORE = { id: "core", name: "core" } as const;

const resolveVariant = (ref: string): VariantLookup => {
  const id = VARIANTS[ref] ?? VARIANTS[ref.toLowerCase()];
  return id === undefined ? { kind: "invalid", reason: `no variant is "${ref}"` } : { kind: "view", id };
};

/**
 * Coast excludes SR-0b0036 (REPORT), SR-0c0037 (LOG) holds only in a variant, SR-036 (SPEC) only in
 * Mountain (like SR-145 in one variant); everything else counts everywhere.
 */
const outOfVariant = (id: string, view: string): string | undefined => {
  if (id === REPORT && view === COAST) {
    return "SR-0b0036 is excluded in VAR-0aaaaa";
  }
  if (id === SPEC && view !== MOUNTAIN) {
    return `SR-036 does not apply in ${view === COAST ? "VAR-0aaaaa" : view}`;
  }
  return id === LOG && view === "core" ? "SR-0c0037 does not apply in core" : undefined;
};

const options = (more: Partial<EnrichOptions> = {}): EnrichOptions => ({
  resolve,
  typePrefixes: ["SR", "N"],
  versionsOf,
  item: "build-1",
  date: DATE,
  now: () => new Date("2026-10-27T18:00:00.000Z"),
  name: "results.xml",
  file: "results/results.xml",
  resolveVariant,
  outOfVariant,
  ...more,
});

const enrich = (xml: string | Uint8Array, more: Partial<EnrichOptions> = {}): Promise<EnrichResult> =>
  enrichJunitBytes(typeof xml === "string" ? Buffer.from(xml, "utf8") : xml, options(more));

const text = (result: EnrichResult): string => Buffer.from(result.bytes).toString("utf8");

/** `<testsuites><testsuite …>` + test cases + the end tags. */
const suite = (cases: string, attributes = ""): string =>
  `<testsuites><testsuite name="s"${attributes}>${cases}</testsuite></testsuites>`;

const prop = (name: string, value: string): string => `<property name="${name}" value="${value}"/>`;

/** The four properties enrich writes for one element, as one string. */
const four = (id: string, version: string, item = "build-1", date = DATE): string =>
  prop("reqseq:element", id) +
  prop("reqseq:version", version) +
  prop("reqseq:item", item) +
  prop("reqseq:date", date);

/** Each test case with its `reqseq:*` properties as `name=value`, in file order. */
const properties = (bytes: Uint8Array): Record<string, string[]> => {
  const read = junitTestCases(bytes);
  if (read.kind !== "junit") {
    throw new Error(`expected JUnit, got ${read.kind}`);
  }
  return Object.fromEntries(
    read.file.testCases.map((t) => [
      t.name,
      t.properties.filter((p) => p.name.startsWith("reqseq:")).map((p) => `${p.name}=${p.value}`),
    ]),
  );
};

/** The test cases that hold all four properties (UUID, version, item, date). */
const enrichedNames = (bytes: Uint8Array): string[] =>
  Object.entries(properties(bytes))
    .filter(([, list]) =>
      ["reqseq:element=", "reqseq:version=", "reqseq:item=", "reqseq:date="].every((start) =>
        list.some((p) => p.startsWith(start) && p.length > start.length),
      ),
    )
    .map(([name]) => name);

describe("SR-029: enriching JUnit XML (pure)", () => {
  it("[SR-029/AK1] adds UUID, version, item and date to a test case that names only a short ID", async () => {
    const xml = suite(
      '<testcase classname="c" name="[SR-46fb54] logs in"/>' +
        '<testcase classname="c" name="by property"><properties><property name="reqseq:element" value="SR-0b0036"/></properties></testcase>' +
        '<testcase classname="c" name="names nothing"/>',
    );
    const result = await enrich(xml, { item: "build-512" });
    expect(result).toMatchObject({ changed: true, testCases: 2, unknown: [], problems: [] });
    // Every test case that names a requirement has all four, and no other one has any.
    expect(enrichedNames(result.bytes)).toEqual(["[SR-46fb54] logs in", "by property"]);
    expect(properties(result.bytes)).toEqual({
      "[SR-46fb54] logs in": [
        `reqseq:element=${LOGIN}`,
        `reqseq:version=${V[LOGIN]}`,
        "reqseq:item=build-512",
        `reqseq:date=${DATE}`,
      ],
      "by property": [
        `reqseq:element=${REPORT}`,
        `reqseq:version=${V[REPORT]}`,
        "reqseq:item=build-512",
        `reqseq:date=${DATE}`,
      ],
      "names nothing": [],
    });
  });

  it("[SR-029/AK2] lists a test case whose short ID names no element and leaves it unchanged", async () => {
    const unknownCase = '<testcase classname="c" name="[SR-ffffff] names no element"/>';
    const xml = suite(`\n${unknownCase}\n<testcase name="[SR-46fb54] logs in"/>`);
    const result = await enrich(xml, { unknownNote: "; the workspace is incomplete" });
    expect(result.unknown).toEqual([
      { testCase: "[SR-ffffff] names no element", className: "c", line: 2, ref: "SR-ffffff" },
    ]);
    expect(result.problems).toEqual([
      {
        code: "evidence.unknown-element",
        severity: "error",
        file: "results/results.xml",
        line: 2,
        message:
          'Test case "[SR-ffffff] names no element" (line 2): no element has the reference "SR-ffffff"; the workspace is incomplete',
      },
    ]);
    expect(text(result)).toContain(`\n${unknownCase}\n`);
    expect(result.testCases).toBe(1);
    expect(enrichedNames(result.bytes)).toEqual(["[SR-46fb54] logs in"]);
  });

  it("[SR-029/AK3] the JUnit reader assigns every test case of an enriched file to its requirements", async () => {
    // The round trip of the ThomasBirkmaier/ReqSeq-archive#41 comment: a test case named by a name token and a property, and one
    // that names two requirements.
    const xml = suite(
      '<testcase classname="c" name="[SR-46fb54] logs in"><properties><property name="reqseq:element" value="SR-46fb54"/></properties></testcase>' +
        '<testcase classname="c" name="[SR-0b0036] [SR-0c0037] reports a failure"><failure/></testcase>',
    );
    const result = await enrich(xml);
    const read = readJunitRecords({ repository: "system", file: "results.xml" }, result.bytes);
    expect(read.problems).toBeUndefined();
    expect(read.records.map((r) => [r.testCase, r.element, r.version, r.item, r.date, r.result])).toEqual([
      ["[SR-46fb54] logs in", LOGIN, V[LOGIN], "build-1", DATE, "passed"],
      ["[SR-0b0036] [SR-0c0037] reports a failure", REPORT, V[REPORT], "build-1", DATE, "failed"],
      ["[SR-0b0036] [SR-0c0037] reports a failure", LOG, V[LOG], "build-1", DATE, "failed"],
    ]);
  });

  it("[SR-029/AK4] counts the test cases that name no element, apart from the listed, refused and kept ones", async () => {
    const xml = suite(
      '<testcase name="names nothing"/><testcase name="test_add[1-2]"/><testcase name="skipped"><skipped/></testcase>' +
        '<testcase name="[SR-ffffff] unknown"/><testcase name="[SR-46fb54] enriched"/>' +
        `<testcase name="kept"><properties>${four(LOGIN, V[LOGIN])}</properties></testcase>` +
        `<testcase name="[SR-46fb54] other variant"><properties>${prop("reqseq:variant", "nowhere")}</properties></testcase>`,
    );
    const result = await enrich(xml);
    // Three without reference (a parameter list and a skipped test case among them); the unknown one is
    // listed, the kept one (D-026) and the enriched one count in testCases, the refused one nowhere.
    expect(result).toMatchObject({ testCases: 2, withoutReference: 3 });
    expect(result.unknown.map((u) => u.testCase)).toEqual(["[SR-ffffff] unknown"]);
    expect(result.problems.map((p) => p.code)).toEqual([
      "evidence.unknown-element",
      "evidence.invalid-record",
    ]);
  });

  it("[SR-029/AK5] assigns test cases through a name pattern and enriches them as in AK1, which the reader reads back", async () => {
    const xml = suite(
      '<testcase classname="tests" name="tests::sr_46fb54_ak1_max_mass"/>' +
        '<testcase classname="tests" name="tests::SR_0B0036_AK2_and_sr_0c0037_ak1"/>' +
        '<testcase classname="tests" name="tests::no_requirement"/>',
    );
    const result = await enrich(xml, { namePattern: pattern("{prefix}_{id}_ak{ak}") });
    expect(result).toMatchObject({
      changed: true,
      testCases: 2,
      withoutReference: 1,
      unknown: [],
      problems: [],
    });
    expect(properties(result.bytes)["tests::sr_46fb54_ak1_max_mass"]).toEqual([
      `reqseq:element=${LOGIN}`,
      `reqseq:version=${V[LOGIN]}`,
      `reqseq:criterion=${LOGIN}:1`,
      "reqseq:item=build-1",
      `reqseq:date=${DATE}`,
    ]);
    const read = readJunitRecords({ repository: "system", file: "results.xml" }, result.bytes);
    expect(read.problems).toBeUndefined();
    expect(read.records.map((r) => [r.testCase, r.element, r.version])).toEqual([
      ["tests::sr_46fb54_ak1_max_mass", LOGIN, V[LOGIN]],
      ["tests::SR_0B0036_AK2_and_sr_0c0037_ak1", REPORT, V[REPORT]],
      ["tests::SR_0B0036_AK2_and_sr_0c0037_ak1", LOG, V[LOG]],
    ]);
  });

  it("counts an element that the pattern, the brackets and a property name once, and reports a pattern match that names no element or several", async () => {
    const xml = suite(
      `<testcase name="[SR-46fb54] sr_46fb54_ak1"><properties>${prop("reqseq:element", LOGIN)}</properties></testcase>` +
        '<testcase classname="k" name="sr_ffffff_ak1 unknown"/><testcase name="sr_aaaaaa_ak2 ambiguous"/>' +
        '<testcase name="test_parse[sr_ffffff_ak1] is test data"/>',
    );
    const result = await enrich(xml, { namePattern: pattern("{prefix}_{id}_ak{ak}") });
    expect(properties(result.bytes)["[SR-46fb54] sr_46fb54_ak1"]).toEqual([
      `reqseq:element=${LOGIN}`,
      `reqseq:version=${V[LOGIN]}`,
      "reqseq:item=build-1",
      `reqseq:date=${DATE}`,
    ]);
    expect(result).toMatchObject({ testCases: 1, withoutReference: 1 });
    expect(result.unknown).toEqual([
      { testCase: "sr_ffffff_ak1 unknown", className: "k", line: 1, ref: "SR-ffffff" },
      { testCase: "sr_aaaaaa_ak2 ambiguous", line: 1, ref: "SR-aaaaaa" },
    ]);
    expect(result.problems.map((p) => [p.code, p.message])).toEqual([
      [
        "evidence.unknown-element",
        'Test case "sr_ffffff_ak1 unknown" (line 1): no element has the reference "SR-ffffff" (read as "sr_ffffff_ak1" by the name pattern)',
      ],
      [
        "evidence.ambiguous-element",
        expect.stringContaining(
          '"SR-aaaaaa" (read as "sr_aaaaaa_ak2" by the name pattern) names more than one element',
        ),
      ],
    ]);
  });

  it("keeps every byte outside the written properties: BOM, CRLF, comments, CDATA, non-ASCII", async () => {
    const head =
      '﻿<?xml version="1.0" encoding="UTF-8"?>\r\n<!-- Grüße -->\r\n<testsuites>\r\n  <testsuite name="Prüfung">\r\n';
    const body =
      '    <testcase name="[SR-46fb54] prüft"><system-out><![CDATA[a <b> & c]]></system-out></testcase>\r\n';
    const tail = "  </testsuite>\r\n</testsuites>\r\n";
    const result = await enrich(head + body + tail);
    expect(text(result)).toBe(
      head +
        `    <testcase name="[SR-46fb54] prüft"><properties>${four(LOGIN, V[LOGIN])}</properties><system-out><![CDATA[a <b> & c]]></system-out></testcase>\r\n` +
        tail,
    );
  });

  it("writes into each place a test case offers: an existing block (inline or on lines), an empty block, a new block, a self-closing test case", async () => {
    const result = await enrich(
      suite(
        `<testcase name="inline [SR-46fb54]"><properties><property name="other" value="x"/></properties></testcase>` +
          `<testcase name="empty [SR-46fb54]"><properties/></testcase>` +
          `<testcase name="none [SR-46fb54]"><system-out/></testcase>` +
          `<testcase name="closed [SR-46fb54]"/>` +
          `\n<testcase name="lines [SR-46fb54]">\n  <properties>\n    <property name="other" value="x"/>\n  </properties>\n</testcase>` +
          `\r\n<testcase name="crlf [SR-46fb54]">\r\n\t<properties>\r\n\t\t<property name="other" value="x"/>\r\n\t</properties>\r\n</testcase>` +
          `<testcase name="spaces only [SR-46fb54]"><properties>  </properties></testcase>`,
      ),
    );
    const w = four(LOGIN, V[LOGIN]);
    const lines = (eol: string, indent: string): string =>
      [
        prop("reqseq:element", LOGIN),
        prop("reqseq:version", V[LOGIN]),
        prop("reqseq:item", "build-1"),
        prop("reqseq:date", DATE),
      ]
        .map((p) => eol + indent + p)
        .join("");
    expect(text(result)).toBe(
      suite(
        `<testcase name="inline [SR-46fb54]"><properties><property name="other" value="x"/>${w}</properties></testcase>` +
          `<testcase name="empty [SR-46fb54]"><properties>${w}</properties></testcase>` +
          `<testcase name="none [SR-46fb54]"><properties>${w}</properties><system-out/></testcase>` +
          `<testcase name="closed [SR-46fb54]"><properties>${w}</properties></testcase>` +
          `\n<testcase name="lines [SR-46fb54]">\n  <properties>\n    <property name="other" value="x"/>${lines("\n", "    ")}\n  </properties>\n</testcase>` +
          `\r\n<testcase name="crlf [SR-46fb54]">\r\n\t<properties>\r\n\t\t<property name="other" value="x"/>${lines("\r\n", "\t\t")}\r\n\t</properties>\r\n</testcase>` +
          `<testcase name="spaces only [SR-46fb54]"><properties>  ${w}</properties></testcase>`,
      ),
    );
    expect(result.testCases).toBe(7);
  });

  it("puts a new element right after the last existing reqseq:element, on its own line in a block on lines", async () => {
    const xml = suite(
      '\n<testcase name="[SR-0b0036] two">\n  <properties>\n    <property name="reqseq:element" value="SR-46fb54"/>\n    <property name="other" value="x"/>\n  </properties>\n</testcase>',
    );
    const result = await enrich(xml);
    expect(text(result)).toBe(
      suite(
        `\n<testcase name="[SR-0b0036] two">\n  <properties>\n    ${prop("reqseq:element", LOGIN)}\n    ${prop("reqseq:element", REPORT)}\n    <property name="other" value="x"/>` +
          `\n    ${prop("reqseq:version", V[LOGIN])}\n    ${prop("reqseq:version", V[REPORT])}\n    ${prop("reqseq:item", "build-1")}\n    ${prop("reqseq:date", DATE)}\n  </properties>\n</testcase>`,
      ),
    );
    // When the last element is the last property, the new element still comes before the versions.
    const last = await enrich(
      suite(
        `<testcase name="[SR-0b0036] two"><properties>${prop("reqseq:element", "SR-46fb54")}</properties></testcase>`,
      ),
    );
    expect(text(last)).toBe(
      suite(
        `<testcase name="[SR-0b0036] two"><properties>${prop("reqseq:element", LOGIN)}${prop("reqseq:element", REPORT)}` +
          `${prop("reqseq:version", V[LOGIN])}${prop("reqseq:version", V[REPORT])}${prop("reqseq:item", "build-1")}${prop("reqseq:date", DATE)}</properties></testcase>`,
      ),
    );
  });

  it("replaces existing reqseq:element, reqseq:item and reqseq:date in place, in their quoting, never twice", async () => {
    const xml = suite(
      `<testcase name="t"><properties>` +
        `<property name='reqseq:element' value='${LOGIN.toUpperCase()}'/>` +
        `<property name="reqseq:item">old &amp; gone</property>` +
        `<property name="reqseq:date"/>` +
        `</properties></testcase>`,
    );
    const result = await enrich(xml, { item: `it's "new"` });
    expect(text(result)).toBe(
      suite(
        `<testcase name="t"><properties>` +
          `<property name='reqseq:element' value='${LOGIN}'/>` +
          `<property name="reqseq:item">it's "new"</property>` +
          prop("reqseq:date", DATE) +
          prop("reqseq:version", V[LOGIN]) +
          `</properties></testcase>`,
      ),
    );
    // In single quotes, a single quote is escaped.
    const quoted = await enrich(
      suite(
        `<testcase name="[SR-46fb54]"><properties><property name='reqseq:item' value='x'/></properties></testcase>`,
      ),
      { item: `it's` },
    );
    expect(text(quoted)).toContain(`<property name='reqseq:item' value='it&apos;s'/>`);
    // A value that is already right is left as it is.
    const same = await enrich(
      suite(
        `<testcase name="t"><properties>${prop("reqseq:element", LOGIN)}${prop("reqseq:item", "build-1")}</properties></testcase>`,
      ),
    );
    expect(text(same)).toBe(
      suite(
        `<testcase name="t"><properties>${prop("reqseq:element", LOGIN)}${prop("reqseq:item", "build-1")}${prop("reqseq:version", V[LOGIN])}${prop("reqseq:date", DATE)}</properties></testcase>`,
      ),
    );
  });

  it("replaces existing properties in place whatever order they stand in", async () => {
    const xml = suite(
      `<testcase name="t"><properties>` +
        prop("reqseq:date", "2020-01-01T00:00:00Z") +
        prop("reqseq:item", "old") +
        prop("reqseq:element", "SR-46fb54") +
        `</properties></testcase>`,
    );
    expect(text(await enrich(xml))).toBe(
      suite(
        `<testcase name="t"><properties>` +
          prop("reqseq:date", DATE) +
          prop("reqseq:item", "build-1") +
          prop("reqseq:element", LOGIN) +
          prop("reqseq:version", V[LOGIN]) +
          `</properties></testcase>`,
      ),
    );
  });

  it("gives the same bytes when a file is enriched twice", async () => {
    const first = await enrich(
      suite('<testcase name="[SR-46fb54] a"/><testcase name="[SR-0b0036] [SR-0c0037] b"/>'),
    );
    const second = await enrich(first.bytes);
    expect(second).toMatchObject({ changed: false, testCases: 2, problems: [] });
    expect(second.bytes).toBe(first.bytes);
  });

  it("keeps the version, item and date of an enriched test case when enriched again with another item, and gives evidence.outdated when its version is no longer current", async () => {
    const enriched = suite(
      `<testcase name="[SR-0c0037] kept">` +
        `<properties>${four(LOGIN, "n1:0000000000000000", "build-1", "2026-10-01T10:00:00Z")}</properties></testcase>` +
        `<testcase name="current"><properties>${four(REPORT, V[REPORT])}</properties></testcase>`,
    );
    const result = await enrich(enriched, { item: "build-2", date: "2026-10-27T12:00:00Z" });
    expect(result.changed).toBe(false);
    expect(text(result)).toBe(enriched);
    expect(result.testCases).toBe(2);
    expect(result.problems).toEqual([
      {
        code: "evidence.outdated",
        severity: "warning",
        file: "results/results.xml",
        line: 1,
        elementId: LOGIN,
        storedVersion: "n1:0000000000000000",
        currentVersion: V[LOGIN],
        message:
          'Test case "[SR-0c0037] kept" (line 1) is enriched already with version n1:0000000000000000, which is no longer current; it is kept (D-026: the version it was tested against)',
      },
    ]);
  });

  it("keeps an enriched test case of the current version in normal form 2 without evidence.outdated (ADR-0005)", async () => {
    const enriched = suite(
      `<testcase name="n2"><properties>${four(REPORT, `n2:${V[REPORT].slice(3)}`)}</properties></testcase>`,
    );
    const result = await enrich(enriched, { item: "build-2", date: "2026-10-27T12:00:00Z" });
    expect(result).toMatchObject({ changed: false, testCases: 1, problems: [] });
  });

  it("reports an enriched test case the reader rejects, and one whose UUID names no element or several, and changes neither", async () => {
    const other = "29000000-0000-4000-8000-0000000f0040";
    const xml = suite(
      `<testcase name="no item"><properties>${prop("reqseq:element", LOGIN)}${prop("reqseq:version", V[LOGIN])}${prop("reqseq:date", DATE)}</properties></testcase>` +
        `<testcase name="gone"><properties>${four(other, V[LOGIN])}</properties></testcase>` +
        `<testcase name="current"><properties>${four(BROKEN, V[LOGIN])}</properties></testcase>`,
    );
    const ambiguous: EnrichOptions["resolve"] = (ref) =>
      ref === BROKEN ? { kind: "ambiguous", candidates: [] } : resolve(ref);
    const result = await enrich(xml, { resolve: ambiguous });
    expect(result.changed).toBe(false);
    expect(result.testCases).toBe(2);
    expect(result.problems.map((p) => [p.code, p.severity, p.targetId])).toEqual([
      ["evidence.invalid-record", "error", undefined],
      ["evidence.unknown-element", "warning", other],
      ["evidence.ambiguous-element", "warning", BROKEN],
    ]);
    expect(result.problems[0]?.message).toBe(
      'Test case "no item" (line 1) is not enriched: reqseq:item is missing',
    );
    expect(result.problems[1]?.message).toContain("which the workspace does not have; it is kept as it is");
    expect(result.problems[2]?.message).toContain("which several files share");
  });

  it("gives a repeated reqseq:element its own version, and counts a name token and a property that name one element once", async () => {
    const result = await enrich(
      suite(
        `<testcase name="[SR-46fb54] [${LOGIN.toUpperCase()}] twice"><properties>${prop("reqseq:element", "SR-46fb54")}${prop("reqseq:element", LOGIN)}</properties></testcase>`,
      ),
    );
    expect(properties(result.bytes)).toEqual({
      [`[SR-46fb54] [${LOGIN.toUpperCase()}] twice`]: [
        `reqseq:element=${LOGIN}`,
        `reqseq:element=${LOGIN}`,
        `reqseq:version=${V[LOGIN]}`,
        `reqseq:version=${V[LOGIN]}`,
        "reqseq:item=build-1",
        `reqseq:date=${DATE}`,
      ],
    });
  });

  it("stays silent on parameter lists and counts another name token only when it names exactly one element", async () => {
    const xml = suite(
      '<testcase name="test_add[1-2]"><properties><property name="x" value="1"/></properties></testcase><testcase name="adds [1, 2]"/><testcase name="[dup] ambiguous identifier"/>' +
        '<testcase name="[SR-036] by identifier"/><testcase name="[SR-036/AK2] by identifier and criterion"/>',
    );
    const result = await enrich(xml);
    expect(result).toMatchObject({ testCases: 2, unknown: [], problems: [] });
    expect(enrichedNames(result.bytes)).toEqual([
      "[SR-036] by identifier",
      "[SR-036/AK2] by identifier and criterion",
    ]);
    expect(properties(result.bytes)["[SR-036] by identifier"]).toContain(`reqseq:element=${SPEC}`);
  });

  it("stays silent on a pytest parameter that looks like a UUID or a short ID of no type and names nothing, and counts one that names one (#358)", async () => {
    const xml = suite(
      '<testcase name="test_get[0b9e7a3c-1d2f-4a5b-8c6d-000000000000]"/><testcase name="test_id[A-123456]"/>' +
        `<testcase name="test_login[${LOGIN}]"/><testcase name="test_named[SR-46fb54]"/>`,
    );
    const result = await enrich(xml);
    expect(result).toMatchObject({ testCases: 2, withoutReference: 2, unknown: [], problems: [] });
    expect(enrichedNames(result.bytes)).toEqual([`test_login[${LOGIN}]`, "test_named[SR-46fb54]"]);
    // A glued short ID with a type prefix is a typo in a pytest ID (SR-029 AK2): reported, as is any
    // token with a space before its bracket.
    const typo = await enrich(
      suite('<testcase name="test_x[SR-ffffff]"/><testcase name="test_id [A-123456]"/>'),
    );
    expect(typo.unknown).toEqual([
      { testCase: "test_x[SR-ffffff]", line: 1, ref: "SR-ffffff" },
      { testCase: "test_id [A-123456]", line: 1, ref: "A-123456" },
    ]);
  });

  it("reports a property that names no element or several, an empty one, and an ambiguous short ID in the name", async () => {
    const xml = suite(
      `<testcase classname="k" name="typo"><properties>${prop("reqseq:element", "SR-0366")}</properties></testcase>` +
        `<testcase name="identifier of two"><properties>${prop("reqseq:element", "dup")}</properties></testcase>` +
        `<testcase name="empty"><properties>${prop("reqseq:element", " ")}</properties></testcase>` +
        `<testcase name="[SR-aaaaaa] [SR-46fb54] short"/>` +
        `<testcase name="[SR-ffffff] twice"><properties>${prop("reqseq:element", "SR-ffffff")}</properties></testcase>`,
    );
    const result = await enrich(xml);
    expect(result.changed).toBe(false);
    expect(result.testCases).toBe(0);
    expect(result.unknown).toEqual([
      { testCase: "typo", className: "k", line: 1, ref: "SR-0366" },
      { testCase: "identifier of two", line: 1, ref: "dup" },
      { testCase: "empty", line: 1, ref: "" },
      { testCase: "[SR-aaaaaa] [SR-46fb54] short", line: 1, ref: "SR-aaaaaa" },
      { testCase: "[SR-ffffff] twice", line: 1, ref: "SR-ffffff" },
    ]);
    expect(result.problems.map((p) => [p.code, p.message])).toEqual([
      ["evidence.unknown-element", 'Test case "typo" (line 1): no element has the reference "SR-0366"'],
      [
        "evidence.ambiguous-element",
        `Test case "identifier of two" (line 1): "dup" names more than one element (${LOGIN} in system/a.md, ${REPORT} in system/b.md); give the full UUID`,
      ],
      [
        "evidence.unknown-element",
        'Test case "empty" (line 1): no element has the reference an empty reqseq:element property',
      ],
      ["evidence.ambiguous-element", expect.stringContaining('"SR-aaaaaa" names more than one element')],
      [
        "evidence.unknown-element",
        'Test case "[SR-ffffff] twice" (line 1): no element has the reference "SR-ffffff"',
      ],
    ]);
  });

  it("reports an element without a current version and leaves its test case unchanged", async () => {
    const xml = suite('<testcase name="[SR-0e0039] [SR-46fb54] broken"/>');
    const lacking = (ids: readonly string[]): Promise<ReadonlyMap<string, VersionLookup>> =>
      versionsOf(ids.filter((id) => id !== LOGIN));
    const result = await enrich(xml, { versionsOf: lacking });
    expect(result).toMatchObject({ changed: false, testCases: 0, unknown: [] });
    expect(result.problems.map((p) => [p.code, p.elementId, p.message])).toEqual([
      [
        "file.faulty",
        BROKEN,
        `Test case "[SR-0e0039] [SR-46fb54] broken" (line 1) is not enriched: element ${BROKEN} has no current version (a value that counts has no normal form)`,
      ],
      [
        "file.faulty",
        LOGIN,
        `Test case "[SR-0e0039] [SR-46fb54] broken" (line 1) is not enriched: element ${LOGIN} has no current version (it is not in the workspace)`,
      ],
    ]);
  });

  it("reports an existing reqseq:variant that names no variant, and keeps valid ones, several views and the core among them", async () => {
    const variant = COAST;
    const xml = suite(
      `<testcase name="[SR-46fb54] a"><properties>${prop("reqseq:variant", "VAR-1")}</properties></testcase>` +
        `<testcase name="[SR-46fb54] b"><properties>${prop("reqseq:variant", variant)}${prop("reqseq:variant", MOUNTAIN)}${prop("reqseq:variant", "Core")}</properties></testcase>` +
        `<testcase name="[SR-46fb54] c"><properties>${prop("reqseq:variant", variant.toUpperCase())}</properties></testcase>`,
    );
    const result = await enrich(xml);
    expect(result.problems.map((p) => [p.code, p.message])).toEqual([
      [
        "evidence.invalid-record",
        'Test case "[SR-46fb54] a" (line 1) is not enriched: reqseq:variant "VAR-1" names no variant: no variant is "VAR-1"',
      ],
    ]);
    // A hand-written `core` stays as it is: the reader takes it in any case.
    expect(properties(result.bytes)["[SR-46fb54] b"]?.filter((p) => p.startsWith("reqseq:variant="))).toEqual(
      [`reqseq:variant=${COAST}`, `reqseq:variant=${MOUNTAIN}`, "reqseq:variant=Core"],
    );
    const read = readJunitRecords({ repository: "system", file: "results.xml" }, result.bytes);
    expect(read.records.map((r) => [r.testCase, r.variant])).toEqual([
      ["[SR-46fb54] b", variant],
      ["[SR-46fb54] b", MOUNTAIN],
      ["[SR-46fb54] b", undefined],
      ["[SR-46fb54] c", variant],
    ]);
  });

  it("reports a reqseq:variant that holds more than a UUID", async () => {
    const variant = COAST;
    const xml = suite(
      `<testcase name="[SR-46fb54] a"><properties>${prop("reqseq:variant", `x${variant}`)}</properties></testcase>` +
        `<testcase name="[SR-46fb54] b"><properties>${prop("reqseq:variant", `${variant}x`)}</properties></testcase>`,
    );
    const result = await enrich(xml);
    expect(result.problems.map((p) => p.message)).toEqual([
      `Test case "[SR-46fb54] a" (line 1) is not enriched: reqseq:variant "x${variant}" names no variant: no variant is "x${variant}"`,
      `Test case "[SR-46fb54] b" (line 1) is not enriched: reqseq:variant "${variant}x" names no variant: no variant is "${variant}x"`,
    ]);
    expect(result.changed).toBe(false);
  });

  it("writes the given variant into each enriched test case, after the version, and keeps one that names it already (AK6)", async () => {
    const xml = suite(
      `<testcase name="[SR-46fb54] a"/>` +
        `<testcase name="[SR-46fb54] b"><properties>${prop("reqseq:variant", COAST.toUpperCase())}</properties></testcase>` +
        `<testcase name="names nothing"/>`,
    );
    const result = await enrich(xml, { views: [GIVEN_COAST] });
    expect(result.problems).toEqual([]);
    expect(text(result)).toBe(
      suite(
        `<testcase name="[SR-46fb54] a"><properties>${prop("reqseq:element", LOGIN)}${prop("reqseq:version", V[LOGIN])}${prop("reqseq:variant", COAST)}${prop("reqseq:item", "build-1")}${prop("reqseq:date", DATE)}</properties></testcase>` +
          `<testcase name="[SR-46fb54] b"><properties>${prop("reqseq:variant", COAST.toUpperCase())}${prop("reqseq:element", LOGIN)}${prop("reqseq:version", V[LOGIN])}${prop("reqseq:item", "build-1")}${prop("reqseq:date", DATE)}</properties></testcase>` +
          `<testcase name="names nothing"/>`,
      ),
    );
    const read = readJunitRecords({ repository: "system", file: "results.xml" }, result.bytes);
    expect(read.records.map((r) => r.variant)).toEqual([COAST, COAST]);
  });

  it("writes nothing for the given core, and leaves a test case without variant in the core", async () => {
    const xml = suite(`<testcase name="[SR-46fb54] a"/>`);
    const result = await enrich(xml, { views: [GIVEN_CORE] });
    expect(text(result)).toBe(
      suite(`<testcase name="[SR-46fb54] a"><properties>${four(LOGIN, V[LOGIN])}</properties></testcase>`),
    );
  });

  it("[SR-029/AK6] writes one reqseq:variant per given view, the core among them, and keeps or rewrites those named already", async () => {
    const xml = suite(
      `<testcase name="[SR-46fb54] a"/>` +
        `<testcase name="[SR-46fb54] b"><properties>${prop("reqseq:variant", "VAR-0aaaaa")}${prop("reqseq:variant", "core")}</properties></testcase>`,
    );
    const result = await enrich(xml, { views: [GIVEN_CORE, GIVEN_COAST, GIVEN_MOUNTAIN] });
    expect(result.problems).toEqual([]);
    expect(text(result)).toBe(
      suite(
        `<testcase name="[SR-46fb54] a"><properties>${prop("reqseq:element", LOGIN)}${prop("reqseq:version", V[LOGIN])}${prop("reqseq:variant", "core")}${prop("reqseq:variant", COAST)}${prop("reqseq:variant", MOUNTAIN)}${prop("reqseq:item", "build-1")}${prop("reqseq:date", DATE)}</properties></testcase>` +
          `<testcase name="[SR-46fb54] b"><properties>${prop("reqseq:variant", COAST)}${prop("reqseq:variant", "core")}${prop("reqseq:element", LOGIN)}${prop("reqseq:version", V[LOGIN])}${prop("reqseq:variant", MOUNTAIN)}${prop("reqseq:item", "build-1")}${prop("reqseq:date", DATE)}</properties></testcase>`,
      ),
    );
    const read = readJunitRecords({ repository: "system", file: "results.xml" }, result.bytes);
    expect(read.records.map((r) => [r.testCase, r.variant])).toEqual([
      ["[SR-46fb54] a", undefined],
      ["[SR-46fb54] a", COAST],
      ["[SR-46fb54] a", MOUNTAIN],
      ["[SR-46fb54] b", COAST],
      ["[SR-46fb54] b", undefined],
      ["[SR-46fb54] b", MOUNTAIN],
    ]);
    // The core given with one variant needs its property: without one the test case would be for the core alone.
    const two = await enrich(suite(`<testcase name="[SR-46fb54] a"/>`), { views: [GIVEN_COAST, GIVEN_CORE] });
    expect(properties(two.bytes)["[SR-46fb54] a"]?.filter((p) => p.startsWith("reqseq:variant="))).toEqual([
      `reqseq:variant=${COAST}`,
      "reqseq:variant=core",
    ]);
  });

  it("turns each reqseq:variant that names a variant by short ID or identifier into its UUID (AK7)", async () => {
    const xml = suite(
      `<testcase name="[SR-46fb54] a"><properties>${prop("reqseq:variant", "VAR-0aaaaa")}${prop("reqseq:variant", " coast ")}</properties></testcase>`,
    );
    const result = await enrich(xml);
    expect(result.problems).toEqual([]);
    expect(text(result)).toBe(
      suite(
        `<testcase name="[SR-46fb54] a"><properties>${prop("reqseq:variant", COAST)}${prop("reqseq:variant", COAST)}${four(LOGIN, V[LOGIN])}</properties></testcase>`,
      ),
    );
  });

  it("[SR-029/AK8] reports a test case that names a view not among the given ones, the core among them, and leaves it unchanged", async () => {
    const xml = suite(
      `<testcase name="[SR-46fb54] a"><properties>${prop("reqseq:variant", "VAR-0aaaaa")}${prop("reqseq:variant", "VAR-0bbbbb")}</properties></testcase>` +
        `<testcase name="[SR-46fb54] b"><properties>${prop("reqseq:variant", "core")}</properties></testcase>`,
    );
    for (const [views, names] of [
      [[GIVEN_COAST], "VAR-0aaaaa"],
      [[GIVEN_CORE, GIVEN_COAST], "core, VAR-0aaaaa"],
    ] as const) {
      const result = await enrich(xml, { views });
      expect(result.problems.map((p) => [p.code, p.severity, p.message])[0]).toEqual([
        "evidence.invalid-record",
        "error",
        `Test case "[SR-46fb54] a" (line 1) is not enriched: reqseq:variant "VAR-0bbbbb" names a view that is not among the given ones (${names})`,
      ]);
    }
    // A hand-written core outside the given views, too.
    const coast = await enrich(xml, { views: [GIVEN_COAST] });
    expect(coast.problems.map((p) => p.message)[1]).toBe(
      'Test case "[SR-46fb54] b" (line 1) is not enriched: reqseq:variant "core" names a view that is not among the given ones (VAR-0aaaaa)',
    );
    expect(coast.changed).toBe(false);
  });

  it("checks the given core too: an element that does not apply in the core is reported (AK9)", async () => {
    const xml = suite(`<testcase name="[SR-0c0037] a"/><testcase name="[SR-46fb54] b"/>`);
    const result = await enrich(xml, { views: [GIVEN_CORE] });
    expect(result.problems.map((p) => p.message)).toEqual([
      'Test case "[SR-0c0037] a" (line 1) is not enriched: SR-0c0037 does not apply in core',
    ]);
    expect(result.testCases).toBe(1);
  });

  it("reports a kept test case enriched for a view outside the given ones, and keeps it unchanged (AK8)", async () => {
    const kept = (...views: string[]): string =>
      `<testcase name="k"><properties>${four(LOGIN, V[LOGIN])}${views.map((v) => prop("reqseq:variant", v)).join("")}</properties></testcase>`;
    const xml = suite(kept(MOUNTAIN) + kept() + kept(COAST.toUpperCase()) + kept(MOUNTAIN, "core", COAST));
    const result = await enrich(xml, { views: [GIVEN_COAST] });
    expect(result.problems.map((p) => [p.code, p.severity, p.message])).toEqual([
      [
        "evidence.invalid-record",
        "error",
        `Test case "k" (line 1) does not fit: it is enriched already for the variant ${MOUNTAIN}, outside the given views (VAR-0aaaaa); an enriched test case is never changed (D-026: version from the tested state; spec question ThomasBirkmaier/ReqSeq-archive#529 Q5)`,
      ],
      [
        "evidence.invalid-record",
        "error",
        'Test case "k" (line 1) does not fit: it is enriched already for the core, outside the given views (VAR-0aaaaa); an enriched test case is never changed (D-026: version from the tested state; spec question ThomasBirkmaier/ReqSeq-archive#529 Q5)',
      ],
      [
        "evidence.invalid-record",
        "error",
        `Test case "k" (line 1) does not fit: it is enriched already for the variant ${MOUNTAIN} and the core, outside the given views (VAR-0aaaaa); an enriched test case is never changed (D-026: version from the tested state; spec question ThomasBirkmaier/ReqSeq-archive#529 Q5)`,
      ],
    ]);
    expect(result).toMatchObject({ changed: false, testCases: 1 });
    // A subset of the given views fits (AK8): the core of a test case without property among them.
    const subset = await enrich(xml, { views: [GIVEN_MOUNTAIN, GIVEN_CORE, GIVEN_COAST] });
    expect(subset).toMatchObject({ problems: [], testCases: 4 });
  });

  it("reports a kept test case that names an element which does not count in its variant, or the given core (AK9)", async () => {
    const xml = suite(
      `<testcase name="a"><properties>${four(REPORT, V[REPORT])}${prop("reqseq:variant", COAST)}</properties></testcase>` +
        `<testcase name="b"><properties>${four(LOG, V[LOG])}</properties></testcase>` +
        `<testcase name="c"><properties>${four(REPORT, V[REPORT])}${prop("reqseq:variant", "29000000-0000-4000-8000-0000000fffff")}</properties></testcase>`,
    );
    const own = await enrich(xml);
    expect(own.problems.map((p) => p.message)).toEqual([
      'Test case "a" (line 1) does not fit: SR-0b0036 is excluded in VAR-0aaaaa',
    ]);
    const core = await enrich(
      suite(`<testcase name="b"><properties>${four(LOG, V[LOG])}</properties></testcase>`),
      {
        views: [GIVEN_CORE],
      },
    );
    expect(core.problems.map((p) => p.message)).toEqual([
      'Test case "b" (line 1) does not fit: SR-0c0037 does not apply in core',
    ]);
  });

  it("keeps a test case enriched for several views, checks each of its variants, and reports it for a given variant (SR-093 AK5)", async () => {
    const kept = (name: string, id: keyof typeof V, views: readonly string[]): string =>
      `<testcase name="${name}"><properties>${four(id, V[id])}${views.map((v) => prop("reqseq:variant", v)).join("")}</properties></testcase>`;
    const xml = suite(
      kept("both", LOGIN, [COAST, "core", MOUNTAIN]) +
        kept("excluded", REPORT, [MOUNTAIN, COAST]) +
        kept("core only here", LOG, ["Core", MOUNTAIN]) +
        kept("unknown variant", REPORT, ["29000000-0000-4000-8000-0000000fffff", "core"]),
    );
    const own = await enrich(xml);
    // AK9 per view, the core it names among them.
    expect(own.problems.map((p) => p.message)).toEqual([
      'Test case "excluded" (line 1) does not fit: SR-0b0036 is excluded in VAR-0aaaaa',
      'Test case "core only here" (line 1) does not fit: SR-0c0037 does not apply in core',
    ]);
    expect(own).toMatchObject({ changed: false, testCases: 2 });
    const given = await enrich(suite(kept("both", LOGIN, [COAST, "core"]) + kept("one", LOGIN, ["core"])), {
      views: [GIVEN_COAST],
    });
    expect(given.problems.map((p) => p.message)).toEqual([
      'Test case "both" (line 1) does not fit: it is enriched already for the core, outside the given views (VAR-0aaaaa); an enriched test case is never changed (D-026: version from the tested state; spec question ThomasBirkmaier/ReqSeq-archive#529 Q5)',
      'Test case "one" (line 1) does not fit: it is enriched already for the core, outside the given views (VAR-0aaaaa); an enriched test case is never changed (D-026: version from the tested state; spec question ThomasBirkmaier/ReqSeq-archive#529 Q5)',
    ]);
    // A given core fits a kept test case for the core named by property, and checks it (AK9).
    const core = await enrich(suite(kept("log", LOG, ["core"]) + kept("login", LOGIN, ["CORE"])), {
      views: [GIVEN_CORE],
    });
    expect(core.problems.map((p) => p.message)).toEqual([
      'Test case "log" (line 1) does not fit: SR-0c0037 does not apply in core',
    ]);
    expect(core.testCases).toBe(1);
  });

  it("gives no UUID hint for core next to a variant given by short ID", async () => {
    const xml = suite(
      `<testcase name="a"><properties>${four(LOGIN, V[LOGIN])}${prop("reqseq:variant", "core")}${prop("reqseq:variant", "VAR-0aaaaa")}</properties></testcase>`,
    );
    expect((await enrich(xml)).problems.map((p) => p.message)).toEqual([
      `Test case "a" (line 1) is not enriched: reqseq:variant "VAR-0aaaaa" is not a UUID or core; it names the variant ${COAST}: write that UUID, as enrich never changes an enriched test case (D-026: version from the tested state; spec question ThomasBirkmaier/ReqSeq-archive#529 Q5)`,
    ]);
  });

  it("says which UUID to write when a kept test case gives its variant by short ID, and leaves it unchanged", async () => {
    const xml = suite(
      `<testcase name="a"><properties>${four(LOGIN, V[LOGIN])}${prop("reqseq:variant", "VAR-0aaaaa")}</properties></testcase>` +
        `<testcase name="b"><properties>${four(LOGIN, V[LOGIN])}${prop("reqseq:variant", "VAR-1")}</properties></testcase>`,
    );
    const result = await enrich(xml);
    expect(result.problems.map((p) => p.message)).toEqual([
      `Test case "a" (line 1) is not enriched: reqseq:variant "VAR-0aaaaa" is not a UUID or core; it names the variant ${COAST}: write that UUID, as enrich never changes an enriched test case (D-026: version from the tested state; spec question ThomasBirkmaier/ReqSeq-archive#529 Q5)`,
      'Test case "b" (line 1) is not enriched: reqseq:variant "VAR-1" is not a UUID or core',
    ]);
    expect(result.changed).toBe(false);
  });

  it("reports a test case that names an element that does not count in its variant, given or its own, and leaves it unchanged (AK9)", async () => {
    const xml = suite(
      `<testcase name="[SR-46fb54] [SR-0b0036] a"/>` +
        `<testcase name="[SR-0b0036] b"><properties>${prop("reqseq:variant", "coast")}</properties></testcase>` +
        `<testcase name="[SR-0b0036] c"><properties>${prop("reqseq:variant", "VAR-0bbbbb")}</properties></testcase>`,
    );
    const given = await enrich(xml, { views: [GIVEN_COAST] });
    expect(given.problems.map((p) => p.message)).toEqual([
      'Test case "[SR-46fb54] [SR-0b0036] a" (line 1) is not enriched: SR-0b0036 is excluded in VAR-0aaaaa',
      'Test case "[SR-0b0036] b" (line 1) is not enriched: SR-0b0036 is excluded in VAR-0aaaaa',
      'Test case "[SR-0b0036] c" (line 1) is not enriched: reqseq:variant "VAR-0bbbbb" names a view that is not among the given ones (VAR-0aaaaa)',
    ]);
    const own = await enrich(xml);
    expect(own.problems.map((p) => p.message)).toEqual([
      'Test case "[SR-0b0036] b" (line 1) is not enriched: SR-0b0036 is excluded in VAR-0aaaaa',
    ]);
    const read = readJunitRecords({ repository: "system", file: "results.xml" }, own.bytes);
    expect(read.records.map((r) => [r.testCase, r.variant])).toEqual([
      ["[SR-46fb54] [SR-0b0036] a", undefined],
      ["[SR-46fb54] [SR-0b0036] a", undefined],
      ["[SR-0b0036] c", MOUNTAIN],
    ]);
  });

  it("[SR-029/AK11] with skipNotInView leaves out an element that applies in none of the given views, counts it, and enriches the rest", async () => {
    const xml = suite(
      `<testcase name="[SR-46fb54] [SR-036] login and spec"/>` +
        `<testcase name="[SR-036/AK2] spec only"/>` +
        `<testcase name="[SR-0b0036] [SR-0c0037] one view each"/>` +
        `<testcase name="[SR-46fb54] login"/>`,
    );
    const views = [GIVEN_CORE, GIVEN_COAST];
    const result = await enrich(xml, { views, skipNotInView: true });
    expect(result).toMatchObject({
      changed: true,
      problems: [],
      testCases: 3,
      notInView: 2,
      withoutReference: 0,
    });
    const written = properties(result.bytes);
    // SR-036 applies only in Mountain: no element, version or criterion for it; the test case that
    // names nothing else gets only the marks of the given views (AK12).
    expect(written["[SR-46fb54] [SR-036] login and spec"]).toEqual([
      `reqseq:element=${LOGIN}`,
      `reqseq:version=${V[LOGIN]}`,
      "reqseq:variant=core",
      `reqseq:variant=${COAST}`,
      "reqseq:item=build-1",
      `reqseq:date=${DATE}`,
    ]);
    expect(written["[SR-036/AK2] spec only"]).toEqual([
      "reqseq:not-in-view=core",
      `reqseq:not-in-view=${COAST}`,
    ]);
    // Each applies in one of the views: both enriched, each record counts only where it applies.
    expect(written["[SR-0b0036] [SR-0c0037] one view each"]?.slice(0, 2)).toEqual([
      `reqseq:element=${REPORT}`,
      `reqseq:element=${LOG}`,
    ]);
    // Without the option AK9 holds: the test cases stay unchanged and are reported.
    const strict = await enrich(xml, { views });
    expect(strict.problems.map((p) => p.message)).toEqual([
      'Test case "[SR-46fb54] [SR-036] login and spec" (line 1) is not enriched: SR-036 does not apply in core; SR-036 does not apply in VAR-0aaaaa',
      'Test case "[SR-036/AK2] spec only" (line 1) is not enriched: SR-036 does not apply in core; SR-036 does not apply in VAR-0aaaaa',
      'Test case "[SR-0b0036] [SR-0c0037] one view each" (line 1) is not enriched: SR-0c0037 does not apply in core; SR-0b0036 is excluded in VAR-0aaaaa',
    ]);
    expect(strict).toMatchObject({ testCases: 1, notInView: 0 });
  });

  it("[SR-029/AK11] removes the hand-written element and criterion properties of an element it leaves out, with their lines", async () => {
    const xml =
      "<testsuite>\r\n" +
      '  <testcase name="[SR-46fb54/AK1] login">\r\n' +
      "    <properties>\r\n" +
      `      ${prop("reqseq:element", "SR-036")}\r\n` +
      `      ${prop("reqseq:criterion", "SR-036:2")}\r\n` +
      `      ${prop("reqseq:element", "SR-46fb54")}\r\n` +
      `      ${prop("reqseq:element", "SR-036")}\r\n` +
      "    </properties>\r\n  </testcase>\r\n" +
      `  <testcase name="inline"><properties>${prop("reqseq:element", "SR-036")}${prop("reqseq:element", "SR-46fb54")}</properties></testcase>\r\n` +
      "</testsuite>\r\n";
    const result = await enrich(xml, { views: [GIVEN_COAST], skipNotInView: true });
    expect(result).toMatchObject({ problems: [], testCases: 2, notInView: 2 });
    expect(text(result)).toBe(
      "<testsuite>\r\n" +
        '  <testcase name="[SR-46fb54/AK1] login">\r\n' +
        "    <properties>\r\n" +
        `      ${prop("reqseq:element", LOGIN)}\r\n` +
        `      ${prop("reqseq:version", V[LOGIN])}\r\n` +
        `      ${prop("reqseq:variant", COAST)}\r\n` +
        `      ${prop("reqseq:criterion", `${LOGIN}:1`)}\r\n` +
        `      ${prop("reqseq:item", "build-1")}\r\n` +
        `      ${prop("reqseq:date", DATE)}\r\n` +
        "    </properties>\r\n  </testcase>\r\n" +
        `  <testcase name="inline"><properties>${prop("reqseq:element", LOGIN)}${prop("reqseq:version", V[LOGIN])}${prop("reqseq:variant", COAST)}${prop("reqseq:item", "build-1")}${prop("reqseq:date", DATE)}</properties></testcase>\r\n` +
        "</testsuite>\r\n",
    );
  });

  it("[SR-029/AK11] keeps an enriched test case whose element applies in one of its views, and reports one in none, with the option", async () => {
    const kept = (name: string, id: keyof typeof V, views: readonly string[]): string =>
      `<testcase name="${name}"><properties>${four(id, V[id])}${views.map((v) => prop("reqseq:variant", v)).join("")}</properties></testcase>`;
    const xml = suite(kept("some", REPORT, ["core", COAST]) + kept("none", SPEC, ["core", COAST]));
    const views = [GIVEN_CORE, GIVEN_COAST];
    const lenient = await enrich(xml, { views, skipNotInView: true });
    expect(lenient.problems.map((p) => p.message)).toEqual([
      'Test case "none" (line 1) does not fit: SR-036 does not apply in core; SR-036 does not apply in VAR-0aaaaa',
    ]);
    expect(lenient).toMatchObject({ testCases: 1, notInView: 0 });
    const strict = await enrich(xml, { views });
    expect(strict.problems.map((p) => p.message)).toEqual([
      'Test case "some" (line 1) does not fit: SR-0b0036 is excluded in VAR-0aaaaa',
      'Test case "none" (line 1) does not fit: SR-036 does not apply in core; SR-036 does not apply in VAR-0aaaaa',
    ]);
  });

  it("[SR-029/AK12] with skipNotInView marks a test case whose requirements apply in none of the given views with each of them, keeps the rest of it, and a re-run changes nothing", async () => {
    const xml =
      "<testsuite>\r\n" +
      '  <testcase name="[SR-036/AK2] spec">\r\n' +
      "    <properties>\r\n" +
      `      ${prop("reqseq:element", "SR-036")}\r\n` +
      `      ${prop("reqseq:criterion", "SR-036:2")}\r\n` +
      "    </properties>\r\n  </testcase>\r\n" +
      '  <testcase name="[SR-036] inline"/>\r\n' +
      '  <testcase name="[SR-46fb54] login"/>\r\n' +
      "</testsuite>\r\n";
    const views = [GIVEN_CORE, GIVEN_COAST];
    const result = await enrich(xml, { views, skipNotInView: true });
    expect(result).toMatchObject({ changed: true, problems: [], testCases: 1, notInView: 2 });
    const core = prop("reqseq:not-in-view", "core");
    const coast = prop("reqseq:not-in-view", COAST);
    expect(text(result)).toBe(
      "<testsuite>\r\n" +
        '  <testcase name="[SR-036/AK2] spec">\r\n' +
        "    <properties>\r\n" +
        `      ${prop("reqseq:element", "SR-036")}\r\n` +
        `      ${prop("reqseq:criterion", "SR-036:2")}\r\n` +
        `      ${core}\r\n      ${coast}\r\n` +
        "    </properties>\r\n  </testcase>\r\n" +
        `  <testcase name="[SR-036] inline"><properties>${core}${coast}</properties></testcase>\r\n` +
        `  <testcase name="[SR-46fb54] login"><properties>${four(LOGIN, V[LOGIN]).replace(prop("reqseq:item", "build-1"), prop("reqseq:variant", "core") + prop("reqseq:variant", COAST) + prop("reqseq:item", "build-1"))}</properties></testcase>\r\n` +
        "</testsuite>\r\n",
    );
    // The same views again: nothing changes, and the marked test cases still count as left out.
    const again = await enrich(result.bytes, { views, skipNotInView: true });
    expect(again).toMatchObject({ changed: false, problems: [], testCases: 1, notInView: 2 });
    expect(again.bytes).toBe(result.bytes);
    // The reader passes over the marked test cases (SR-093 AK6).
    const read = readJunitRecords({ repository: "system", file: "results.xml" }, result.bytes);
    expect(read.problems).toBeUndefined();
    expect(read.records.map((r) => r.testCase)).toEqual(["[SR-46fb54] login", "[SR-46fb54] login"]);
  });

  it("[SR-029/AK12] writes the core as a mark when it is the only given view", async () => {
    const result = await enrich(suite('<testcase name="[SR-036] spec"/>'), {
      views: [GIVEN_CORE],
      skipNotInView: true,
    });
    expect(result).toMatchObject({ changed: true, problems: [], testCases: 0, notInView: 1 });
    expect(properties(result.bytes)["[SR-036] spec"]).toEqual(["reqseq:not-in-view=core"]);
  });

  it("rewrites the marks of a test case left out for other views, in place, and leaves the same set in any order or case (AK12)", async () => {
    const marked = (...values: string[]): string =>
      suite(
        `<testcase name="[SR-036] spec"><properties>${prop("x", "1")}${values.map((v) => prop("reqseq:not-in-view", v)).join("")}${prop("y", "2")}</properties></testcase>`,
      );
    const run = (xml: string, views: EnrichOptions["views"]): Promise<EnrichResult> =>
      enrich(xml, { views, skipNotInView: true });
    const marksOf = (result: EnrichResult): string[] | undefined => properties(result.bytes)["[SR-036] spec"];
    for (const [values, views] of [
      [
        [COAST, "core"],
        [GIVEN_CORE, GIVEN_COAST],
      ],
      [
        ["CORE", COAST.toUpperCase()],
        [GIVEN_CORE, GIVEN_COAST],
      ],
      [["core", "core"], [GIVEN_CORE]],
    ] as const) {
      const same = await run(marked(...values), views);
      expect(same.changed, values.join()).toBe(false);
    }
    // Another set: replaced in place, extra ones removed, missing ones after the last mark.
    expect(marksOf(await run(marked("core"), [GIVEN_COAST]))).toEqual([`reqseq:not-in-view=${COAST}`]);
    expect(marksOf(await run(marked("core", COAST), [GIVEN_CORE]))).toEqual(["reqseq:not-in-view=core"]);
    expect(marksOf(await run(marked("core"), [GIVEN_CORE, GIVEN_COAST]))).toEqual([
      "reqseq:not-in-view=core",
      `reqseq:not-in-view=${COAST}`,
    ]);
    expect(marksOf(await run(marked("bogus", "core"), [GIVEN_CORE]))).toEqual(["reqseq:not-in-view=core"]);
    const between = await run(marked("core"), [GIVEN_CORE, GIVEN_COAST]);
    expect(text(between)).toContain(
      `${prop("x", "1")}${prop("reqseq:not-in-view", "core")}${prop("reqseq:not-in-view", COAST)}${prop("y", "2")}`,
    );
    // A mark without a value is replaced whole.
    const bare = await run(
      suite(
        '<testcase name="[SR-036] spec"><properties><property name="reqseq:not-in-view"/></properties></testcase>',
      ),
      [GIVEN_CORE],
    );
    expect(marksOf(bare)).toEqual(["reqseq:not-in-view=core"]);
  });

  it("removes every mark of a test case it enriches: without given views, with views of which some apply, or with one in which it applies (AK12)", async () => {
    const marks = prop("reqseq:not-in-view", "core") + prop("reqseq:not-in-view", COAST);
    const xml = suite(
      `<testcase name="[SR-036] spec"><properties>${marks}</properties></testcase>` +
        `<testcase name="[SR-46fb54] [SR-036] both"><properties>${marks}</properties></testcase>`,
    );
    const hasMark = (result: EnrichResult): boolean =>
      Object.values(properties(result.bytes)).some((list) =>
        list.some((p) => p.startsWith("reqseq:not-in-view=")),
      );
    const own = await enrich(xml);
    expect(own).toMatchObject({ problems: [], testCases: 2 });
    expect(hasMark(own)).toBe(false);
    const partly = await enrich(xml, { views: [GIVEN_CORE, GIVEN_COAST], skipNotInView: true });
    expect(partly).toMatchObject({ problems: [], testCases: 1, notInView: 2 });
    expect(properties(partly.bytes)["[SR-46fb54] [SR-036] both"]).not.toContain("reqseq:not-in-view=core");
    expect(properties(partly.bytes)["[SR-036] spec"]).toEqual([
      "reqseq:not-in-view=core",
      `reqseq:not-in-view=${COAST}`,
    ]);
    const mountain = await enrich(xml, { views: [GIVEN_MOUNTAIN], skipNotInView: true });
    expect(mountain).toMatchObject({ problems: [], testCases: 2, notInView: 0 });
    expect(hasMark(mountain)).toBe(false);
  });

  it("keeps the marks of a test case it refuses, reports or that names nothing, and refuses a mark on an enriched test case (AK12)", async () => {
    const mark = prop("reqseq:not-in-view", "core");
    const xml = suite(
      `<testcase name="[SR-036] spec"><properties>${mark}</properties></testcase>` +
        `<testcase name="nothing"><properties>${mark}</properties></testcase>` +
        `<testcase name="dup"><properties>${prop("reqseq:element", "SR-dup")}${mark}</properties></testcase>` +
        `<testcase name="kept"><properties>${four(LOGIN, V[LOGIN])}${mark}</properties></testcase>` +
        '<testcase name="[SR-46fb54] login"/>',
    );
    // Without the option AK9 refuses it; the other test cases are still enriched and the file written.
    const strict = await enrich(xml, { views: [GIVEN_CORE] });
    expect(strict.problems.map((p) => p.message)).toEqual([
      'Test case "[SR-036] spec" (line 1) is not enriched: SR-036 does not apply in core',
      expect.stringContaining('"SR-dup" names more than one element'),
      'Test case "kept" (line 1) is not enriched: reqseq:not-in-view is given on an enriched test case: it marks only a test case that enrich left out',
    ]);
    expect(strict).toMatchObject({ changed: true, testCases: 1, withoutReference: 1 });
    const written = properties(strict.bytes);
    expect(written["[SR-036] spec"]).toEqual(["reqseq:not-in-view=core"]);
    expect(written["nothing"]).toEqual(["reqseq:not-in-view=core"]);
    expect(written["dup"]).toEqual(["reqseq:element=SR-dup", "reqseq:not-in-view=core"]);
    expect(written["kept"]).toContain("reqseq:not-in-view=core");
  });

  it("reads a test case left out back only with exactly the given marks and its other properties unchanged (AK12)", () => {
    const wanted: Intended = {
      kind: "left-out",
      name: "[SR-036] a",
      className: "",
      outcome: "passed",
      start: 0,
      end: 0,
      marks: ["core", COAST],
      properties: [["x", "1"]],
    };
    const testCase = (body: string): Buffer =>
      Buffer.from(`<testcase name="[SR-036] a"><properties>${body}</properties></testcase>`);
    const core = prop("reqseq:not-in-view", "core");
    const coast = prop("reqseq:not-in-view", COAST);
    expect(readsBackAs(testCase(prop("x", "1") + core + coast), wanted)).toBe(true);
    expect(readsBackAs(testCase(coast + prop("x", "1") + core), wanted)).toBe(true);
    for (const body of [
      prop("x", "1") + core,
      prop("x", "1") + core + coast + core,
      prop("x", "1") + core + prop("reqseq:not-in-view", MOUNTAIN),
      prop("x", "1") + core + prop("reqseq:not-in-view", "bogus"),
      prop("x", "2") + core + coast,
      core + coast,
      prop("x", "1") + core + coast + prop("reqseq:version", V[LOGIN]),
    ]) {
      expect(readsBackAs(testCase(body), wanted), body).toBe(false);
    }
  });

  it("does nothing with skipNotInView without given views: AK9 holds for the views a test case names", async () => {
    const xml = suite(
      `<testcase name="[SR-036] spec"><properties>${prop("reqseq:variant", COAST)}</properties></testcase>`,
    );
    const result = await enrich(xml, { skipNotInView: true });
    expect(result.problems.map((p) => p.message)).toEqual([
      'Test case "[SR-036] spec" (line 1) is not enriched: SR-036 does not apply in VAR-0aaaaa',
    ]);
    expect(result).toMatchObject({ changed: false, notInView: 0 });
  });

  it("escapes & < > \" ' and line breaks so that they read back unchanged", async () => {
    const item = "build\t1\nline & <tag> \"quoted\" 'single'\r\nend";
    const result = await enrich(
      suite(
        '<testcase name="[SR-46fb54] a"/>' +
          `<testcase name="[SR-46fb54] b"><properties><property name='reqseq:item' value='old'/></properties></testcase>` +
          `<testcase name="[SR-46fb54] c"><properties><property name="reqseq:item">old</property></properties></testcase>`,
      ),
      { item },
    );
    const read = readJunitRecords({ repository: "system", file: "results.xml" }, result.bytes);
    // The element text has no attribute normalisation; a CR is kept as a character reference.
    expect(read.records.map((r) => r.item)).toEqual([item, item, item]);
    expect(escapeAttribute(`&<>"'\t\n\r`, '"')).toBe("&amp;&lt;&gt;&quot;'&#9;&#10;&#13;");
    expect(escapeAttribute(`&<>"'`, "'")).toBe('&amp;&lt;&gt;"&apos;');
    expect(escapeText(`&<>"'\t\n\r`)).toBe("&amp;&lt;&gt;\"'\t\n&#13;");
  });

  it("takes the given date, else a valid date of the test case, else the suite timestamp with time zone, else the time of the call", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T18:30:00.000Z"));
    try {
      const xml =
        `<testsuites>` +
        `<testsuite name="zone" timestamp="2026-10-27T12:22:13.306Z">` +
        `<testcase name="[SR-46fb54] own"><properties>${prop("reqseq:date", "2026-10-02T08:00:00+02:00")}</properties></testcase>` +
        `<testcase name="[SR-46fb54] own invalid"><properties>${prop("reqseq:date", "2026-10-02")}</properties></testcase>` +
        `<testcase name="[SR-46fb54] suite"/>` +
        `</testsuite>` +
        `<testsuite name="no zone" timestamp="2026-10-27T10:00:00"><testcase name="[SR-46fb54] now"/></testsuite>` +
        `<testsuite name="none"><testcase name="[SR-46fb54] none"/></testsuite>` +
        `</testsuites>`;
      const dates = (result: EnrichResult): Record<string, string | undefined> =>
        Object.fromEntries(
          Object.entries(properties(result.bytes)).map(([name, list]) => [
            name,
            list.find((p) => p.startsWith("reqseq:date="))?.slice("reqseq:date=".length),
          ]),
        );
      expect(dates(await enrich(xml, { date: undefined, now: () => new Date() }))).toEqual({
        "[SR-46fb54] own": "2026-10-02T08:00:00+02:00",
        "[SR-46fb54] own invalid": "2026-10-27T12:22:13.306Z",
        "[SR-46fb54] suite": "2026-10-27T12:22:13.306Z",
        "[SR-46fb54] now": "2026-10-27T18:30:00.000Z",
        "[SR-46fb54] none": "2026-10-27T18:30:00.000Z",
      });
      expect(new Set(Object.values(dates(await enrich(xml))))).toEqual(new Set([DATE]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes the suite timestamp over two own dates that differ, and writes it into both", async () => {
    const xml =
      `<testsuites><testsuite name="zone" timestamp="2026-10-27T12:22:13.306Z">` +
      `<testcase name="[SR-46fb54] two"><properties>` +
      prop("reqseq:date", "2026-10-02T08:00:00+02:00") +
      prop("reqseq:date", "2026-10-03T08:00:00+02:00") +
      `</properties></testcase></testsuite></testsuites>`;
    const result = await enrich(xml, { date: undefined });
    expect(properties(result.bytes)["[SR-46fb54] two"]?.filter((p) => p.startsWith("reqseq:date="))).toEqual([
      "reqseq:date=2026-10-27T12:22:13.306Z",
      "reqseq:date=2026-10-27T12:22:13.306Z",
    ]);
  });

  it("enriches a skipped test case, which the reader keeps as a test case without execution", async () => {
    const result = await enrich(suite('<testcase name="[SR-46fb54] skipped"><skipped/></testcase>'));
    expect(result.testCases).toBe(1);
    const read = readJunitRecords({ repository: "system", file: "results.xml" }, result.bytes);
    expect(read.records).toEqual([]);
    expect(read.skipped?.map((s) => [s.name, s.elements])).toEqual([["[SR-46fb54] skipped", [LOGIN]]]);
  });

  it("refuses a file the XML scanner refuses (file.faulty) and XML that is no JUnit file (input.invalid)", async () => {
    await expect(enrich("<testsuites>\n<testcase>")).rejects.toMatchObject({
      code: "file.faulty",
      details: { file: "results.xml", line: expect.any(Number) as number },
    });
    await expect(enrich("<project/>")).rejects.toMatchObject({
      code: "input.invalid",
      message: "results.xml is not a JUnit XML file: its root is <project>, not <testsuites> or <testsuite>",
    });
  });

  it("gives back the bytes it got and calls for no version when nothing names an element", async () => {
    const lookup = vi.fn(versionsOf);
    const bytes = Buffer.from(suite('<testcase name="test_add[1-2]"/>'));
    const result = await enrichJunitBytes(bytes, options({ versionsOf: lookup }));
    expect(result).toMatchObject({ changed: false, testCases: 0, unknown: [], problems: [] });
    expect(result.bytes).toBe(bytes);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("reads an enriched test case back only when it is one test case with the same name, class name and outcome and exactly the intended values (B3)", () => {
    const wanted: Intended = {
      name: "[SR-46fb54] a",
      className: "k",
      outcome: "passed",
      start: 0,
      end: 0,
      pairs: new Map([[LOGIN, V[LOGIN]]]),
      item: "build-1",
      date: DATE,
    };
    const testCase = (body: string, attributes = 'name="[SR-46fb54] a" classname="k"'): Buffer =>
      Buffer.from(`<testcase ${attributes}><properties>${body}</properties></testcase>`);
    expect(readsBackAs(testCase(four(LOGIN, V[LOGIN])), wanted)).toBe(true);
    const refused = [
      Buffer.from("<testcase"),
      Buffer.concat([testCase(four(LOGIN, V[LOGIN])), testCase(four(LOGIN, V[LOGIN]))]),
      testCase(four(LOGIN, V[LOGIN]), 'name="[SR-46fb54] b" classname="k"'),
      testCase(four(LOGIN, V[LOGIN]), 'name="[SR-46fb54] a" classname="j"'),
      Buffer.from(
        `<testcase name="[SR-46fb54] a" classname="k"><skipped/><properties>${four(LOGIN, V[LOGIN])}</properties></testcase>`,
      ),
      testCase(four(LOGIN, V[LOGIN], "build-2")),
      testCase(four(LOGIN, V[LOGIN], "build-1", "2026-10-28T10:00:00Z")),
      testCase(four(LOGIN, V[REPORT])),
      testCase(four(LOGIN, V[LOGIN]) + prop("reqseq:element", REPORT) + prop("reqseq:version", V[REPORT])),
      testCase(prop("reqseq:element", LOGIN) + prop("reqseq:item", "build-1") + prop("reqseq:date", DATE)),
      testCase(four(LOGIN, V[LOGIN]) + prop("reqseq:variant", COAST)),
      testCase(four(LOGIN, V[LOGIN]) + prop("reqseq:variant", COAST) + prop("reqseq:variant", "core")),
    ];
    for (const bytes of refused) {
      expect(readsBackAs(bytes, wanted)).toBe(false);
    }
    expect(readsBackAs(testCase(four(LOGIN, V[LOGIN]) + prop("reqseq:variant", "core")), wanted)).toBe(true);
    const coast = { ...wanted, views: [COAST] };
    expect(readsBackAs(testCase(four(LOGIN, V[LOGIN]) + prop("reqseq:variant", COAST)), coast)).toBe(true);
    expect(
      readsBackAs(
        testCase(four(LOGIN, V[LOGIN]) + prop("reqseq:variant", COAST) + prop("reqseq:variant", MOUNTAIN)),
        coast,
      ),
    ).toBe(false);
    // Several views (SR-093 AK5) read back as the same views in any order, and only as all of them.
    const several = { ...wanted, views: ["core", COAST] };
    const both = four(LOGIN, V[LOGIN]) + prop("reqseq:variant", COAST) + prop("reqseq:variant", "core");
    expect(readsBackAs(testCase(both), several)).toBe(true);
    expect(readsBackAs(testCase(both + prop("reqseq:variant", MOUNTAIN)), several)).toBe(false);
    expect(readsBackAs(testCase(four(LOGIN, V[LOGIN]) + prop("reqseq:variant", COAST)), several)).toBe(false);
  });

  it("reads an enriched test case back only when every element has its intended version", () => {
    const wanted: Intended = {
      name: "[SR-46fb54] a",
      className: "",
      outcome: "passed",
      start: 0,
      end: 0,
      pairs: new Map([
        [LOGIN, V[LOGIN]],
        [REPORT, V[REPORT]],
      ]),
      item: "build-1",
      date: DATE,
    };
    const testCase = (versions: readonly string[]): Buffer =>
      Buffer.from(
        `<testcase name="[SR-46fb54] a"><properties>` +
          prop("reqseq:element", LOGIN) +
          prop("reqseq:element", REPORT) +
          versions.map((v) => prop("reqseq:version", v)).join("") +
          prop("reqseq:item", "build-1") +
          prop("reqseq:date", DATE) +
          `</properties></testcase>`,
      );
    expect(readsBackAs(testCase([V[LOGIN], V[REPORT]]), wanted)).toBe(true);
    expect(readsBackAs(testCase([V[LOGIN], V[LOG]]), wanted)).toBe(false);
    expect(readsBackAs(testCase([V[REPORT], V[LOGIN]]), wanted)).toBe(false);
  });

  it("the read-back refuses with internal a result whose enriched test case does not read back, or whose other bytes differ from the file as read (B3, N1)", () => {
    const plain = '<testcase name="[SR-46fb54] a"/>';
    const enriched = `<testcase name="[SR-46fb54] a"><properties>${four(LOGIN, V[LOGIN])}</properties></testcase>`;
    const untouched = `<testcase name="b"><properties>${prop("x", "1")}</properties></testcase>`;
    const input = Buffer.from(suite(plain + untouched));
    const start = input.indexOf(plain);
    const wanted: Intended = {
      name: "[SR-46fb54] a",
      className: "",
      outcome: "passed",
      start,
      end: start + plain.length,
      pairs: new Map([[LOGIN, V[LOGIN]]]),
      item: "build-1",
      date: DATE,
    };
    const delta = enriched.length - plain.length;
    const moved = (offset: number): number => (offset > start ? offset + delta : offset);
    const check = (xml: string): void => {
      checkReadBack(input, Buffer.from(xml), moved, [wanted]);
    };
    // What enrich writes passes.
    check(suite(enriched + untouched));
    const refused = [
      suite(enriched.replace("build-1", "build-2") + untouched),
      suite(enriched + untouched.replace('"1"', '"2"')),
      suite(enriched + untouched).replace('name="s"', 'name="t"'),
      `${suite(enriched + untouched)}\n`,
    ];
    for (const xml of refused) {
      expect(() => {
        check(xml);
      }).toThrow(
        expect.objectContaining({
          code: "internal",
          message: "Enrich produced a file that does not read back; nothing written",
        }) as Error,
      );
    }
  });

  describe("reqseq:criterion (#960, #961)", () => {
    const criterion = (value: string): string => prop("reqseq:criterion", value);
    /** The criteria of each record of the enriched file, by element. */
    const criteriaOfRecords = (result: EnrichResult): [string, readonly number[] | undefined][] =>
      readJunitRecords({ repository: "r", file: "f" }, result.bytes).records.map((r) => [
        r.element,
        r.criteria,
      ]);

    it("[SR-029/AK10] writes the acceptance criterion a test case name gives", async () => {
      const result = await enrich(suite('<testcase name="[SR-46fb54/AK2] logs in"/>'));
      expect(result).toMatchObject({ changed: true, testCases: 1, problems: [] });
      expect(properties(result.bytes)["[SR-46fb54/AK2] logs in"]).toEqual([
        `reqseq:element=${LOGIN}`,
        `reqseq:version=${V[LOGIN]}`,
        `reqseq:criterion=${LOGIN}:2`,
        "reqseq:item=build-1",
        `reqseq:date=${DATE}`,
      ]);
      expect(criteriaOfRecords(result)).toEqual([[LOGIN, [2]]]);
    });

    it("writes each criterion of each element once, by short ID, UUID or identifier, in name order", async () => {
      const result = await enrich(
        suite(
          `<testcase name="[SR-46fb54/AK3] [SR-46fb54/ak1] [${LOGIN}/AK3] [SR-036/AK2] [SR-0b0036/AK1] a"/>`,
        ),
      );
      expect(
        properties(result.bytes)[
          "[SR-46fb54/AK3] [SR-46fb54/ak1] [" + LOGIN + "/AK3] [SR-036/AK2] [SR-0b0036/AK1] a"
        ]?.filter((p) => p.startsWith("reqseq:criterion=")),
      ).toEqual([
        `reqseq:criterion=${LOGIN}:3`,
        `reqseq:criterion=${LOGIN}:1`,
        `reqseq:criterion=${SPEC}:2`,
        `reqseq:criterion=${REPORT}:1`,
      ]);
      expect(criteriaOfRecords(result)).toEqual([
        [LOGIN, [1, 3]],
        [SPEC, [2]],
        [REPORT, [1]],
      ]);
    });

    it("writes no criterion for an element the name also names without one, nor for a suffix of another kind", async () => {
      const result = await enrich(
        suite(
          '<testcase name="[SR-46fb54] [SR-46fb54/AK2] whole"/><testcase name="[SR-0b0036/slow] [SR-0b0036/AKfoo] [] [x/AK0] none"/>',
        ),
      );
      expect(result).toMatchObject({ testCases: 2, problems: [] });
      expect(criteriaOfRecords(result)).toEqual([
        [LOGIN, undefined],
        [REPORT, undefined],
      ]);
    });

    it("leaves a test case with a malformed criterion of one of its elements unchanged, also next to a valid one", async () => {
      for (const name of [
        "[SR-46fb54/AK0] a",
        "[SR-46fb54/AK02] a",
        "[SR-46fb54/ak] a",
        "[SR-46fb54/AK2a] a",
        "[SR-46fb54/AK1234567890] a",
        "[SR-46fb54/AK2] [SR-46fb54/AK] a",
        "[SR-46fb54] [SR-46fb54/AK0] a",
      ]) {
        const result = await enrich(suite(`<testcase name="${name}"/>`));
        expect([result.changed, result.testCases], name).toEqual([false, 0]);
        expect(
          result.problems.map((p) => [p.code, p.severity]),
          name,
        ).toEqual([["evidence.invalid-record", "error"]]);
        expect(result.problems[0]?.message, name).toContain(
          "names no acceptance criterion: write AK and a number from 1 without leading zero",
        );
      }
    });

    it("writes the criterion of a name the name pattern reads (SR-029 AK5)", async () => {
      const result = await enrich(
        suite(
          '<testcase name="tests::sr_46fb54_ak2_and_sr_46fb54_ak4"/><testcase name="tests::sr_0b0036_ak0"/><testcase name="tests::sr_0c0037_ak03"/>',
        ),
        { namePattern: pattern("{prefix}_{id}_ak{ak}") },
      );
      expect(result.testCases).toBe(1);
      expect(result.problems.map((p) => p.message)).toEqual([
        expect.stringContaining('"sr_0b0036_ak0" names no acceptance criterion'),
        expect.stringContaining('"sr_0c0037_ak03" names no acceptance criterion'),
      ]);
      expect(criteriaOfRecords(result)).toEqual([[LOGIN, [2, 4]]]);
    });

    it("keeps a hand-written criterion, gives its reference the UUID and adds those of the name", async () => {
      const xml = suite(
        `<testcase name="[SR-46fb54/AK1] [SR-46fb54/AK2] [SR-036] a"><properties>${criterion(`${LOGIN}:2`)}${criterion(" SR-036 :3")}${criterion(`${LOGIN.toUpperCase()}:4`)}</properties></testcase>`,
      );
      const result = await enrich(xml);
      expect(result).toMatchObject({ changed: true, testCases: 1, problems: [] });
      const written = properties(result.bytes)["[SR-46fb54/AK1] [SR-46fb54/AK2] [SR-036] a"];
      expect(written?.filter((p) => p.startsWith("reqseq:criterion="))).toEqual([
        `reqseq:criterion=${LOGIN}:2`,
        `reqseq:criterion=${SPEC}:3`,
        `reqseq:criterion=${LOGIN.toUpperCase()}:4`,
        `reqseq:criterion=${LOGIN}:1`,
      ]);
      expect(criteriaOfRecords(result)).toEqual([
        [LOGIN, [1, 2, 4]],
        [SPEC, [3]],
      ]);
    });

    it("leaves a test case with a criterion that names no element of it, or is malformed, unchanged and reports it", async () => {
      const cases: [string, string][] = [
        ["2", 'reqseq:criterion "2" is not <element reference>:<number from 1>'],
        [":2", 'reqseq:criterion ":2" is not <element reference>:<number from 1>'],
        [`${LOGIN}:0`, `reqseq:criterion "${LOGIN}:0" is not <element reference>:<number from 1>`],
        [`${LOGIN}:02`, `reqseq:criterion "${LOGIN}:02" is not <element reference>:<number from 1>`],
        [`${LOGIN}:99999999999999999999`, "reqseq:criterion"],
        [`${REPORT}:1`, `reqseq:criterion "${REPORT}:1" names no reqseq:element of the test case`],
        ["SR-ffffff:1", 'reqseq:criterion "SR-ffffff:1" names no element'],
        [
          "dup:1",
          `reqseq:criterion "dup:1" names more than one element (${LOGIN} in system/a.md, ${REPORT} in system/b.md)`,
        ],
      ];
      for (const [value, message] of cases) {
        const xml = suite(
          `<testcase name="[SR-46fb54] a"><properties>${criterion(value)}</properties></testcase>`,
        );
        const result = await enrich(xml);
        expect(result.changed, value).toBe(false);
        expect(result.testCases, value).toBe(0);
        expect(
          result.problems.map((p) => [p.code, p.severity]),
          value,
        ).toEqual([["evidence.invalid-record", "error"]]);
        expect(result.problems[0]?.message, value).toContain(`is not enriched: ${message}`);
      }
    });

    it("reports a kept test case whose criterion the reader refuses, and does not count it", async () => {
      const xml = suite(
        `<testcase name="[SR-46fb54] a"><properties>${four(LOGIN, V[LOGIN])}${criterion(`${REPORT}:1`)}</properties></testcase>`,
      );
      const result = await enrich(xml);
      expect(result.testCases).toBe(0);
      expect(result.problems.map((p) => [p.code, p.severity, p.message])).toEqual([
        [
          "evidence.invalid-record",
          "error",
          `Test case "[SR-46fb54] a" (line 1) is not enriched: reqseq:criterion "${REPORT}:1" names no reqseq:element of the test case`,
        ],
      ]);
    });

    it("reads back only the intended criteria", () => {
      const wanted: Intended = {
        name: "a",
        className: "",
        outcome: "passed",
        start: 0,
        end: 0,
        pairs: new Map([[LOGIN, V[LOGIN]]]),
        item: "build-1",
        date: DATE,
        criteria: JSON.stringify([[LOGIN, [2]]]),
      };
      const testCase = (body: string): Buffer =>
        Buffer.from(`<testcase name="a"><properties>${four(LOGIN, V[LOGIN])}${body}</properties></testcase>`);
      expect(readsBackAs(testCase(criterion(`${LOGIN}:2`)), wanted)).toBe(true);
      expect(readsBackAs(testCase(criterion(`${LOGIN}:3`)), wanted)).toBe(false);
      expect(readsBackAs(testCase(criterion(`${LOGIN}:x`)), wanted)).toBe(false);
      expect(readsBackAs(testCase(""), wanted)).toBe(false);
    });
  });
});
