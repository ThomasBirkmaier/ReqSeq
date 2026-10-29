// The page of problem and error codes (SR-139 AK2): cause and remedy of every code, from schemas/problem-codes.yaml,
// whose keys `pnpm schemas:check` holds equal to the codes of common.schema.json.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { inline } from "./markdown.js";

export interface CodeText {
  readonly cause: string;
  readonly remedy: string;
}

/** The problem codes (findings in a command's result) and the error codes (a command that failed). */
export interface ProblemCodes {
  readonly problems: Readonly<Record<string, CodeText>>;
  readonly errors: Readonly<Record<string, CodeText>>;
}

/** The page below the content folder. */
export const CODES_PAGE = "reference/problem-codes.md";

export type CodeKind = "problem" | "error";

/** The anchor of a code on the page: `relation.outdated` → `relation-outdated`, errors with `error-` in front. */
export const codeAnchor = (code: string, kind: CodeKind): string =>
  `${kind === "error" ? "error-" : ""}${code.replaceAll(".", "-")}`;

/** `schemas/problem-codes.yaml` of the repository at `repoRoot`. */
export async function readProblemCodes(repoRoot: string): Promise<ProblemCodes> {
  const text = await readFile(join(repoRoot, "schemas", "problem-codes.yaml"), "utf8");
  return YAML.parse(text, { version: "1.2", schema: "core" }) as ProblemCodes;
}

const section = (codes: Readonly<Record<string, CodeText>>, kind: CodeKind): string[] =>
  Object.entries(codes).flatMap(([code, text]) => [
    `<a id="${codeAnchor(code, kind)}"></a>`,
    "",
    `### \`${code}\``,
    "",
    `**Cause:** ${inline(text.cause)}`,
    "",
    `**Remedy:** ${inline(text.remedy)}`,
    "",
  ]);

/** The Markdown page of all codes, problems first, each group in the order of the file. */
export function codesPage(codes: ProblemCodes): string {
  return [
    "---",
    "title: Problem and error codes",
    "description: The cause and the remedy of every problem code and every error code of ReqSeq.",
    "---",
    "",
    "Every message of ReqSeq carries a stable code. The app, the command line, the API and MCP show the same codes.",
    "",
    "## Problem codes",
    "",
    "A problem is a finding or a hint in the result of a command, for example of the workspace check, with a severity of error, warning or info. The command itself succeeded.",
    "",
    ...section(codes.problems, "problem"),
    "## Error codes",
    "",
    "An error means that the command did not run or did not finish: the command line prints it and exits with a code other than 0, the API answers with an HTTP error, and MCP returns a tool error.",
    "",
    ...section(codes.errors, "error"),
  ].join("\n");
}
