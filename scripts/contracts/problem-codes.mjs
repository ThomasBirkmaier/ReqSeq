// schemas/problem-codes.yaml gives every problem code and every error code of common.schema.json a cause and a
// remedy (SR-139 AK2, ADR-0017), and every problem code the title of its kind (SR-224 AK6); the user documentation
// shows them. The codes stay enums in the schema, and this
// check keeps the file's keys equal to them.
import YAML from "yaml";

export const PROBLEM_CODES_FILE = "problem-codes.yaml";

/** A title of a problem kind: sentence case, at most 40 characters, no final punctuation, as a field title. */
const TITLE = /^[A-Z0-9][^.!?]*$/;
const TITLE_LENGTH = 40;

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
  for (const key of Object.keys(keysOf(data) ?? {}).filter((k) => !Object.hasOwn(lists, k))) {
    errors.push(`${PROBLEM_CODES_FILE}: ${key} is no section (problems, errors)`);
  }
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
      // A problem kind has a short title, which the reference and the app show (SR-224 AK6).
      for (const field of section === "problems" ? ["title", "cause", "remedy"] : ["cause", "remedy"]) {
        if (typeof keysOf(entry)?.[field] !== "string" || entry[field].trim() === "") {
          errors.push(`${PROBLEM_CODES_FILE}: ${section}: ${code} needs a ${field}`);
        }
      }
    }
  }
  errors.push(...checkTitles(data, lists));
  return errors;
}

/** The titles of the problem kinds (SR-224 AK6): one per problem code, unique, as a field title; none for an error. */
function checkTitles(data, lists) {
  const errors = [];
  const titles = Object.entries(keysOf(keysOf(data)?.problems) ?? {}).map(([code, entry]) => [
    code,
    keysOf(entry)?.title,
  ]);
  const seen = new Map();
  for (const [code, title] of titles.filter(
    ([code, title]) => lists.problems.includes(code) && typeof title === "string" && title.trim() !== "",
  )) {
    if (!TITLE.test(title) || title.length > TITLE_LENGTH) {
      errors.push(
        `${PROBLEM_CODES_FILE}: problems: ${code}: title "${title}": sentence case, at most ${TITLE_LENGTH} characters, no final punctuation`,
      );
    }
    if (seen.has(title)) {
      errors.push(
        `${PROBLEM_CODES_FILE}: problems: ${code}: title "${title}" is also the title of ${seen.get(title)}`,
      );
    }
    seen.set(title, code);
  }
  for (const [code] of Object.entries(keysOf(keysOf(data)?.errors) ?? {}).filter(
    ([, entry]) => keysOf(entry)?.title !== undefined,
  )) {
    errors.push(`${PROBLEM_CODES_FILE}: errors: ${code}: an error code has no title, it is no problem kind`);
  }
  return errors;
}
