// The catalog entries as the windows get them (SR-108), because the renderer has no schema files to
// resolve a `$ref` against:
// - a `choice` argument whose field, or the items of a list field, names its values by a `$ref`
//   (`hint.list kind`: `common.schema.json#/$defs/problemCode`) gets that enum inline;
// - an argument without a description of its own gets the description of the type its field, or the
//   items of a list field, names by a `$ref` (SR-210 AK6: `baseline.create name`).
// Everything else stays as the catalog has it; `catalog-checks.mjs` checks that such a `$ref` leads
// straight to an enum, and that every argument ends up with a description.
import type { CatalogEntry, JsonSchema } from "@reqseq/core";
import { SCHEMA_BASE } from "@reqseq/core";

type Schema = Readonly<Record<string, unknown>>;
type Resolve = (ref: unknown) => unknown;

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The schema `ref` names, relative to `base`, in the schema files by `$id`; undefined when none. */
const resolver =
  (base: string, byId: ReadonlyMap<string, JsonSchema>): Resolve =>
  (ref) => {
    if (typeof ref !== "string") {
      return undefined;
    }
    const url = new URL(ref, base);
    const pointer = decodeURIComponent(url.hash.slice(1));
    url.hash = "";
    let node: unknown = byId.get(url.href);
    for (const part of pointer.split("/").slice(1)) {
      node = isSchema(node) ? node[part] : undefined;
    }
    return node;
  };

/** `schema` with the enum its `$ref` leads to inline, or `schema` itself when that is no enum. */
const inlined = (schema: Schema, resolve: Resolve): Schema => {
  const { $ref: ref, ...rest } = schema;
  const node = resolve(ref);
  const values = isSchema(node) ? node["enum"] : undefined;
  return Array.isArray(values) ? { ...rest, enum: values } : schema;
};

/** `property` with the enum of a `choice` inline (on its items for a list field). */
const withChoice = (property: Schema, resolve: Resolve): Schema => {
  const items = property["items"];
  return property["type"] === "array" && isSchema(items)
    ? { ...property, items: inlined(items, resolve) }
    : inlined(property, resolve);
};

/** The description of the type `property`, or the items of a list field, names by a `$ref`. */
const typeDescription = (property: Schema, resolve: Resolve): unknown => {
  const items = property["items"];
  const ref =
    property["$ref"] ?? (property["type"] === "array" && isSchema(items) ? items["$ref"] : undefined);
  const node = resolve(ref);
  return isSchema(node) ? node["description"] : undefined;
};

/** `property` with the description of its type when it has none of its own and the type has one. */
const withDescription = (property: Schema, resolve: Resolve): Schema => {
  if (typeof property["description"] === "string") {
    return property;
  }
  const description = typeDescription(property, resolve);
  return typeof description === "string" ? { ...property, description } : property;
};

/** The schema files by `$id`, built once for each list of them: the host lists every entry with it. */
const byIdCache = new WeakMap<readonly JsonSchema[], ReadonlyMap<string, JsonSchema>>();
const byIdOf = (schemas: readonly JsonSchema[]): ReadonlyMap<string, JsonSchema> => {
  let byId = byIdCache.get(schemas);
  if (byId === undefined) {
    byId = new Map(schemas.map((schema) => [String(schema["$id"]), schema]));
    byIdCache.set(schemas, byId);
  }
  return byId;
};

/**
 * `entry` with the enum of each `choice` argument inline and the description of the type of each
 * argument without its own; `schemas` are the schema files of the contracts.
 */
export const listedEntry = (entry: CatalogEntry, schemas: readonly JsonSchema[]): CatalogEntry => {
  const input = entry.input as { readonly properties?: Readonly<Record<string, unknown>> };
  const properties = input.properties ?? {};
  const byId = byIdOf(schemas);
  const resolve = resolver(`${SCHEMA_BASE}commands/${entry.name}.json`, byId);
  const fields = entry.arguments.flatMap(({ field, complete }) => {
    const property = properties[field];
    if (!isSchema(property)) {
      return [];
    }
    // The description first, while the field still names its type by `$ref`.
    const described = withDescription(property, resolve);
    const listed = complete === "choice" ? withChoice(described, resolve) : described;
    return listed === property ? [] : [[field, listed] as const];
  });
  if (fields.length === 0) {
    return entry;
  }
  return { ...entry, input: { ...input, properties: { ...properties, ...Object.fromEntries(fields) } } };
};
