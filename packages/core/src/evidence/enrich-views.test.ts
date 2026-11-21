// The views of the pure enrich of a JUnit XML file (SR-029 AK6 to AK9, AK11, AK12): given views,
// `reqseq:variant`, skipNotInView and the marks of a test case left out.
import { describe, expect, it } from "vitest";
import type { EnrichOptions, EnrichResult } from "./enrich-model.js";
import { readJunitRecords } from "./junit.js";
import {
  LOGIN,
  REPORT,
  LOG,
  SPEC,
  V,
  DATE,
  COAST,
  MOUNTAIN,
  GIVEN_COAST,
  GIVEN_MOUNTAIN,
  GIVEN_CORE,
  enrich,
  enrichViews,
  text,
  suite,
  prop,
  four,
  properties,
} from "./enrich.test-helper.js";

describe("SR-029: enriching JUnit XML (pure)", () => {
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

  it("[SR-029/AK-r1s7] writes one reqseq:variant per given view, the core among them, and keeps or rewrites those named already", async () => {
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

  it("[SR-029/AK-pb9c] reports a test case that names a view not among the given ones, the core among them, and leaves it unchanged", async () => {
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
    const result = await enrichViews(xml, { views: [GIVEN_CORE] });
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
        `Test case "k" (line 1) does not fit: it is enriched already for the variant ${MOUNTAIN}, outside the given views (VAR-0aaaaa); an enriched test case is never changed`,
      ],
      [
        "evidence.invalid-record",
        "error",
        'Test case "k" (line 1) does not fit: it is enriched already for the core, outside the given views (VAR-0aaaaa); an enriched test case is never changed',
      ],
      [
        "evidence.invalid-record",
        "error",
        `Test case "k" (line 1) does not fit: it is enriched already for the variant ${MOUNTAIN} and the core, outside the given views (VAR-0aaaaa); an enriched test case is never changed`,
      ],
    ]);
    expect(result).toMatchObject({ changed: false, testCases: 1 });
    // A subset of the given views fits (AK8): the core of a test case without property among them.
    const subset = await enrich(xml, { views: [GIVEN_MOUNTAIN, GIVEN_CORE, GIVEN_COAST] });
    expect(subset).toMatchObject({ problems: [], testCases: 4 });
  });

  it("reports a kept test case that names an element which does not count in its variant, the given core or the core it has without a variant (AK9)", async () => {
    const xml = suite(
      `<testcase name="a"><properties>${four(REPORT, V[REPORT])}${prop("reqseq:variant", COAST)}</properties></testcase>` +
        `<testcase name="b"><properties>${four(LOG, V[LOG])}</properties></testcase>` +
        `<testcase name="c"><properties>${four(REPORT, V[REPORT])}${prop("reqseq:variant", "29000000-0000-4000-8000-0000000fffff")}</properties></testcase>`,
    );
    const own = await enrichViews(xml);
    // "b" has no reqseq:variant: it is for the core, where SR-0c0037 does not apply (SR-047 AK5).
    expect(own.problems.map((p) => p.message)).toEqual([
      'Test case "a" (line 1) does not fit: SR-0b0036 is excluded in VAR-0aaaaa',
      'Test case "b" (line 1) does not fit: SR-0c0037 does not apply in core',
    ]);
    const core = await enrichViews(
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
    const own = await enrichViews(xml);
    // AK9 per view, the core it names among them.
    expect(own.problems.map((p) => p.message)).toEqual([
      'Test case "excluded" (line 1) does not fit: SR-0b0036 is excluded in VAR-0aaaaa',
      'Test case "core only here" (line 1) does not fit: SR-0c0037 does not apply in core',
    ]);
    expect(own).toMatchObject({ changed: false, testCases: 2 });
    const given = await enrichViews(
      suite(kept("both", LOGIN, [COAST, "core"]) + kept("one", LOGIN, ["core"])),
      {
        views: [GIVEN_COAST],
      },
    );
    expect(given.problems.map((p) => p.message)).toEqual([
      'Test case "both" (line 1) does not fit: it is enriched already for the core, outside the given views (VAR-0aaaaa); an enriched test case is never changed',
      'Test case "one" (line 1) does not fit: it is enriched already for the core, outside the given views (VAR-0aaaaa); an enriched test case is never changed',
    ]);
    // A given core fits a kept test case for the core named by property, and checks it (AK9).
    const core = await enrichViews(suite(kept("log", LOG, ["core"]) + kept("login", LOGIN, ["CORE"])), {
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
      `Test case "a" (line 1) is not enriched: reqseq:variant "VAR-0aaaaa" is not a UUID or core; it names the variant ${COAST}: write that UUID, as enrich never changes an enriched test case`,
    ]);
  });

  it("says which UUID to write when a kept test case gives its variant by short ID, and leaves it unchanged", async () => {
    const xml = suite(
      `<testcase name="a"><properties>${four(LOGIN, V[LOGIN])}${prop("reqseq:variant", "VAR-0aaaaa")}</properties></testcase>` +
        `<testcase name="b"><properties>${four(LOGIN, V[LOGIN])}${prop("reqseq:variant", "VAR-1")}</properties></testcase>`,
    );
    const result = await enrich(xml);
    expect(result.problems.map((p) => p.message)).toEqual([
      `Test case "a" (line 1) is not enriched: reqseq:variant "VAR-0aaaaa" is not a UUID or core; it names the variant ${COAST}: write that UUID, as enrich never changes an enriched test case`,
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

  it("[SR-029/AK-djjh] with skipNotInView leaves out an element that applies in none of the given views, counts it, and enriches the rest", async () => {
    const xml = suite(
      `<testcase name="[SR-46fb54] [SR-036] login and spec"/>` +
        `<testcase name="[SR-036/AK-kspc] spec only"/>` +
        `<testcase name="[SR-0b0036] [SR-0c0037] one view each"/>` +
        `<testcase name="[SR-46fb54] login"/>`,
    );
    const views = [GIVEN_CORE, GIVEN_COAST];
    const result = await enrichViews(xml, { views, skipNotInView: true });
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
    expect(written["[SR-036/AK-kspc] spec only"]).toEqual([
      "reqseq:not-in-view=core",
      `reqseq:not-in-view=${COAST}`,
    ]);
    // Each applies in one of the views: both enriched, each record counts only where it applies.
    expect(written["[SR-0b0036] [SR-0c0037] one view each"]?.slice(0, 2)).toEqual([
      `reqseq:element=${REPORT}`,
      `reqseq:element=${LOG}`,
    ]);
    // Without the option AK9 holds: the test cases stay unchanged and are reported.
    const strict = await enrichViews(xml, { views });
    expect(strict.problems.map((p) => p.message)).toEqual([
      'Test case "[SR-46fb54] [SR-036] login and spec" (line 1) is not enriched: SR-036 does not apply in core; SR-036 does not apply in VAR-0aaaaa',
      'Test case "[SR-036/AK-kspc] spec only" (line 1) is not enriched: SR-036 does not apply in core; SR-036 does not apply in VAR-0aaaaa',
      'Test case "[SR-0b0036] [SR-0c0037] one view each" (line 1) is not enriched: SR-0c0037 does not apply in core; SR-0b0036 is excluded in VAR-0aaaaa',
    ]);
    expect(strict).toMatchObject({ testCases: 1, notInView: 0 });
  });

  it("[SR-029/AK-djjh] removes the hand-written element and criterion properties of an element it leaves out, with their lines", async () => {
    const xml =
      "<testsuite>\r\n" +
      '  <testcase name="[SR-46fb54/AK-kone] login">\r\n' +
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
        '  <testcase name="[SR-46fb54/AK-kone] login">\r\n' +
        "    <properties>\r\n" +
        `      ${prop("reqseq:element", LOGIN)}\r\n` +
        `      ${prop("reqseq:version", V[LOGIN])}\r\n` +
        `      ${prop("reqseq:variant", COAST)}\r\n` +
        `      ${prop("reqseq:criterion", `${LOGIN}:kone`)}\r\n` +
        `      ${prop("reqseq:item", "build-1")}\r\n` +
        `      ${prop("reqseq:date", DATE)}\r\n` +
        "    </properties>\r\n  </testcase>\r\n" +
        `  <testcase name="inline"><properties>${prop("reqseq:element", LOGIN)}${prop("reqseq:version", V[LOGIN])}${prop("reqseq:variant", COAST)}${prop("reqseq:item", "build-1")}${prop("reqseq:date", DATE)}</properties></testcase>\r\n` +
        "</testsuite>\r\n",
    );
  });

  it("[SR-029/AK-djjh] keeps an enriched test case whose element applies in one of its views, and reports one in none, with the option", async () => {
    const kept = (name: string, id: keyof typeof V, views: readonly string[]): string =>
      `<testcase name="${name}"><properties>${four(id, V[id])}${views.map((v) => prop("reqseq:variant", v)).join("")}</properties></testcase>`;
    const xml = suite(kept("some", REPORT, ["core", COAST]) + kept("none", SPEC, ["core", COAST]));
    const views = [GIVEN_CORE, GIVEN_COAST];
    const lenient = await enrichViews(xml, { views, skipNotInView: true });
    expect(lenient.problems.map((p) => p.message)).toEqual([
      'Test case "none" (line 1) does not fit: SR-036 does not apply in core; SR-036 does not apply in VAR-0aaaaa',
    ]);
    expect(lenient).toMatchObject({ testCases: 1, notInView: 0 });
    const strict = await enrichViews(xml, { views });
    expect(strict.problems.map((p) => p.message)).toEqual([
      'Test case "some" (line 1) does not fit: SR-0b0036 is excluded in VAR-0aaaaa',
      'Test case "none" (line 1) does not fit: SR-036 does not apply in core; SR-036 does not apply in VAR-0aaaaa',
    ]);
  });

  it("[SR-029/AK-hx47] with skipNotInView marks a test case whose requirements apply in none of the given views with each of them, keeps the rest of it, and a re-run changes nothing", async () => {
    const xml =
      "<testsuite>\r\n" +
      '  <testcase name="[SR-036/AK-kspc] spec">\r\n' +
      "    <properties>\r\n" +
      `      ${prop("reqseq:element", "SR-036")}\r\n` +
      `      ${prop("reqseq:criterion", "SR-036:2")}\r\n` +
      "    </properties>\r\n  </testcase>\r\n" +
      '  <testcase name="[SR-036] inline"/>\r\n' +
      '  <testcase name="[SR-46fb54] login"/>\r\n' +
      "</testsuite>\r\n";
    const views = [GIVEN_CORE, GIVEN_COAST];
    const result = await enrichViews(xml, { views, skipNotInView: true });
    expect(result).toMatchObject({ changed: true, problems: [], testCases: 1, notInView: 2 });
    const core = prop("reqseq:not-in-view", "core");
    const coast = prop("reqseq:not-in-view", COAST);
    expect(text(result)).toBe(
      "<testsuite>\r\n" +
        '  <testcase name="[SR-036/AK-kspc] spec">\r\n' +
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
    const again = await enrichViews(result.bytes, { views, skipNotInView: true });
    expect(again).toMatchObject({ changed: false, problems: [], testCases: 1, notInView: 2 });
    expect(again.bytes).toBe(result.bytes);
    // The reader passes over the marked test cases (SR-093 AK6).
    const read = readJunitRecords({ repository: "system", file: "results.xml" }, result.bytes);
    expect(read.problems).toBeUndefined();
    expect(read.records.map((r) => r.testCase)).toEqual(["[SR-46fb54] login", "[SR-46fb54] login"]);
  });

  it("[SR-029/AK-hx47] writes the core as a mark when it is the only given view", async () => {
    const result = await enrichViews(suite('<testcase name="[SR-036] spec"/>'), {
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
      enrichViews(xml, { views, skipNotInView: true });
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
    const partly = await enrichViews(xml, { views: [GIVEN_CORE, GIVEN_COAST], skipNotInView: true });
    expect(partly).toMatchObject({ problems: [], testCases: 1, notInView: 2 });
    expect(properties(partly.bytes)["[SR-46fb54] [SR-036] both"]).not.toContain("reqseq:not-in-view=core");
    expect(properties(partly.bytes)["[SR-036] spec"]).toEqual([
      "reqseq:not-in-view=core",
      `reqseq:not-in-view=${COAST}`,
    ]);
    const mountain = await enrichViews(xml, { views: [GIVEN_MOUNTAIN], skipNotInView: true });
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
    const strict = await enrichViews(xml, { views: [GIVEN_CORE] });
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
});
