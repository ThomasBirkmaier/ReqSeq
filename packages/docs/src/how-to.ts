// How-to pages (SR-140 AK3): each shows its task in the app, the CLI, the API and MCP, in a section `## App`,
// `## CLI`, `## API` and `## MCP`; where the task is not possible in an access, its section says so. The names a
// section uses must exist in this build: command prompt entries (bold in `## App`), API paths with their body
// fields (`http` blocks in `## API`) and MCP tools with their arguments (`json` blocks with a `name` in `## MCP`).
import { COMMANDS_PATH } from "@reqseq/api";
import { appCommandEntry } from "@reqseq/app";
import type { CatalogEntry } from "@reqseq/core";
import { toolName } from "@reqseq/mcp";
import type { GeneratedContracts } from "./access.js";
import type { GuidePage } from "./examples.js";

/** The folder of the how-to pages below docs/guide/. */
export const HOW_TO_FOLDER = "how-to";

/** The section headings every how-to page has, in this order. */
export const ACCESSES: readonly string[] = ["App", "CLI", "API", "MCP"];

/** What the accesses of this build offer: command prompt entries, and the input fields of each command. */
export interface AccessNames {
  readonly appEntries: ReadonlySet<string>;
  /** Command name to the fields of its input (the MCP tool's input schema). */
  readonly inputs: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The names of the accesses: entries of the app for `commands`, and commands with an API path and an MCP tool. */
export function accessNames(commands: readonly CatalogEntry[], generated: GeneratedContracts): AccessNames {
  const inputs = new Map<string, ReadonlySet<string>>();
  for (const { name } of commands) {
    const tool = generated.mcpTools.tools.find((candidate) => candidate.name === toolName(name));
    if (tool !== undefined && generated.openapi.paths[`${COMMANDS_PATH}/${name}`] !== undefined) {
      inputs.set(name, new Set(Object.keys(tool.inputSchema?.properties ?? {})));
    }
  }
  return {
    appEntries: new Set(commands.map((entry) => appCommandEntry(entry, false).name)),
    inputs,
  };
}

/** The level-2 sections of a page by heading, each with its lines (fenced blocks included). */
function sections(text: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  let current: string[] | undefined;
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark !== undefined && (fence === undefined || line.trim() === fence)) {
      fence = fence === undefined ? mark : undefined;
    }
    const heading = fence === undefined && mark === undefined ? /^## (.+?)\s*$/.exec(line)?.[1] : undefined;
    if (heading !== undefined) {
      current = [];
      found.set(heading, current);
    } else {
      current?.push(line);
    }
  }
  return found;
}

/** The fenced blocks of `lang` in the lines of a section, each as its text. */
function fenced(lines: readonly string[], lang: string): string[] {
  const found: string[] = [];
  let open: string[] | undefined;
  for (const line of lines) {
    if (open === undefined) {
      open = line.trim() === `\`\`\`${lang}` ? [] : undefined;
    } else if (line.trim() === "```") {
      found.push(open.join("\n"));
      open = undefined;
    } else {
      open.push(line);
    }
  }
  return found;
}

/** The problems of the fields of an input object for `command`. */
function fieldProblems(where: string, command: string, input: unknown, names: AccessNames): string[] {
  const fields = names.inputs.get(command);
  if (fields === undefined) {
    return [`${where}: no command ${command} in the API and MCP`];
  }
  const keys = input !== null && typeof input === "object" ? Object.keys(input) : [];
  return keys.filter((key) => !fields.has(key)).map((key) => `${where}: ${command} has no input ${key}`);
}

/** The problems of an `http` block of `## API`: a request line `POST /v1/commands/<name>`, then an optional body. */
function requestProblems(where: string, block: string, names: AccessNames): string[] {
  const [head = "", ...rest] = block.split("\n");
  const command = new RegExp(`^POST ${COMMANDS_PATH}/(\\S+)$`).exec(head.trim())?.[1];
  if (command === undefined) {
    return [`${where}: an http block starts with POST ${COMMANDS_PATH}/<command>, not "${head}"`];
  }
  // The headers end at the first blank line; the body follows.
  const blank = rest.findIndex((line) => line.trim() === "");
  const body =
    blank < 0
      ? ""
      : rest
          .slice(blank + 1)
          .join("\n")
          .trim();
  return fieldProblems(where, command, body === "" ? {} : (JSON.parse(body) as unknown), names);
}

/**
 * The problems of a `json` block of `## MCP` that is a tool call, `{ "name": ..., "arguments": {...} }`; another
 * block, such as a client configuration, has no `name` and is no call.
 */
function toolCallProblems(where: string, block: string, names: AccessNames): string[] {
  const call = JSON.parse(block) as { name?: unknown; arguments?: unknown };
  if (call.name === undefined) {
    return [];
  }
  const command = [...names.inputs.keys()].find((name) => toolName(name) === call.name);
  return command === undefined
    ? [`${where}: no MCP tool ${JSON.stringify(call.name)}`]
    : fieldProblems(where, command, call.arguments, names);
}

/** What a how-to page lacks or names wrongly; empty when it shows its task in every access. */
export function howToProblems(page: GuidePage, names: AccessNames): string[] {
  const found = sections(page.text);
  const problems: string[] = [];
  for (const access of ACCESSES) {
    const lines = found.get(access);
    if (lines === undefined || lines.every((line) => line.trim() === "")) {
      problems.push(
        `${page.path}: no section "## ${access}" with its steps, or why it is not possible there`,
      );
    }
  }
  for (const [, entry = ""] of (found.get("App") ?? []).join("\n").matchAll(/\*\*([^*]+)\*\*/g)) {
    if (!names.appEntries.has(entry)) {
      problems.push(`${page.path}: ## App: the command prompt has no entry "${entry}"`);
    }
  }
  for (const block of fenced(found.get("API") ?? [], "http")) {
    problems.push(...requestProblems(`${page.path}: ## API`, block, names));
  }
  for (const block of fenced(found.get("MCP") ?? [], "json")) {
    problems.push(...toolCallProblems(`${page.path}: ## MCP`, block, names));
  }
  return problems;
}

/** Checks every how-to page of the guide; throws with all problems. Returns how many pages it checked. */
export function checkHowTos(pages: readonly GuidePage[], names: AccessNames): number {
  const howTos = pages.filter((page) => page.path.startsWith(`${HOW_TO_FOLDER}/`));
  const problems = howTos.flatMap((page) => howToProblems(page, names));
  if (problems.length > 0) {
    throw new Error(`docs: how-to pages\n${problems.join("\n")}`);
  }
  return howTos.length;
}
