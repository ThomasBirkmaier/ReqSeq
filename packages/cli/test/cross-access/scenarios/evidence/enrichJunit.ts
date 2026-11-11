// Cross-access scenarios of evidence.enrichJunit, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import type { Result } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";
import { EVIDENCE } from "../../fixtures.js";

/**
 * The ThomasBirkmaier/ReqSeq-archive#535 workspace with a JUnit file outside the evidence folder that is not enriched yet (SR-029,
 * plan review S3), so evidence.enrichJunit writes on every access.
 */
const RAW_JUNIT: FixtureOptions = {
  ...EVIDENCE,
  files: {
    "results/raw.xml":
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="station" timestamp="2026-10-27T09:00:00">\n' +
      '    <testcase classname="station" name="[SR-e88fb3] shows the wind speed"/>\n' +
      '    <testcase classname="station" name="[SR-ffffff] names no element"/>\n' +
      "  </testsuite>\n</testsuites>\n",
  },
};

/**
 * The ThomasBirkmaier/ReqSeq-archive#535 workspace with a JUnit file of Rust test names that cannot hold brackets (SR-029 AK4, AK5):
 * one names SR-e88fb3 in the form `{prefix}_{id}_ak{ak}`, one names nothing.
 */
const PATTERN_JUNIT: FixtureOptions = {
  ...EVIDENCE,
  files: {
    "results/nextest.xml":
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="station" timestamp="2026-10-27T09:00:00">\n' +
      '    <testcase classname="station" name="tests::sr_e88fb3_ak1_shows_the_wind_speed"/>\n' +
      '    <testcase classname="station" name="tests::adds_two_numbers"/>\n' +
      "  </testsuite>\n</testsuites>\n",
  },
};

/**
 * The ThomasBirkmaier/ReqSeq-archive#535 workspace with a JUnit file whose test case names an acceptance criterion of SR-e88fb3 in
 * its name and one by short ID in a hand-written property (SR-029 AK10, #961).
 */
const CRITERION_JUNIT: FixtureOptions = {
  ...EVIDENCE,
  files: {
    "results/criterion.xml":
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="station">\n' +
      '  <testcase classname="station" name="[SR-e88fb3/AK2] shows the wind speed">\n' +
      '    <properties><property name="reqseq:criterion" value="SR-e88fb3:1"/></properties>\n  </testcase>\n</testsuite>\n',
  },
};

/** The ThomasBirkmaier/ReqSeq-archive#535 workspace with a need and a JUnit file whose test case names it (#843). */
const NEED_JUNIT: FixtureOptions = {
  ...EVIDENCE,
  files: {
    "needs/N-0000000e0843.md":
      "---\nid: 84300000-0000-4000-8000-0000000e0843\ntype: need\nstatus: draft\ntitle: See the need\n---\n",
    "results/need.xml":
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="station">\n' +
      '  <testcase classname="station" name="[N-0e0843] shows the need"/>\n</testsuite>\n',
  },
};

/** The output of evidence.enrichJunit through core. */
const enrichOutput = (results: Readonly<Record<string, Result>>): Record<string, unknown> | undefined =>
  (results["core"]?.outcome as { output?: Record<string, unknown> }).output;

const VARIANT_C1 = "43043043-0000-4000-8000-0000000000c1";
const VARIANT_C2 = "43043043-0000-4000-8000-0000000000c2";
/** The problem messages of evidence.enrichJunit through core (SR-029 AK8, AK9). */
const enrichMessages = (results: Readonly<Record<string, Result>>): string[] =>
  (
    (results["core"]?.outcome as { output?: { problems?: { message: string }[] } }).output?.problems ?? []
  ).map((p) => p.message);

/**
 * The example of SR-043 with a JUnit file of variant runs (SR-029 AK6 to AK9): SR-0000a3 (core) and
 * SR-0000b2 (only Coast) without variant, SR-0000a3 for Mountain by short ID, and SR-0000a2 (excluded
 * in Coast), SR-0000a1 (replaced in Coast) and SR-0000b2 for Mountain (not valid there).
 */
const VARIANT_JUNIT: FixtureOptions = {
  fixture: "SR-043/example",
  git: true,
  files: {
    "results/run.xml":
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="station">\n' +
      '    <testcase classname="station" name="[SR-0000a3] [SR-0000b2] rain and storm"/>\n' +
      '    <testcase classname="station" name="[SR-0000a3] rain on the mountain">\n' +
      '      <properties><property name="reqseq:variant" value="VAR-0000c2"/></properties>\n    </testcase>\n' +
      '    <testcase classname="station" name="[SR-0000a2] wind"/>\n' +
      '    <testcase classname="station" name="[SR-0000a1] response"/>\n' +
      '    <testcase classname="station" name="[SR-0000b2] storm on the mountain">\n' +
      '      <properties><property name="reqseq:variant" value="VAR-0000c2"/></properties>\n    </testcase>\n' +
      "  </testsuite>\n</testsuites>\n",
  },
};

/**
 * The example of SR-043 with a JUnit file of a run for several views (SR-029 AK6, AK8, AK11):
 * SR-0000a3 (core) alone and with SR-0000b2 (only Coast, as SR-145 only on macOS), SR-0000b2 alone,
 * SR-0000a4 (core) with a hand-written `core`, and SR-0000a5, a core requirement Mountain excludes.
 */
const VIEWS_JUNIT: FixtureOptions = {
  fixture: "SR-043/example",
  git: true,
  files: {
    "requirements/SR-0000000000a5.md":
      "---\nid: 43043043-0000-4000-8000-0000000000a5\ntype: system-requirement\nstatus: draft\ntitle: Show the humidity\n---\n",
    "variants/VAR-0000000000c2.md":
      "---\nid: 43043043-0000-4000-8000-0000000000c2\ntype: variant\nstatus: draft\ntitle: Mountain\n" +
      "excludes: [{ id: 43043043-0000-4000-8000-0000000000a5, version: n1:67ebd0624004c969, title: Show the humidity }]\n---\n",
    "results/views.xml":
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="station">\n' +
      '    <testcase classname="station" name="[SR-0000a3] rain"/>\n' +
      '    <testcase classname="station" name="[SR-0000a3] [SR-0000b2] rain and storm"/>\n' +
      '    <testcase classname="station" name="[SR-0000b2] storm"/>\n' +
      '    <testcase classname="station" name="[SR-0000a4] temperature">\n' +
      '      <properties><property name="reqseq:variant" value="core"/></properties>\n    </testcase>\n' +
      '    <testcase classname="station" name="[SR-0000a5] humidity"/>\n' +
      "  </testsuite>\n</testsuites>\n",
  },
};

/** The `reqseq:variant` values of each test case of `results/views.xml` as core wrote it. */
const viewsWritten = (results: Readonly<Record<string, Result>>): string[][] =>
  (results["core"]?.files["results/views.xml"] ?? "")
    .split("<testcase ")
    .slice(1)
    .map((testCase) => [...testCase.matchAll(/reqseq:variant" value="([^"]*)"/g)].map((m) => m[1] ?? ""));

/** A mark of a test case left out for a view (SR-029 AK12). */
const mark = (view: string): string => `<property name="reqseq:not-in-view" value="${view}"/>`;

/**
 * The views workspace with a JUnit file of SR-0000b2 (only Coast): one test case marked for the core
 * and Mountain already, as a run for them wrote it, one not marked yet (SR-029 AK12).
 */
const MARKED_JUNIT: FixtureOptions = {
  ...VIEWS_JUNIT,
  files: {
    ...VIEWS_JUNIT.files,
    "results/marked.xml":
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="station">\n' +
      `  <testcase classname="station" name="[SR-0000b2] storm"><properties>${mark("core")}${mark("43043043-0000-4000-8000-0000000000c2")}</properties></testcase>\n` +
      '  <testcase classname="station" name="[SR-0000b2] gusts">\n    <properties>\n      <property name="reqseq:element" value="SR-0000b2"/>\n    </properties>\n  </testcase>\n' +
      "</testsuite>\n",
  },
};

// `file` and `output` are localPaths (see scenarios/workspace/init.ts). The date is given: without it the
// time of the call would differ between the accesses.
scenariosOf("evidence.enrichJunit", [
  {
    name: "a JUnit file in place, with an unknown short ID listed (SR-029 AK1, AK2)",
    fixture: RAW_JUNIT,
    input: { file: "results/raw.xml", item: "build-513", date: "2026-10-27T10:00:00Z" },
    expect: "output",
  },
  {
    name: "a JUnit file into the evidence folder (SR-029 AK3)",
    fixture: RAW_JUNIT,
    input: {
      file: "results/raw.xml",
      item: "build-513",
      date: "2026-10-27T10:00:00Z",
      output: "evidence/ci/raw.xml",
    },
    expect: "output",
  },
  {
    name: "an enriched file is kept as it is (D-026)",
    fixture: EVIDENCE,
    input: { file: "evidence/ci/results.xml", item: "build-513", date: "2026-10-27T10:00:00Z" },
    expect: "output",
  },
  {
    name: "a test case that names a need is enriched, with a warning (#843)",
    fixture: NEED_JUNIT,
    input: { file: "results/need.xml", item: "build-843", date: "2026-11-04T10:00:00Z" },
    expect: "output",
    check: (results) => {
      expect(enrichOutput(results)).toMatchObject({
        testCases: 1,
        problems: [{ code: "evidence.kind-mismatch", severity: "warning", line: 3 }],
      });
    },
  },
  {
    name: "the acceptance criterion a test case name gives is written, a hand-written one kept",
    fixture: CRITERION_JUNIT,
    input: { file: "results/criterion.xml", item: "build-961", date: "2026-11-06T10:00:00Z" },
    expect: "output",
    check: (results) => {
      expect(enrichOutput(results)).toMatchObject({ testCases: 1, problems: [] });
      const file = results["core"]?.files["results/criterion.xml"] ?? "";
      expect(file.match(/reqseq:criterion" value="[^"]*"/g)).toEqual([
        'reqseq:criterion" value="e8df96ea-a168-4d90-8d65-6328cee88fb3:1"',
        'reqseq:criterion" value="e8df96ea-a168-4d90-8d65-6328cee88fb3:2"',
      ]);
    },
  },
  {
    name: "a file that is not there",
    fixture: EVIDENCE,
    input: { file: "results/gone.xml", item: "build-513" },
    expect: "error",
  },
  {
    name: "a test case named in another form is assigned through a name pattern",
    fixture: PATTERN_JUNIT,
    input: {
      file: "results/nextest.xml",
      item: "build-627",
      date: "2026-11-01T10:00:00Z",
      namePattern: "{prefix}_{id}_ak{ak}",
    },
    expect: "output",
    check: (results) => {
      expect(enrichOutput(results)).toMatchObject({ testCases: 1, unknown: [], problems: [] });
      expect(results["core"]?.files["results/nextest.xml"]).toContain(
        'name="tests::sr_e88fb3_ak1_shows_the_wind_speed"><properties><property name="reqseq:element" value="e8df96ea-a168-4d90-8d65-6328cee88fb3"/>',
      );
    },
  },
  {
    name: "the number of test cases that name no requirement",
    fixture: PATTERN_JUNIT,
    input: { file: "results/nextest.xml", item: "build-627", date: "2026-11-01T10:00:00Z" },
    tag: "[SR-029/AK4]",
    expect: "output",
    check: (results) => {
      expect(enrichOutput(results)).toMatchObject({ testCases: 0, withoutReference: 2 });
    },
  },
  {
    name: "a name pattern that is no template",
    fixture: PATTERN_JUNIT,
    input: { file: "results/nextest.xml", item: "build-627", namePattern: "{prefix}_{id}{ak}" },
    expect: "error",
  },
  {
    name: "the given variant goes into each enriched test case",
    fixture: VARIANT_JUNIT,
    input: {
      file: "results/run.xml",
      item: "build-631",
      date: "2026-11-01T10:00:00Z",
      variant: ["VAR-0000c1"],
    },
    tag: "[SR-029/AK6]",
    expect: "output",
    check: (results) => {
      const run = results["core"]?.files["results/run.xml"] ?? "";
      expect(run.match(/reqseq:variant" value="[^"]*"/g)).toEqual([
        `reqseq:variant" value="${VARIANT_C1}"`,
        'reqseq:variant" value="VAR-0000c2"',
        'reqseq:variant" value="VAR-0000c2"',
      ]);
    },
  },
  {
    name: "each given view, the core and a variant, goes into each enriched test case",
    fixture: VIEWS_JUNIT,
    input: {
      file: "results/views.xml",
      item: "build-1315",
      date: "2026-11-09T10:00:00Z",
      variant: ["core", "VAR-0000c2"],
    },
    tag: "[SR-029/AK6]",
    expect: "output",
    check: (results) => {
      // SR-0000b2 applies in neither view, SR-0000a5 not in Mountain: those test cases stay unchanged (AK9).
      expect(viewsWritten(results)).toEqual([["core", VARIANT_C2], [], [], ["core", VARIANT_C2], []]);
      expect(enrichOutput(results)).toMatchObject({ testCases: 2, notInView: 0 });
    },
  },
  {
    name: "a hand-written core not among the given views is reported",
    fixture: VIEWS_JUNIT,
    input: {
      file: "results/views.xml",
      item: "build-1315",
      date: "2026-11-09T10:00:00Z",
      variant: ["VAR-0000c1"],
    },
    tag: "[SR-029/AK8]",
    expect: "output",
    check: (results) => {
      expect(enrichMessages(results)).toEqual([
        'Test case "[SR-0000a4] temperature" (line 7) is not enriched: reqseq:variant "core" names a view that is not among the given ones (VAR-0000c1)',
      ]);
      expect(viewsWritten(results)).toEqual([
        [VARIANT_C1],
        [VARIANT_C1],
        [VARIANT_C1],
        ["core"],
        [VARIANT_C1],
      ]);
    },
  },
  {
    name: "a requirement that applies in none of the given views is left out with skipNotInView, and counted",
    fixture: VIEWS_JUNIT,
    input: {
      file: "results/views.xml",
      item: "build-1315",
      date: "2026-11-09T10:00:00Z",
      variant: ["core", "VAR-0000c2"],
      skipNotInView: true,
    },
    tag: "[SR-029/AK11]",
    expect: "output",
    check: (results) => {
      expect(enrichOutput(results)).toMatchObject({ testCases: 4, notInView: 2, problems: [] });
      const file = results["core"]?.files["results/views.xml"] ?? "";
      // Only SR-0000a3 in the test case that names both; the one with SR-0000b2 alone gets only the
      // marks of the given views (AK12).
      expect(file.match(/reqseq:element" value="[^"]*"/g)).toEqual([
        'reqseq:element" value="43043043-0000-4000-8000-0000000000a3"',
        'reqseq:element" value="43043043-0000-4000-8000-0000000000a3"',
        'reqseq:element" value="43043043-0000-4000-8000-0000000000a4"',
        'reqseq:element" value="43043043-0000-4000-8000-0000000000a5"',
      ]);
      expect(file).toContain(
        `<testcase classname="station" name="[SR-0000b2] storm"><properties><property name="reqseq:not-in-view" value="core"/><property name="reqseq:not-in-view" value="${VARIANT_C2}"/></properties></testcase>`,
      );
      // SR-0000a5 applies only in the core: enriched for both views, its Mountain record counts nowhere.
      expect(viewsWritten(results)[4]).toEqual(["core", VARIANT_C2]);
    },
  },
  {
    name: "a test case whose requirements apply in none of the given views is marked with each of them, once",
    fixture: MARKED_JUNIT,
    input: {
      file: "results/marked.xml",
      item: "build-1343",
      date: "2026-11-10T10:00:00Z",
      variant: ["core", "VAR-0000c2"],
      skipNotInView: true,
    },
    tag: "[SR-029/AK12]",
    expect: "output",
    check: (results) => {
      expect(enrichOutput(results)).toMatchObject({ testCases: 0, notInView: 2, problems: [] });
      // The marked one stays as it was; the other keeps its property and gets the marks after it.
      expect(results["core"]?.files["results/marked.xml"]).toBe(
        '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="station">\n' +
          `  <testcase classname="station" name="[SR-0000b2] storm"><properties>${mark("core")}${mark(VARIANT_C2)}</properties></testcase>\n` +
          '  <testcase classname="station" name="[SR-0000b2] gusts">\n    <properties>\n      <property name="reqseq:element" value="SR-0000b2"/>\n' +
          `      ${mark("core")}\n      ${mark(VARIANT_C2)}\n    </properties>\n  </testcase>\n` +
          "</testsuite>\n",
      );
    },
  },
  {
    name: "skipNotInView without the views given",
    fixture: VIEWS_JUNIT,
    input: { file: "results/views.xml", item: "build-1315", skipNotInView: true },
    expect: "error",
  },
  {
    name: "a reqseq:variant given by short ID becomes its UUID",
    fixture: VARIANT_JUNIT,
    input: { file: "results/run.xml", item: "build-631", date: "2026-11-01T10:00:00Z" },
    tag: "[SR-029/AK7]",
    expect: "output",
    check: (results) => {
      const run = results["core"]?.files["results/run.xml"] ?? "";
      expect(run.match(/reqseq:variant" value="[^"]*"/g)).toEqual([
        `reqseq:variant" value="${VARIANT_C2}"`,
        'reqseq:variant" value="VAR-0000c2"',
      ]);
    },
  },
  {
    name: "a test case that names another variant than the given one is reported",
    fixture: VARIANT_JUNIT,
    input: {
      file: "results/run.xml",
      item: "build-631",
      date: "2026-11-01T10:00:00Z",
      variant: ["VAR-0000c1"],
    },
    tag: "[SR-029/AK8]",
    expect: "output",
    check: (results) => {
      expect(enrichMessages(results)).toContain(
        'Test case "[SR-0000a3] rain on the mountain" (line 5) is not enriched: reqseq:variant "VAR-0000c2" names a view that is not among the given ones (VAR-0000c1)',
      );
    },
  },
  {
    name: "a test case that names a requirement excluded, replaced or not valid in its variant is reported",
    fixture: VARIANT_JUNIT,
    input: {
      file: "results/run.xml",
      item: "build-631",
      date: "2026-11-01T10:00:00Z",
      variant: ["VAR-0000c1"],
    },
    tag: "[SR-029/AK9]",
    expect: "output",
    check: (results) => {
      expect(enrichMessages(results)).toEqual([
        expect.stringContaining('"[SR-0000a3] rain on the mountain" (line 5)'),
        expect.stringContaining("SR-0000a2 is excluded in VAR-0000c1"),
        expect.stringContaining("SR-0000a1 is replaced in VAR-0000c1 by SR-0000b1"),
        expect.stringContaining('"[SR-0000b2] storm on the mountain" (line 10)'),
      ]);
    },
  },
  {
    name: "a requirement not valid in the variant a test case names itself, or in the core without one, is reported",
    fixture: VARIANT_JUNIT,
    input: { file: "results/run.xml", item: "build-631", date: "2026-11-01T10:00:00Z" },
    tag: "[SR-029/AK9]",
    expect: "output",
    check: (results) => {
      expect(enrichMessages(results)).toEqual([
        'Test case "[SR-0000a3] [SR-0000b2] rain and storm" (line 4) is not enriched: SR-0000b2 does not apply in core, so a record for it there would count nowhere (SR-040)',
        'Test case "[SR-0000b2] storm on the mountain" (line 10) is not enriched: SR-0000b2 does not apply in VAR-0000c2, so a record for it there would count nowhere (SR-040)',
      ]);
    },
  },
]);
