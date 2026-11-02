// Turns the command line into a command input object. Only transport: the values stay as given (numbers
// and booleans converted when they look like one, local paths made absolute); core validates the result.
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "@reqseq/core";
import type { InputField, PartFlag, ScalarKind } from "./fields.js";
import { kebab } from "./fields.js";
import type { Invocation } from "./program.js";

/** Where `--input -` reads from. */
export type InputStream = AsyncIterable<string | Uint8Array>;

const NUMBER = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/** A flag value as the schema expects it; values that do not fit stay strings, so core reports them. */
const convert = (kind: ScalarKind | "complex", value: string): unknown => {
  if (kind === "number" && NUMBER.test(value)) {
    return Number(value);
  }
  if (kind === "boolean" && (value === "true" || value === "false")) {
    return value === "true";
  }
  return value;
};

const readStream = async (stream: InputStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const readInputFile = async (file: string, cwd: string): Promise<Buffer> => {
  try {
    return await fs.readFile(path.resolve(cwd, file));
  } catch (error) {
    throw new CommandError("input.invalid", `Cannot read the input file ${file}`, { file }, { cause: error });
  }
};

/**
 * Text of an input file or of standard input: UTF-8 (with or without byte order mark), or UTF-16 with a
 * byte order mark, as Windows PowerShell writes files (`>` and `Out-File`).
 */
const decode = (bytes: Buffer, source: string): string => {
  const littleEndian = bytes[0] === 0xff && bytes[1] === 0xfe;
  if (littleEndian || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    const body = Buffer.from(bytes.subarray(2));
    if (body.length % 2 !== 0) {
      throw new CommandError("input.invalid", `Input from ${source} is not valid UTF-16`);
    }
    return (littleEndian ? body : body.swap16()).toString("utf16le");
  }
  const text = bytes.toString("utf8");
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
};

/** Shells that drop quotes inside arguments turn inline JSON into something else. */
const INLINE_HINT =
  " (if the shell removed the quotes, as PowerShell and cmd.exe do, use --input @file or --input -)";

/** `--input <json|@file|->`: inline JSON, a JSON file (relative to the current folder) or standard input. */
export async function readInputOption(
  value: string,
  cwd: string,
  stdin: InputStream,
): Promise<Record<string, unknown>> {
  const [source, text] =
    value === "-"
      ? ["standard input", decode(await readStream(stdin), "standard input")]
      : value.startsWith("@")
        ? [value.slice(1), decode(await readInputFile(value.slice(1), cwd), value.slice(1))]
        : ["--input", value];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const hint = source === "--input" ? INLINE_HINT : "";
    throw new CommandError("input.invalid", `Input from ${source} is not valid JSON${hint}`, undefined, {
      cause: error,
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CommandError("input.invalid", `Input from ${source} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** `key=value` of an entries flag (#171): the value as JSON when it parses, else the text as it is. */
const entryOf = (field: InputField, item: string): [string, unknown] => {
  const at = item.indexOf("=");
  if (at <= 0) {
    throw new CommandError("input.invalid", `--${field.flag} expects key=value, not ${item}`, {
      argument: item,
    });
  }
  const text = item.slice(at + 1);
  try {
    return [item.slice(0, at), JSON.parse(text)];
  } catch {
    return [item.slice(0, at), text];
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Local paths are relative to the current folder on the command line; the command gets them absolute. */
const absolute = (value: unknown, cwd: string): unknown =>
  typeof value === "string" && value !== "" ? path.resolve(cwd, value) : value;

const resolveLocalPaths = (
  fields: readonly InputField[],
  input: Record<string, unknown>,
  cwd: string,
): void => {
  for (const field of fields.filter((f) => f.localPath && Object.hasOwn(input, f.name))) {
    const value = input[field.name];
    input[field.name] = Array.isArray(value)
      ? value.map((item) => absolute(item, cwd))
      : absolute(value, cwd);
  }
};

/** Where a text flag reads `@file` and `-` from; standard input is read once per call. */
interface TextSource {
  readonly cwd: string;
  readonly stdin: InputStream;
  stdinRead: boolean;
}

/** `@file` or `-` of a text flag (#171): the text of that file or of standard input. */
const readText = async (
  field: { readonly flag: string },
  value: string,
  source: TextSource,
): Promise<string> => {
  if (value !== "-") {
    return decode(await readInputFile(value.slice(1), source.cwd), value.slice(1));
  }
  if (source.stdinRead) {
    throw new CommandError("input.invalid", `--${field.flag} - cannot read standard input a second time`);
  }
  source.stdinRead = true;
  return decode(await readStream(source.stdin), "standard input");
};

/** The value a given flag puts into the input; `given` is what `--input` or an argument gave. */
const flagValue = async (
  field: InputField,
  value: unknown,
  given: unknown,
  source: TextSource,
): Promise<unknown> => {
  if (field.entries && Array.isArray(value)) {
    return {
      ...(isObject(given) ? given : {}),
      ...Object.fromEntries(value.map((item: string) => entryOf(field, item))),
    };
  }
  if (field.textFile && typeof value === "string" && (value === "-" || value.startsWith("@"))) {
    return readText(field, value, source);
  }
  if (Array.isArray(value)) {
    return value.map((item: string) => convert(field.kind, item));
  }
  // Boolean flags are true for --x and false for --no-x.
  return typeof value === "string" ? convert(field.kind, value) : value;
};

/**
 * `value` with `item` at `path` (`[]`: `item` itself); objects on the way are copied. A value on the
 * way that is no object stays as `--input` gave it, so core reports it.
 */
const setAt = (value: unknown, path: readonly string[], item: unknown): unknown => {
  const [head, ...rest] = path;
  if (head === undefined) {
    return item;
  }
  if (value !== undefined && !isObject(value)) {
    return value;
  }
  const object = value ?? {};
  return { ...object, [head]: setAt(object[head], rest, item) };
};

const getAt = (value: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((at, key) => (isObject(at) ? at[key] : undefined), value);

/** `<by>[:asc|desc]`: only `:asc` or `:desc` at the end is split off. */
const sortKeyOf = (text: string): Record<string, string> => {
  const match = /^(.+):(asc|desc)$/.exec(text);
  return match?.[1] !== undefined && match[2] !== undefined
    ? { by: match[1], order: match[2] }
    : { by: text };
};

/** `--where <json|@file|->`: the condition as JSON; core checks it. */
const conditionOf = async (part: PartFlag, value: string, source: TextSource): Promise<unknown> => {
  const text = value === "-" || value.startsWith("@") ? await readText(part, value, source) : value;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const hint = text === value ? INLINE_HINT.replaceAll("--input", `--${part.flag}`) : "";
    throw new CommandError("input.invalid", `--${part.flag} is not valid JSON${hint}`, undefined, {
      cause: error,
    });
  }
};

/**
 * The value of a field with part flags (#149, #173), from what `--input` gave: each property flag
 * replaces that property (a list flag the whole list), `--where` the condition, `--sort` the list; the
 * values of one key flag form `{ <key>: [values] }`, added to the condition there with `all`.
 */
const withParts = async (
  given: unknown,
  parts: readonly { readonly part: PartFlag; readonly value: unknown }[],
  source: TextSource,
): Promise<unknown> => {
  let value = given;
  const keyConditions = new Map<string, { path: readonly string[]; conditions: unknown[] }>();
  for (const { part, value: raw } of parts) {
    const items = (Array.isArray(raw) ? raw : [raw]).map(String);
    if (part.role === "key") {
      const at = keyConditions.get(part.path.join("/")) ?? { path: part.path, conditions: [] };
      at.conditions.push({ [String(part.key)]: items });
      keyConditions.set(part.path.join("/"), at);
    } else if (part.role === "condition") {
      value = setAt(value, part.path, await conditionOf(part, items.join(""), source));
    } else if (part.role === "sort") {
      value = setAt(value, part.path, items.map(sortKeyOf));
    } else {
      const converted = items.map((item) => convert(part.kind, item));
      value = setAt(value, part.path, part.array ? converted : converted[0]);
    }
  }
  for (const { path: at, conditions } of keyConditions.values()) {
    const before = getAt(value, at);
    // An `all` alone takes the conditions into its list, so it is not nested.
    const all =
      before === undefined
        ? conditions
        : isObject(before) && Object.keys(before).join() === "all" && Array.isArray(before["all"])
          ? [...(before["all"] as unknown[]), ...conditions]
          : [before, ...conditions];
    value = setAt(value, at, all.length === 1 ? all[0] : { all });
  }
  return value;
};

/**
 * The form of a call: the positional fields, the other required fields as flags (`--refs <refs>...`
 * for a list), the optional element flags of the catalog (`[--successor <successor>]`), then
 * `[options]` (#449).
 */
const usageOf = (invocation: Invocation, command: string): string => {
  const elements = new Set(
    invocation.entry.arguments.filter((a) => a.complete === "element").map((a) => a.field),
  );
  const flag = (f: InputField): string => `--${f.flag} <${f.flag}>${f.array ? "..." : ""}`;
  const flags = invocation.fields.filter((f) => f.use === "flag");
  return [
    `reqseq ${command}`,
    ...invocation.positionals.map((p) => `<${p.field.flag}>`),
    ...flags.filter((f) => f.required).map(flag),
    // A required field with part flags: any of them gives it (#149).
    ...invocation.fields
      .filter((f) => f.use === "parts" && f.required)
      .map((f) => `{${f.parts.map((p) => `--${p.flag}`).join("|")}}`),
    ...flags.filter((f) => !f.required && elements.has(f.name)).map((f) => `[${flag(f)}]`),
    "[options]",
  ].join(" ");
};

/**
 * `input.invalid` for an argument that no positional field takes, with the form of the call. It does not
 * guess which value belongs to which field: the order the user had in mind is not known (#449).
 */
const unexpectedArgument = (
  invocation: Invocation,
  given: ReadonlySet<string>,
  value: string,
): CommandError => {
  const name = invocation.entry.name;
  const command = `${name.slice(0, name.indexOf("."))} ${kebab(name.slice(name.indexOf(".") + 1))}`;
  const taken = invocation.positionals.map((p) => p.field).filter((f) => given.has(f.name));
  const takes = invocation.positionals.map((p) => `<${p.field.flag}>`).join(" ");
  const reason =
    taken.length > 0
      ? `--input or a flag already gives ${taken.map((f) => f.name).join(", ")}`
      : takes === ""
        ? `${command} takes no arguments`
        : `${command} takes ${takes}`;
  const usage = usageOf(invocation, command);
  return new CommandError(
    "input.invalid",
    `Unexpected argument ${value}: ${reason}; the form is ${usage} (reqseq ${command} --help)`,
    { argument: value, usage },
  );
};

/**
 * The command input: `--input` first; positional values fill the positional fields that neither
 * `--input` nor a flag gives, in order; flags override the same field from `--input`, an entries flag
 * (`--set key=value`) key by key, part flags (`--ids`, `--where-type`) part by part (`withParts`); a
 * text flag reads `@file` and `-`; local paths become absolute.
 */
export async function buildInput(
  invocation: Invocation,
  cwd: string,
  stdin: InputStream,
): Promise<Record<string, unknown>> {
  const input = invocation.input === undefined ? {} : await readInputOption(invocation.input, cwd, stdin);
  const values = [
    ...invocation.positionals.flatMap(({ value }) => (value === undefined ? [] : [value])),
    ...invocation.extraArguments,
  ];
  const given = new Set([
    ...Object.keys(input),
    ...invocation.flags.filter((f) => f.value !== undefined).map((f) => f.field.name),
  ]);
  const open = invocation.positionals.map(({ field }) => field).filter((f) => !given.has(f.name));
  values.forEach((value, i) => {
    const field = open[i];
    if (field === undefined) {
      throw unexpectedArgument(invocation, given, value);
    }
    input[field.name] = value;
  });
  const source = { cwd, stdin, stdinRead: invocation.input === "-" };
  const parted = new Map<InputField, { part: PartFlag; value: unknown }[]>();
  for (const { field, part, value } of invocation.flags) {
    if (value === undefined) {
      continue;
    }
    if (part === undefined) {
      input[field.name] = await flagValue(field, value, input[field.name], source);
    } else {
      parted.set(field, [...(parted.get(field) ?? []), { part, value }]);
    }
  }
  for (const [field, parts] of parted) {
    input[field.name] = await withParts(input[field.name], parts, source);
  }
  resolveLocalPaths(invocation.fields, input, cwd);
  return input;
}
