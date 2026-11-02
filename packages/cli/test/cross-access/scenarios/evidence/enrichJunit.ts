// Cross-access scenarios of evidence.enrichJunit, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import type { Result } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";
import { EVIDENCE } from "../../fixtures.js";

/**
 * The #535 workspace with a JUnit file outside the evidence folder that is not enriched yet (SR-029,
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
 * The #535 workspace with a JUnit file of Rust test names that cannot hold brackets (SR-029 AK4, AK5):
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
    tag: "[SR-029/AK5]",
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
      variant: "VAR-0000c1",
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
      variant: "VAR-0000c1",
    },
    tag: "[SR-029/AK8]",
    expect: "output",
    check: (results) => {
      expect(enrichMessages(results)).toContain(
        'Test case "[SR-0000a3] rain on the mountain" (line 5) is not enriched: reqseq:variant "VAR-0000c2" names another variant than the given one, VAR-0000c1',
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
      variant: "VAR-0000c1",
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
    name: "a requirement not valid in the variant a test case names itself is reported",
    fixture: VARIANT_JUNIT,
    input: { file: "results/run.xml", item: "build-631", date: "2026-11-01T10:00:00Z" },
    tag: "[SR-029/AK9]",
    expect: "output",
    check: (results) => {
      expect(enrichMessages(results)).toEqual([
        'Test case "[SR-0000b2] storm on the mountain" (line 10) is not enriched: SR-0000b2 does not apply in VAR-0000c2, so a record for it there would count nowhere (SR-040)',
      ]);
    },
  },
]);
