// Output of the CLI. `--json` prints exactly the command output (SR-019 AK3); the default is a generic,
// readable rendering of the same object. No colors, ever: output stays plain text in pipes and logs.
import type { CommandError } from "@logreq/core";
import { stringify } from "yaml";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** The command output as JSON, unchanged (`null` when a command returned nothing). */
export const renderJson = (output: unknown): string => `${JSON.stringify(output ?? null, null, 2)}\n`;

/**
 * `severity  code  repository:file:line  message  (element <uuid>)`, parts that are missing left
 * out; the repository only when the problem names one and has a file (e.g. element files of
 * several repositories, metamodel files).
 */
export const renderProblem = (problem: unknown): string => {
  const p = isRecord(problem) ? problem : { message: JSON.stringify(problem) };
  const repository = text(p["repository"]);
  const file =
    repository !== "" && text(p["file"]) !== "" ? `${repository}:${text(p["file"])}` : text(p["file"]);
  const line = text(p["line"]);
  const location = file !== "" && line !== "" ? `${file}:${line}` : file;
  const element = text(p["elementId"]);
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

/** The output without `problems` as YAML, then one line per problem. */
export function renderHuman(output: unknown): string {
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

/** An error for stderr: the error object as JSON with `--json`, else `error <code>: <message>`. */
export const renderError = (error: CommandError, json: boolean): string =>
  json ? `${JSON.stringify(error.toJSON())}\n` : `error ${error.code}: ${error.message}\n`;

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
