// Where a command input holds local paths (SR-142): every place its catalog input schema reaches
// `common.schema.json#/$defs/localPath`, found by the resolved definition, not by the text of a
// `$ref`. The walk follows `$ref`, `properties`, `items`, `anyOf` and `oneOf`; a local path under any
// other keyword (`additionalProperties`, `allOf`, `prefixItems`, ...) would go unchecked, so the walk
// throws there instead (fail closed), and so does a `$ref` that does not resolve. `invoke` checks the values of these fields for API and MCP calls.
import type { JsonSchema, LocalPathUse } from "../catalog.js";
import { SCHEMA_BASE } from "./contracts.js";

/** A field: property names, `null` for each item of an array. */
export type LocalPathField = readonly (string | null)[];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Keywords that hold schemas the walk does not follow. */
const UNFOLLOWED = [
  "allOf",
  "additionalProperties",
  "patternProperties",
  "prefixItems",
  "contains",
  "if",
  "then",
  "else",
  "not",
  "dependentSchemas",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
];

const shown = (at: LocalPathField): string => at.map((part) => part ?? "[]").join(".") || "(input)";

/** The local path fields of `schema`, whose relative `$ref`s resolve against `base` among `schemas`. */
export const localPathFields = (
  schema: JsonSchema,
  base: string,
  schemas: readonly JsonSchema[],
): readonly LocalPathField[] => {
  const byId = new Map<string, JsonSchema>(schemas.map((s) => [String(s["$id"]), s]));
  const resolve = (ref: string, from: string): { node: unknown; base: string } => {
    const url = new URL(ref, from);
    const pointer = decodeURIComponent(url.hash.slice(1));
    url.hash = "";
    let node: unknown = byId.get(url.href);
    for (const part of pointer.split("/").slice(1)) {
      node = isRecord(node) ? node[part.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined;
    }
    return { node, base: url.href };
  };
  const target = resolve(`${SCHEMA_BASE}common.schema.json#/$defs/localPath`, SCHEMA_BASE).node;
  if (target === undefined) {
    throw new Error("common.schema.json has no $defs/localPath");
  }

  /** Whether `value` reaches the local path definition anywhere, following `$ref`s. */
  const mentions = (value: unknown, from: string, seen: Set<unknown>): boolean => {
    if (value === target) {
      return true;
    }
    if (typeof value !== "object" || value === null || seen.has(value)) {
      return false;
    }
    seen.add(value);
    const ref = isRecord(value) ? value["$ref"] : undefined;
    if (typeof ref === "string") {
      const next = resolve(ref, from);
      if (mentions(next.node, next.base, seen)) {
        return true;
      }
    }
    return Object.values(value).some((inner) => mentions(inner, from, seen));
  };

  /** Throws when `node` holds a local path where the walk does not follow (see the file comment). */
  const refuseUnfollowed = (
    node: Readonly<Record<string, unknown>>,
    from: string,
    at: LocalPathField,
  ): void => {
    if (Array.isArray(node["items"]) && mentions(node["items"], from, new Set())) {
      throw new Error(`a local path in the items array of ${shown(at)} would not be checked (SR-142)`);
    }
    for (const key of UNFOLLOWED) {
      if (key in node && mentions(node[key], from, new Set())) {
        throw new Error(`a local path under ${key} of ${shown(at)} would not be checked (SR-142)`);
      }
    }
  };

  const found = new Map<string, LocalPathField>();
  // The schemas on the way to the current one, to find a schema that refers back to itself.
  const visiting = new Set<unknown>();
  const walk = (node: unknown, from: string, at: LocalPathField): void => {
    if (node === target) {
      found.set(JSON.stringify(at), at);
      return;
    }
    if (!isRecord(node)) {
      return;
    }
    if (visiting.has(node)) {
      // A schema that refers back to itself has local paths at every depth: no list holds them.
      if (mentions(node, from, new Set())) {
        throw new Error(`a local path in the recursive schema at ${shown(at)} would not be checked (SR-142)`);
      }
      return;
    }
    visiting.add(node);
    const ref = node["$ref"];
    if (typeof ref === "string") {
      const next = resolve(ref, from);
      if (next.node === undefined) {
        throw new Error(
          `the $ref ${ref} at ${shown(at)} does not resolve, so its local paths would not be checked (SR-142)`,
        );
      }
      walk(next.node, next.base, at);
    }
    const properties = node["properties"];
    if (isRecord(properties)) {
      for (const [name, inner] of Object.entries(properties)) {
        walk(inner, from, [...at, name]);
      }
    }
    walk(node["items"], from, [...at, null]);
    for (const key of ["anyOf", "oneOf"]) {
      const branches = node[key];
      if (Array.isArray(branches)) {
        for (const branch of branches) {
          walk(branch, from, at);
        }
      }
    }
    refuseUnfollowed(node, from, at);
    visiting.delete(node);
  };
  walk(schema, base, []);
  return [...found.values()];
};

/** The values of `fields` in `input` that are strings, each named as in input errors (`changedFiles[1]`). */
export const localPathUses = (input: unknown, fields: readonly LocalPathField[] = []): LocalPathUse[] => {
  const uses: LocalPathUse[] = [];
  const visit = (value: unknown, rest: LocalPathField, field: string): void => {
    const [head, ...tail] = rest;
    if (head === undefined) {
      if (typeof value === "string") {
        uses.push({ field, path: value });
      }
    } else if (head === null) {
      if (Array.isArray(value)) {
        value.forEach((item, i) => {
          visit(item, tail, `${field}[${String(i)}]`);
        });
      }
    } else if (isRecord(value) && Object.hasOwn(value, head)) {
      visit(value[head], tail, field === "" ? head : `${field}.${head}`);
    }
  };
  for (const field of fields) {
    visit(input, field, "");
  }
  return uses;
};
