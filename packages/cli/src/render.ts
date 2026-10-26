// Output of the CLI. `--json` prints exactly the command output (SR-019 AK3), `--yaml` all of it as
// YAML; the default is the compact form of `present.ts`. No colors, ever: output stays plain text in
// pipes and logs.
import type { CatalogEntry, CommandError } from "@logreq/core";
import { stringify } from "yaml";
import { inputFields } from "./fields.js";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** The command output as JSON, unchanged (`null` when a command returned nothing). */
export const renderJson = (output: unknown): string => `${JSON.stringify(output ?? null, null, 2)}\n`;

/**
 * `severity  code  repository:file:line  message  (element SR-46fb54)`, parts that are missing left
 * out; the repository only when the problem names one and has a file (e.g. element files of
 * several repositories, metamodel files); the element by its short ID (`elementShortId`, #315), by
 * its UUID when the problem has no short ID.
 */
export const renderProblem = (problem: unknown): string => {
  const p = isRecord(problem) ? problem : { message: JSON.stringify(problem) };
  const repository = text(p["repository"]);
  const file =
    repository !== "" && text(p["file"]) !== "" ? `${repository}:${text(p["file"])}` : text(p["file"]);
  const line = text(p["line"]);
  const location = file !== "" && line !== "" ? `${file}:${line}` : file;
  const shortId = text(p["elementShortId"]);
  const element = shortId === "" ? text(p["elementId"]) : shortId;
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

/** `--yaml`: the output without `problems` as YAML, then one line per problem. */
export function renderYaml(output: unknown): string {
  if (!isRecord(output)) {
    return output === undefined ? "" : stringify(output, { lineWidth: 0 });
  }
  const { problems, ...rest } = output;
  const parts: string[] = [];
  if (Object.keys(rest).length > 0) {
    parts.push(stringify(rest, { lineWidth: 0 }));
  }
  if (Array.isArray(problems)) {
    parts.push(problems.length === 0 ? "No problems.\n" : problems.map(renderProblem).join(""));
  }
  return parts.join("");
}

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
