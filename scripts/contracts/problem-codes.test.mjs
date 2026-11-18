import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { schemasDir } from "./load.mjs";
import { checkProblemCodes } from "./problem-codes.mjs";

const common = {
  $defs: { problemCode: { enum: ["a.one", "a.two"] }, error: { properties: { code: { enum: ["e.one"] } } } },
};
const entry = "{ title: A kind, cause: Why., remedy: What. }";

describe("checkProblemCodes", () => {
  it("accepts the repository's file", () => {
    const read = (f) => fs.readFileSync(path.join(schemasDir, f), "utf8");
    expect(checkProblemCodes(read("problem-codes.yaml"), JSON.parse(read("common.schema.json")))).toEqual([]);
  });

  it("names missing and unknown codes and empty texts", () => {
    const text = `problems:\n  a.one: ${entry}\n  a.three: ${entry}\nerrors:\n  e.one: { cause: "", remedy: 1 }\nwarnings: {}\n`;
    expect(checkProblemCodes(text, common)).toEqual([
      "problem-codes.yaml: warnings is no section (problems, errors)",
      "problem-codes.yaml: problems: a.two is missing",
      "problem-codes.yaml: problems: a.three is no code of common.schema.json",
      "problem-codes.yaml: errors: e.one needs a cause",
      "problem-codes.yaml: errors: e.one needs a remedy",
    ]);
  });

  it("asks every problem kind for a title of its own, and none of an error code (SR-224 AK6)", () => {
    const text = [
      "problems:",
      "  a.one: { cause: Why., remedy: What. }",
      "  a.two: { title: lower case., cause: Why., remedy: What. }",
      "errors:",
      "  e.one: { title: An error, cause: Why., remedy: What. }",
      "",
    ].join("\n");
    expect(checkProblemCodes(text, common)).toEqual([
      "problem-codes.yaml: problems: a.one needs a title",
      'problem-codes.yaml: problems: a.two: title "lower case.": sentence case, at most 40 characters, no final punctuation',
      "problem-codes.yaml: errors: e.one: an error code has no title, it is no problem kind",
    ]);
    const twice = `problems:\n  a.one: ${entry}\n  a.two: ${entry}\nerrors:\n  e.one: { cause: Why., remedy: What. }\n`;
    expect(checkProblemCodes(twice, common)).toEqual([
      'problem-codes.yaml: problems: a.two: title "A kind" is also the title of a.one',
    ]);
  });

  it("reports a file that is no mapping or no YAML", () => {
    expect(checkProblemCodes("- a\n", common)).toHaveLength(3);
    expect(checkProblemCodes("problems: [\n", common)[0]).toMatch(/^problem-codes.yaml: /);
  });
});
