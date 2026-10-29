// schemas/problem-codes.yaml gives every problem code and every error code of common.schema.json a cause and a
// remedy (SR-139 AK2, ADR-0017); the user documentation shows them. The codes stay enums in the schema, and this
// check keeps the file's keys equal to them.
import YAML from "yaml";

export const PROBLEM_CODES_FILE = "problem-codes.yaml";

const keysOf = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;

/** Errors of the file's text against the `problemCode` and `error` code enums of `common` (common.schema.json). */
export function checkProblemCodes(text, common) {
  const errors = [];
  let data;
  try {
    data = YAML.parse(text, { version: "1.2", schema: "core" });
  } catch (e) {
    return [`${PROBLEM_CODES_FILE}: ${e.message}`];
  }
  const lists = {
    problems: common.$defs.problemCode.enum,
    errors: common.$defs.error.properties.code.enum,
  };
  for (const [section, codes] of Object.entries(lists)) {
    const entries = keysOf(keysOf(data)?.[section]) ?? {};
    for (const code of codes.filter((c) => !Object.hasOwn(entries, c))) {
      errors.push(`${PROBLEM_CODES_FILE}: ${section}: ${code} is missing`);
    }
    for (const [code, entry] of Object.entries(entries)) {
      if (!codes.includes(code)) {
        errors.push(`${PROBLEM_CODES_FILE}: ${section}: ${code} is no code of common.schema.json`);
        continue;
      }
      for (const field of ["cause", "remedy"]) {
        if (typeof keysOf(entry)?.[field] !== "string" || entry[field].trim() === "") {
          errors.push(`${PROBLEM_CODES_FILE}: ${section}: ${code} needs a ${field}`);
        }
      }
    }
  }
  return errors;
}
