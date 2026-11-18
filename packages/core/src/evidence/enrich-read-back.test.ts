// The read-back of the pure enrich of a JUnit XML file (SR-029, `readsBackAs`, `checkReadBack`).
import { describe, expect, it } from "vitest";
import type { Intended } from "./enrich-read-back.js";
import { checkReadBack, readsBackAs } from "./enrich-read-back.js";
import { LOGIN, REPORT, LOG, V, DATE, COAST, MOUNTAIN, suite, prop, four } from "./enrich.test-helper.js";

describe("SR-029: enriching JUnit XML (pure)", () => {
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
});
