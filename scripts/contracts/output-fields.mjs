// The fields of a command's output with their title and marks (SR-224 AK3, AK4, AK9, D-078): `title`, `x-technical`,
// `x-normal`, `x-elements`, `x-key` and `x-element-values` of the output schemas (ADR-0002 rule 1). A field takes its own keyword, else the one
// of the definition its `$ref` names (and so on along `$ref`s). `x-technical` also holds when an `anyOf` or
// `oneOf` branch or the `items` of an array are technical (`viewId` → `elementId` → `uuid`). `catalog-checks.mjs`
// checks the marks with these fields; `generate.mjs` writes them resolved into each entry of the generated catalog
// (`outputFields`), so a reader of the catalog the API gives needs no `$ref` (SR-224 AK3).

/** The definitions SR-224 AK3 names as technical: UUID, path, check value, commit, kind of a problem, duration. */
export const TECHNICAL_DEFINITIONS = [
  "common.schema.json#/$defs/uuid",
  "common.schema.json#/$defs/uuidRef",
  "common.schema.json#/$defs/relativePath",
  "common.schema.json#/$defs/localPath",
  "common.schema.json#/$defs/outputPath",
  "common.schema.json#/$defs/fileSha256",
  "common.schema.json#/$defs/version",
  "common.schema.json#/$defs/commit",
  "common.schema.json#/$defs/problemCode",
  "common.schema.json#/$defs/duration",
];

/** The marks of the output schemas; `title` is the JSON Schema annotation. */
export const MARKS = ["x-technical", "x-normal", "x-elements", "x-key", "x-element-values"];

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The schema a `$ref` names, with its file and its key (`common.schema.json#/$defs/uuid`): refs relative to `file`
 * (a key of `schemas`, `commands/` for command schemas), `#` alone or a JSON pointer.
 */
export function resolveRef(ref, file, schemas) {
  const [target, pointer = ""] = ref.split("#");
  const name = target === "" ? file : target.replace(/^\.\.\//, "");
  let schema = schemas[name];
  for (const part of pointer.split("/").filter((p) => p !== "")) {
    schema = isObject(schema) ? schema[part.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined;
  }
  return schema === undefined ? undefined : { schema, file: name, key: `${name}#${pointer}` };
}

/** The value of `keyword` at `schema`, else along its `$ref`s. */
function inherited(schema, file, schemas, keyword, seen = new Set()) {
  if (!isObject(schema) || seen.has(schema)) {
    return undefined;
  }
  seen.add(schema);
  if (schema[keyword] !== undefined) {
    return schema[keyword];
  }
  const target = typeof schema.$ref === "string" ? resolveRef(schema.$ref, file, schemas) : undefined;
  return target === undefined ? undefined : inherited(target.schema, target.file, schemas, keyword, seen);
}

/**
 * Whether a field is technical: its own `x-technical` (`true`, `false` or `"with-element"`), else that of its
 * `$ref`, an `anyOf`/`oneOf` branch or its `items`.
 */
export function technicalOf(schema, file, schemas, seen = new Set()) {
  if (!isObject(schema) || seen.has(schema)) {
    return false;
  }
  seen.add(schema);
  if (schema["x-technical"] !== undefined) {
    return schema["x-technical"];
  }
  const parts = [
    ...(typeof schema.$ref === "string" ? [resolveRef(schema.$ref, file, schemas)] : []),
    ...[...(schema.anyOf ?? []), ...(schema.oneOf ?? [])].map((branch) => ({ schema: branch, file })),
    ...(isObject(schema.items) ? [{ schema: schema.items, file }] : []),
  ].filter((part) => part !== undefined);
  return parts.some((part) => technicalOf(part.schema, part.file, schemas, seen) === true);
}

/**
 * The parts of a schema whose properties are its fields, each with its file and JSON pointer: itself, its `$ref`,
 * `allOf`, `anyOf`, `oneOf`, `then` and `else`. `stack` holds the definitions on the way, which are not entered again.
 */
function objectParts(schema, file, pointer, schemas, stack) {
  const parts = [{ schema, file, pointer, stack }];
  if (typeof schema.$ref === "string") {
    const target = resolveRef(schema.$ref, file, schemas);
    if (target !== undefined && !stack.includes(target.key)) {
      const targetPointer = target.key.slice(target.key.indexOf("#") + 1);
      parts.push(...objectParts(target.schema, target.file, targetPointer, schemas, [...stack, target.key]));
    }
  }
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    for (const [i, branch] of (schema[keyword] ?? []).entries()) {
      if (isObject(branch)) {
        parts.push(...objectParts(branch, file, `${pointer}/${keyword}/${i}`, schemas, stack));
      }
    }
  }
  for (const keyword of ["then", "else"]) {
    if (isObject(schema[keyword])) {
      parts.push(...objectParts(schema[keyword], file, `${pointer}/${keyword}`, schemas, stack));
    }
  }
  return parts;
}

/** Where a field is written: its file and JSON pointer, for messages and for checking each place once. */
const placeOf = (file, pointer) => `${file === "commands/" ? "" : file}#${pointer}`;

/**
 * Every field of an output schema, depth first: `{ path, name, schema, file, pointer, place, parent }`, with
 * `path` such as `levels[].elements.withChildren` (`[]` for the items of an array, `*` for a key of a map) and
 * `place` the file and JSON pointer of the field's schema. A definition already on the way to a field is not
 * entered again (the recursive filter condition), so the path ends at that field.
 * @param {object} output the output schema of an entry
 * @param {string} pointer the JSON pointer of `output` in its file, `/output` in a command file
 */
export function outputFieldsOf(output, schemas, pointer = "/output") {
  const fields = [];
  const visit = (schema, file, at, path, stack, parent) => {
    for (const part of objectParts(schema, file, at, schemas, stack)) {
      for (const [name, property] of Object.entries(part.schema.properties ?? {})) {
        if (!isObject(property)) {
          continue;
        }
        const fieldPointer = `${part.pointer}/properties/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
        const field = {
          path: path === "" ? name : `${path}.${name}`,
          name,
          schema: property,
          file: part.file,
          pointer: fieldPointer,
          place: placeOf(part.file, fieldPointer),
          parent,
        };
        fields.push(field);
        below(property, part.file, fieldPointer, field.path, part.stack, field);
      }
    }
  };
  // The fields below a field: those of its object schema, of the items of an array and of the values of a map.
  const below = (schema, file, at, path, stack, parent) => {
    visit(schema, file, at, path, stack, parent);
    for (const part of objectParts(schema, file, at, schemas, stack)) {
      if (isObject(part.schema.items)) {
        below(part.schema.items, part.file, `${part.pointer}/items`, `${path}[]`, part.stack, parent);
      }
      if (isObject(part.schema.additionalProperties)) {
        below(
          part.schema.additionalProperties,
          part.file,
          `${part.pointer}/additionalProperties`,
          `${path}.*`,
          part.stack,
          parent,
        );
      }
    }
  };
  below(output, "commands/", pointer, "", [], undefined);
  return fields;
}

/**
 * The lists a field is inside, outermost first, one per `[]` of its path: `{ path, field, key }` with the array
 * field (undefined when no field of the output has that path) and its `x-key`, the fields of an item that
 * identify the entry (SR-224 AK4). `maps` counts the `.*` of the path, the values of a map.
 */
export function listsAbove(field, schemas) {
  const byPath = new Map();
  for (let above = field.parent; above !== undefined; above = above.parent) {
    byPath.set(above.path, above);
  }
  const lists = [...field.path.matchAll(/\[\]/g)].map((match) => {
    const path = field.path.slice(0, match.index);
    const array = byPath.get(path);
    return {
      path,
      field: array,
      key: array === undefined ? undefined : inherited(array.schema, array.file, schemas, "x-key"),
    };
  });
  return { lists, maps: [...field.path.matchAll(/\.\*(?=\.|$)/g)].length };
}

/** The title of a field: its own, else that of the definition its `$ref` names. */
export const titleOf = (field, schemas) => inherited(field.schema, field.file, schemas, "title");

/** The normal value of a field: its own `x-normal`, else that of its definition. */
export const normalOf = (field, schemas) => inherited(field.schema, field.file, schemas, "x-normal");

/**
 * Whether a field is one of the element's own values of an entry (SR-224 AK9): a field of the items of a list whose
 * `x-element-values` names it.
 */
const isElementValue = (field) => {
  const list = field.parent;
  const names = list?.schema["x-element-values"];
  return Array.isArray(names) && field.path === `${list.path}[].${field.name}` && names.includes(field.name);
};

/** The path of the field `relative` names from the object that holds `field` (`elements/withChildren`). */
export const relativePath = (field, relative) => {
  const base = field.path.slice(0, field.path.length - field.name.length);
  return `${base}${relative.split("/").join(".")}`;
};

/**
 * The fields of an output as the generated catalog gives them (`outputFields`): one per path, the first place
 * of a path wins, each with its resolved `title`, `technical` (`true` or `"with-element"`), `normal` and
 * `elements` (`true`, `"answer"`, `"selection"`, or the paths of the lists a count counts) and `elementValue` (a value
 * of the element itself in an entry, `isElementValue`). A count also has
 * `keys`: the `x-key` of each list it is inside, outermost first, so a reader names its entry (SR-224 AK4).
 */
export function resolvedOutputFields(output, schemas) {
  const seen = new Set();
  return outputFieldsOf(output, schemas).flatMap((field) => {
    if (seen.has(field.path)) {
      return [];
    }
    seen.add(field.path);
    const title = titleOf(field, schemas);
    const technical = technicalOf(field.schema, field.file, schemas);
    const normal = normalOf(field, schemas);
    const elements = field.schema["x-elements"];
    const counts = elements !== undefined && elements !== true && elements !== "answer";
    return [
      {
        path: field.path,
        ...(title === undefined ? {} : { title }),
        ...(technical === false ? {} : { technical }),
        ...(normal === undefined ? {} : { normal }),
        ...(isElementValue(field) ? { elementValue: true } : {}),
        ...(elements === undefined
          ? {}
          : {
              elements:
                typeof elements === "boolean" || elements === "answer" || elements === "selection"
                  ? elements
                  : [elements].flat().map((relative) => relativePath(field, relative)),
            }),
        ...(counts ? { keys: listsAbove(field, schemas).lists.map((list) => [list.key ?? []].flat()) } : {}),
      },
    ];
  });
}
