// Checks of the command catalog that JSON Schema cannot express (ADR-0002): titles, the length of
// summaries (#1252), the argument sources of the command prompt (SR-108) and the JSON Lines form
// (`jsonLines`, #319). Returns the error lines; `validate-schemas.mjs` prints them.

/** Sources that give elements: what `of` of an element source names. */
const ELEMENTS = ["element", "relationTarget"];
/**
 * Sources that read an earlier field, and the sources that field may have. Without `of`, a source reads
 * the nearest earlier field of such a source that has no `meaning` (`contextOf`, the same rule as
 * `contextField` in the app's `catalog-commands.ts`).
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
  criterion: ["element"],
  elementFile: ["element"],
  properties: ["type"],
  relations: ["type"],
  metamodelLocation: ["folder"],
};
/** Sources that give every value of the metamodel or the workspace when no such field comes before. */
const WITHOUT_CONTEXT = new Set(["status", "invalidStatus", "relationKind", "hint", "property"]);

/**
 * The field the argument at `at` reads: `of`, else the nearest earlier field of a fitting source, never
 * an `element` field with a `meaning` (a variant or a package: `evidence.record criteria` reads `ref`, not
 * `variant`). Undefined for a source that reads nothing, or when no such field comes before.
 */
export const contextOf = (args, at) => {
  const arg = args[at];
  if (arg?.of !== undefined) {
    return arg.of;
  }
  const fitting = arg === undefined ? undefined : CONTEXT[arg.complete];
  return args
    .slice(0, at)
    .reverse()
    .find((earlier) => fitting?.includes(earlier.complete) === true && earlier.meaning === undefined)?.field;
};

/** The inline schema of a field, or of the items of an array field. */
const itemOf = (property) => (property.type === "array" ? (property.items ?? {}) : property);

/** The most words a summary has; the rest of the text goes to `details` (#1252). */
export const SUMMARY_WORDS = 50;

/** Summaries: one or two sentences, counted as the source text split at white space. */
function checkSummary(cmd) {
  const words = typeof cmd.summary === "string" ? cmd.summary.split(/\s+/).filter((w) => w !== "").length : 0;
  return words > SUMMARY_WORDS
    ? [
        `summary has ${words} words, more than ${SUMMARY_WORDS}: keep one or two sentences, move the rest to details`,
      ]
    : [];
}

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

/** Whether a field (or the items of an array field) is a `localPath` of `common.schema.json`. */
const isLocalPath = (property) => /#\/\$defs\/localPath$/.test(itemOf(property).$ref ?? "");

/** Path sources: `folder` or `file` exactly on the `localPath` fields (ADR-0002 rule 1, SR-143). */
const PATHS = new Set(["folder", "file"]);

/**
 * The values of a `choice` field: its inline `enum`, or the `enum` of the definition its `$ref` names
 * (`hint.list kind`: `common.schema.json#/$defs/problemCode`), which the app's core host puts inline.
 */
const choiceValues = (item, schemas) =>
  item.$ref === undefined ? item.enum : resolveRef(item.$ref, "commands/", schemas)?.schema.enum;

/**
 * A description for every argument (SR-210 AK6): its own, else the one of the type its field, or the
 * items of a list field, names by a `$ref`, which the app's core host gives the windows with it.
 */
function checkDescription(arg, property, schemas) {
  if (typeof property.description === "string") {
    // An own description is shown as it is, so a blank one is no description.
    return property.description.trim() === "" ? [`"${arg.field}": has a blank description`] : [];
  }
  const ref = property.$ref ?? (property.type === "array" ? property.items?.$ref : undefined);
  const type = ref === undefined ? undefined : resolveRef(ref, "commands/", schemas)?.schema;
  return typeof type?.description === "string" && type.description.trim() !== ""
    ? []
    : [`"${arg.field}": needs a description, its own or one of the type its $ref names`];
}

/** Whether `ref` names the definition `name` of the schema file `file`. */
const names = (ref, file, name) => typeof ref === "string" && ref.endsWith(`${file}#/$defs/${name}`);

/**
 * The composed sources bound to their schema in both directions, as `folder`/`file` to `localPath`: a
 * field of that schema is completed so, and only such a field.
 */
const BOUND = {
  condition: {
    holds: (property) => names(property.$ref, "filter.schema.json", "condition"),
    is: "a condition",
  },
  sort: {
    holds: (property) =>
      property.type === "array" && names(property.items?.$ref, "filter.schema.json", "sortKey"),
    is: "a list of sortKey",
  },
  group: { holds: (property) => names(property.$ref, "common.schema.json", "groupKey"), is: "a groupKey" },
  searchField: {
    holds: (property) =>
      property.type === "array" && names(property.items?.$ref, "common.schema.json", "searchFieldKey"),
    is: "a list of searchFieldKey",
  },
};

/** The sources bound one way: each needs its kind of field, which may also be asked otherwise (`json`). */
const NEEDS = {
  properties: {
    holds: (property) =>
      property.type === "object" &&
      names(property.additionalProperties?.$ref, "element.schema.json", "inputValue"),
    is: "an object of inputValue",
  },
  relations: {
    holds: (property) => names(property.$ref, "common.schema.json", "relationRefs"),
    is: "a relationRefs",
  },
  metamodelLocation: {
    holds: (property) =>
      property.type === "object" &&
      property.properties?.repository !== undefined &&
      property.properties?.path !== undefined,
    is: "an object with repository and path",
  },
  evidenceLocation: { holds: (property) => property.type === "string", is: "a string" },
};

/** The composed and located sources: each fits its kind of field (`BOUND`, `NEEDS`). */
function checkBound(arg, property) {
  const bound = Object.entries(BOUND).find(([, rule]) => rule.holds(property));
  if (bound !== undefined && bound[0] !== arg.complete) {
    return [`"${arg.field}": ${bound[1].is} field is completed as ${bound[0]}`];
  }
  const rule = BOUND[arg.complete] ?? NEEDS[arg.complete];
  return rule === undefined || rule.holds(property)
    ? []
    : [`"${arg.field}": ${arg.complete} needs ${rule.is} field`];
}

/** The sources whose kind has to fit the type of the field. */
function checkKind(arg, property, schemas) {
  const item = itemOf(property);
  if (isLocalPath(property) !== PATHS.has(arg.complete)) {
    return PATHS.has(arg.complete)
      ? [`"${arg.field}": ${arg.complete} needs a localPath field`]
      : [`"${arg.field}": a localPath field is completed as folder or file`];
  }
  const bound = checkBound(arg, property);
  if (bound.length > 0) {
    return bound;
  }
  if (arg.complete === "choice" && !Array.isArray(choiceValues(item, schemas))) {
    return [`"${arg.field}": choice needs an enum, inline or as the definition its $ref names`];
  }
  if (arg.complete === "boolean" && item.type !== "boolean") {
    return [`"${arg.field}": boolean needs a boolean field`];
  }
  if (arg.complete === "number" && item.type !== "integer" && item.type !== "number") {
    return [`"${arg.field}": number needs an integer field`];
  }
  return [];
}

/**
 * `of`: only for sources that read a field, and only an earlier field of a fitting source; without it a
 * fitting field without `meaning` must come before (`contextOf`), unless the source gives every value.
 */
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
  return WITHOUT_CONTEXT.has(arg.complete) || contextOf([...earlier, arg], earlier.length) !== undefined
    ? []
    : [`"${arg.field}": ${arg.complete} needs an earlier ${kinds} field`];
}

/** `meaning`: only on an `element` source (`variant` or `package`, the enum of the meta schema). */
const checkMeaning = (arg) =>
  arg.meaning === undefined || arg.complete === "element"
    ? []
    : [`"${arg.field}": meaning is only for an element source, not ${arg.complete}`];

/**
 * `class`: on every `text` source and only there, so a new argument asked as free text is taken up in the
 * catalog on purpose (SR-215 AK2); the meta schema holds the closed list of classes.
 */
const checkClass = (arg) =>
  (arg.complete === "text") === (arg.class !== undefined)
    ? []
    : arg.complete === "text"
      ? [`"${arg.field}": a text source needs a class (SR-215 AK2)`]
      : [`"${arg.field}": class is only for a text source, not ${arg.complete}`];

/** `replaces`: only earlier optional fields, each once (a required one is always given). */
function checkReplaces(arg, earlier, required) {
  const names = arg.replaces ?? [];
  return names
    .filter(
      (name, i) => !earlier.some((e) => e.field === name) || required.has(name) || names.indexOf(name) !== i,
    )
    .map((name) => `"${arg.field}": "replaces" must name earlier optional fields, each once, not "${name}"`);
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

/**
 * Flags the CLI derives from the parts of a field (#149, #173): keep in step with `partsOf` in
 * `packages/cli/src/fields.ts`, whose `buildProgram` refuses a clash too. Direct `$ref`s only.
 */
const SELECTION_FLAGS = [
  "ids",
  "filter",
  "where",
  "where-type",
  "where-status",
  "package",
  "baseline",
  "view",
];
function partFlags(property, flag) {
  const ref = property?.$ref ?? "";
  if (ref.endsWith("common.schema.json#/$defs/selection")) {
    return SELECTION_FLAGS;
  }
  if (ref.endsWith("filter.schema.json#/$defs/condition")) {
    return [flag, `${flag}-type`, `${flag}-status`];
  }
  return property?.type === "array" &&
    (property.items?.$ref ?? "").endsWith("filter.schema.json#/$defs/sortKey")
    ? [flag]
    : [];
}

/** A part flag (`--ids` of a selection) is neither a common option nor another field's flag. */
function checkPartFlags(cmd) {
  const flagOf = (arg) => arg.flag ?? arg.field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const properties = cmd.input.properties ?? {};
  const derived = cmd.arguments.map((arg) => ({ arg, parts: partFlags(properties[arg.field], flagOf(arg)) }));
  const plain = derived
    .filter(({ parts }) => parts.length === 0)
    .flatMap(({ arg }) => [
      flagOf(arg),
      ...(properties[arg.field]?.type === "boolean" ? [`no-${flagOf(arg)}`] : []),
    ]);
  return derived.flatMap(({ arg, parts }) =>
    parts.flatMap((flag) => {
      if (COMMON_OPTIONS.includes(flag)) {
        return [`"${arg.field}": part flag "${flag}" is a common option`];
      }
      const others = derived.filter((d) => d.arg !== arg).flatMap((d) => d.parts);
      return plain.includes(flag) || others.includes(flag)
        ? [`"${arg.field}": part flag "${flag}" is also the flag of another field`]
        : [];
    }),
  );
}

/** Every input field exactly once, the required ones first, each source fitting its field. */
function checkArguments(cmd, schemas) {
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
    errors.push(
      ...checkContext(arg, cmd.arguments.slice(0, index)),
      ...checkMeaning(arg),
      ...checkClass(arg),
      ...checkKind(arg, property, schemas),
      ...checkDescription(arg, property, schemas),
      ...checkReplaces(arg, cmd.arguments.slice(0, index), required),
    );
  });
  errors.push(...checkFlags(cmd), ...checkPartFlags(cmd));
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

/**
 * `jsonLines` (#319): `items` is a top-level array of the output, every field a top-level property that
 * is not `items` itself and no property of the item schema, so a line never holds a key twice. A field
 * may be another array: the lines of data.export carry `repositories` (SR-062 AK1).
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
    if (field === items) {
      return [`jsonLines: "${field}" is the array of the lines`];
    }
    return item.has(field) ? [`jsonLines: "${field}" is also a property of the items of "${items}"`] : [];
  });
}

/** `textOutput` (SR-151 AK4): a required top-level `string` of the output, which the CLI prints alone. */
function checkTextOutput(cmd, schemas) {
  if (cmd.textOutput === undefined) {
    return [];
  }
  const field = cmd.textOutput;
  const required = cmd.output.required ?? [];
  return propertiesOf(cmd.output, "commands/", schemas).get(field)?.type === "string" &&
    required.includes(field)
    ? []
    : [`textOutput: "${field}" is not a required top-level string of the output`];
}

/**
 * @param {{ commands: any[] }} catalog
 * @param {Record<string, any>} schemas the schema files by name (`loadContracts`), for `jsonLines` and `choice`
 */
export function checkCatalog(catalog, schemas = {}) {
  const titles = new Map();
  return catalog.commands.flatMap((cmd) =>
    [
      ...checkTitle(cmd, titles),
      ...checkSummary(cmd),
      ...checkArguments(cmd, schemas),
      ...checkJsonLines(cmd, schemas),
      ...checkTextOutput(cmd, schemas),
    ].map((e) => `schemas/commands/${cmd.name}.json: ${e}`),
  );
}
