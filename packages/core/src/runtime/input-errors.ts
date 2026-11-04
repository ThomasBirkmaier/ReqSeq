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
  "common.schema.json#/$defs/elementRef":
    "is not a reference to an element (a UUID, a short ID such as SR-3c90b0 or an identifier such as SR-036; at most 256 characters, without control characters or spaces at either end)",
  "common.schema.json#/$defs/uuid": "is not a UUID (for example 6adc6d27-b7a2-49dd-9b02-2b572655ebad)",
  "common.schema.json#/$defs/uuidRef": "is not a UUID (for example 6adc6d27-b7a2-49dd-9b02-2b572655ebad)",
  "common.schema.json#/$defs/shortId": `is not a short ID (${SHORT_ID_FORM})`,
  "common.schema.json#/$defs/view":
    "is neither core nor a reference to a variant (a UUID, a short ID such as SR-3c90b0 or an identifier such as SR-036; at most 256 characters, without control characters or spaces at either end)",
  "common.schema.json#/$defs/key":
    "is not a key (lower case letters and digits, words joined by single dashes, for example system-requirement)",
  "common.schema.json#/$defs/version": "is not a version (for example n1:9f86d081884c7d65)",
  "common.schema.json#/$defs/commit": "is not a full Git commit ID (40 or 64 hex characters)",
  "common.schema.json#/$defs/relativePath":
    "is not a relative path (forward slashes, no leading slash, no drive letter, no .. segment)",
  "common.schema.json#/$defs/date": "is not a date YYYY-MM-DD",
  "common.schema.json#/$defs/dateTime": "is not a date and time (for example 2026-10-26T09:30:00Z)",
  "filter.schema.json#/$defs/name":
    "is not a filter name (at most 200 characters, without control characters or spaces at either end)",
  "element.schema.json#/$defs/inputValue":
    "is not a property value (text, a number, true or false, a list of these, a relation target { id } with an element reference, or a list of them)",
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
  if (value === undefined) {
    return "missing";
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
export const segmentsOf = (pointer: string): string[] =>
  pointer === ""
    ? []
    : pointer
        .split("/")
        .slice(1)
        .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));

/** `["refs", "0"]` -> `refs[0]`, `["properties", "type"]` -> `properties.type`. */
export const fieldOf = (segments: readonly string[]): string =>
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

/**
 * A value that has not the form its schema describes; the description is added when there is one, and
 * the keys that tell the branches of a `oneOf` or `anyOf` apart when no key or several of them are there
 * (#150).
 */
const notTheForm: KeywordText = (value, p, error) => {
  const description = (error.parentSchema as JsonSchema | undefined)?.["description"];
  const keys = p["keys"] as readonly string[] | undefined;
  return `${subject(value)} does not have the expected form${typeof description === "string" ? `: ${description}` : ""}${keys === undefined ? "" : ` (one of: ${keys.join(", ")})`}`;
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

/** At most this many names are listed after an unknown input or field. */
const NAMES_SHOWN = 12;

/**
 * The names the object at an `additionalProperties` error takes, as ` (known: a, b, c)` (#641: a caller
 * who sends `properties` to `element.update` reads `set` there). Empty when the schema lists none. Parentheses, not `; `, because
 * `describeInputViolations` joins violations with `; `.
 */
export const knownNames = (schema: unknown): string => {
  const properties = (schema as { readonly properties?: unknown } | undefined)?.properties;
  const names = typeof properties === "object" && properties !== null ? Object.keys(properties) : [];
  if (names.length === 0) {
    return "";
  }
  const more = names.length > NAMES_SHOWN ? ", ..." : "";
  return ` (known: ${names.slice(0, NAMES_SHOWN).join(", ")}${more})`;
};

const known = new WeakMap<readonly JsonSchema[], WeakMap<object, string>>();

/** The schema file of every def, by the def object, to resolve a `#/$defs/...` reference in a branch. */
const rootsOf = (schemas: readonly JsonSchema[]): WeakMap<object, JsonSchema> => {
  const byDef = new WeakMap<object, JsonSchema>();
  for (const schema of schemas) {
    for (const def of Object.values((schema["$defs"] ?? {}) as Readonly<Record<string, JsonSchema>>)) {
      byDef.set(def, schema);
    }
  }
  return byDef;
};

const rootsKnown = new WeakMap<readonly JsonSchema[], WeakMap<object, JsonSchema>>();

/** An object branch that names its keys: what `branchesOf` needs of each branch. */
interface ObjectBranch {
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
  readonly closed: boolean;
}

/**
 * The branches of a `oneOf` or `anyOf`, when every one is an object schema with required keys (inline or
 * a `#/$defs/...` reference of the same file); else `undefined`, and the branches cannot be told apart.
 */
const branchesOf = (error: ErrorObject, roots: WeakMap<object, JsonSchema>): ObjectBranch[] | undefined => {
  // An error of a validator without `verbose` holds no schema to tell branches apart by (defensive:
  // inputs and refused files are checked with `verbose`, #160).
  if (!Array.isArray(error.schema)) {
    return undefined;
  }
  const root = roots.get(error.parentSchema as object);
  const branches: ObjectBranch[] = [];
  for (const raw of error.schema as readonly JsonSchema[]) {
    const ref = raw["$ref"];
    const local =
      typeof ref === "string" && ref.startsWith("#/$defs/") ? ref.slice("#/$defs/".length) : undefined;
    const branch =
      ref === undefined
        ? raw
        : local === undefined
          ? undefined
          : (root?.["$defs"] as Readonly<Record<string, JsonSchema>> | undefined)?.[local];
    const required = branch?.["required"];
    if (branch?.["type"] !== "object" || !Array.isArray(required) || required.length === 0) {
      return undefined;
    }
    branches.push({
      required: required as string[],
      properties: (branch["properties"] ?? {}) as Readonly<Record<string, unknown>>,
      closed: branch["additionalProperties"] === false,
    });
  }
  return branches;
};

/**
 * The errors with each `oneOf` or `anyOf` of object branches narrowed to the branch the value means
 * (#150): the one whose required keys are all there, as `{"property": ..., "op": ...}` means the property
 * branch, else the one whose first required key is there. Its errors stay (below the value, those under
 * a key of the branch; a key it misses or does not have) and the errors of the other branches and the
 * `oneOf` go. When no branch or several fit, the `oneOf` stays and names the keys that tell the branches
 * apart. Meant for a schema that is the `oneOf` alone, as the filter condition: errors below the value
 * under a key no branch has, such as those of a sibling `properties`, would go too.
 */
const narrowed = (
  all: readonly ErrorObject[],
  input: unknown,
  roots: WeakMap<object, JsonSchema>,
): ErrorObject[] => {
  let errors = [...all];
  for (const either of all.filter((e) => e.keyword === "anyOf" || e.keyword === "oneOf")) {
    const value = valueAt(input, segmentsOf(either.instancePath));
    const branches = branchesOf(either, roots);
    if (branches === undefined || typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    // Own keys only: `toString` in a value is an unknown key, not an inherited name (#820 review).
    const has = (object: object, key: string): boolean => Object.hasOwn(object, key);
    const fitting = branches.filter((b) => b.required.every((key) => has(value, key)));
    // No branch with all its keys: the one whose first key is there (`{"property": "topic"}` lacks `op`).
    const leading = branches.filter((b) => has(value, String(b.required[0])));
    const candidates = fitting.length > 0 ? fitting : leading;
    const [branch] = candidates;
    const at = errors.indexOf(either);
    const path = either.instancePath;
    const chosen = branch === undefined ? -1 : branches.indexOf(branch);
    // At the value itself, the required keys and unknown keys of the branch are told anew below, and an
    // inline branch's errors carry its index; deeper, an error belongs to the branch when its key does.
    const ofBranch = (error: ErrorObject): boolean =>
      branch !== undefined &&
      (error.instancePath === path
        ? error.keyword !== "required" &&
          error.keyword !== "additionalProperties" &&
          (!error.schemaPath.startsWith(`${either.schemaPath}/`) ||
            error.schemaPath.startsWith(`${either.schemaPath}/${String(chosen)}/`))
        : has(branch.properties, String(segmentsOf(error.instancePath.slice(path.length))[0])));
    const inside = errors.slice(0, at).filter((e) => isUnder(e.instancePath, path));
    const kept = inside.filter(ofBranch);
    const missing = branch === undefined ? [] : branch.required.filter((key) => !has(value, key));
    const unknown =
      branch?.closed === true ? Object.keys(value).filter((key) => !has(branch.properties, key)) : [];
    const own = [
      ...missing.map((key) => ({ ...either, keyword: "required", params: { missingProperty: key } })),
      ...unknown.map((key) => ({
        ...either,
        keyword: "additionalProperties",
        params: { additionalProperty: key },
        parentSchema: { properties: branch?.properties },
      })),
    ];
    if (candidates.length !== 1 || kept.length + own.length === 0) {
      const keys = [...new Set(branches.map((b) => String(b.required[0])))];
      errors[at] = { ...either, params: { ...either.params, keys } };
      continue;
    }
    errors = [
      ...errors.slice(0, at).filter((e) => !inside.includes(e) || kept.includes(e)),
      ...own,
      ...errors.slice(at + 1),
    ];
  }
  return errors;
};

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
  let roots = rootsKnown.get(context.schemas);
  if (roots === undefined) {
    roots = rootsOf(context.schemas);
    rootsKnown.set(context.schemas, roots);
  }
  const all = narrowed(errors ?? [], context.input, roots);
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
    } else if (error.keyword === "additionalProperties" || error.keyword === "unevaluatedProperties") {
      field = fieldOf([...segments, String(p["additionalProperty"] ?? p["unevaluatedProperty"])]);
      const names = knownNames(error.parentSchema);
      const where = segments.length === 0 ? "an input of this command" : `a field of ${fieldOf(segments)}`;
      message = `${field} is not ${where}${names}`;
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

/** The keywords of a key the object does not take. */
export const UNKNOWN_KEY: ReadonlySet<string> = new Set(["additionalProperties", "unevaluatedProperties"]);

/**
 * The message of a violation in a hand-written file rather than a command input (#835): the input as a
 * whole is "the file", and a key it does not take is "not a field of the file".
 */
export const fileMessage = (violation: InputViolation): string => {
  // By the violation's form, never by its text: a key or value may hold the same words (#837 review).
  if (UNKNOWN_KEY.has(violation.keyword) && violation.path === "") {
    return violation.message.replace(
      `${violation.field} is not an input of this command`,
      `${violation.field} is not a field of the file`,
    );
  }
  return violation.field === "" ? violation.message.replace(/^The input /, "the file ") : violation.message;
};

/** The violations for the message of `input.invalid`, joined with `; `. */
export const describeInputViolations = (violations: readonly InputViolation[]): string =>
  violations.map((v) => v.message).join("; ");
