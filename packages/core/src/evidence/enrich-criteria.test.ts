// The acceptance criteria of the pure enrich of a JUnit XML file (SR-029 AK10, AK13): `reqseq:criterion`
// from the name and by hand.
import { describe, expect, it } from "vitest";
import type { EnrichResult } from "./enrich-model.js";
import type { Intended } from "./enrich-read-back.js";
import { readsBackAs } from "./enrich-read-back.js";
import { readJunitRecords } from "./junit.js";
import {
  LOGIN,
  REPORT,
  SPEC,
  V,
  DATE,
  pattern,
  GIVEN_COAST,
  GIVEN_CORE,
  enrich,
  enrichViews,
  text,
  suite,
  prop,
  four,
  properties,
  enrichedNames,
} from "./enrich.test-helper.js";

describe("SR-029: enriching JUnit XML (pure)", () => {
  describe("reqseq:criterion (#960, #961)", () => {
    const criterion = (value: string): string => prop("reqseq:criterion", value);
    /** The criteria of each record of the enriched file, by element. */
    const criteriaOfRecords = (result: EnrichResult): [string, readonly (number | string)[] | undefined][] =>
      readJunitRecords({ repository: "r", file: "f" }, result.bytes).records.map((r) => [
        r.element,
        r.criteria,
      ]);

    it("writes the acceptance criterion a test case name gives", async () => {
      const result = await enrich(suite('<testcase name="[SR-46fb54/AK-ktwo] logs in"/>'));
      expect(result).toMatchObject({ changed: true, testCases: 1, problems: [] });
      expect(properties(result.bytes)["[SR-46fb54/AK-ktwo] logs in"]).toEqual([
        `reqseq:element=${LOGIN}`,
        `reqseq:version=${V[LOGIN]}`,
        `reqseq:criterion=${LOGIN}:ktwo`,
        "reqseq:item=build-1",
        `reqseq:date=${DATE}`,
      ]);
      expect(criteriaOfRecords(result)).toEqual([[LOGIN, ["ktwo"]]]);
    });

    it("writes each criterion of each element once, by short ID, UUID or identifier, in name order", async () => {
      const result = await enrich(
        suite(
          `<testcase name="[SR-46fb54/AK-k7f3] [SR-46fb54/ak-kone] [${LOGIN}/AK-k7f3] [SR-036/AK-kspc] [SR-0b0036/AK-verify] a"/>`,
        ),
      );
      expect(
        properties(result.bytes)[
          "[SR-46fb54/AK-k7f3] [SR-46fb54/ak-kone] [" +
            LOGIN +
            "/AK-k7f3] [SR-036/AK-kspc] [SR-0b0036/AK-verify] a"
        ]?.filter((p) => p.startsWith("reqseq:criterion=")),
      ).toEqual([
        `reqseq:criterion=${LOGIN}:k7f3`,
        `reqseq:criterion=${LOGIN}:kone`,
        `reqseq:criterion=${SPEC}:kspc`,
        `reqseq:criterion=${REPORT}:verify`,
      ]);
      expect(criteriaOfRecords(result)).toEqual([
        [LOGIN, ["k7f3", "kone"]],
        [SPEC, ["kspc"]],
        [REPORT, ["verify"]],
      ]);
    });

    it("writes no criterion for an element the name also names without one, nor for a suffix of another kind", async () => {
      const result = await enrich(
        suite(
          '<testcase name="[SR-46fb54] [SR-46fb54/AK-ktwo] whole"/><testcase name="[SR-0b0036/slow] [SR-0b0036/AKfoo] [] [x/AK0] none"/>',
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
        "[SR-46fb54/AK-ktwo] [SR-46fb54/AK] a",
        "[SR-46fb54] [SR-46fb54/AK0] a",
        "[SR-46fb54/AK-k7f] a",
        "[SR-46fb54/AK-] a",
        "[SR-46fb54/AK-7f3k] a",
      ]) {
        const result = await enrich(suite(`<testcase name="${name}"/>`));
        expect([result.changed, result.testCases], name).toEqual([false, 0]);
        expect(
          result.problems.map((p) => [p.code, p.severity]),
          name,
        ).toEqual([["evidence.invalid-criterion-name", "error"]]);
        expect(result.problems[0]?.message, name).toContain(
          "names no acceptance criterion: write AK- and its criterion key from the element file",
        );
      }
    });

    it("[SR-029/AK-zyp3] writes the criterion keys of a name, for each requirement it names, and none for one named without", async () => {
      const result = await enrich(
        suite(
          '<testcase name="[SR-46fb54/AK-k7f3] [SR-46fb54/ak-m2x9] [SR-036/AK-k7f3] a"/><testcase name="[SR-46fb54] [SR-46fb54/AK-k7f3] whole"/>',
        ),
      );
      expect(result).toMatchObject({ changed: true, testCases: 2, problems: [] });
      expect(
        properties(result.bytes)["[SR-46fb54/AK-k7f3] [SR-46fb54/ak-m2x9] [SR-036/AK-k7f3] a"]?.filter((p) =>
          p.startsWith("reqseq:criterion="),
        ),
      ).toEqual([
        `reqseq:criterion=${LOGIN}:k7f3`,
        `reqseq:criterion=${LOGIN}:m2x9`,
        `reqseq:criterion=${SPEC}:k7f3`,
      ]);
      expect(criteriaOfRecords(result)).toEqual([
        [LOGIN, ["k7f3", "m2x9"]],
        [SPEC, ["k7f3"]],
        [LOGIN, undefined],
      ]);
    });

    it("[SR-029/AK-m9gw] [SR-029/AK-zyp3] writes the key of a criterion a name pattern reads, and a word {ak} reads as a key", async () => {
      const result = await enrich(
        suite(
          '<testcase name="tests::sr_46fb54_ak_k7f3_and_sr_46fb54_ak_m2x9"/><testcase name="sr_0b0036_ak_verify"/>',
        ),
        { namePattern: pattern("{prefix}_{id}_ak_{ak}") },
      );
      expect(result).toMatchObject({ testCases: 2, problems: [] });
      expect(criteriaOfRecords(result)).toEqual([
        [LOGIN, ["k7f3", "m2x9"]],
        [REPORT, ["verify"]],
      ]);
    });

    it("[SR-029/AK-zvy0] reports a criterion named by number or by a key that not exactly one current criterion carries, names the key to write, and leaves the test case unchanged", async () => {
      const items = [
        { key: "kaaa", text: "one" },
        "two",
        { key: "kdup", text: "a" },
        { key: "kdup", text: "b" },
      ];
      const names = [
        "[SR-46fb54/AK1] a",
        "[SR-46fb54/AK2] b",
        "[SR-46fb54/AK3] c",
        "[SR-46fb54/AK9] c9",
        "[SR-46fb54/AK-kzzz] d",
        "[SR-0b0036/AK-kzzz] keyless",
        "[SR-46fb54/AK-kdup] e",
        "tests::sr_46fb54_ak1",
        "[SR-46fb54/AK-kaaa] [SR-46fb54/AK1] g",
        "[SR-46fb54/AK-kaaa] counts",
      ];
      const xml = suite(names.map((name) => `<testcase name="${name}"/>`).join(""));
      const result = await enrich(xml, {
        // REPORT has criteria without keys (before element.assignCriterionKeys).
        criteriaOf: (id) => (id === LOGIN ? items : id === REPORT ? ["x", "y"] : []),
        namePattern: pattern("{prefix}_{id}_ak{ak}"),
      });
      const byNumber = "names an acceptance criterion by its number; name it by its criterion key";
      expect(result.problems.map((p) => [p.code, p.severity, p.message])).toEqual(
        [
          `"[SR-46fb54/AK1]" ${byNumber}, [SR-46fb54/AK-kaaa]`,
          `"[SR-46fb54/AK2]" names an acceptance criterion by its number, which has no criterion key yet; give the acceptance criteria of SR-46fb54 criterion keys with "Assign criterion keys" and name it by its key`,
          `"[SR-46fb54/AK3]" ${byNumber} from the element file`,
          `"[SR-46fb54/AK9]" ${byNumber} from the element file`,
          '"[SR-46fb54/AK-kzzz]" names the criterion key kzzz, which no acceptance criterion of SR-46fb54 in its current version carries; name the key from the element file',
          '"[SR-0b0036/AK-kzzz]" names the criterion key kzzz, which no acceptance criterion of SR-0b0036 in its current version carries; give the acceptance criteria of SR-0b0036 criterion keys with "Assign criterion keys"',
          '"[SR-46fb54/AK-kdup]" names the criterion key kdup, which 2 acceptance criteria of SR-46fb54 in its current version carry; name the key from the element file',
          `"sr_46fb54_ak1" (read by the name pattern) ${byNumber}, kaaa`,
          `"[SR-46fb54/AK1]" ${byNumber}, [SR-46fb54/AK-kaaa]`,
        ].map((why, i) => [
          "evidence.invalid-criterion-name",
          "error",
          `Test case "${String(names[i])}" (line 1) is not enriched: ${why}`,
        ]),
      );
      // Only the last one is enriched; the reported ones keep their bytes.
      expect(result.testCases).toBe(1);
      expect(enrichedNames(result.bytes)).toEqual(["[SR-46fb54/AK-kaaa] counts"]);
      expect(text(result)).toContain(`<testcase name="${String(names[0])}"/>`);
      expect(criteriaOfRecords(result)).toEqual([[LOGIN, ["kaaa"]]]);
    });

    it("[SR-029/AK-zvy0] names why criteria without keys cannot be named: no criteria property in the metamodel, no criteria, or none with a key (#2524)", async () => {
      const names = [
        "[SR-46fb54/AK1] a",
        "[SR-46fb54/AK-zzzz] b",
        "tests::sr_46fb54_ak_0",
        "[SR-036/AK1] c",
        "[SR-0b0036/AK3] d",
        "tests::sr_0b0036_ak_0",
      ];
      const xml = suite(names.map((name) => `<testcase name="${name}"/>`).join(""));
      const result = await enrich(xml, {
        // LOGIN: a metamodel without criteria property; SPEC: no criteria; REPORT: two without key.
        criteriaOf: (id) => (id === LOGIN ? undefined : id === SPEC ? [] : ["x", "y"]),
        namePattern: pattern("{prefix}_{id}_ak_{ak}"),
      });
      const noProperty =
        'names an acceptance criterion, but no property of the metamodel with the meaning acceptance-criteria holds a list of texts, so no requirement has acceptance criteria or criterion keys; name SR-46fb54 without a criterion, or give the property of its acceptance criteria that meaning, kind text and many, and then criterion keys with "Assign criterion keys"';
      const assign = 'give the acceptance criteria of SR-0b0036 criterion keys with "Assign criterion keys"';
      expect(result.problems.map((p) => [p.code, p.message])).toEqual(
        [
          `"[SR-46fb54/AK1]" ${noProperty}`,
          `"[SR-46fb54/AK-zzzz]" ${noProperty}`,
          `"sr_46fb54_ak_0" ${noProperty}`,
          '"[SR-036/AK1]" names an acceptance criterion, but SR-036 has none in its current version; name it without a criterion',
          `"[SR-0b0036/AK3]" names acceptance criterion 3, which SR-0b0036 does not have, and none of its acceptance criteria has a criterion key yet; ${assign} and name one of them by its key`,
          `"sr_0b0036_ak_0" names no acceptance criterion: write AK- and its criterion key; ${assign} first`,
        ].map((why, i) => [
          "evidence.invalid-criterion-name",
          `Test case "${String(names[i])}" (line 1) is not enriched: ${why}`,
        ]),
      );
      expect(result.changed).toBe(false);
    });

    it("[SR-029/AK-zvy0] reports a criterion named by number also for an element it would leave out (AK11)", async () => {
      const result = await enrichViews(suite('<testcase name="[SR-036/AK2] spec"/>'), {
        views: [GIVEN_CORE, GIVEN_COAST],
        skipNotInView: true,
      });
      expect(result).toMatchObject({ changed: false, testCases: 0, notInView: 0 });
      expect(result.problems.map((p) => [p.code, p.message])).toEqual([
        [
          "evidence.invalid-criterion-name",
          'Test case "[SR-036/AK2] spec" (line 1) is not enriched: "[SR-036/AK2]" names an acceptance criterion by its number; name it by its criterion key, [SR-036/AK-kspc]',
        ],
      ]);
    });

    it("writes the criterion of a name the name pattern reads (SR-029 AK5)", async () => {
      const result = await enrich(
        suite(
          '<testcase name="tests::sr_46fb54_ak_ktwo_and_sr_46fb54_ak_m2x9"/><testcase name="tests::sr_0b0036_ak_0"/><testcase name="tests::sr_0c0037_ak_03"/>',
        ),
        { namePattern: pattern("{prefix}_{id}_ak_{ak}") },
      );
      expect(result.testCases).toBe(1);
      expect(result.problems.map((p) => p.message)).toEqual([
        expect.stringContaining('"sr_0b0036_ak_0" names no acceptance criterion'),
        expect.stringContaining('"sr_0c0037_ak_03" names no acceptance criterion'),
      ]);
      expect(criteriaOfRecords(result)).toEqual([[LOGIN, ["ktwo", "m2x9"]]]);
    });

    it("keeps a hand-written criterion, gives its reference the UUID and adds those of the name", async () => {
      const xml = suite(
        `<testcase name="[SR-46fb54/AK-kone] [SR-46fb54/AK-kfour] [SR-036] a"><properties>${criterion(`${LOGIN}:2`)}${criterion(" SR-036 :3")}${criterion(`${LOGIN.toUpperCase()}:4`)}${criterion(`${LOGIN}:kfour`)}</properties></testcase>`,
      );
      const result = await enrich(xml);
      expect(result).toMatchObject({ changed: true, testCases: 1, problems: [] });
      const written = properties(result.bytes)["[SR-46fb54/AK-kone] [SR-46fb54/AK-kfour] [SR-036] a"];
      expect(written?.filter((p) => p.startsWith("reqseq:criterion="))).toEqual([
        `reqseq:criterion=${LOGIN}:2`,
        `reqseq:criterion=${SPEC}:3`,
        `reqseq:criterion=${LOGIN.toUpperCase()}:4`,
        `reqseq:criterion=${LOGIN}:kfour`,
        `reqseq:criterion=${LOGIN}:kone`,
      ]);
      expect(criteriaOfRecords(result)).toEqual([
        [LOGIN, [2, 4, "kfour", "kone"]],
        [SPEC, [3]],
      ]);
    });

    it("leaves a test case with a criterion that names no element of it, or is malformed, unchanged and reports it", async () => {
      const cases: [string, string][] = [
        ["2", 'reqseq:criterion "2" is not <element reference>:<number from 1 or criterion key>'],
        [":2", 'reqseq:criterion ":2" is not <element reference>:<number from 1 or criterion key>'],
        [
          `${LOGIN}:0`,
          `reqseq:criterion "${LOGIN}:0" is not <element reference>:<number from 1 or criterion key>`,
        ],
        [
          `${LOGIN}:02`,
          `reqseq:criterion "${LOGIN}:02" is not <element reference>:<number from 1 or criterion key>`,
        ],
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
