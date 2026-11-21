// How-to pages (SR-140 AK3): each shows its task in the app, the CLI, the API and MCP, in a section `## App`,
// `## CLI`, `## API` and `## MCP`; where the task is not possible in an access, its section says so. The names a
// section uses must exist in this build: command prompt entries (bold in `## App`), API paths with their body
// fields (`http` blocks in `## API`) and MCP tools with their arguments (`json` blocks with a `name` in `## MCP`).
import { COMMANDS_PATH } from "@reqseq/api";
import type { ShortcutSection } from "@reqseq/app";
import { SHORTCUT_TABLES, appCommandEntry } from "@reqseq/app";
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
    // The entries of the catalog's commands, and the actions of the app by their titles ("Write skill file").
    appEntries: new Set([
      ...commands.flatMap((entry) => {
        const app = appCommandEntry(entry, false);
        return app.shownIn === undefined ? [app.name] : [];
      }),
      ...SHORTCUT_TABLES.actions.map((action) => action.title),
    ]),
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

/**
 * The fenced blocks of `lang` in the lines of a section, each as its text. The fence may be longer than three
 * characters or use `~`, and attributes may follow the language (`title="..."`), so no such block is passed over.
 */
function fenced(lines: readonly string[], lang: string): string[] {
  const found: string[] = [];
  let open: { fence: string; lines: string[] } | undefined;
  for (const line of lines) {
    const text = line.trim();
    if (open === undefined) {
      const fence = new RegExp(`^(\`{3,}|~{3,})${lang}(?:\\s.*)?$`).exec(text)?.[1];
      open = fence === undefined ? undefined : { fence, lines: [] };
    } else if (text === open.fence) {
      found.push(open.lines.join("\n"));
      open = undefined;
    } else {
      open.lines.push(line);
    }
  }
  return found;
}

/** The JSON of a block, or the problem that it is no JSON. */
function parseJson(where: string, text: string): { value: unknown } | { problem: string } {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    return { problem: `${where}: no valid JSON: ${(error as Error).message}` };
  }
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
  const input = parseJson(where, body === "" ? "{}" : body);
  return "problem" in input ? [input.problem] : fieldProblems(where, command, input.value, names);
}

/**
 * The problems of a `json` block of `## MCP` that is a tool call, `{ "name": ..., "arguments": {...} }`; another
 * block, such as a client configuration, has no `name` and is no call.
 */
function toolCallProblems(where: string, block: string, names: AccessNames): string[] {
  const parsed = parseJson(where, block);
  if ("problem" in parsed) {
    return [parsed.problem];
  }
  const call = (parsed.value ?? {}) as { name?: unknown; arguments?: unknown };
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

/**
 * The keys of the app as the keyboard reference writes them (`shortcutReference`): each label on Windows and Linux
 * with the labels on macOS it stands beside in a row, and the labels that exist on one system only.
 */
export interface KeyPairs {
  readonly pairs: ReadonlyMap<string, ReadonlySet<string>>;
  readonly plainOnly: ReadonlySet<string>;
  readonly macOnly: ReadonlySet<string>;
}

/** The pairs of the rows of `sections`: the n-th key of a row on Windows and Linux with its n-th key on macOS. */
export function keyPairs(sections: readonly ShortcutSection[]): KeyPairs {
  const pairs = new Map<string, Set<string>>();
  const plainOnly = new Set<string>();
  const macOnly = new Set<string>();
  for (const { keys, mac } of sections.flatMap((section) => section.rows)) {
    keys.forEach((key, index) => {
      const partner = mac[index];
      if (partner === undefined) {
        plainOnly.add(key);
      } else {
        pairs.set(key, new Set([...(pairs.get(key) ?? []), partner]));
      }
    });
    for (const key of mac.slice(keys.length)) {
      macOnly.add(key);
    }
  }
  return { pairs, plainOnly, macOnly };
}

/** A key name after the modifiers, longest first; a letter not followed by another one. */
const KEY_NAME =
  "(?:Page Up|Page Down|Backspace|Escape|Enter|Space|Click|click|Home|Tab|Up|Down|Left|Right|End|F\\d{1,2}|[A-Za-z])(?![A-Za-z])";
/** A key with Ctrl, Alt or Shift, as Windows and Linux write it ("Ctrl+Shift+P"), and a letter after the prefix key. */
const PLAIN_KEY = `(?:Ctrl|Alt|Shift)(?:\\+(?:Ctrl|Alt|Shift))*\\+${KEY_NAME}(?: [A-Z](?!\\w))?`;
/** A key as macOS writes it ("⌘⇧P", "⌥⌘A", "⌘↩"). */
const MAC_KEY = `[⌃⌥⌘⇧]+(?:↩|${KEY_NAME})(?: [A-Z](?!\\w))?`;

/** The text of a page outside fenced blocks and code spans, where keys are named in prose. */
const prose = (text: string): string => {
  let fence: string | undefined;
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark !== undefined && (fence === undefined || line.trim() === fence)) {
      fence = fence === undefined ? mark : undefined;
    } else if (fence === undefined) {
      kept.push(line.replace(/`[^`]*`/g, ""));
    }
  }
  return kept.join("\n");
};

/**
 * The keys a page names wrongly: each key with Ctrl, Alt or Shift comes with its macOS key as the app shows it, after
 * a comma or in parentheses ("Ctrl+K E, ⌘K E", "Ctrl+Enter (⌘↩)"), and each macOS key after its key on Windows and
 * Linux, unless the key exists on one system only. Keys without a modifier (Enter, Escape) are named once.
 */
export function shortcutProblems(page: GuidePage, keys: KeyPairs): string[] {
  const text = prose(page.text);
  const problems: string[] = [];
  const partnered = new Set<number>();
  for (const match of text.matchAll(new RegExp(PLAIN_KEY, "g"))) {
    const [key] = match;
    const after = match.index + key.length;
    const mac = new RegExp(`(?:, | \\()(${MAC_KEY})`, "y");
    mac.lastIndex = after;
    const macKey = mac.exec(text)?.[1];
    if (macKey !== undefined) {
      // Both separators are two characters long.
      partnered.add(after + 2);
    }
    const expected = keys.pairs.get(key);
    const named = [...(expected ?? [])].map((label) => `"${label}"`).join(" or ");
    if (expected === undefined && !keys.plainOnly.has(key)) {
      problems.push(`${page.path}: "${key}" is no key of the app`);
    } else if (expected === undefined) {
      if (macKey !== undefined) {
        problems.push(`${page.path}: "${key}" has no macOS key, not "${macKey}"`);
      }
    } else if (macKey === undefined) {
      problems.push(`${page.path}: "${key}" without its macOS key ${named}`);
    } else if (!expected.has(macKey)) {
      problems.push(`${page.path}: "${key}" is ${named} on macOS, not "${macKey}"`);
    }
  }
  for (const match of text.matchAll(new RegExp(MAC_KEY, "g"))) {
    if (!partnered.has(match.index) && !keys.macOnly.has(match[0])) {
      problems.push(`${page.path}: "${match[0]}" without its key on Windows and Linux before it`);
    }
  }
  return problems;
}
