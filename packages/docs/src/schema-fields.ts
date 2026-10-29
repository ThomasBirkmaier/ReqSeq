// The fields of a command's input or output, read from its catalog schema (SR-139 AK1). A `$ref` is shown by the
// name of its definition, with the definition's description when the field has none of its own.
import { SCHEMA_BASE } from "@reqseq/core";
import type { JsonSchema } from "@reqseq/core";

/** One row of the field table: the field's path (`a.b`, `a[].b`), its type as Markdown, and its text. */
export interface FieldRow {
  readonly field: string;
  readonly type: string;
  readonly required: boolean;
  readonly description: string;
}

type Schema = Readonly<Record<string, unknown>>;

/** Nested objects are listed to this depth; deeper ones are named by their type only. */
const MAX_DEPTH = 2;

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const code = (text: string): string => `\`${text}\``;

/** The schema a `$ref` of the catalog points to, among `schemas` (by `$id`). */
export function resolveRef(ref: string, schemas: readonly JsonSchema[]): Schema | undefined {
  const url = new URL(ref, `${SCHEMA_BASE}commands/catalog.json`);
  const file = schemas.find((schema) => schema["$id"] === `${url.origin}${url.pathname}`);
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

/** The type of a schema as Markdown: `string`, `array of uuid`, one of `"a"`, `"b"`. */
export function typeText(schema: Schema): string {
  if (typeof schema["$ref"] === "string") {
    return code(refName(schema["$ref"]));
  }
  if (Array.isArray(schema["enum"])) {
    return `one of ${schema["enum"].map((value) => code(JSON.stringify(value))).join(", ")}`;
  }
  if ("const" in schema) {
    return code(JSON.stringify(schema["const"]));
  }
  const alternatives = schema["anyOf"] ?? schema["oneOf"];
  if (Array.isArray(alternatives)) {
    return alternatives.filter(isSchema).map(typeText).join(" or ");
  }
  if (Array.isArray(schema["allOf"])) {
    return schema["allOf"].filter(isSchema).map(typeText).join(" and ");
  }
  const type = schema["type"];
  if (type === "array") {
    return isSchema(schema["items"]) ? `array of ${typeText(schema["items"])}` : code("array");
  }
  if (Array.isArray(type)) {
    return type.map((name) => code(String(name))).join(" or ");
  }
  return code(typeof type === "string" ? type : "any");
}

const describe = (schema: Schema, schemas: readonly JsonSchema[]): string => {
  const own = schema["description"];
  const target = typeof schema["$ref"] === "string" ? resolveRef(schema["$ref"], schemas) : undefined;
  const text =
    typeof own === "string" ? own : typeof target?.["description"] === "string" ? target["description"] : "";
  return "default" in schema
    ? `${text}${text === "" ? "" : " "}Default: ${code(JSON.stringify(schema["default"]))}.`
    : text;
};

/** The rows of every field of an object schema, nested objects and arrays of objects below their field. */
export function fieldRows(
  schema: Schema,
  schemas: readonly JsonSchema[],
  prefix = "",
  depth = 0,
): FieldRow[] {
  const properties = isSchema(schema["properties"]) ? schema["properties"] : {};
  const required = new Set(Array.isArray(schema["required"]) ? schema["required"] : []);
  return Object.entries(properties).flatMap(([name, value]) => {
    const field = isSchema(value) ? value : {};
    const path = `${prefix}${name}`;
    const row: FieldRow = {
      field: path,
      type: typeText(field),
      required: required.has(name),
      description: describe(field, schemas),
    };
    const items = isSchema(field["items"]) ? field["items"] : undefined;
    const nested =
      depth >= MAX_DEPTH
        ? []
        : isSchema(field["properties"])
          ? fieldRows(field, schemas, `${path}.`, depth + 1)
          : items !== undefined && isSchema(items["properties"])
            ? fieldRows(items, schemas, `${path}[].`, depth + 1)
            : [];
    return [row, ...nested];
  });
}
