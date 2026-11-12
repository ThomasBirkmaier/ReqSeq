// The catalog entries as the windows get them (SR-108): a `choice` argument whose field, or the items of a
// list field, names its values by a `$ref` (`hint.list kind`: `common.schema.json#/$defs/problemCode`) gets
// that enum inline, because the renderer has no schema files to resolve it against. Everything else stays
// as the catalog has it; `catalog-checks.mjs` checks that such a `$ref` leads straight to an enum.
import type { CatalogEntry, JsonSchema } from "@reqseq/core";
import { SCHEMA_BASE } from "@reqseq/core";

type Schema = Readonly<Record<string, unknown>>;

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `schema` with the enum its `$ref` leads to inline, or `schema` itself when that is no enum. */
const inlined = (schema: Schema, base: string, byId: ReadonlyMap<string, JsonSchema>): Schema => {
  const { $ref: ref, ...rest } = schema;
  if (typeof ref !== "string") {
    return schema;
  }
  const url = new URL(ref, base);
  const pointer = decodeURIComponent(url.hash.slice(1));
  url.hash = "";
  let node: unknown = byId.get(url.href);
  for (const part of pointer.split("/").slice(1)) {
    node = isSchema(node) ? node[part] : undefined;
  }
  const values = isSchema(node) ? node["enum"] : undefined;
  return Array.isArray(values) ? { ...rest, enum: values } : schema;
};

/** `entry` with the enum of each `choice` argument inline; `schemas` are the schema files of the contracts. */
export const listedEntry = (entry: CatalogEntry, schemas: readonly JsonSchema[]): CatalogEntry => {
  const input = entry.input as { readonly properties?: Readonly<Record<string, unknown>> };
  const properties = input.properties ?? {};
  const choices = entry.arguments.filter(
    (arg) => arg.complete === "choice" && isSchema(properties[arg.field]),
  );
  if (choices.length === 0) {
    return entry;
  }
  const byId = new Map(schemas.map((schema) => [String(schema["$id"]), schema]));
  const base = `${SCHEMA_BASE}commands/${entry.name}.json`;
  const fields = Object.fromEntries(
    choices.map(({ field }) => {
      const property = properties[field] as Schema;
      const items = property["items"];
      return [
        field,
        property["type"] === "array" && isSchema(items)
          ? { ...property, items: inlined(items, base, byId) }
          : inlined(property, base, byId),
      ];
    }),
  );
  return { ...entry, input: { ...input, properties: { ...properties, ...fields } } };
};
