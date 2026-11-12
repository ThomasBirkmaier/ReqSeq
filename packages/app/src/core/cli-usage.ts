// The call of a catalog command on the command line as its `--help` writes it (SR-210 AK3: the command help
// of the app shows it): `reqseq element get <ref> [options]`. The CLI takes a required field whose value is
// one string as a positional argument (`fields.ts` of the CLI, ADR-0009); this reads the kind of a field by
// the CLI's rules. `cli-usage.test.ts` of the CLI compares the line with its own help for every command.
import type { CatalogEntry, JsonSchema } from "@reqseq/core";
import { SCHEMA_BASE } from "@reqseq/core";

type Schema = Readonly<Record<string, unknown>>;

/** The kind of a value, as the CLI reads it; `any`: a schema without a type, `other`: anything not scalar. */
type Kind = "string" | "number" | "boolean" | "null" | "any" | "other";

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `setStatus` -> `set-status`, as the CLI names actions and flags. */
const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// Deep enough for every schema of the catalog; a deeper (or circular) chain is no scalar.
const MAX_DEPTH = 16;

/** One kind when all but `null` agree on one scalar kind; only `null` is `null`; else `other`. */
const combine = (all: readonly Kind[]): Kind => {
  const kinds = all.filter((kind) => kind !== "null");
  if (kinds.length === 0) {
    return all.length > 0 ? "null" : "other";
  }
  const [first = "other"] = kinds;
  return first !== "any" && kinds.every((kind) => kind === first) ? first : "other";
};

const typeKind = (type: unknown): Kind => {
  if (Array.isArray(type)) {
    return combine(type.map(typeKind));
  }
  if (type === undefined) {
    return "any";
  }
  if (type === "integer") {
    return "number";
  }
  return type === "string" || type === "number" || type === "boolean" || type === "null" ? type : "other";
};

const valueKind = (value: unknown): Kind => {
  const type = value === null ? "null" : typeof value;
  return type === "string" || type === "number" || type === "boolean" || type === "null" ? type : "other";
};

/** The kind of `schema`, its `$ref`s followed in `byId`, as `kindOf` in the CLI's `fields.ts` reads it. */
const kindOf = (schema: unknown, base: string, byId: ReadonlyMap<string, JsonSchema>, depth = 0): Kind => {
  if (!isSchema(schema) || depth > MAX_DEPTH) {
    return "other";
  }
  const ref = schema["$ref"];
  if (typeof ref === "string") {
    const url = new URL(ref, base);
    const pointer = decodeURIComponent(url.hash.slice(1));
    url.hash = "";
    let node: unknown = byId.get(url.href);
    for (const part of pointer.split("/").slice(1)) {
      node = isSchema(node) ? node[part] : undefined;
    }
    return kindOf(node, url.href, byId, depth + 1);
  }
  if ("const" in schema) {
    return valueKind(schema["const"]);
  }
  const values = schema["enum"];
  if (Array.isArray(values)) {
    return combine(values.map(valueKind));
  }
  const branches = (key: string): Kind[] | undefined => {
    const list = schema[key];
    return Array.isArray(list) ? list.map((branch) => kindOf(branch, base, byId, depth + 1)) : undefined;
  };
  const either = branches("anyOf") ?? branches("oneOf");
  if (either !== undefined) {
    // A number or a text (a criterion by number or key): the CLI passes the text as given.
    const kinds = new Set(either);
    return kinds.size === 2 && kinds.has("number") && kinds.has("string") ? "string" : combine(either);
  }
  const all = branches("allOf");
  if (all !== undefined) {
    // Every branch holds; a branch without a type (`not`) only narrows the value.
    return combine([typeKind(schema["type"]), ...all].filter((kind) => kind !== "any"));
  }
  return typeKind(schema["type"]);
};

/** `reqseq <group> <action> <positional>… [options]` for `entry`; `schemas` resolve its `$ref`s. */
export const cliUsage = (entry: CatalogEntry, schemas: readonly JsonSchema[]): string => {
  const byId = new Map(schemas.map((schema) => [String(schema["$id"]), schema]));
  const base = `${SCHEMA_BASE}commands/${entry.name}.input.json`;
  const input = entry.input as { readonly properties?: unknown; readonly required?: unknown };
  const properties = isSchema(input.properties) ? input.properties : {};
  const required: readonly unknown[] = Array.isArray(input.required) ? input.required : [];
  const positional = Object.entries(properties).flatMap(([name, schema]) =>
    required.includes(name) && kindOf(schema, base, byId) === "string"
      ? [`<${entry.arguments.find((arg) => arg.field === name)?.flag ?? kebab(name)}>`]
      : [],
  );
  const dot = entry.name.indexOf(".");
  const action = kebab(entry.name.slice(dot + 1));
  return ["reqseq", entry.name.slice(0, dot), action, ...positional, "[options]"].join(" ");
};
