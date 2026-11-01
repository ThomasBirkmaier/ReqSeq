// Checks of the command catalog that JSON Schema cannot express (ADR-0002): titles, the argument
// sources of the command prompt (SR-108) and the JSON Lines form (`jsonLines`, #319). Returns the
// error lines; `validate-schemas.mjs` prints them.

/** Sources that give elements: what `of` of an element source names. */
const ELEMENTS = ["element", "relationTarget"];
/**
 * Sources that read an earlier field, and the sources that field may have. Without `of`, a source reads
 * the nearest earlier field of such a source (the same rule as `contextField` in the app's
 * `catalog-commands.ts`).
 */
export const CONTEXT = {
  status: ELEMENTS,
  invalidStatus: ELEMENTS,
  relationKind: ELEMENTS,
  hint: ELEMENTS,
  property: ELEMENTS,
  relation: [...ELEMENTS, "relation"],
  relationTarget: ["relationKind"],
  value: ["property"],
};
/** Sources that give every value of the metamodel or the workspace when no such field comes before. */
const WITHOUT_CONTEXT = new Set(["status", "invalidStatus", "relationKind", "hint", "property"]);

/** The inline schema of a field, or of the items of an array field. */
const itemOf = (property) => (property.type === "array" ? (property.items ?? {}) : property);

/** Titles: unique, and D-045: no access offers deleting an element. */
function checkTitle(cmd, titles) {
  const errors = [];
  if (titles.has(cmd.title)) {
    errors.push(`title "${cmd.title}" is also the title of ${titles.get(cmd.title)}`);
  }
  titles.set(cmd.title, cmd.name);
  if (/delete|remove/i.test(cmd.title) && !cmd.name.startsWith("relation.")) {
    errors.push(`title "${cmd.title}": elements are superseded, never deleted (D-045)`);
  }
  return errors;
}

/** The sources whose kind has to fit the type of the field. */
function checkKind(arg, property) {
  const item = itemOf(property);
  if (arg.complete === "choice" && !Array.isArray(item.enum)) {
    return [`"${arg.field}": choice needs an inline enum`];
  }
  if (arg.complete === "boolean" && item.type !== "boolean") {
    return [`"${arg.field}": boolean needs a boolean field`];
  }
  if (arg.complete === "number" && item.type !== "integer" && item.type !== "number") {
    return [`"${arg.field}": number needs an integer field`];
  }
  return [];
}

/** `of`: only for sources that read a field, and only an earlier field of a fitting source. */
function checkContext(arg, earlier) {
  const fitting = CONTEXT[arg.complete];
  if (fitting === undefined) {
    return arg.of === undefined ? [] : [`"${arg.field}": ${arg.complete} takes no "of"`];
  }
  const kinds = fitting.join(" or ");
  if (arg.of !== undefined) {
    const named = earlier.find((e) => e.field === arg.of);
    return named !== undefined && fitting.includes(named.complete)
      ? []
      : [`"${arg.field}": "of" must name an earlier ${kinds} field, not "${arg.of}"`];
  }
  return WITHOUT_CONTEXT.has(arg.complete) || earlier.some((e) => fitting.includes(e.complete))
    ? []
    : [`"${arg.field}": ${arg.complete} needs an earlier ${kinds} field`];
}

/**
 * Options every CLI command has: keep in step with `RESERVED_FLAGS` in `packages/cli/src/fields.ts`,
 * plus `--jsonl` (`packages/cli/src/program.ts`).
 */
const COMMON_OPTIONS = ["json", "yaml", "jsonl", "workspace", "input", "help"];

/**
 * `flag`: a CLI flag name of its own (ADR-0009), neither another field's flag (nor `--no-<flag>` of an
 * inline boolean field) nor a common option.
 */
function checkFlags(cmd) {
  const flagOf = (arg) => arg.flag ?? arg.field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const isBoolean = (arg) => cmd.input.properties?.[arg.field]?.type === "boolean";
  return cmd.arguments
    .filter((arg) => arg.flag !== undefined)
    .flatMap((arg) =>
      COMMON_OPTIONS.includes(arg.flag)
        ? [`"${arg.field}": flag "${arg.flag}" is a common option`]
        : cmd.arguments.some(
              (other) =>
                other !== arg &&
                (flagOf(other) === arg.flag || (isBoolean(other) && `no-${flagOf(other)}` === arg.flag)),
            )
          ? [`"${arg.field}": flag "${arg.flag}" is also the flag of another field`]
          : [],
    );
}

/** Every input field exactly once, the required ones first, each source fitting its field. */
function checkArguments(cmd) {
  const errors = [];
  const properties = cmd.input.properties ?? {};
  const required = new Set(cmd.input.required ?? []);
  const fields = cmd.arguments.map((a) => a.field);
  for (const field of Object.keys(properties)) {
    const count = fields.filter((f) => f === field).length;
    if (count !== 1) {
      errors.push(`input field "${field}" must be listed exactly once in arguments (found ${count})`);
    }
  }
  let optionalSeen = null;
  cmd.arguments.forEach((arg, index) => {
    const property = properties[arg.field];
    if (!property) {
      errors.push(`"${arg.field}" is no input field`);
      return;
    }
    if (!required.has(arg.field)) {
      optionalSeen ??= arg.field;
    } else if (optionalSeen) {
      errors.push(`required "${arg.field}" comes after optional "${optionalSeen}"`);
    }
    errors.push(...checkContext(arg, cmd.arguments.slice(0, index)), ...checkKind(arg, property));
  });
  errors.push(...checkFlags(cmd));
  return errors.map((e) => `arguments: ${e}`);
}

/**
 * The schema a `$ref` names, with the file it is in: refs relative to `file` (a key of `schemas`,
 * `commands/` for command schemas), `#` alone or `#/$defs/<name>`.
 */
function resolveRef(ref, file, schemas) {
  const [target, pointer = ""] = ref.split("#");
  const name = target === "" ? file : target.replace(/^\.\.\//, "");
  const root = schemas[name];
  const def = /^\/\$defs\/([^/]+)$/.exec(pointer)?.[1];
  const schema = pointer === "" ? root : def === undefined ? undefined : root?.$defs?.[def];
  return schema === undefined ? undefined : { schema, file: name };
}

/** The properties of an object schema, its `$ref` and its `allOf` parts included (by name). */
function propertiesOf(schema, file, schemas, seen = new Set()) {
  if (typeof schema !== "object" || schema === null || seen.has(schema)) {
    return new Map();
  }
  seen.add(schema);
  const found = new Map(Object.entries(schema.properties ?? {}));
  const parts = [...(schema.$ref === undefined ? [] : [{ $ref: schema.$ref }]), ...(schema.allOf ?? [])];
  for (const part of parts) {
    const resolved = part.$ref === undefined ? { schema: part, file } : resolveRef(part.$ref, file, schemas);
    if (resolved !== undefined) {
      for (const [name, property] of propertiesOf(resolved.schema, resolved.file, schemas, seen)) {
        found.set(name, found.get(name) ?? property);
      }
    }
  }
  return found;
}

/** The type of a property, after one `$ref`. */
function typeOf(property, file, schemas) {
  const resolved = property.$ref === undefined ? undefined : resolveRef(property.$ref, file, schemas);
  return property.type ?? resolved?.schema.type;
}

/**
 * `jsonLines` (#319): `items` is a top-level array of the output, every field a top-level property that
 * is no array and no property of the item schema, so a line never holds a key twice.
 */
function checkJsonLines(cmd, schemas) {
  if (cmd.jsonLines === undefined) {
    return [];
  }
  const { items, fields } = cmd.jsonLines;
  const output = propertiesOf(cmd.output, "commands/", schemas);
  const array = output.get(items);
  if (array === undefined || array.type !== "array") {
    return [`jsonLines: "${items}" is not a top-level array of the output`];
  }
  const outputFile =
    cmd.output.$ref === undefined ? "commands/" : resolveRef(cmd.output.$ref, "commands/", schemas)?.file;
  const item = propertiesOf(array.items ?? {}, outputFile ?? "commands/", schemas);
  return fields.flatMap((field) => {
    const property = output.get(field);
    if (property === undefined) {
      return [`jsonLines: "${field}" is not a top-level field of the output`];
    }
    if (typeOf(property, outputFile, schemas) === "array") {
      return [`jsonLines: "${field}" is an array`];
    }
    return item.has(field) ? [`jsonLines: "${field}" is also a property of the items of "${items}"`] : [];
  });
}

/**
 * @param {{ commands: any[] }} catalog
 * @param {Record<string, any>} schemas the schema files by name (`loadContracts`), for `jsonLines`
 */
export function checkCatalog(catalog, schemas = {}) {
  const titles = new Map();
  return catalog.commands.flatMap((cmd) =>
    [...checkTitle(cmd, titles), ...checkArguments(cmd), ...checkJsonLines(cmd, schemas)].map(
      (e) => `catalog.json: ${cmd.name}: ${e}`,
    ),
  );
}
