// The fields of a command's input or output, or of a file format, read from its schema (SR-139 AK1, AK3). A `$ref`
// is shown by the name of its definition, linked to where the reference documents it, with the definition's
// description when the field has none of its own.
import { SCHEMA_BASE } from "@reqseq/core";
import type { JsonSchema } from "@reqseq/core";
import { cell, markdownCell, table } from "./markdown.js";

/** One row of the field table: the field's path (`a.b`, `a[].b`), its type as Markdown, and its text. */
export interface FieldRow {
  readonly field: string;
  readonly type: string;
  readonly required: boolean;
  readonly description: string;
  /** Whether the field has a text of its own, of its definition or of its items; a default alone is none. */
  readonly described: boolean;
}

export type Schema = Readonly<Record<string, unknown>>;

/** The base of the `$ref`s in the command catalog. */
export const CATALOG_BASE = `${SCHEMA_BASE}commands/catalog.json`;

/** What a schema is read with: all schemas (by `$id`), the URL its `$ref`s resolve against, and the links. */
export interface SchemaContext {
  readonly schemas: readonly JsonSchema[];
  /** Default: the catalog (`CATALOG_BASE`). */
  readonly base?: string;
  /** Where the reference documents the type at `url` (a schema file, or a definition in it), if anywhere. */
  readonly link?: (url: URL) => string | undefined;
}

/** Nested objects are listed to this depth; deeper ones are named by their type only. */
const MAX_DEPTH = 2;

/** The keywords by which a schema names a type, as `typeText` reads them. */
const TYPE_KEYWORDS = ["$ref", "enum", "const", "anyOf", "oneOf", "allOf", "type"];

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const code = (text: string): string => `\`${text}\``;

/** The schema a `$ref` points to, among the context's schemas (by `$id`). */
export function resolveRef(ref: string, context: SchemaContext): Schema | undefined {
  const url = new URL(ref, context.base ?? CATALOG_BASE);
  const file = context.schemas.find((schema) => schema["$id"] === `${url.origin}${url.pathname}`);
  const path = url.hash.replace(/^#\/?/, "");
  return (path === "" ? [] : path.split("/")).reduce<Schema | undefined>(
    (node, key) => (node === undefined || !isSchema(node[key]) ? undefined : node[key]),
    file,
  );
}

/** The name a `$ref` is shown by: its definition, or its schema file without `.schema.json`. */
export const refName = (ref: string): string => {
  const [file = "", pointer = ""] = ref.split("#");
  const last = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
  return pointer === "" ? last(file).replace(/\.schema\.json$/, "") : last(pointer);
};

/** A `$ref` by its name, linked where the reference documents it. */
const refType = (ref: string, context: SchemaContext | undefined): string => {
  const href = context?.link?.(new URL(ref, context.base ?? CATALOG_BASE));
  const name = code(refName(ref));
  return href === undefined ? name : `[${name}](${href})`;
};

/** The type of a schema as Markdown: `string`, `array of uuid`, one of `"a"`, `"b"`. */
export function typeText(schema: Schema, context?: SchemaContext): string {
  const inner = (part: Schema): string => typeText(part, context);
  if (typeof schema["$ref"] === "string") {
    return refType(schema["$ref"], context);
  }
  if (Array.isArray(schema["enum"])) {
    return `one of ${schema["enum"].map((value) => code(JSON.stringify(value))).join(", ")}`;
  }
  if ("const" in schema) {
    return code(JSON.stringify(schema["const"]));
  }
  // Alternatives that only constrain (`required`) name no type: an object with `oneOf` of required fields is `object`.
  const alternatives = schema["anyOf"] ?? schema["oneOf"];
  const named = Array.isArray(alternatives)
    ? alternatives.filter(isSchema).filter((part) => TYPE_KEYWORDS.some((keyword) => keyword in part))
    : [];
  if (named.length > 0) {
    return named.map(inner).join(" or ");
  }
  if (Array.isArray(schema["allOf"])) {
    // Parts that only constrain (`minLength`, `not`) name no type of their own: `relativePath`, not `relativePath and any`.
    const named = schema["allOf"]
      .filter(isSchema)
      .filter((part) => TYPE_KEYWORDS.some((keyword) => keyword in part));
    return named.length === 0 ? code("any") : named.map(inner).join(" and ");
  }
  const type = schema["type"];
  if (type === "array") {
    return isSchema(schema["items"]) ? `array of ${inner(schema["items"])}` : code("array");
  }
  if (Array.isArray(type)) {
    return type.map((name) => code(String(name))).join(" or ");
  }
  return code(typeof type === "string" ? type : "any");
}

/** The text of a schema: its own, else that of the definition its `$ref` names, followed over further `$ref`s. */
const ownText = (schema: Schema, context: SchemaContext): string => {
  const own = schema["description"];
  const ref = schema["$ref"];
  const target = typeof own !== "string" && typeof ref === "string" ? resolveRef(ref, context) : undefined;
  return typeof own === "string"
    ? own
    : target === undefined
      ? ""
      : // A `$ref` of the definition resolves against the file that holds it.
        ownText(target, { ...context, base: new URL(String(ref), context.base ?? CATALOG_BASE).href });
};

/** The text of a field: its own or its definition's, else that of its items, so a list reads like its entries. */
const fieldText = (schema: Schema, context: SchemaContext): string => {
  const text = ownText(schema, context);
  return text === "" && isSchema(schema["items"]) ? ownText(schema["items"], context) : text;
};

const describe = (schema: Schema, context: SchemaContext): string => {
  const text = fieldText(schema, context);
  return "default" in schema
    ? `${text}${text === "" ? "" : " "}Default: ${code(JSON.stringify(schema["default"]))}.`
    : text;
};

const propertiesOf = (schema: Schema | undefined): Schema =>
  schema !== undefined && isSchema(schema["properties"]) ? schema["properties"] : {};

/**
 * The `properties` and `required` of a schema and of the parts of its `allOf`. A property that is only `true` lets a
 * property of a `$ref` part through `unevaluatedProperties`, so it is that part's property.
 */
const objectParts = (
  schema: Schema,
  context: SchemaContext,
): { properties: Schema; required: Set<unknown> } => {
  const parts = [schema, ...(Array.isArray(schema["allOf"]) ? schema["allOf"].filter(isSchema) : [])];
  const referenced = Object.assign(
    {},
    ...parts.map((part) =>
      propertiesOf(typeof part["$ref"] === "string" ? resolveRef(part["$ref"], context) : undefined),
    ),
  ) as Schema;
  const merged = Object.assign({}, ...parts.map(propertiesOf)) as Schema;
  return {
    properties: Object.fromEntries(
      Object.entries(merged).map(([name, value]) => [
        name,
        value === true ? (referenced[name] ?? value) : value,
      ]),
    ),
    required: new Set(
      parts.flatMap((part): unknown[] =>
        Array.isArray(part["required"]) ? (part["required"] as unknown[]) : [],
      ),
    ),
  };
};

/** The rows of every field of an object schema, nested objects and arrays of objects below their field. */
export function fieldRows(schema: Schema, context: SchemaContext, prefix = "", depth = 0): FieldRow[] {
  const { properties, required } = objectParts(schema, context);
  return Object.entries(properties).flatMap(([name, value]) => {
    const field = isSchema(value) ? value : {};
    const path = `${prefix}${name}`;
    const row: FieldRow = {
      field: path,
      type: typeText(field, context),
      required: required.has(name),
      description: describe(field, context),
      described: fieldText(field, context) !== "",
    };
    const items = isSchema(field["items"]) ? field["items"] : undefined;
    const nested =
      depth >= MAX_DEPTH
        ? []
        : isSchema(field["properties"])
          ? fieldRows(field, context, `${path}.`, depth + 1)
          : items !== undefined && isSchema(items["properties"])
            ? fieldRows(items, context, `${path}[].`, depth + 1)
            : [];
    return [row, ...nested];
  });
}

/**
 * The field table of an object schema, or `none` when it has no fields. Throws when a field has no text of its own,
 * of its definition or of its items (a default alone is no text), so no field ships without one (#1249).
 */
export function fieldTable(schema: Schema, context: SchemaContext, none: string): string {
  const rows = fieldRows(schema, context);
  const missing = rows.filter((row) => !row.described);
  if (missing.length > 0) {
    throw new Error(`fields without a description: ${missing.map((row) => row.field).join(", ")}`);
  }
  return rows.length === 0
    ? none
    : table(
        ["Field", "Type", "Required", "Description"],
        rows.map((row) => [
          `\`${row.field}\``,
          markdownCell(row.type),
          row.required ? "yes" : "no",
          cell(row.description),
        ]),
      );
}
