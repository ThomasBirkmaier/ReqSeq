// The reverse of the parser: the command line for a command input, for the cross-access test (SR-080,
// #125) and scripts. Uses positional arguments and flags where they carry the value exactly, and puts
// the rest into one inline `--input`. Generic like the parser: only the schema decides.
import type { CatalogEntry, JsonSchema } from "@reqseq/core";
import { contractsBundle } from "@reqseq/core";
import type { InputField } from "./fields.js";
import { inputFields, kebab } from "./fields.js";

/** A value that a flag or argument gives back unchanged after the parser (input.ts) converted it. */
const scalarText = (field: InputField, value: unknown): string | undefined => {
  if (field.kind === "string" && typeof value === "string" && !value.startsWith("-")) {
    return value;
  }
  // Negative numbers start with a dash, like an option: they go into --input.
  if (field.kind === "number" && typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(value);
  }
  return field.kind === "boolean" && typeof value === "boolean" ? String(value) : undefined;
};

/** `--<flag> key=<JSON>` per entry; a key with `=` and an empty object need `--input`. */
const entriesArgs = (field: InputField, value: unknown): string[] | undefined => {
  const entries =
    typeof value === "object" && value !== null && !Array.isArray(value) ? Object.entries(value) : [];
  return entries.length > 0 && entries.every(([key]) => key !== "" && !key.includes("="))
    ? entries.flatMap(([key, item]) => [`--${field.flag}`, `${key}=${JSON.stringify(item)}`])
    : undefined;
};

/** Flag arguments of one field, or `undefined` when the value needs `--input`. */
const flagArgs = (field: InputField, value: unknown): string[] | undefined => {
  if (field.entries) {
    return entriesArgs(field, value);
  }
  // A text that names a file or standard input would be read instead of taken.
  if (field.textFile && typeof value === "string" && value.startsWith("@")) {
    return undefined;
  }
  if (field.array) {
    const items = Array.isArray(value) ? value.map((item) => scalarText(field, item)) : [];
    return items.length > 0 && items.every((item) => item !== undefined)
      ? items.flatMap((item) => [`--${field.flag}`, item])
      : undefined;
  }
  if (field.kind === "boolean") {
    return typeof value === "boolean" ? [value ? `--${field.flag}` : `--no-${field.flag}`] : undefined;
  }
  const text = scalarText(field, value);
  return text === undefined ? undefined : [`--${field.flag}`, text];
};

/**
 * `reqseq` arguments that make `runCli` call `entry` with `input` (without `--json` and `--workspace`).
 * Local path fields are made absolute by the CLI against its current folder; give absolute paths or
 * run it in the folder the paths are relative to.
 */
export function argvFor(
  entry: CatalogEntry,
  input: Readonly<Record<string, unknown>>,
  schemas: readonly JsonSchema[] = contractsBundle.schemas,
): string[] {
  const dot = entry.name.indexOf(".");
  const group = entry.name.slice(0, dot);
  const action = entry.name.slice(dot + 1);
  const fields = inputFields(entry, schemas);
  const positionals: string[] = [];
  const flags: string[] = [];
  const consumed = new Set<string>();
  // Positional values fill the open positional fields in order, so stop at the first one that cannot.
  let positionalOpen = true;
  for (const field of fields.filter((f) => f.use === "positional")) {
    const text = scalarText(field, input[field.name]);
    positionalOpen &&= text !== undefined;
    if (positionalOpen && text !== undefined) {
      positionals.push(text);
      consumed.add(field.name);
    }
  }
  for (const field of fields.filter((f) => f.use === "flag" && Object.hasOwn(input, f.name))) {
    const args = flagArgs(field, input[field.name]);
    if (args !== undefined) {
      flags.push(...args);
      consumed.add(field.name);
    }
  }
  const rest = Object.fromEntries(Object.entries(input).filter(([name]) => !consumed.has(name)));
  const json = Object.keys(rest).length > 0 ? ["--input", JSON.stringify(rest)] : [];
  return [group, kebab(action), ...positionals, ...flags, ...json];
}
