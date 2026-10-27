import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { JunitFile, JunitTestCase } from "./junit-model.js";
import { elementRefsOf, junitTestCases } from "./junit-model.js";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A sample of fixtures/junit-samples/ as the tool wrote it. */
const sample = (file: string): Uint8Array =>
  fs.readFileSync(new URL(`../../../../fixtures/junit-samples/${file}`, import.meta.url));

const read = (bytes: Uint8Array): JunitFile => {
  const outcome = junitTestCases(bytes);
  if (outcome.kind !== "junit") {
    throw new Error(`not read: ${outcome.kind}`);
  }
  return outcome.file;
};

const only = (xml: string): JunitTestCase => {
  const [testCase, ...rest] = read(utf8(xml)).testCases;
  if (testCase === undefined || rest.length > 0) {
    throw new Error("not exactly one test case");
  }
  return testCase;
};

/** The bytes from `start` to `end`, as text (a byte order mark kept). */
const slice = (bytes: Uint8Array, start: number, end: number): string =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(start, end));

/** The bytes of `range`, as text; nothing when it is missing. */
const bytesOf = (
  bytes: Uint8Array,
  range: { readonly start: number; readonly end: number } | undefined,
): string => slice(bytes, range?.start ?? 0, range?.end ?? 0);

/** `bytes` with the bytes from `start` to `end` replaced by `text`, as text. */
const splice = (bytes: Uint8Array, start: number, end: number, text: string): string =>
  slice(Uint8Array.from([...bytes.subarray(0, start), ...utf8(text), ...bytes.subarray(end)]), 0, Infinity);

const PROPERTY = '<property name="logreq:version" value="v1"/>';

describe("junitTestCases", () => {
  it("junitTestCases reads pytest and Vitest JUnit files", () => {
    const pytest = read(sample("pytest.xml"));
    expect(pytest.root).toBe("testsuites");
    expect(pytest.suites).toEqual([
      { name: "pytest", line: 1, timestamp: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) as unknown },
    ]);
    expect(pytest.testCases.map(({ className, name, outcome }) => [className, name, outcome])).toEqual([
      ["test_sample", "test_login_by_property", "passed"],
      ["test_sample", "test_add[1-2]", "passed"],
      ["test_sample", "test_add[3-4]", "passed"],
      ["test_sample", "test_named[SR-46fb54]", "passed"],
      ["test_sample", "test_named[SR-036]", "passed"],
      ["test_sample", "test_fails", "failed"],
      ["test_sample", "test_skipped", "skipped"],
      ["test_sample", "test_error", "error"],
    ]);
    expect(pytest.testCases[0]?.properties.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: "logreq:element", value: "SR-46fb54" },
    ]);
    expect(pytest.testCases.every((testCase) => testCase.timestamp === pytest.suites[0]?.timestamp)).toBe(
      true,
    );

    const vitestBytes = sample("vitest.xml");
    const vitest = read(vitestBytes);
    expect(vitest.root).toBe("testsuites");
    expect(vitest.suites).toEqual([
      { name: "sample.test.ts", line: 3, timestamp: "2026-10-27T12:22:13.306Z" },
    ]);
    expect(vitest.testCases.map(({ name, outcome, line }) => [name, outcome, line])).toEqual([
      ["login > [SR-46fb54/AK1] accepts a valid password", "passed", 4],
      ["login > adds [1, 2]", "passed", 10],
      ["login > adds [3, 4]", "passed", 12],
      ["login > [SR-036] reports a failure", "failed", 14],
      ["login > is skipped", "skipped", 31],
    ]);
    const property = vitest.testCases[0]?.properties[0];
    expect(property).toMatchObject({ name: "logreq:element", value: "SR-46fb54", line: 6 });
    expect(slice(vitestBytes, property?.valueAt?.start ?? 0, property?.valueAt?.end ?? 0)).toBe("SR-46fb54");
    expect(vitest.testCases.map((testCase) => elementRefsOf(testCase))).toEqual([
      [
        { text: "SR-46fb54", kind: "shortId", source: "property" },
        { text: "SR-46fb54", kind: "shortId", source: "name" },
      ],
      [{ text: "1, 2", kind: "other", source: "name" }],
      [{ text: "3, 4", kind: "other", source: "name" }],
      [{ text: "SR-036", kind: "other", source: "name" }],
      [],
    ]);
  });

  it("junitTestCases gives skipped, failure and error outcomes", () => {
    const file = read(
      utf8(
        [
          '<testsuite name="s">',
          '<testcase name="passes"/>',
          '<testcase name="fails"><failure message="m">trace</failure></testcase>',
          '<testcase name="breaks"><error message="e"/></testcase>',
          '<testcase name="skips"><skipped/></testcase>',
          '<testcase name="both"><failure/><error/></testcase>',
          '<testcase name="out"><system-out>x</system-out></testcase>',
          "</testsuite>",
        ].join("\n"),
      ),
    );
    expect(file.root).toBe("testsuite");
    expect(file.testCases.map(({ name, outcome }) => [name, outcome])).toEqual([
      ["passes", "passed"],
      ["fails", "failed"],
      ["breaks", "error"],
      ["skips", "skipped"],
      ["both", "error"],
      ["out", "passed"],
    ]);
  });

  it("reads a test case with both <failure> and <system-out>", () => {
    const bytes = utf8(
      '<testsuite><testcase classname="c" name="n"><system-out>Prüfling</system-out><failure message="x"/></testcase></testsuite>',
    );
    const testCase = read(bytes).testCases[0];
    expect(testCase).toMatchObject({ className: "c", name: "n", outcome: "failed", properties: [], line: 1 });
    expect(testCase?.propertiesAt).toEqual({ kind: "new-block", offset: bytes.indexOf(0x3c, 12) });
  });

  it("reads nested <testsuite> elements, with the timestamp of the nearest suite that has one", () => {
    const file = read(
      utf8(
        [
          '<testsuites timestamp="2026-10-01T00:00:00">',
          '  <testsuite name="outer">',
          '    <testcase name="a"/>',
          '    <testsuite name="inner" timestamp="2026-10-02T00:00:00">',
          '      <testcase name="b"/>',
          "    </testsuite>",
          '    <testcase name="c"/>',
          "  </testsuite>",
          "  <testcase name='not in a suite'/>",
          "  <other><testcase name='not in a suite either'/></other>",
          "</testsuites>",
        ].join("\n"),
      ),
    );
    expect(file.suites).toEqual([
      { name: "outer", line: 2, timestamp: "2026-10-01T00:00:00" },
      { name: "inner", line: 4, timestamp: "2026-10-02T00:00:00" },
    ]);
    expect(file.testCases.map(({ name, line, timestamp }) => [name, line, timestamp])).toEqual([
      ["a", 3, "2026-10-01T00:00:00"],
      ["b", 5, "2026-10-02T00:00:00"],
      ["c", 7, "2026-10-01T00:00:00"],
    ]);
  });

  it("gives empty names and no timestamp when the attributes are missing", () => {
    const file = read(utf8("<testsuite><testcase/></testsuite>"));
    expect(file.suites).toEqual([{ name: "", line: 1 }]);
    expect(file.testCases[0]).toMatchObject({ name: "", className: "", properties: [], outcome: "passed" });
    expect(file.testCases[0]).not.toHaveProperty("timestamp");
  });

  it("gives the offsets that open a self-closing test case", () => {
    const xml = '<testsuite>\n  <testcase classname="c" name="n" />\n</testsuite>\n';
    const bytes = utf8(xml);
    const testCase = only(xml);
    expect(slice(bytes, testCase.start, testCase.end)).toBe('<testcase classname="c" name="n" />');
    const at = testCase.propertiesAt;
    expect(at.kind).toBe("open-testcase");
    if (at.kind !== "open-testcase") {
      return;
    }
    expect(splice(bytes, at.start, at.end, `><properties>${PROPERTY}</properties></testcase>`)).toBe(
      `<testsuite>\n  <testcase classname="c" name="n" ><properties>${PROPERTY}</properties></testcase>\n</testsuite>\n`,
    );
  });

  it("gives the offset of a new <properties> block in a test case without one", () => {
    const xml = '<testsuite><testcase name="n">\r\n<failure/></testcase></testsuite>';
    const at = only(xml).propertiesAt;
    expect(at.kind).toBe("new-block");
    if (at.kind !== "new-block") {
      return;
    }
    expect(splice(utf8(xml), at.offset, at.offset, `<properties>${PROPERTY}</properties>`)).toBe(
      `<testsuite><testcase name="n"><properties>${PROPERTY}</properties>\r\n<failure/></testcase></testsuite>`,
    );
  });

  const ENRICHED = [
    '\uFEFF<testsuite name="Prüfung">',
    '<testcase name="n">',
    "<properties>",
    '  <property name="logreq:element" value="SR-46fb54"/>',
    '  <property name="logreq:version" value="old &amp; stale"/>',
    '  <property name="note">text &amp; value</property>',
    "  <property name='single' value='a&apos;b'/>",
    '  <property name="empty"/>',
    "</properties>",
    "</testcase>",
    "</testsuite>",
  ].join("\r\n");

  it("appends to an existing <properties> block and replaces a logreq:* value in place", () => {
    const bytes = utf8(ENRICHED);
    expect(junitTestCases(bytes)).toMatchObject({ kind: "junit", file: { bom: true } });
    const testCase = only(ENRICHED);
    expect(testCase.properties.map(({ name, value, line }) => [name, value, line])).toEqual([
      ["logreq:element", "SR-46fb54", 4],
      ["logreq:version", "old & stale", 5],
      ["note", "text & value", 6],
      ["single", "a'b", 7],
      ["empty", "", 8],
    ]);

    // Replacing an existing logreq:* property keeps every other byte (BOM, CRLF, non-ASCII text).
    const version = testCase.properties[1]?.valueAt;
    expect(splice(bytes, version?.start ?? 0, version?.end ?? 0, "v2")).toBe(
      ENRICHED.replace("old &amp; stale", "v2"),
    );

    const at = testCase.propertiesAt;
    expect(at.kind).toBe("append");
    if (at.kind !== "append") {
      return;
    }
    expect(splice(bytes, at.offset, at.offset, `${PROPERTY}\r\n`)).toBe(
      ENRICHED.replace("</properties>", `${PROPERTY}\r\n</properties>`),
    );
  });

  it("gives where each property's value is written: attribute with its quote, element text, or none", () => {
    const bytes = utf8(ENRICHED);
    const [element, , note, single, empty] = only(ENRICHED).properties;
    expect(element?.valueAt?.quote).toBe('"');
    expect(single?.valueAt?.quote).toBe("'");
    expect(bytesOf(bytes, single?.valueAt)).toBe("a&apos;b");
    // A property valued by its text: the offsets of the text, no quote (escape < and &).
    expect(note?.valueAt?.quote).toBeUndefined();
    expect(bytesOf(bytes, note?.valueAt)).toBe("text &amp; value");
    expect(bytesOf(bytes, note)).toBe('<property name="note">text &amp; value</property>');
    // No value at all: the whole property is replaced.
    expect(empty?.valueAt).toBeUndefined();
    expect(bytesOf(bytes, empty)).toBe('<property name="empty"/>');
  });

  it("opens an empty self-closing <properties/> block and reads the properties of every block", () => {
    const xml =
      '<testsuite><testcase name="n"><properties/><properties><property name="a" value="1"/></properties></testcase></testsuite>';
    const testCase = only(xml);
    expect(testCase.properties.map(({ name }) => name)).toEqual(["a"]);
    const at = testCase.propertiesAt;
    expect(at.kind).toBe("open-properties");
    if (at.kind !== "open-properties") {
      return;
    }
    expect(splice(utf8(xml), at.start, at.end, `>${PROPERTY}</properties>`)).toBe(
      xml.replace("<properties/>", `<properties>${PROPERTY}</properties>`),
    );
  });

  it("takes a property without a name as an empty name and ignores other children of <properties>", () => {
    const testCase = only(
      '<testsuite><testcase><properties><property value="v"/><x/></properties></testcase></testsuite>',
    );
    expect(testCase.properties.map(({ name, value }) => [name, value])).toEqual([["", "v"]]);
  });

  it("skips well-formed XML whose root is not a JUnit root", () => {
    expect(junitTestCases(utf8('<?xml version="1.0"?><project><testsuite/></project>'))).toEqual({
      kind: "not-junit",
      root: "project",
    });
  });

  it("gives the reason and line of a file the scanner refuses", () => {
    expect(junitTestCases(utf8('<testsuite>\n<!DOCTYPE x SYSTEM "http://example.org/x.dtd">'))).toEqual({
      kind: "invalid",
      reason: "doctype",
      message: "A document type declaration (<!DOCTYPE) is not read",
      line: 2,
    });
  });
});

describe("elementRefsOf", () => {
  const UUID = "825b7146-a1b2-4c3d-8e9f-0123456789ab";
  const testCase = (name: string, properties: readonly (readonly [string, string])[] = []) => ({
    name,
    properties: properties.map(([propertyName, value]) => ({
      name: propertyName,
      value,
      line: 1,
      start: 0,
      end: 0,
    })),
  });

  it("elementRefsOf takes the logreq:element property and the tokens of the name", () => {
    expect(
      elementRefsOf(
        testCase("[SR-a1b2c3/AK2] logs in [SR-036] as [" + UUID + "]", [
          ["logreq:element", UUID],
          ["logreq:version", "v1"],
          ["logreq:element", " REQ-0123456789ab "],
        ]),
      ),
    ).toEqual([
      { text: UUID, kind: "uuid", source: "property" },
      { text: "REQ-0123456789ab", kind: "shortId", source: "property" },
      { text: "SR-a1b2c3", kind: "shortId", source: "name" },
      { text: "SR-036", kind: "other", source: "name" },
      { text: UUID, kind: "uuid", source: "name" },
    ]);
  });

  it("elementRefsOf keeps a property value that is not a short ID or UUID, marked as from a property", () => {
    // A caller reports such a value (an explicit statement), unlike a name token (review S2).
    expect(
      elementRefsOf(
        testCase("t", [
          ["logreq:element", "SR-0366"],
          ["logreq:element", "SR-1, SR-2"],
        ]),
      ),
    ).toEqual([
      { text: "SR-0366", kind: "other", source: "property" },
      { text: "SR-1, SR-2", kind: "other", source: "property" },
    ]);
  });

  it("elementRefsOf takes a UUID in any case", () => {
    expect(elementRefsOf(testCase(`t[${UUID.toUpperCase()}]`))).toEqual([
      { text: UUID.toUpperCase(), kind: "uuid", source: "name" },
    ]);
  });

  it("elementRefsOf names each reference once per source", () => {
    expect(
      elementRefsOf(testCase("[SR-a1b2c3] and [SR-a1b2c3/AK1]", [["logreq:element", "SR-a1b2c3"]])),
    ).toEqual([
      { text: "SR-a1b2c3", kind: "shortId", source: "property" },
      { text: "SR-a1b2c3", kind: "shortId", source: "name" },
    ]);
  });

  it("elementRefsOf ignores a pytest parameter list", () => {
    // Classified as `other`: a caller counts such a token only when it names exactly one element and
    // never reports it as unknown, so `test_x[1-2]` cannot make enrich fail (plan review B3).
    for (const [name, text] of [
      ["test_x[1-2]", "1-2"],
      ["test_x[SR-036]", "SR-036"],
      ["test_x[sr-a1b2c3]", "sr-a1b2c3"],
    ] as const) {
      expect(elementRefsOf(testCase(name))).toEqual([{ text, kind: "other", source: "name" }]);
    }
  });

  it("elementRefsOf skips empty tokens and nested brackets", () => {
    expect(elementRefsOf(testCase("t[] [ ] [/AK1] [a[SR-a1b2c3]] b]"))).toEqual([
      { text: "SR-a1b2c3", kind: "shortId", source: "name" },
    ]);
  });
});
