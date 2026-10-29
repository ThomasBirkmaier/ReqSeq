// The JUnit reader (SR-093, ADR-0012 "JUnit XML"): the records of an enriched JUnit XML file. The
// samples are the files pytest and Vitest wrote (fixtures/junit-samples/, D-054), enriched here the
// way `reqseq evidence enrich-junit` (SR-029) does: at the offsets the JUnit model gives.
import fs from "node:fs";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import { evidenceIndex } from "./by-element.js";
import type { JunitPropertiesAt } from "./junit-model.js";
import { junitTestCases } from "./junit-model.js";
import type { JunitLocation } from "./junit.js";
import { JUNIT_READER, readJunitRecords } from "./junit.js";
import type { EvidenceRecord } from "./record.js";
import { EVIDENCE_READERS, evidenceReadState, evidenceRecordsState } from "./state.js";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A sample of fixtures/junit-samples/ as the tool wrote it. */
const sample = (file: string): Uint8Array =>
  fs.readFileSync(new URL(`../../../../fixtures/junit-samples/${file}`, import.meta.url));

const AT: JunitLocation = { repository: "results", file: "ci/results.xml" };

/** SR-46fb54, the requirement the samples name by short ID. */
const LOGIN = "0b9e7a3c-1d2f-4a5b-8c6d-825b7146fb54";
const REPORT = "93000000-0000-4000-8000-0000000b0036";
const OTHER = "93000000-0000-4000-8000-0000000c0037";
const VARIANT = "93000000-0000-4000-8000-0000000d0038";
const V1 = "n1:1111111111111111";
const V2 = "n1:2222222222222222";
const V3 = "n1:3333333333333333";
const DATE = "2026-10-27T12:30:00Z";

interface Enrich {
  readonly elements: readonly (readonly [element: string, version: string])[];
  readonly item?: string;
  readonly date?: string;
  readonly variant?: string;
}

const property = (name: string, value: string): string => `<property name="${name}" value="${value}"/>`;

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Writing `added` properties at `at`, as enrich does (ADR-0012 "JUnit XML"). */
const insertion = (at: JunitPropertiesAt, added: string): Edit => {
  switch (at.kind) {
    case "append":
      return { start: at.offset, end: at.offset, text: added };
    case "new-block":
      return { start: at.offset, end: at.offset, text: `<properties>${added}</properties>` };
    case "open-properties":
      return { start: at.start, end: at.end, text: `>${added}</properties>` };
    case "open-testcase":
      return { start: at.start, end: at.end, text: `><properties>${added}</properties></testcase>` };
  }
};

/**
 * `bytes` enriched as `reqseq evidence enrich-junit` would: per test case (by name) an existing
 * `reqseq:element` property gets the UUID of the first element, the other properties are added at
 * `propertiesAt`. Test cases not named stay as they are.
 */
const enrich = (bytes: Uint8Array, byName: Readonly<Record<string, Enrich>>): Uint8Array => {
  const read = junitTestCases(bytes);
  if (read.kind !== "junit") {
    throw new Error(`not JUnit: ${read.kind}`);
  }
  const edits: Edit[] = [];
  for (const testCase of read.file.testCases) {
    const wanted = byName[testCase.name];
    if (wanted === undefined) {
      continue;
    }
    const existing = testCase.properties.find((p) => p.name === "reqseq:element");
    const [first] = wanted.elements;
    if (existing?.valueAt !== undefined && first !== undefined) {
      edits.push({ start: existing.valueAt.start, end: existing.valueAt.end, text: first[0] });
    }
    const added = [
      ...wanted.elements
        .slice(existing === undefined ? 0 : 1)
        .map(([element]) => property("reqseq:element", element)),
      ...wanted.elements.map(([, version]) => property("reqseq:version", version)),
      property("reqseq:item", wanted.item ?? "build-512"),
      property("reqseq:date", wanted.date ?? DATE),
      ...(wanted.variant === undefined ? [] : [property("reqseq:variant", wanted.variant)]),
    ].join("");
    edits.push(insertion(testCase.propertiesAt, added));
  }
  edits.sort((a, b) => b.start - a.start);
  let out = Uint8Array.from(bytes);
  for (const edit of edits) {
    out = Uint8Array.from([...out.subarray(0, edit.start), ...utf8(edit.text), ...out.subarray(edit.end)]);
  }
  return out;
};

/** The fields a test compares: element, version, result, test case and line. */
const brief = (records: readonly EvidenceRecord[]): string[][] =>
  records.map((r) => [r.element, r.version, r.result, r.testCase ?? "", String(r.line)]);

/** A JUnit file with one suite holding `testCases`. */
const suite = (testCases: string): Uint8Array =>
  utf8(`<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="s">\n${testCases}\n</testsuite>\n`);

/** A test case with `props` as its properties (none when empty) and `body` after them. */
const testCase = (name: string, props: readonly (readonly [string, string])[], body = ""): string =>
  `<testcase classname="c" name="${name}">` +
  (props.length === 0 ? "" : `<properties>${props.map(([n, v]) => property(n, v)).join("")}</properties>`) +
  `${body}</testcase>`;

/** The properties of a test case enriched for `element` with version V1. */
const enriched = (element = LOGIN): (readonly [string, string])[] => [
  ["reqseq:element", element],
  ["reqseq:version", V1],
  ["reqseq:item", "build-512"],
  ["reqseq:date", DATE],
];

describe("JUnit reader (SR-093)", () => {
  it("[SR-093/AK1] assigns every test case of an enriched JUnit file to the requirement it names", () => {
    // pytest: the property test case (an existing <properties> block), a short ID in a parameter
    // list, a failure and an error; each names its requirement after enrich.
    const bytes = enrich(sample("pytest.xml"), {
      test_login_by_property: { elements: [[LOGIN, V1]] },
      "test_named[SR-46fb54]": { elements: [[LOGIN, V1]] },
      test_fails: { elements: [[REPORT, V2]] },
      test_error: { elements: [[OTHER, V3]] },
    });
    const read = readJunitRecords(AT, bytes);
    expect(brief(read.records)).toEqual([
      [LOGIN, V1, "passed", "test_login_by_property", "1"],
      [LOGIN, V1, "passed", "test_named[SR-46fb54]", "19"],
      [REPORT, V2, "failed", "test_fails", "31"],
      [OTHER, V3, "failed", "test_error", "55"],
    ]);
    expect(read.records[0]).toEqual({
      element: LOGIN,
      version: V1,
      kind: "verification",
      method: "test",
      item: "build-512",
      result: "passed",
      date: DATE,
      testCase: "test_login_by_property",
      source: "junit",
      repository: "results",
      file: "ci/results.xml",
      line: 1,
      className: "test_sample",
    });
    expect(read.problems).toBeUndefined();
  });

  it("[SR-093/AK1] assigns every test case of an enriched Vitest file to the requirement it names", () => {
    const bytes = enrich(sample("vitest.xml"), {
      "login > [SR-46fb54/AK1] accepts a valid password": { elements: [[LOGIN, V1]] },
      "login > [SR-036] reports a failure": { elements: [[REPORT, V2]], item: "build-513" },
    });
    const read = readJunitRecords(AT, bytes);
    expect(brief(read.records)).toEqual([
      [LOGIN, V1, "passed", "login > [SR-46fb54/AK1] accepts a valid password", "4"],
      [REPORT, V2, "failed", "login > [SR-036] reports a failure", "14"],
    ]);
    expect(read.records.map((r) => [r.className, r.item])).toEqual([
      ["sample.test.ts", "build-512"],
      ["sample.test.ts", "build-513"],
    ]);
    expect(read.problems).toBeUndefined();
  });

  it("[SR-093/AK1] a test case that names several requirements gives one record for each, with its own version", () => {
    const bytes = enrich(sample("vitest.xml"), {
      "login > [SR-46fb54/AK1] accepts a valid password": {
        elements: [
          [LOGIN, V1],
          [REPORT, V2],
          [LOGIN, V1],
        ],
      },
    });
    const read = readJunitRecords(AT, bytes);
    // The n-th version belongs to the n-th element; a repeated element with the same version counts once.
    expect(brief(read.records)).toEqual([
      [LOGIN, V1, "passed", "login > [SR-46fb54/AK1] accepts a valid password", "4"],
      [REPORT, V2, "passed", "login > [SR-46fb54/AK1] accepts a valid password", "4"],
    ]);
    // Both records are executions of one test case, seen from each element (SR-033 AK2).
    const index = evidenceIndex(read.records, []);
    expect(index.testCasesOf(LOGIN).map((t) => t.elements)).toEqual([[LOGIN, REPORT]]);
    expect(index.testCasesOf(REPORT).map((t) => t.executions.map((r) => r.version))).toEqual([[V2]]);
  });

  it("[SR-093/AK1] takes item, date and variant from the properties of the test case", () => {
    const read = readJunitRecords(
      AT,
      enrich(sample("vitest.xml"), {
        "login > [SR-46fb54/AK1] accepts a valid password": {
          elements: [[LOGIN, V1]],
          item: "station-fw 2.4.1",
          date: "2026-10-27T14:22:13.306+02:00",
          variant: VARIANT.toUpperCase(),
        },
      }),
    );
    expect(read.records.map((r) => [r.item, r.date, r.variant])).toEqual([
      ["station-fw 2.4.1", "2026-10-27T14:22:13.306+02:00", VARIANT],
    ]);
  });

  it("[SR-093/AK1] reads an element UUID in upper case as the UUID", () => {
    const read = readJunitRecords(AT, suite(testCase("t", enriched(LOGIN.toUpperCase()))));
    expect(read.records.map((r) => r.element)).toEqual([LOGIN]);
  });

  it("[SR-093/AK1] reads test cases enriched from a self-closing tag and from an empty properties block", () => {
    const bytes = enrich(
      suite('<testcase classname="c" name="a"/>\n<testcase classname="c" name="b"><properties/></testcase>'),
      {
        a: { elements: [[LOGIN, V1]] },
        b: { elements: [[REPORT, V2]] },
      },
    );
    expect(brief(readJunitRecords(AT, bytes).records)).toEqual([
      [LOGIN, V1, "passed", "a", "3"],
      [REPORT, V2, "passed", "b", "4"],
    ]);
  });

  it("[SR-093/AK1] the evidence state reads the enriched JUnit files of the evidence folders", async () => {
    expect(EVIDENCE_READERS).toContain(JUNIT_READER);
    const fixture = await createFixtureWorkspace({ fixture: "enabler-535/evidence" });
    const workspace = new Workspace(fixture.root);
    onTestFinished(async () => {
      await workspace.close();
      await fixture.cleanup();
    });
    const SR = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
    const read = await workspace.get(evidenceReadState);
    // The fixture's Markdown record is read too (SR-028); the JUnit file gives one record.
    const junit = read.records.filter((r) => r.source === "junit");
    expect(brief(junit)).toEqual([
      [SR, "n1:11335f109ffb1a19", "passed", "test_shows_wind_speed[SR-e88fb3]", "4"],
    ]);
    expect(junit[0]).toMatchObject({ file: "evidence/ci/results.xml", className: "tests.test_wind" });
    expect(read.skipped).toEqual([
      {
        name: "test_shows_gusts[SR-e88fb3]",
        className: "tests.test_wind",
        elements: [SR],
        repository: "system",
        file: "evidence/ci/results.xml",
        line: 12,
      },
    ]);
    expect(await workspace.get(evidenceRecordsState)).toEqual(read.records);
  });

  it("[SR-093/AK2] passes over a test case that names no requirement without a problem", () => {
    // After enrich the parameter lists (`test_add[1-2]`, `adds [1, 2]`), the skipped test case and
    // every other test case without a reference still name no requirement.
    for (const [file, names] of [
      ["pytest.xml", ["test_login_by_property", "test_named[SR-46fb54]"]],
      ["vitest.xml", ["login > [SR-46fb54/AK1] accepts a valid password"]],
    ] as const) {
      const byName = Object.fromEntries(names.map((name) => [name, { elements: [[LOGIN, V1]] }] as const));
      const read = readJunitRecords(AT, enrich(sample(file), byName));
      expect(read.records.map((r) => r.testCase)).toEqual(names);
      expect(read.problems).toBeUndefined();
      expect(read.skipped).toBeUndefined();
    }
  });

  it("[SR-093/AK2] a file whose test cases name no requirement gives nothing", () => {
    const read = readJunitRecords(
      AT,
      suite(
        [
          testCase("test_add[1-2]", []),
          testCase("adds [3, 4]", [["owner", "team-a"]]),
          testCase("test_x[SR-036]", [], "<failure/>"),
          testCase("skipped", [], "<skipped/>"),
        ].join("\n"),
      ),
    );
    expect(read).toEqual({ records: [] });
  });

  it("[SR-093/AK3] a skipped test case gives no record, so it never counts as passed", () => {
    const read = readJunitRecords(
      AT,
      enrich(sample("vitest.xml"), {
        "login > [SR-46fb54/AK1] accepts a valid password": { elements: [[LOGIN, V1]] },
        "login > is skipped": {
          elements: [
            [REPORT, V2],
            [OTHER, V3],
          ],
        },
      }),
    );
    expect(read.records.map((r) => [r.element, r.result])).toEqual([[LOGIN, "passed"]]);
    // It stays a test case, one without execution (SR-033 AK3).
    expect(read.skipped).toEqual([
      {
        name: "login > is skipped",
        className: "sample.test.ts",
        elements: [REPORT, OTHER],
        repository: "results",
        file: "ci/results.xml",
        line: 31,
      },
    ]);
    const index = evidenceIndex(read.records, read.skipped ?? []);
    expect(index.byElement.get(REPORT)).toBeUndefined();
    expect(index.testCasesOf(REPORT)).toEqual([
      {
        name: "login > is skipped",
        className: "sample.test.ts",
        elements: [REPORT, OTHER],
        executed: false,
        executions: [],
      },
    ]);
  });

  it("an error counts as failed, as a failure does", () => {
    const read = readJunitRecords(
      AT,
      suite([testCase("e", enriched(), "<error/>"), testCase("f", enriched(), "<failure/>")].join("\n")),
    );
    expect(read.records.map((r) => r.result)).toEqual(["failed", "failed"]);
  });

  it("a test case without class name gives a record without className", () => {
    const read = readJunitRecords(
      AT,
      utf8(
        `<testsuite><testcase name="t"><properties>${enriched()
          .map(([n, v]) => property(n, v))
          .join("")}</properties></testcase></testsuite>`,
      ),
    );
    expect(read.records[0]?.className).toBeUndefined();
    expect(read.records[0]?.testCase).toBe("t");
  });

  it("reports a file that names requirements but is not enriched once, with the number of test cases", () => {
    // The samples as the tools wrote them: a reqseq:element property and short IDs in the names.
    expect(readJunitRecords(AT, sample("pytest.xml"))).toEqual({
      records: [],
      problems: [
        {
          code: "evidence.not-enriched",
          severity: "warning",
          repository: "results",
          file: "ci/results.xml",
          line: 1,
          message:
            "2 test case(s) name a requirement but have no reqseq:version, so they give no record; enrich the file with reqseq evidence enrich-junit",
        },
      ],
    });
    const vitest = readJunitRecords(AT, sample("vitest.xml"));
    expect(vitest.records).toEqual([]);
    expect(vitest.problems?.map((p) => [p.code, p.line, p.message.slice(0, 13)])).toEqual([
      ["evidence.not-enriched", 4, "1 test case(s"],
    ]);
  });

  it("reports an enriched test case whose properties do not fit, and reads the others", () => {
    const at = (name: string, props: (readonly [string, string])[]): string => testCase(name, props);
    const without = (key: string): (readonly [string, string])[] => enriched().filter(([n]) => n !== key);
    const read = readJunitRecords(
      AT,
      suite(
        [
          at("short id", [["reqseq:element", "SR-46fb54"], ...without("reqseq:element")]),
          at("no element", without("reqseq:element")),
          at("two versions", [...enriched(), ["reqseq:version", V2]]),
          at("bad version", [
            ["reqseq:element", LOGIN],
            ["reqseq:version", "1.0"],
            ...without("reqseq:version").slice(1),
          ]),
          at("no item", without("reqseq:item")),
          at("empty item", [...without("reqseq:item"), ["reqseq:item", " "]]),
          at("two items", [...enriched(), ["reqseq:item", "build-513"]]),
          at("no date", without("reqseq:date")),
          at("bad date", [...without("reqseq:date"), ["reqseq:date", "2026-10-27"]]),
          at("bad variant", [...enriched(), ["reqseq:variant", "core"]]),
          at("good", enriched()),
          at("same item twice", [...enriched(), ["reqseq:item", "build-512"]]),
          at("element twice, two versions", [
            ...enriched(),
            ["reqseq:element", LOGIN],
            ["reqseq:version", V2],
          ]),
        ].join("\n"),
      ),
    );
    expect(read.records.map((r) => r.testCase)).toEqual(["good", "same item twice"]);
    expect(read.problems?.map((p) => [p.code, p.severity, p.line, p.message])).toEqual([
      [
        "evidence.invalid-record",
        "error",
        3,
        'Test case "short id" is not read: reqseq:element "SR-46fb54" is not a UUID (reqseq evidence enrich-junit writes the UUID)',
      ],
      [
        "evidence.invalid-record",
        "error",
        4,
        'Test case "no element" is not read: 0 reqseq:element and 1 reqseq:version properties: each element needs its version',
      ],
      [
        "evidence.invalid-record",
        "error",
        5,
        'Test case "two versions" is not read: 1 reqseq:element and 2 reqseq:version properties: each element needs its version',
      ],
      [
        "evidence.invalid-record",
        "error",
        6,
        'Test case "bad version" is not read: reqseq:version "1.0" is not a version',
      ],
      ["evidence.invalid-record", "error", 7, 'Test case "no item" is not read: reqseq:item is missing'],
      ["evidence.invalid-record", "error", 8, 'Test case "empty item" is not read: reqseq:item is missing'],
      [
        "evidence.invalid-record",
        "error",
        9,
        'Test case "two items" is not read: reqseq:item is given with different values',
      ],
      ["evidence.invalid-record", "error", 10, 'Test case "no date" is not read: reqseq:date is missing'],
      [
        "evidence.invalid-record",
        "error",
        11,
        'Test case "bad date" is not read: reqseq:date "2026-10-27" is not a date and time with time zone',
      ],
      [
        "evidence.invalid-record",
        "error",
        12,
        'Test case "bad variant" is not read: reqseq:variant "core" is not a UUID',
      ],
      [
        "evidence.invalid-record",
        "error",
        15,
        `Test case "element twice, two versions" is not read: reqseq:element "${LOGIN}" is given with different versions`,
      ],
    ]);
  });

  it("quotes names and values of the file in a problem short and with control characters escaped", () => {
    const name = `evil\u001b[2J${"x".repeat(60)}`;
    const read = readJunitRecords(
      AT,
      suite(testCase(name, [["reqseq:element", "\u001b[31m"], ...enriched().slice(1)])),
    );
    expect(read.problems?.map((p) => p.message)).toEqual([
      `Test case "evil\\u{1b}[2J${"x".repeat(32)}…" is not read: reqseq:element "\\u{1b}[31m" is not a UUID (reqseq evidence enrich-junit writes the UUID)`,
    ]);
  });

  it("lists the problems of a file by line, the not-enriched warning among them", () => {
    const read = readJunitRecords(
      AT,
      suite(
        [
          testCase("bad", [...enriched().slice(0, 3)]),
          testCase("plain [SR-46fb54]", []),
          testCase("also bad", [...enriched().slice(0, 3)]),
          testCase("by property", [["reqseq:element", "SR-46fb54"]]),
        ].join("\n"),
      ),
    );
    expect(read.problems?.map((p) => [p.code, p.line])).toEqual([
      ["evidence.invalid-record", 3],
      ["evidence.not-enriched", 4],
      ["evidence.invalid-record", 5],
    ]);
    expect(read.problems?.[1]?.message.startsWith("2 test case(s)")).toBe(true);
  });

  it("reports a file the XML scanner refuses with its line, and passes over XML that is not JUnit", () => {
    const refused = readJunitRecords(AT, utf8('<?xml version="1.0"?>\n<!DOCTYPE x>\n<testsuite/>'));
    expect(refused.records).toEqual([]);
    expect(refused.problems?.map((p) => [p.code, p.severity, p.repository, p.file, p.line])).toEqual([
      ["evidence.invalid-record", "error", "results", "ci/results.xml", 2],
    ]);
    expect(refused.problems?.[0]?.message).toMatch(/^Not a readable JUnit XML file: .*DOCTYPE/);
    expect(readJunitRecords(AT, utf8("<project><testcase name='x'/></project>"))).toEqual({ records: [] });
  });
});
