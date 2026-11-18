// Checks of the titles and marks of output fields (SR-224 AK3, AK4, AK7, D-078; ADR-0002 rule 1), on the fields
// `output-fields.mjs` finds. Each place of a shared definition is checked once, whatever output reaches it.
import {
  MARKS,
  TECHNICAL_DEFINITIONS,
  normalOf,
  outputFieldsOf,
  relativePath,
  resolveRef,
  titleOf,
} from "./output-fields.mjs";

/** A field title: English, sentence case, at most 40 characters, no final punctuation, as a command title. */
const TITLE = /^[A-Z0-9][^.!?]*$/;
const TITLE_LENGTH = 40;
/** A reference to this repository's spec or issues, which a user cannot look up (user-text.mjs). */
const INTERNAL = /#\d+|\b(?:D|SR|N)-\d{3}\b|\bADR-\d{4}\b|\bAK\d+\b/;
/** The only fields that are technical only when their problem names an element (#1876). */
const WITH_ELEMENT = new Set([
  "common.schema.json#/$defs/problem/properties/file",
  "common.schema.json#/$defs/problem/properties/line",
]);

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The write commands whose output carries content of its own, so the app shows it after they ran (SR-224 AK7):
 * a plan, an import or an export result. Every other write command reports in the command line (SR-223 AK8). The
 * set follows the proposed wording of #1880; it is the one place that changes when the wording does.
 */
export const SHOWS_OUTPUT = new Set([
  "element.bulkUpdate",
  "evidence.enrichJunit",
  "reqif.import",
  "reqif.export",
]);

/** The schema a field's `$ref`s end at. */
function target(schema, file, schemas, seen = new Set()) {
  if (typeof schema.$ref !== "string" || seen.has(schema)) {
    return { schema, file };
  }
  seen.add(schema);
  const found = resolveRef(schema.$ref, file, schemas);
  return found === undefined ? { schema, file } : target(found.schema, found.file, schemas, seen);
}

/** Whether a schema is a UUID, or an object whose `id` is one: what an element list holds. */
function namesElement(schema, file, schemas) {
  if (/#\/\$defs\/uuid$/.test(schema.$ref ?? "")) {
    return true;
  }
  const end = target(schema, file, schemas);
  const parts = [end.schema, ...(end.schema.allOf ?? [])];
  return parts.some((part) => {
    const resolved =
      part.$ref === undefined ? { schema: part, file: end.file } : target(part, end.file, schemas);
    const id = resolved.schema.properties?.id;
    return isObject(id) && /#\/\$defs\/uuid$/.test(id.$ref ?? "");
  });
}

/** The marks found anywhere in a schema, as `<pointer>: <mark>`. */
function marksIn(node, at = "") {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => marksIn(item, `${at}/${i}`));
  }
  if (!isObject(node)) {
    return [];
  }
  return Object.entries(node).flatMap(([key, value]) => [
    ...(MARKS.includes(key) ? [`${at === "" ? "/" : at}: ${key}`] : []),
    ...marksIn(value, `${at}/${key}`),
  ]);
}

/** The patterns of the technical definitions, which an inline schema must not repeat. */
function technicalPatterns(schemas) {
  return new Map(
    TECHNICAL_DEFINITIONS.flatMap((key) => {
      const found = resolveRef(key, "", schemas);
      return typeof found?.schema.pattern === "string" ? [[found.schema.pattern, key]] : [];
    }),
  );
}

/** The definitions marked `x-technical`, which must be exactly those SR-224 AK3 names. */
function checkTechnicalDefinitions(schemas) {
  const marked = Object.entries(schemas).flatMap(([file, schema]) =>
    Object.entries(schema.$defs ?? {})
      .filter(([, def]) => def["x-technical"] !== undefined)
      .map(([name]) => `${file}#/$defs/${name}`),
  );
  return [
    ...TECHNICAL_DEFINITIONS.filter((key) => !marked.includes(key)).map(
      (key) => `${key}: a definition SR-224 AK3 names needs "x-technical": true`,
    ),
    ...marked
      .filter((key) => !TECHNICAL_DEFINITIONS.includes(key))
      .map(
        (key) => `${key}: only the definitions SR-224 AK3 names carry x-technical; mark the field instead`,
      ),
    ...TECHNICAL_DEFINITIONS.filter((key) => {
      const def = resolveRef(key, "", schemas)?.schema;
      return def !== undefined && def["x-technical"] !== undefined && def["x-technical"] !== true;
    }).map((key) => `${key}: x-technical of a definition is true`),
  ];
}

/** The errors of one place of a field: title, `x-technical`, inline patterns. */
function checkPlace(field, schemas, patterns) {
  const errors = [];
  const title = titleOf(field, schemas);
  if (typeof title !== "string") {
    errors.push("has no title (SR-224 AK3)");
  } else if (!TITLE.test(title) || title.length > TITLE_LENGTH || INTERNAL.test(title)) {
    errors.push(
      `title "${title}": sentence case, at most ${TITLE_LENGTH} characters, no final punctuation, no internal reference`,
    );
  }
  const own = field.schema["x-technical"];
  if (own !== undefined && own !== true && own !== "with-element") {
    errors.push(`x-technical is true or "with-element"; leave it out otherwise`);
  }
  if (own === "with-element" && !WITH_ELEMENT.has(field.place)) {
    errors.push(`x-technical "with-element" is only for file and line of a problem`);
  }
  const pattern = target(field.schema, field.file, schemas).schema.pattern;
  if (field.schema.$ref === undefined && patterns.has(pattern)) {
    errors.push(`repeats the pattern of ${patterns.get(pattern)}; refer to it`);
  }
  if (field.schema.format === "uuid") {
    errors.push("is a UUID: refer to common.schema.json#/$defs/uuid");
  }
  return errors;
}

/** Whether a field is at the top level of its output. */
const isTop = (field) => field.parent === undefined && field.path === field.name;

/** The normal values the rule fixes: no problems, not incomplete (SR-223 AK7). */
function checkNormal(field, schemas) {
  const errors = [];
  if (isTop(field) && field.name === "problems" && !equal(normalOf(field, schemas), [])) {
    errors.push(`"x-normal": [] (no problems is the normal value, SR-223 AK7)`);
  }
  if (field.name === "incomplete" && normalOf(field, schemas) !== false) {
    errors.push(`refers to common.schema.json#/$defs/incomplete, whose normal value is false`);
  }
  return errors;
}

/** A list of elements (`true`, `"answer"`): an array of UUIDs or of objects with a UUID `id`. */
function checkList(field, elements, schemas) {
  const end = target(field.schema, field.file, schemas).schema;
  const errors = [];
  if (end.type !== "array" || !isObject(end.items) || !namesElement(end.items, field.file, schemas)) {
    errors.push(
      `x-elements ${JSON.stringify(elements)} is for an array of UUIDs or of objects with a UUID "id"`,
    );
  }
  if (elements === "answer" && !isTop(field)) {
    errors.push(`x-elements "answer" is for a top-level field`);
  }
  return errors;
}

/** A count of elements: an integer whose paths name lists of elements of the same output (SR-224 AK4). */
function checkCount(field, elements, fields, schemas) {
  const errors = [];
  if (target(field.schema, field.file, schemas).schema.type !== "integer") {
    errors.push("x-elements with paths is for a number that counts elements");
  }
  for (const relative of [elements].flat()) {
    const mark = fields.find((other) => other.path === relativePath(field, String(relative)))?.schema[
      "x-elements"
    ];
    if (mark !== true && mark !== "answer") {
      errors.push(`x-elements "${relative}" names no field with x-elements true or "answer"`);
    }
  }
  return errors;
}

/** The errors of `x-normal` and `x-elements` of a field of one output. */
function checkField(field, fields, schemas) {
  const elements = field.schema["x-elements"];
  const marks =
    elements === undefined
      ? []
      : elements === true || elements === "answer"
        ? checkList(field, elements, schemas)
        : typeof elements === "string" || (Array.isArray(elements) && elements.length > 0)
          ? checkCount(field, elements, fields, schemas)
          : [`x-elements is true, "answer", or the paths of the lists a number counts`];
  return [...checkNormal(field, schemas), ...marks];
}

/** `showsOutput` (SR-224 AK7) in both directions, and the marks a command file may not have. */
function checkEntry(cmd, fields) {
  const errors = [];
  const answers = fields.filter((field) => field.schema["x-elements"] === "answer");
  if (answers.length > 1) {
    errors.push(
      `x-elements "answer" on ${answers.map((f) => f.path).join(", ")}: at most one field is the answer`,
    );
  }
  if (SHOWS_OUTPUT.has(cmd.name) && (cmd.effect !== "write-files" || cmd.showsOutput !== true)) {
    errors.push("showsOutput: true, since its output carries content of its own (SR-224 AK7)");
  }
  if (!SHOWS_OUTPUT.has(cmd.name) && cmd.showsOutput !== undefined) {
    errors.push(
      "showsOutput: only the write commands of SHOWS_OUTPUT in output-checks.mjs show their output (SR-224 AK7)",
    );
  }
  for (const mark of marksIn(cmd.input)) {
    errors.push(`input${mark}: marks are for outputs`);
  }
  if (cmd.outputFields !== undefined) {
    errors.push("outputFields: written by generate.mjs into the generated catalog only");
  }
  return errors;
}

/**
 * The errors of the titles and marks of every output field of the catalog.
 * @param {{ commands: any[] }} catalog
 * @param {Record<string, any>} schemas the schema files by name (`loadContracts`)
 */
export function checkOutputs(catalog, schemas) {
  const errors = checkTechnicalDefinitions(schemas);
  const patterns = technicalPatterns(schemas);
  const checked = new Set();
  for (const cmd of catalog.commands) {
    const where = `schemas/commands/${cmd.name}.json`;
    const fields = outputFieldsOf(cmd.output, schemas);
    for (const field of fields) {
      const shared = field.file !== "commands/";
      const place = shared ? `schemas/${field.place}` : `${where}${field.place}`;
      if (!checked.has(place)) {
        checked.add(place);
        errors.push(...checkPlace(field, schemas, patterns).map((e) => `${place} (${field.path}): ${e}`));
      }
      errors.push(...checkField(field, fields, schemas).map((e) => `${where}: output ${field.path}: ${e}`));
    }
    errors.push(...checkEntry(cmd, fields).map((e) => `${where}: ${e}`));
  }
  return [...new Set(errors)];
}
