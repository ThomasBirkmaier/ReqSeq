// Turns the command line into a command input object. Only transport: the values stay as given (numbers
// and booleans converted when they look like one, local paths made absolute); core validates the result.
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "@reqseq/core";
import type { InputField, ScalarKind } from "./fields.js";
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
const readText = async (field: InputField, value: string, source: TextSource): Promise<string> => {
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
 * The command input: `--input` first; positional values fill the positional fields that neither
 * `--input` nor a flag gives, in order; flags override the same field from `--input`, an entries flag
 * (`--set key=value`) key by key; a text flag reads `@file` and `-`; local paths become absolute.
 */
export async function buildInput(
  invocation: Invocation,
  cwd: string,
  stdin: InputStream,
): Promise<Record<string, unknown>> {
  const input = invocation.input === undefined ? {} : await readInputOption(invocation.input, cwd, stdin);
  const values = invocation.positionals.flatMap(({ value }) => (value === undefined ? [] : [value]));
  const flagged = new Set(invocation.flags.filter((f) => f.value !== undefined).map((f) => f.field.name));
  const open = invocation.positionals
    .map(({ field }) => field)
    .filter((f) => !Object.hasOwn(input, f.name) && !flagged.has(f.name));
  values.forEach((value, i) => {
    const field = open[i];
    if (field === undefined) {
      const given = invocation.positionals
        .map((p) => p.field.name)
        .filter((name) => !open.some((f) => f.name === name));
      throw new CommandError(
        "input.invalid",
        `Unexpected argument ${value}: --input or a flag already gives ${given.join(", ")}`,
        { argument: value },
      );
    }
    input[field.name] = value;
  });
  const source = { cwd, stdin, stdinRead: invocation.input === "-" };
  for (const { field, value } of invocation.flags) {
    if (value !== undefined) {
      input[field.name] = await flagValue(field, value, input[field.name], source);
    }
  }
  resolveLocalPaths(invocation.fields, input, cwd);
  return input;
}
