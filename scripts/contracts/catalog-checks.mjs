// Checks of the command catalog that JSON Schema cannot express (ADR-0002): titles and the argument
// sources of the command prompt (SR-108). Returns the error lines; `validate-schemas.mjs` prints them.

/** Sources that read the field named by `of`. */
const NEEDS_CONTEXT = new Set([
  "status",
  "invalidStatus",
  "relationKind",
  "relationTarget",
  "relation",
  "value",
  "hint",
]);
/** Sources that may be given `of` (property: every property of the metamodel without it). */
const MAY_HAVE_CONTEXT = new Set([...NEEDS_CONTEXT, "property"]);

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

/** `of`: only for sources that read a field, and only an earlier one. */
function checkContext(arg, earlier) {
  if (arg.of === undefined) {
    return NEEDS_CONTEXT.has(arg.complete) && earlier.length === 0
      ? [`"${arg.field}": ${arg.complete} needs an earlier field`]
      : [];
  }
  const errors = [];
  if (!MAY_HAVE_CONTEXT.has(arg.complete)) {
    errors.push(`"${arg.field}": ${arg.complete} takes no "of"`);
  }
  if (!earlier.includes(arg.of)) {
    errors.push(`"${arg.field}": "of" must name an earlier field, not "${arg.of}"`);
  }
  return errors;
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
    errors.push(...checkContext(arg, fields.slice(0, index)), ...checkKind(arg, property));
  });
  return errors.map((e) => `arguments: ${e}`);
}

/** @param {{ commands: any[] }} catalog */
export function checkCatalog(catalog) {
  const titles = new Map();
  return catalog.commands.flatMap((cmd) =>
    [...checkTitle(cmd, titles), ...checkArguments(cmd)].map((e) => `catalog.json: ${cmd.name}: ${e}`),
  );
}
