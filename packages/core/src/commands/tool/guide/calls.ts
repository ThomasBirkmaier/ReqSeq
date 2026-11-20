// The calls the agent guide names (SR-229 AK1, AK6): a catalog command and its input, shown as a call of the
// command line or as the name of the MCP tool. The command is a `CommandName`, so a call of a command outside
// the catalog does not compile. The command-line form follows the catalog: a required field that is not a
// list, an object or a boolean is a positional argument in the order of the input schema, every other field a flag
// named by its catalog argument (`--set` for `properties`) or by the field in kebab-case (a boolean as
// `--x` or `--no-x`), an object of
// named values one `--<flag> key=<value>` per entry, a list one flag per item (packages/cli/src/fields.ts; a test
// of the command line checks that each call of the guide parses back to its command and input).
import type { CommandName } from "../../../catalog.js";
import type { CatalogEntry } from "../../../runtime/contracts.js";

/** How the guide names a command (`tool.guide` input `names`). */
export type GuideNames = "cli" | "mcp";

/** A call: the command and its input, with placeholders such as `<title>` for the values to fill in. */
export interface GuideCall {
  readonly command: CommandName;
  readonly input?: Readonly<Record<string, unknown>>;
}

/** `setStatus` -> `set-status`, as the command line names actions and flags. */
export const kebabCase = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** `element.setStatus` -> `element_setStatus`, the name of the MCP tool. */
export const mcpToolName = (command: string): string => command.replace(".", "_");

/** `element.setStatus` -> `reqseq element set-status`. */
export const commandLineName = (command: string): string => {
  const dot = command.indexOf(".");
  return `reqseq ${command.slice(0, dot)} ${kebabCase(command.slice(dot + 1))}`;
};

/** A word of a shell command line: as it is when the shell keeps it, else in single quotes. */
const shellWord = (word: string): string =>
  /^[\w./:=@%+-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

/** A value as the command line takes it: text as it is, anything else as JSON. */
const valueText = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a field of an input schema holds a list or an object, which never is a positional argument. */
const isComposite = (schema: unknown): boolean =>
  isRecord(schema) && (schema["type"] === "array" || schema["type"] === "object");

/** Whether a field of an input schema holds a boolean, which is a flag on the command line even when required. */
const isBoolean = (schema: unknown): boolean => isRecord(schema) && schema["type"] === "boolean";

/** The words of `call` on the command line after the command name, in the order the parser takes them. */
const commandLineWords = (entry: CatalogEntry, input: Readonly<Record<string, unknown>>): string[] => {
  const properties = isRecord(entry.input["properties"]) ? entry.input["properties"] : {};
  const required = Array.isArray(entry.input["required"]) ? (entry.input["required"] as unknown[]) : [];
  const fields = Object.keys(properties).filter((name) => Object.hasOwn(input, name));
  const positional = (name: string): boolean =>
    required.includes(name) && !isComposite(properties[name]) && !isBoolean(properties[name]);
  const flagOf = (name: string): string =>
    entry.arguments.find((argument) => argument.field === name)?.flag ?? kebabCase(name);
  const flags = fields
    .filter((name) => !positional(name))
    .flatMap((name) => {
      const value = input[name];
      const flag = `--${flagOf(name)}`;
      if (Array.isArray(value)) {
        return value.flatMap((item) => [flag, valueText(item)]);
      }
      // A boolean is a flag without a value on the command line: `--x` for true, `--no-x` for false.
      if (typeof value === "boolean") {
        return [value ? flag : `--no-${flagOf(name)}`];
      }
      return isRecord(value)
        ? Object.entries(value).flatMap(([key, item]) => [flag, `${key}=${valueText(item)}`])
        : [flag, valueText(value)];
    });
  return [...fields.filter(positional).map((name) => valueText(input[name])), ...flags];
};

/**
 * `call` as the guide shows it, in backticks: `reqseq element create need '<title>'` for `cli`,
 * `element_create` with its input as JSON for `mcp`. Throws for a command `entries` lacks, a programming error.
 */
export const renderCall = (call: GuideCall, names: GuideNames, entries: readonly CatalogEntry[]): string => {
  const entry = entries.find((candidate) => candidate.name === call.command);
  if (entry === undefined) {
    throw new Error(`the guide names ${call.command}, which is not in the catalog`);
  }
  const input = call.input ?? {};
  if (names === "mcp") {
    const tool = `\`${mcpToolName(call.command)}\``;
    return Object.keys(input).length === 0 ? tool : `${tool} with \`${JSON.stringify(input)}\``;
  }
  const words = [commandLineName(call.command), ...commandLineWords(entry, input).map(shellWord)];
  return `\`${words.join(" ")}\``;
};
