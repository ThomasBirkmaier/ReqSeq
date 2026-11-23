// The title of every problem kind (SR-224 AK6), by its code, from schemas/problem-codes.yaml (`pnpm
// contracts:generate`; contracts:check keeps it up to date). On its own, without the schemas of the bundle, so
// the app's renderer can head a group of problems by the title of their kind.
import generated from "./generated/problem-titles.json" with { type: "json" };

/** The title of every problem kind by its code. */
export const PROBLEM_TITLES: Readonly<Record<string, string>> = generated.titles;

/** The title of the problem kind `code`; undefined for a code that is no problem kind. */
export const problemTitle = (code: string): string | undefined =>
  Object.hasOwn(PROBLEM_TITLES, code) ? PROBLEM_TITLES[code] : undefined;
