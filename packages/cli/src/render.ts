// Output of the CLI. `--json` prints exactly the command output (SR-019 AK3), `--yaml` all of it as
// YAML; the default is the compact form of `present.ts`. No colors, ever: output stays plain text in
// pipes and logs. `--json` and `--yaml` come in pieces (`jsonOutput`, `yamlOutput`), never as one
// string, since an output such as `data.export` at N-036 is larger than V8 holds in one (#277).
import type { CatalogEntry, CommandError } from "@logreq/core";
import { jsonChunks } from "@logreq/core";
import { stringify } from "yaml";
import { inputFields } from "./fields.js";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/**
 * The command output as JSON, unchanged (`null` when a command returned nothing), and a line break:
 * the text of `JSON.stringify(output, null, 2)` in chunks of about 1 MB (`jsonChunks` of core).
 */
export function* jsonOutput(output: unknown): Generator<string, void, undefined> {
  yield* jsonChunks(output ?? null, { indent: 2 });
  yield "\n";
}

/** `jsonOutput` as one string (small outputs and tests). */
export const renderJson = (output: unknown): string => [...jsonOutput(output)].join("");

/**
 * `severity  code  repository:file:line  message  (element SR-46fb54)`, parts that are missing left
 * out; the repository only when the problem names one and has a file (e.g. element files of
 * several repositories, metamodel files); the element by its short ID (`elementShortId`, #315), by
 * its UUID when the problem has no short ID, and its identifier when it has one
 * (`(element SR-3c90b0, identifier SR-036)`, `elementIdentifier`, #305).
 */
export const renderProblem = (problem: unknown): string => {
  const p = isRecord(problem) ? problem : { message: JSON.stringify(problem) };
  const repository = text(p["repository"]);
  const file =
    repository !== "" && text(p["file"]) !== "" ? `${repository}:${text(p["file"])}` : text(p["file"]);
  const line = text(p["line"]);
  const location = file !== "" && line !== "" ? `${file}:${line}` : file;
  const shortId = text(p["elementShortId"]);
  const identifier = text(p["elementIdentifier"]);
  const element =
    shortId === ""
      ? text(p["elementId"])
      : identifier === ""
        ? shortId
        : `${shortId}, identifier ${identifier}`;
  return `${[
    text(p["severity"]),
    text(p["code"]),
    location,
    text(p["message"]),
    element === "" ? "" : `(element ${element})`,
  ]
    .filter((part) => part !== "")
    .join("  ")}\n`;
};

/** Findings an output left out of `problems`, by severity (`hidden` of workspace.check, #304). */
interface Hidden {
  readonly below: string;
  readonly warning: number;
  readonly info: number;
}

/** `hidden` of an output when it has that shape. */
export const hiddenOf = (output: Readonly<Record<string, unknown>>): Hidden | undefined => {
  const hidden = output["hidden"];
  return isRecord(hidden) &&
    typeof hidden["below"] === "string" &&
    typeof hidden["warning"] === "number" &&
    typeof hidden["info"] === "number"
    ? { below: hidden["below"], warning: hidden["warning"], info: hidden["info"] }
    : undefined;
};

/**
 * The line after the problems: `No problems.` when there are none at all; when the output left
 * findings out (`hidden`), how many, so that no line shown never reads as no findings (#304):
 * `No problems at or above error; 3 warnings and 1 info not shown.`, or after shown problems
 * `3 warnings and 1 info below error not shown.`.
 */
export const problemsEnd = (output: Readonly<Record<string, unknown>>, shown: number): string => {
  const hidden = hiddenOf(output);
  const counts = [
    hidden === undefined || hidden.warning === 0
      ? ""
      : `${String(hidden.warning)} warning${hidden.warning === 1 ? "" : "s"}`,
    hidden === undefined || hidden.info === 0 ? "" : `${String(hidden.info)} info`,
  ]
    .filter((part) => part !== "")
    .join(" and ");
  if (hidden === undefined || counts === "") {
    return shown === 0 ? "No problems.\n" : "";
  }
  return shown === 0
    ? `No problems at or above ${hidden.below}; ${counts} not shown.\n`
    : `${counts} below ${hidden.below} not shown.\n`;
};

/**
 * The options of every YAML piece. No aliases: an object that an output holds twice (a test case whose
 * `last` is its newest execution) is written out each time, since an anchor cannot reach from one
 * piece into another (ADR-0009).
 */
export const YAML_OPTIONS = { lineWidth: 0, aliasDuplicateObjects: false } as const;

/**
 * `text` with every line that is not empty indented by two spaces (YAML keeps empty lines empty).
 * Lines end at `\n` only: `yaml` writes U+2028, U+2029 and CR raw inside scalars, and a regular
 * expression with the `m` flag would take them for line ends and change the value.
 */
const indented = (text: string): string =>
  text
    .split("\n")
    .map((line) => (line === "" ? line : `  ${line}`))
    .join("\n");

/**
 * `stringify(value, YAML_OPTIONS)` in pieces: the items of an array one by one; for an object each key
 * on its own, an array under a key item by item. The pieces join to the text of the whole.
 */
export function* yamlPieces(value: unknown): Generator<string, void, undefined> {
  if (Array.isArray(value) && value.length > 0) {
    for (const item of value as readonly unknown[]) {
      yield stringify([item], YAML_OPTIONS);
    }
    return;
  }
  // An object whose fields are all undefined is `{}`, as the whole writes it.
  if (!isRecord(value) || !Object.values(value).some((item) => item !== undefined)) {
    yield stringify(value, YAML_OPTIONS);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item) && item.length > 0) {
      // The key line as the whole writes it (quoted where needed), then the items below it. A key
      // over 1024 characters is an explicit `? key` there; output keys are schema names, never so long.
      yield `${stringify({ [key]: [null] }, YAML_OPTIONS).split("\n")[0] ?? ""}\n`;
      for (const entry of item as readonly unknown[]) {
        yield indented(stringify([entry], YAML_OPTIONS));
      }
    } else if (item !== undefined) {
      yield stringify({ [key]: item }, YAML_OPTIONS);
    }
  }
}

/** `--yaml`: the output without `problems` as YAML, then one line per problem; in pieces. */
export function* yamlOutput(output: unknown): Generator<string, void, undefined> {
  if (!isRecord(output)) {
    if (output !== undefined) {
      yield* yamlPieces(output);
    }
    return;
  }
  const { problems, ...rest } = output;
  if (Object.keys(rest).length > 0) {
    yield* yamlPieces(rest);
  }
  if (Array.isArray(problems)) {
    for (const problem of problems as readonly unknown[]) {
      yield renderProblem(problem);
    }
    yield problemsEnd(output, problems.length);
  }
}

/** `yamlOutput` as one string (small outputs and tests). */
export const renderYaml = (output: unknown): string => [...yamlOutput(output)].join("");

/**
 * The message of an `input.invalid` with each field named as it is typed on this command line (#309):
 * `<path>` for an argument, `--package` for a flag. Core names fields by their input name and starts
 * each violation's message with it (`details.errors[].field`); only that name is respelled, the rest
 * of the text is core's (ADR-0002 rule 3). Fields only `--input` carries keep their input name.
 */
export const spelledMessage = (error: CommandError, entry: CatalogEntry): string => {
  const violations = error.details?.["errors"];
  if (error.code !== "input.invalid" || !Array.isArray(violations)) {
    return error.message;
  }
  const fields = new Map(inputFields(entry).map((f) => [f.name, f]));
  // Rebuilt from the violations, never by replacing text: a value may hold `$&` or a field name.
  const spelled = (violations as unknown[]).filter(isRecord).map((v) => {
    const name = text(v["field"]);
    const said = text(v["message"]);
    // `refs[0]`, `selection.ids` -> the field the command line has: `refs`, `selection`.
    const top = name.replace(/[.[].*$/, "");
    const field = fields.get(top);
    return field !== undefined && field.use !== "input-only" && said.startsWith(name)
      ? `${field.use === "positional" ? `<${field.flag}>` : `--${field.flag}`}${said.slice(top.length)}`
      : said;
  });
  return `Invalid input for ${entry.name}: ${spelled.join("; ")}`;
};

/**
 * An error for stderr: the error object as JSON with `--json`, else `error <code>: <message>`, where
 * `message` is the text for people (default the error's own; see `spelledMessage`).
 */
export const renderError = (error: CommandError, json: boolean, message = error.message): string =>
  json ? `${JSON.stringify(error.toJSON())}\n` : `error ${error.code}: ${message}\n`;

/** Exit code 1 when the output has an error finding or reports `ok: false` (ADR-0009), else 0. */
export const outcomeExitCode = (output: unknown): 0 | 1 => {
  if (!isRecord(output)) {
    return 0;
  }
  const problems = output["problems"];
  const errorFinding =
    Array.isArray(problems) && problems.some((p: unknown) => isRecord(p) && p["severity"] === "error");
  return output["ok"] === false || errorFinding ? 1 : 0;
};
