// Turns the command line into a command input object. Only transport: the values stay as given (numbers
// and booleans converted when they look like one, local paths made absolute); core validates the result.
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "@reqseq/core";
import type { InputField, ScalarKind } from "./fields.js";
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
 * `--input` nor a flag gives, in order; flags override the same field from `--input`; local paths
 * become absolute.
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
  for (const { field, value } of invocation.flags) {
    if (Array.isArray(value)) {
      input[field.name] = value.map((item: string) => convert(field.kind, item));
    } else if (typeof value === "string") {
      input[field.name] = convert(field.kind, value);
    } else if (value !== undefined) {
      // Boolean flags: true for --x, false for --no-x.
      input[field.name] = value;
    }
  }
  resolveLocalPaths(invocation.fields, input, cwd);
  return input;
}
