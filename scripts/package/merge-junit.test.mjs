import { describe, expect, it } from "vitest";
import { mergeJunit } from "./merge-junit.mjs";

describe("mergeJunit", () => {
  it("adds the suites of the second file and sums the counts of the root", () => {
    const into = [
      '<?xml version="1.0" encoding="UTF-8" ?>',
      '<testsuites name="vitest tests" tests="2" failures="1" errors="0" time="1.5">',
      '    <testsuite name="a.test.ts" tests="2"><testcase name="x"/></testsuite>',
      "</testsuites>",
      "",
    ].join("\n");
    const from = [
      '<testsuites name="vitest tests" tests="1" failures="0" errors="0" time="0.2">',
      '    <testsuite name="b.test.ts" tests="1">',
      '        <testcase name="$y"/>',
      "    </testsuite>",
      "</testsuites>",
    ].join("\n");
    expect(mergeJunit(into, from)).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8" ?>',
        '<testsuites name="vitest tests" tests="3" failures="1" errors="0" time="1.5">',
        '    <testsuite name="a.test.ts" tests="2"><testcase name="x"/></testsuite>',
        '    <testsuite name="b.test.ts" tests="1">\n        <testcase name="$y"/>\n    </testsuite>',
        "</testsuites>",
        "",
      ].join("\n"),
    );
  });

  it("refuses a file without a root to merge into", () => {
    expect(() => mergeJunit("<testsuite/>", "")).toThrow("no </testsuites>");
  });
});
