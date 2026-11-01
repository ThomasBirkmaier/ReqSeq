// How the fields of a command input schema appear on the command line (ADR-0009). Generic: only the
// JSON Schema decides, never the command. Validation stays in core; this only picks the argument form.
import type { CatalogEntry, JsonSchema } from "@reqseq/core";
import { SCHEMA_BASE, contractsBundle } from "@reqseq/core";

/** Values the command line can carry directly. Anything else is `complex` and only reachable via `--input`. */
export type ScalarKind = "string" | "number" | "boolean";
/** `null`: a schema that allows only `null`; next to another kind it leaves that kind (#343). */
type Kind = ScalarKind | "complex" | "any" | "null";

/** How a field is given: positional argument, `--<flag>`, or only inside `--input`. */
export type FieldUse = "positional" | "flag" | "input-only";

export interface InputField {
  /** Property name in the input schema (camelCase). */
  readonly name: string;
  /** kebab-case form for the flag or the argument name. */
  readonly flag: string;
  /** Scalar kind of the value (of each item for arrays); `complex` for everything else. */
  readonly kind: ScalarKind | "complex";
  /** An array of scalars, given by repeating the flag. */
  readonly array: boolean;
  readonly required: boolean;
  readonly use: FieldUse;
  readonly description: string | undefined;
  /** Allowed values when the schema lists them (for the help text). */
  readonly choices: readonly string[] | undefined;
  /**
   * The schema also allows `null` (`type: [X, "null"]`, an `anyOf` branch `{ type: "null" }`): the
   * field keeps the form of its other kind, and `null` itself is given with `--input` (#343).
   */
  readonly nullable: boolean;
  /** `default` of the schema (for the help text; core fills it in). */
  readonly defaultValue: unknown;
  /**
   * A `common.schema.json#/$defs/localPath` (or an array of them): the CLI resolves the value against
   * the current folder, so the command gets an absolute path (ADR-0009).
   */
  readonly localPath: boolean;
  /**
   * An object of named values (`additionalProperties`, no `properties`): given as a repeated
   * `--<flag> key=value`, the value as JSON when it parses, else as a string (#171).
   */
  readonly entries: boolean;
  /**
   * A string with `contentMediaType` (a Markdown text): the flag also takes `@file` and `-`, read like
   * `--input` (#171).
   */
  readonly textFile: boolean;
}

/** `$ref` target of local file and folder paths. */
export const LOCAL_PATH_REF = `${SCHEMA_BASE}common.schema.json#/$defs/localPath`;

/** Options of every command; an input field with one of these names is only reachable via `--input`. */
export const RESERVED_FLAGS: readonly string[] = ["json", "yaml", "workspace", "input", "help"];

/** `setStatus` -> `set-status`, `changedFiles` -> `changed-files`. */
export const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface Located {
  readonly schema: JsonSchema;
  /** Base URL that relative `$ref`s inside `schema` resolve against. */
  readonly base: string;
}

// Deep enough for every schema of the catalog; a deeper (or circular) chain counts as complex.
const MAX_DEPTH = 16;

const NO_SHAPE = {
  array: false,
  choices: undefined,
  localPath: false,
  nullable: false,
  entries: false,
  textFile: false,
} as const;

const scalarOf = (value: unknown): Kind => {
  if (value === null) {
    return "null";
  }
  const type = typeof value;
  return type === "string" || type === "number" || type === "boolean" ? type : "complex";
};

/**
 * One kind when all agree on the same scalar kind, else `complex`. A `null` kind next to others is
 * left out (a nullable scalar keeps its form) unless `keepNull`; only `null` is `null`.
 */
const combine = (all: readonly Kind[], keepNull: boolean): Kind => {
  const kinds = keepNull ? all : all.filter((k) => k !== "null");
  if (kinds.length === 0 && all.length > 0) {
    return "null";
  }
  const [first] = kinds;
  return first !== undefined && first !== "complex" && first !== "any" && kinds.every((k) => k === first)
    ? first
    : "complex";
};

const typeKind = (type: unknown, keepNull: boolean): Kind => {
  if (Array.isArray(type)) {
    return combine(
      type.map((t) => typeKind(t, keepNull)),
      keepNull,
    );
  }
  switch (type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case undefined:
      return "any";
    default:
      return "complex";
  }
};

/** A scalar kind as it is; `any`, `null` (a field that is only ever null) and `complex` are `complex`. */
const scalarOrComplex = (kind: Kind): ScalarKind | "complex" =>
  kind === "any" || kind === "null" ? "complex" : kind;

type Shape = Pick<
  InputField,
  "kind" | "array" | "choices" | "localPath" | "nullable" | "entries" | "textFile"
>;

/** Reads field schemas; `$ref`s resolve only against `schemas` (identifiers, never fetched). */
const schemaReader = (schemas: readonly JsonSchema[]): ((located: Located) => Shape) => {
  const byId = new Map<string, JsonSchema>(schemas.map((schema) => [String(schema["$id"]), schema]));

  /** Follow a `$ref`; `undefined` when it leads nowhere. */
  const resolveRef = (ref: string, base: string): Located | undefined => {
    const url = new URL(ref, base);
    const pointer = decodeURIComponent(url.hash.slice(1));
    url.hash = "";
    let node: unknown = byId.get(url.href);
    for (const part of pointer.split("/").slice(1)) {
      node = isSchema(node) ? node[part.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined;
    }
    return isSchema(node) ? { schema: node, base: url.href } : undefined;
  };

  /** Follow `$ref`s at the top of a schema, so `type: array` and `enum` behind a reference count. */
  const dereference = (located: Located, depth = 0): Located | undefined => {
    const ref = located.schema["$ref"];
    if (typeof ref !== "string") {
      return located;
    }
    const target = depth < MAX_DEPTH ? resolveRef(ref, located.base) : undefined;
    return target === undefined ? undefined : dereference(target, depth + 1);
  };

  /** Whether the `$ref` chain at the top of a schema leads through `$defs/localPath`. */
  const isLocalPath = (located: Located, depth = 0): boolean => {
    const ref = located.schema["$ref"];
    if (typeof ref !== "string" || depth >= MAX_DEPTH) {
      return false;
    }
    if (new URL(ref, located.base).href === LOCAL_PATH_REF) {
      return true;
    }
    const target = resolveRef(ref, located.base);
    return target !== undefined && isLocalPath(target, depth + 1);
  };

  /** The kind of a schema; with `keepNull`, one that also allows `null` is `complex` (see `nullable`). */
  const kindOf = (start: Located, depth = 0, keepNull = false): Kind => {
    const located = depth > MAX_DEPTH ? undefined : dereference(start);
    if (located === undefined) {
      return "complex";
    }
    const { schema, base } = located;
    if ("const" in schema) {
      return scalarOf(schema["const"]);
    }
    const values = schema["enum"];
    if (Array.isArray(values)) {
      return combine(values.map(scalarOf), keepNull);
    }
    const branchKinds = (key: string): Kind[] | undefined => {
      const branches = schema[key];
      return Array.isArray(branches)
        ? branches.map((b: unknown) =>
            isSchema(b) ? kindOf({ schema: b, base }, depth + 1, keepNull) : "complex",
          )
        : undefined;
    };
    const either = branchKinds("anyOf") ?? branchKinds("oneOf");
    if (either !== undefined) {
      return combine(either, keepNull);
    }
    const all = branchKinds("allOf");
    if (all !== undefined) {
      // Every branch must hold; branches without a type (e.g. `not`) only narrow the value.
      return combine(
        [typeKind(schema["type"], keepNull), ...all].filter((k) => k !== "any"),
        keepNull,
      );
    }
    return typeKind(schema["type"], keepNull);
  };

  /** The shape of an array field: repeatable scalars, else `complex`. */
  const arrayShape = (located: Located): Shape => {
    const items = located.schema["items"];
    const itemSchema = isSchema(items) ? { schema: items, base: located.base } : undefined;
    const item = itemSchema === undefined ? "complex" : scalarOrComplex(kindOf(itemSchema));
    return itemSchema === undefined || item === "complex"
      ? { ...NO_SHAPE, kind: "complex" }
      : { ...NO_SHAPE, kind: item, array: true, localPath: isLocalPath(itemSchema) };
  };

  /** A map: `type: object` with `additionalProperties` and without `properties`. */
  const isEntries = (located: Located | undefined): boolean =>
    located?.schema["type"] === "object" &&
    isSchema(located.schema["additionalProperties"]) &&
    !("properties" in located.schema);

  return (field) => {
    const located = dereference(field);
    if (located?.schema["type"] === "array") {
      return arrayShape(located);
    }
    const kind = scalarOrComplex(kindOf(field));
    const values = located?.schema["enum"];
    const strings = kind === "string";
    return {
      kind,
      array: false,
      choices: strings && Array.isArray(values) ? values.filter((v) => v !== null).map(String) : undefined,
      localPath: strings && isLocalPath(field),
      // A scalar whose kind does not hold once `null` counts as a kind of its own allows `null`.
      nullable: kind !== "complex" && kindOf(field, 0, true) !== kind,
      entries: isEntries(located),
      textFile: strings && typeof located?.schema["contentMediaType"] === "string",
    };
  };
};

const useOf = (field: Omit<InputField, "use">): FieldUse => {
  if (field.required && field.kind === "string" && !field.array) {
    return "positional";
  }
  return (field.kind === "complex" && !field.entries) || RESERVED_FLAGS.includes(field.flag)
    ? "input-only"
    : "flag";
};

/**
 * The fields of a command's input, in schema property order. `$ref`s resolve against `schemas`
 * (default: the schemas of this version, `contractsBundle`). The flag is the field name in kebab-case,
 * or the `flag` of the field's catalog argument (`--set` for `properties` of `element.create`).
 */
export function inputFields(
  entry: CatalogEntry,
  schemas: readonly JsonSchema[] = contractsBundle.schemas,
): InputField[] {
  const read = schemaReader(schemas);
  const base = `${SCHEMA_BASE}commands/${entry.name}.input.json`;
  const properties = entry.input["properties"];
  const required = entry.input["required"];
  const requiredNames: unknown[] = Array.isArray(required) ? required : [];
  return Object.entries(isSchema(properties) ? properties : {}).map(([name, value]) => {
    const schema = isSchema(value) ? value : {};
    const description = schema["description"];
    const field = {
      name,
      flag: entry.arguments.find((a) => a.field === name)?.flag ?? kebab(name),
      ...read({ schema, base }),
      required: requiredNames.includes(name),
      description: typeof description === "string" ? description : undefined,
      defaultValue: schema["default"],
    };
    return { ...field, use: useOf(field) };
  });
}
