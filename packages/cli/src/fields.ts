// How the fields of a command input schema appear on the command line (ADR-0009). Generic: only the
// JSON Schema decides, never the command. Validation stays in core; this only picks the argument form.
import type { CatalogEntry, JsonSchema } from "@reqseq/core";
import { SCHEMA_BASE, contractsBundle } from "@reqseq/core";

/** Values the command line can carry directly. Anything else is `complex` and only reachable via `--input`. */
export type ScalarKind = "string" | "number" | "boolean";
/** `null`: a schema that allows only `null`; next to another kind it leaves that kind (#343). */
type Kind = ScalarKind | "complex" | "any" | "null";

/**
 * How a field is given: positional argument, `--<flag>`, flags for its parts (`parts`), or only
 * inside `--input`.
 */
export type FieldUse = "positional" | "flag" | "parts" | "input-only";

/**
 * A flag that sets one part of an object field (#149, #173), keyed to the `$def` the field references:
 * a selection gets one flag per scalar property (`--ids`, `--filter`) and the flags of its condition;
 * a condition gets `--where <json>` and one repeatable flag per key condition (`--where-type`); a list
 * of sort keys gets `--sort <by>[:asc|desc]`.
 */
export interface PartFlag {
  readonly flag: string;
  /**
   * `property`: a scalar or a list of scalars; `condition`: a whole condition as JSON; `key`: the
   * condition `{ <key>: [values] }`, added to the condition at `path` with `all`; `sort`: sort keys.
   */
  readonly role: "property" | "condition" | "key" | "sort";
  /** Where inside the field's value the part goes (`["ids"]`; `[]` for the value itself). */
  readonly path: readonly string[];
  /** The condition key of a `key` part (`type`), else `undefined`. */
  readonly key: string | undefined;
  /** Scalar kind of a `property` part (of each item for a list); `string` for the others. */
  readonly kind: ScalarKind;
  /** Given by repeating the flag. */
  readonly array: boolean;
  readonly description: string | undefined;
}

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
  /** The part flags of a selection, a condition or a list of sort keys (`use` is `parts`), else empty. */
  readonly parts: readonly PartFlag[];
}

/** `$ref` target of local file and folder paths. */
export const LOCAL_PATH_REF = `${SCHEMA_BASE}common.schema.json#/$defs/localPath`;
/** `$ref` targets whose fields get part flags (#149, #173). */
export const SELECTION_REF = `${SCHEMA_BASE}common.schema.json#/$defs/selection`;
export const CONDITION_REF = `${SCHEMA_BASE}filter.schema.json#/$defs/condition`;
export const SORT_KEY_REF = `${SCHEMA_BASE}filter.schema.json#/$defs/sortKey`;
/** The values of a key condition (`{ type: [...] }`). */
const KEYS_REF = `${SCHEMA_BASE}filter.schema.json#/$defs/keys`;

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
  parts: [],
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
  "kind" | "array" | "choices" | "localPath" | "nullable" | "entries" | "textFile" | "parts"
>;

const describe = (schema: JsonSchema): string | undefined =>
  typeof schema["description"] === "string" ? schema["description"] : undefined;

/** Reads field schemas; `$ref`s resolve only against `schemas` (identifiers, never fetched). */
const schemaReader = (schemas: readonly JsonSchema[]): ((located: Located, flag: string) => Shape) => {
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

  /** Whether the `$ref` chain at the top of a schema leads through `target`. */
  const leadsTo = (located: Located, target: string, depth = 0): boolean => {
    const ref = located.schema["$ref"];
    if (typeof ref !== "string" || depth >= MAX_DEPTH) {
      return false;
    }
    if (new URL(ref, located.base).href === target) {
      return true;
    }
    const next = resolveRef(ref, located.base);
    return next !== undefined && leadsTo(next, target, depth + 1);
  };
  const isLocalPath = (located: Located): boolean => leadsTo(located, LOCAL_PATH_REF);

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

  const read = (field: Located): Shape => {
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
      parts: [],
    };
  };

  /** `--<flag> <json>` and, per key condition among its branches, `--<flag>-<key> <key>...`. */
  const conditionParts = (located: Located, flag: string, path: readonly string[]): PartFlag[] => {
    const condition = dereference(located);
    const branches = condition?.schema["oneOf"];
    const keyParts = (Array.isArray(branches) ? branches : []).flatMap((branch: unknown): PartFlag[] => {
      const required = isSchema(branch) ? branch["required"] : undefined;
      const properties = isSchema(branch) ? branch["properties"] : undefined;
      const key: unknown = Array.isArray(required) && required.length === 1 ? required[0] : undefined;
      const value = typeof key === "string" && isSchema(properties) ? properties[key] : undefined;
      return condition !== undefined &&
        typeof key === "string" &&
        isSchema(value) &&
        leadsTo({ schema: value, base: condition.base }, KEYS_REF)
        ? [
            {
              flag: `${flag}-${kebab(key)}`,
              role: "key",
              path,
              key,
              kind: "string",
              array: true,
              description: describe(value),
            },
          ]
        : [];
    });
    const whole: PartFlag = {
      flag,
      role: "condition",
      path,
      key: undefined,
      kind: "string",
      array: false,
      description: describe(located.schema),
    };
    return [whole, ...keyParts];
  };

  /** One flag per scalar property of a selection (or list of them), and the flags of its condition. */
  const selectionParts = (located: Located): PartFlag[] => {
    const selection = dereference(located);
    const properties = selection?.schema["properties"];
    return Object.entries(isSchema(properties) ? properties : {}).flatMap(([name, value]): PartFlag[] => {
      const property = { schema: isSchema(value) ? value : {}, base: selection?.base ?? located.base };
      if (leadsTo(property, CONDITION_REF)) {
        return conditionParts(property, kebab(name), [name]);
      }
      const shape = read(property);
      return shape.kind === "complex"
        ? []
        : [
            {
              flag: kebab(name),
              role: "property",
              path: [name],
              key: undefined,
              kind: shape.kind,
              array: shape.array,
              description: describe(property.schema),
            },
          ];
    });
  };

  /** The part flags of a field, keyed to the `$def` it references (#149, #173); empty for others. */
  const partsOf = (field: Located, flag: string): PartFlag[] => {
    if (leadsTo(field, SELECTION_REF)) {
      return selectionParts(field);
    }
    if (leadsTo(field, CONDITION_REF)) {
      return conditionParts(field, flag, []);
    }
    const located = dereference(field);
    const items = located?.schema["items"];
    return located?.schema["type"] === "array" &&
      isSchema(items) &&
      leadsTo({ schema: items, base: located.base }, SORT_KEY_REF)
      ? [
          {
            flag,
            role: "sort",
            path: [],
            key: undefined,
            kind: "string",
            array: true,
            description: describe(field.schema),
          },
        ]
      : [];
  };

  return (field, flag) => {
    const parts = partsOf(field, flag);
    return parts.length > 0 ? { ...NO_SHAPE, kind: "complex", parts } : read(field);
  };
};

const useOf = (field: Omit<InputField, "use">): FieldUse => {
  if (field.required && field.kind === "string" && !field.array) {
    return "positional";
  }
  if (field.parts.length > 0) {
    return "parts";
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
    const flag = entry.arguments.find((a) => a.field === name)?.flag ?? kebab(name);
    const field = {
      name,
      flag,
      ...read({ schema, base }, flag),
      required: requiredNames.includes(name),
      description: describe(schema),
      defaultValue: schema["default"],
    };
    return { ...field, use: useOf(field) };
  });
}
