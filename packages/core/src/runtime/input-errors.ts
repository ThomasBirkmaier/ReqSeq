// Readable messages for a command input that fails its catalog schema (#309). Built in core, so every
// access shows the same text (SR-080 AK2); the CLI only respells the field names (ADR-0002 rule 3).
// A message names the field by its input name and never shows a regular expression or "(root)".
// Messages of the shared definitions (`$defs`) come from one table, never per command: the def a
// failing keyword belongs to is its `parentSchema` (Ajv `verbose`), the def object itself.
import type { ErrorObject } from "ajv/dist/2020.js";
import type { JsonSchema } from "../catalog.js";
import type { SchemaViolation } from "./contracts.js";

/** One failed check of a command input, as `CommandError.details.errors` of `input.invalid` holds it. */
export interface InputViolation extends SchemaViolation {
  /**
   * The input field the violation is about, as the input names it: `ref`, `properties.requirement-type`,
   * `refs[0]`; `""` for the input as a whole. `message` starts with it whenever it is not empty, so an
   * adapter can respell it (the CLI shows `<path>` or `--package`).
   */
  readonly field: string;
}

/** Example short ID in messages. */
const SHORT_ID_FORM = "prefix, dash, at least 6 hex characters, for example SR-3c90b0";

/** What a value of a shared definition must look like, after "is" / "is not". */
const DEF_MESSAGES: Readonly<Record<string, string>> = {
  "common.schema.json#/$defs/elementRef": `is neither a UUID nor a short ID (${SHORT_ID_FORM})`,
  "common.schema.json#/$defs/uuid": "is not a UUID (for example 6adc6d27-b7a2-49dd-9b02-2b572655ebad)",
  "common.schema.json#/$defs/uuidRef": "is not a UUID (for example 6adc6d27-b7a2-49dd-9b02-2b572655ebad)",
  "common.schema.json#/$defs/shortId": `is not a short ID (${SHORT_ID_FORM})`,
  "common.schema.json#/$defs/view": `is neither core nor a UUID or short ID of a variant (${SHORT_ID_FORM})`,
  "common.schema.json#/$defs/key":
    "is not a key (lower case letters and digits, words joined by single dashes, for example system-requirement)",
  "common.schema.json#/$defs/version": "is not a version (for example n1:9f86d081884c7d65)",
  "common.schema.json#/$defs/commit": "is not a full Git commit ID (40 or 64 hex characters)",
  "common.schema.json#/$defs/relativePath":
    "is not a relative path (forward slashes, no leading slash, no drive letter, no .. segment)",
  "common.schema.json#/$defs/date": "is not a date YYYY-MM-DD",
  "common.schema.json#/$defs/dateTime": "is not a date and time (for example 2026-10-26T09:30:00Z)",
  "element.schema.json#/$defs/inputValue":
    "is not a property value (text, a number, true or false, a list of these, a relation target { id } or a list of them)",
};

/**
 * Def name (`file#/$defs/name`) by the def object, for every def of `DEF_MESSAGES`. Ajv keeps the
 * objects of the schemas it was given, so the `parentSchema` of an error is the def itself.
 */
const defsOf = (schemas: readonly JsonSchema[]): WeakMap<object, string> => {
  const byObject = new WeakMap<object, string>();
  for (const schema of schemas) {
    const file = String(schema["$id"]).replace(/^.*\//, "");
    const defs = (schema["$defs"] ?? {}) as Readonly<Record<string, JsonSchema>>;
    for (const [name, def] of Object.entries(defs)) {
      const key = `${file}#/$defs/${name}`;
      if (key in DEF_MESSAGES) {
        byObject.set(def, key);
      }
    }
  }
  return byObject;
};

/** Longest text of a value quoted in a message. */
const SHOWN_TEXT = 60;

/** A value as a message quotes it: text in quotes (cut), numbers and booleans as they are. */
const quote = (value: unknown): string => {
  if (typeof value === "string") {
    return JSON.stringify(value.length > SHOWN_TEXT ? `${value.slice(0, SHOWN_TEXT)}...` : value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "empty";
  }
  return Array.isArray(value) ? "a list" : "an object";
};

/** A value as the subject of a message: `"SR-036"`, `5`, `(a list)`. */
const subject = (value: unknown): string => {
  const quoted = quote(value);
  return typeof value === "object" ? `(${quoted})` : quoted;
};

/** Every type of JSON Schema, as messages name it. */
const TYPE_NAMES: Readonly<Record<string, string>> = {
  string: "text",
  number: "a number",
  integer: "a whole number",
  boolean: "true or false",
  array: "a list",
  object: "an object",
  null: "empty",
};

const typeName = (type: unknown): string =>
  (Array.isArray(type) ? type : [type]).map((t) => String(TYPE_NAMES[String(t)])).join(" or ");

/** JSON Pointer segments of an Ajv `instancePath`. */
const segmentsOf = (pointer: string): string[] =>
  pointer === ""
    ? []
    : pointer
        .split("/")
        .slice(1)
        .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));

/** `["refs", "0"]` -> `refs[0]`, `["properties", "type"]` -> `properties.type`. */
const fieldOf = (segments: readonly string[]): string =>
  segments.reduce(
    (name, segment) =>
      /^\d+$/.test(segment) ? `${name}[${segment}]` : name === "" ? segment : `${name}.${segment}`,
    "",
  );

/** The value at a JSON Pointer of the checked input. */
const valueAt = (input: unknown, segments: readonly string[]): unknown => {
  let node = input;
  for (const segment of segments) {
    // Ajv reports paths into the value it checked: every step but the last is an object or a list.
    node = (node as Readonly<Record<string, unknown>>)[segment];
  }
  return node;
};

/** `n item` or `n items`. */
const items = (count: unknown, noun: string): string => `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

const isUnder = (path: string, parent: string): boolean => path === parent || path.startsWith(`${parent}/`);

type KeywordText = (value: unknown, params: Readonly<Record<string, unknown>>, error: ErrorObject) => string;

const bound: KeywordText = (value, p) =>
  `must be ${String(p["comparison"])} ${String(p["limit"])}, not ${quote(value)}`;

/** A value that has not the form its schema describes; the description is added when there is one. */
const notTheForm: KeywordText = (value, _p, error) => {
  const description = (error.parentSchema as JsonSchema | undefined)?.["description"];
  return `${subject(value)} does not have the expected form${typeof description === "string" ? `: ${description}` : ""}`;
};

/** What a field must be, by keyword, when no def message applies; after the field name. */
const KEYWORD_TEXTS: Readonly<Record<string, KeywordText>> = {
  type: (value, p) => `must be ${typeName(p["type"])}, not ${quote(value)}`,
  enum: (value, _p, error) =>
    `${subject(value)} is not one of: ${(error.schema as readonly unknown[]).map(String).join(", ")}`,
  const: (value, p) => `${subject(value)} is not ${String(p["allowedValue"])}`,
  minLength: (_v, p) =>
    p["limit"] === 1 ? "must not be empty" : `must have at least ${items(p["limit"], "character")}`,
  maxLength: (_v, p) => `must have at most ${items(p["limit"], "character")}`,
  minItems: (_v, p) => `must have at least ${items(p["limit"], "item")}`,
  maxItems: (_v, p) => `must have at most ${items(p["limit"], "item")}`,
  uniqueItems: () => "must not hold the same item twice",
  minimum: bound,
  maximum: bound,
  exclusiveMinimum: bound,
  exclusiveMaximum: bound,
  format: (value, p) => `${subject(value)} is not a valid ${String(p["format"])}`,
  not: (value) => `${subject(value)} is not allowed here`,
  pattern: notTheForm,
  anyOf: notTheForm,
  oneOf: notTheForm,
};

const keywordText = (error: ErrorObject, value: unknown): string => {
  const text = KEYWORD_TEXTS[error.keyword];
  // Ajv's own text names no regular expression for any other keyword.
  return text === undefined
    ? String(error.message)
    : text(value, error.params as Readonly<Record<string, unknown>>, error);
};

/** What `inputViolations` needs besides the errors: the checked input and the schemas of the catalog. */
export interface InputErrorContext {
  readonly input: unknown;
  readonly schemas: readonly JsonSchema[];
}

const known = new WeakMap<readonly JsonSchema[], WeakMap<object, string>>();

/**
 * The readable violations of an input that failed its schema, in Ajv's order, each once. Errors
 * inside a branch of an `anyOf` (or `oneOf`) at the same place are left out: the `anyOf` gives one
 * message for them. Requires errors of an Ajv instance with `verbose: true`.
 */
export function inputViolations(
  errors: readonly ErrorObject[] | null | undefined,
  context: InputErrorContext,
): InputViolation[] {
  let defs = known.get(context.schemas);
  if (defs === undefined) {
    defs = defsOf(context.schemas);
    known.set(context.schemas, defs);
  }
  const all = errors ?? [];
  const either = all.filter((e) => e.keyword === "anyOf" || e.keyword === "oneOf");
  const propertyNames = all.filter((e) => e.keyword === "propertyNames");
  const out: InputViolation[] = [];
  all.forEach((error, index) => {
    const swallowed =
      either.some(
        (e) => e !== error && all.indexOf(e) > index && isUnder(error.instancePath, e.instancePath),
      ) ||
      propertyNames.some(
        (e) =>
          e !== error &&
          e.instancePath === error.instancePath &&
          error.schemaPath.includes("/propertyNames/"),
      );
    if (swallowed) {
      return;
    }
    const segments = segmentsOf(error.instancePath);
    const p = error.params as Readonly<Record<string, unknown>>;
    let field = fieldOf(segments);
    let message: string;
    if (error.keyword === "required") {
      field = fieldOf([...segments, String(p["missingProperty"])]);
      message = `${field} is required`;
    } else if (error.keyword === "additionalProperties") {
      field = fieldOf([...segments, String(p["additionalProperty"])]);
      message = `${field} is not ${segments.length === 0 ? "an input of this command" : `a field of ${fieldOf(segments)}`}`;
    } else if (error.keyword === "propertyNames") {
      message = `${field} cannot hold ${String(p["propertyName"])}`;
    } else {
      const value = valueAt(context.input, segments);
      const def = defs.get(error.parentSchema as object);
      const defText = def === undefined || error.keyword === "type" ? undefined : DEF_MESSAGES[def];
      const text = defText === undefined ? keywordText(error, value) : `${subject(value)} ${defText}`;
      message = field === "" ? `The input ${text}` : `${field} ${text}`;
    }
    // The regular expression of a pattern stays out of the error object too: the message says the form.
    const params = error.keyword === "pattern" ? {} : error.params;
    out.push({ path: error.instancePath, field, keyword: error.keyword, message, params });
  });
  return out;
}

/** The violations for the message of `input.invalid`, joined with `; `. */
export const describeInputViolations = (violations: readonly InputViolation[]): string =>
  violations.map((v) => v.message).join("; ");
