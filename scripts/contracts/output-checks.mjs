// Checks of the titles and marks of output fields (SR-224 AK3, AK4, AK7, D-078; ADR-0002 rule 1), on the fields
// `output-fields.mjs` finds. Each place of a shared definition is checked once, whatever output reaches it.
import {
  MARKS,
  TECHNICAL_DEFINITIONS,
  listsAbove,
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
  "tool.guide",
]);

/**
 * The read commands whose answer is the state of each entry, which a list would show only on request, so the app
 * keeps their output an output page (SR-224 AK8, D-078): the change since the baseline, the verification status per
 * view. `evidence.withoutPassedTest` is not one: its answer is the selection of the requirements (SR-120 AK2).
 */
export const STAYS_OUTPUT_PAGE = new Set(["baseline.get", "evidence.status"]);

/**
 * The values of the element itself in an entry of the answer, by command (SR-224 AK9): the output page shows them
 * below the entry's row only with Show details (SR-223 AK6). An `evidence.status` entry is an element as
 * `element.list` gives it with its status; a `baseline.get` entry and every other output have none.
 */
export const ELEMENT_VALUES = new Map([
  ["evidence.status", ["type", "version", "repository", "file", "properties", "relations"]],
]);

const POSITION = "a position or size, not a number of elements";
const CRITERIA = "counts acceptance criteria, not elements";
const NODES =
  "counts the nodes of the walks, and an element is a node once per direction or walk it is reached in";

/**
 * The integer fields of outputs that count no elements (SR-224 AK4), each with its reason: a shared definition by
 * its place, a field of a command file as `<command> <path>`. Every other integer field is marked `x-elements`.
 */
export const NOT_ELEMENT_COUNTS = new Map([
  ["common.schema.json#/$defs/problem/properties/line", POSITION],
  ["common.schema.json#/$defs/problem/properties/place/properties/occurrence", POSITION],
  [
    "common.schema.json#/$defs/problem/properties/limit",
    "a limit the metamodel sets, not a number of elements",
  ],
  [
    "common.schema.json#/$defs/problem/properties/count",
    "counts the relations, list entries or acceptance criteria of the one element the problem names",
  ],
  ["common.schema.json#/$defs/listGroup/properties/offset", POSITION],
  ["common.schema.json#/$defs/textMarks/items/properties/start", POSITION],
  ["common.schema.json#/$defs/textMarks/items/properties/end", POSITION],
  [
    "data-export.schema.json#/$defs/criterionName/properties/criterion",
    "the number of an acceptance criterion",
  ],
  [
    "data-export.schema.json#/$defs/criterionEntry/properties/criterion",
    "the number of an acceptance criterion",
  ],
  ["data-export.schema.json#/$defs/criteriaCount/properties/verified", CRITERIA],
  ["data-export.schema.json#/$defs/criteriaCount/properties/total", CRITERIA],
  ["data-export.schema.json#/$defs/evidenceRecord/properties/line", POSITION],
  ["metamodel.schema.json#/$defs/property/properties/max-items", "a limit the metamodel sets"],
  ["metamodel.schema.json#/$defs/relationLimit/properties/min", "a limit the metamodel sets"],
  ["metamodel.schema.json#/$defs/relationLimit/properties/max", "a limit the metamodel sets"],
  ["workspace.check hidden.warning", "counts problems"],
  ["workspace.check hidden.info", "counts problems"],
  ["workspace.check durationMs", "a duration"],
  ["element.list tree[].depth", POSITION],
  ["element.list offset", POSITION],
  ["element.list rows", "counts rows, and an element is a row in each group it is in"],
  ["element.search offset", POSITION],
  ["element.search rows", "counts rows, and a hit is a row in each group it is in"],
  ["element.search hits[].snippet.criterion.criterion", "the number of an acceptance criterion"],
  ["element.facets properties[].distinct", "counts values, not elements"],
  ["element.assignCriterionKeys changed[].assigned", CRITERIA],
  ["trace.chain nodes[].depth", POSITION],
  ["trace.chain evidence[].depth", POSITION],
  ["trace.chain total", NODES],
  ["trace.neighbourhood nodes[].depth", POSITION],
  ["trace.neighbourhood total", NODES],
  ["trace.affected affected[].distance", POSITION],
  ["trace.matrix rows[].depth", POSITION],
  ["trace.matrix rows[].gaps[].column", POSITION],
  ["trace.matrix rows[].gaps[].count", "counts the relations of the row"],
  ["trace.matrix rows[].gaps[].min", "the minimum of relations the metamodel sets"],
  ["trace.graph nodes[].level", POSITION],
  ["trace.graph evidence[].level", POSITION],
  ["trace.graph evidence[].testCases", "counts test cases"],
  ["trace.graph evidence[].records", "counts verification records"],
  ["trace.graph evidence[].results.passed", "counts test results"],
  ["trace.graph evidence[].results.failed", "counts test results"],
  ["trace.graph evidence[].results.inconclusive", "counts test results"],
  ["trace.graph evidence[].results.skipped", "counts test results"],
  ["hint.list kinds[].count", "counts hints"],
  ["hint.list total", "counts hints"],
  ["baseline.changes hintKinds[].count", "counts hints"],
  ["baseline.changes hintTotal", "counts hints"],
  ["evidence.list display.rows[].criterion", "the number of an acceptance criterion"],
  ["evidence.record criteria[].criterion", "the number of an acceptance criterion"],
  ["evidence.enrichJunit testCases", "counts test cases"],
  ["evidence.enrichJunit withoutReference", "counts test cases"],
  ["evidence.enrichJunit notInView", "counts pairs of an element and a test case"],
  ["evidence.enrichJunit unknown[].line", POSITION],
  ["reqif.export relations", "counts relations"],
  ["html.export removed", "counts files of the earlier export"],
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

/** Whether a field's value is an integer: its type, or that of an `anyOf`/`oneOf` branch. */
function isInteger(schema, file, schemas) {
  const end = target(schema, file, schemas);
  const type = end.schema.type;
  return (
    type === "integer" ||
    (Array.isArray(type) && type.includes("integer")) ||
    [...(end.schema.anyOf ?? []), ...(end.schema.oneOf ?? [])].some((branch) =>
      isInteger(branch, end.file, schemas),
    )
  );
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

/** Whether an output is paged: its command takes a `limit`, so a top-level list holds one page. */
const isPaged = (cmd) => cmd.input?.properties?.limit !== undefined;

/** The fields of the item of a list: its properties and those of its `$ref`s and branches. */
function itemFields(array, fields) {
  const prefix = `${array.path}[].`;
  return new Set(
    fields
      .filter((f) => f.path.startsWith(prefix) && !f.path.slice(prefix.length).includes("."))
      .map((f) => f.name),
  );
}

/**
 * A count of elements (SR-224 AK4): an integer whose paths name lists of elements of the same output, or
 * `"selection"`, whose elements only `element.list` gives (a read command only). Each list it is inside names
 * the fields of its entry that identify it (`x-key`), and none is a map.
 */
function checkCount(cmd, field, elements, fields, schemas) {
  const errors = [];
  if (!isInteger(field.schema, field.file, schemas)) {
    errors.push("x-elements with paths or selection is for a number that counts elements");
  }
  if (elements === "selection" && cmd.effect !== "read") {
    errors.push(`x-elements "selection" is for a read command; a write command names the list of its output`);
  }
  for (const relative of elements === "selection" ? [] : [elements].flat()) {
    errors.push(...checkCountPath(cmd, field, String(relative), fields));
  }
  return [...errors, ...checkCountLists(field, fields, schemas)];
}

/** A path of a count names a list of elements of the same output, in a read command one of all pages. */
function checkCountPath(cmd, field, relative, fields) {
  const named = fields.find((other) => other.path === relativePath(field, relative));
  const mark = named?.schema["x-elements"];
  if (mark !== true && mark !== "answer") {
    return [`x-elements "${relative}" names no field with x-elements true or "answer"`];
  }
  return cmd.effect === "read" && mark === true && isTop(named) && isPaged(cmd)
    ? [`x-elements "${relative}" names a list of one page; mark the number "selection"`]
    : [];
}

/** Each list a count is inside names the fields of its entry (`x-key`), and none is a map. */
function checkCountLists(field, fields, schemas) {
  const errors = [];
  const { lists, maps } = listsAbove(field, schemas);
  if (maps > 0) {
    errors.push("a number of elements is not inside a map: a reader cannot name its entry");
  }
  for (const list of lists) {
    const key = list.key;
    if (!Array.isArray(key) || key.length === 0 || key.some((name) => typeof name !== "string")) {
      errors.push(`the list ${list.path} needs "x-key": the fields that identify its entry`);
      continue;
    }
    const known = list.field === undefined ? new Set() : itemFields(list.field, fields);
    for (const name of key.filter((name) => !known.has(name))) {
      errors.push(`x-key of ${list.path} names "${name}", which its entry does not have`);
    }
  }
  return errors;
}

/** The key of `field` in `NOT_ELEMENT_COUNTS`: its shared place, else `<command> <path>`. */
const notCountKey = (cmd, field) => (field.file === "commands/" ? `${cmd.name} ${field.path}` : field.place);

/** Every integer field counts elements and is marked, or is listed in `notCounts` with its reason, not both. */
function checkInteger(cmd, field, schemas, notCounts) {
  if (!isInteger(field.schema, field.file, schemas)) {
    return [];
  }
  const marked = field.schema["x-elements"] !== undefined;
  const listed = notCounts.has(notCountKey(cmd, field));
  if (marked && listed) {
    return ["is marked x-elements and listed in NOT_ELEMENT_COUNTS; keep one"];
  }
  return marked || listed
    ? []
    : [
        `a number: mark it x-elements if it counts elements, else list "${notCountKey(cmd, field)}" in NOT_ELEMENT_COUNTS of output-checks.mjs with the reason (SR-224 AK4)`,
      ];
}

/** Whether the values of a field's map, or of a map in them, are integers, which no check above sees as fields. */
function mapsNumbers(schema, file, schemas, seen = new Set()) {
  const values = target(schema, file, schemas);
  if (seen.has(values.schema)) {
    return false;
  }
  seen.add(values.schema);
  const inner = values.schema.additionalProperties;
  return (
    isObject(inner) &&
    (isInteger(inner, values.file, schemas) || mapsNumbers(inner, values.file, schemas, seen))
  );
}

/**
 * A number is never the value of a map (SR-224 AK4): a number of elements names its entry by the fields of a list
 * (`x-key`), and a map's values are no field that could be marked or listed in `NOT_ELEMENT_COUNTS`.
 */
const checkMapNumbers = (field, schemas) =>
  mapsNumbers(field.schema, field.file, schemas)
    ? [
        "a number as the value of a map: make it a list whose entries name their key (x-key) and mark the number",
      ]
    : [];

/** `x-key` stands on an array: the names of fields of its item. */
function checkKey(field, schemas) {
  const key = field.schema["x-key"];
  if (key === undefined) {
    return [];
  }
  return target(field.schema, field.file, schemas).schema.type === "array"
    ? []
    : ["x-key is for a list: the fields of its entry that identify it"];
}

/** The errors of `x-normal`, `x-elements` and `x-key` of a field of one output. */
function checkField(cmd, field, fields, schemas, notCounts) {
  const elements = field.schema["x-elements"];
  const marks =
    elements === undefined
      ? []
      : elements === true || elements === "answer"
        ? checkList(field, elements, schemas)
        : typeof elements === "string" || (Array.isArray(elements) && elements.length > 0)
          ? checkCount(cmd, field, elements, fields, schemas)
          : [`x-elements is true, "answer", "selection", or the paths of the lists a number counts`];
  return [
    ...checkNormal(field, schemas),
    ...marks,
    ...checkInteger(cmd, field, schemas, notCounts),
    ...checkMapNumbers(field, schemas),
    ...checkKey(field, schemas),
  ];
}

/** The entries of `notCounts` that name no integer field: a shared place, or a field of a command's output. */
function staleNotCounts(catalog, schemas, notCounts) {
  const errors = [];
  for (const key of notCounts.keys()) {
    const [name, path] = key.split(" ");
    const cmd = path === undefined ? undefined : catalog.commands.find((entry) => entry.name === name);
    const field =
      path === undefined
        ? resolveRef(key, "", schemas)
        : cmd === undefined
          ? undefined
          : outputFieldsOf(cmd.output, schemas).find((f) => f.path === path && f.file === "commands/");
    if (field === undefined || !isInteger(field.schema, field.file, schemas)) {
      errors.push(`NOT_ELEMENT_COUNTS "${key}" names no number of an output; remove it`);
    }
  }
  return errors;
}

/**
 * `showsOutput` (SR-224 AK7), `staysOutputPage` (SR-224 AK8) and `x-element-values` (SR-224 AK9) in both directions,
 * and the marks a command file may not have.
 */
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
  errors.push(...outputPageErrors(cmd, fields, answers), ...elementValueErrors(cmd, fields, answers));
  for (const mark of marksIn(cmd.input)) {
    errors.push(`input${mark}: marks are for outputs`);
  }
  if (cmd.outputFields !== undefined) {
    errors.push("outputFields: written by generate.mjs into the generated catalog only");
  }
  return errors;
}

/**
 * `staysOutputPage` (SR-224 AK8) in both directions, and the entries of an answer the app lists as element rows,
 * with a short ID and a title (SR-223 AK6): a record of another shape keeps its values only on an output page. A list
 * of UUIDs is listed by `element.list`.
 */
function outputPageErrors(cmd, fields, answers) {
  const errors = [];
  if (
    STAYS_OUTPUT_PAGE.has(cmd.name) &&
    (cmd.effect !== "read" || cmd.staysOutputPage !== true || answers.length !== 1)
  ) {
    errors.push(
      "staysOutputPage: true, since its answer is the state of each entry (SR-224 AK8); a read command with an answer field",
    );
  }
  if (!STAYS_OUTPUT_PAGE.has(cmd.name) && cmd.staysOutputPage !== undefined) {
    errors.push(
      "staysOutputPage: only the read commands of STAYS_OUTPUT_PAGE in output-checks.mjs stay an output page (SR-224 AK8)",
    );
  }
  const [answer] = answers;
  if (answer === undefined || cmd.staysOutputPage === true) {
    return errors;
  }
  const entryFields = fields.filter((field) => field.path.startsWith(`${answer.path}[].`));
  const has = (name) => entryFields.some((field) => field.path === `${answer.path}[].${name}`);
  if (entryFields.length > 0 && !(has("shortId") && has("title"))) {
    errors.push(
      `output ${answer.path}: the app lists the answer as rows, so its entries need shortId and title, or the command is staysOutputPage (SR-223 AK6)`,
    );
  }
  return errors;
}

/**
 * `x-element-values` (SR-224 AK9): exactly the names of `ELEMENT_VALUES`, on the answer field of its command, each a
 * field of its items; on no other field of any output.
 */
function elementValueErrors(cmd, fields, answers) {
  const errors = [];
  const wanted = ELEMENT_VALUES.get(cmd.name);
  const marked = fields.filter((field) => field.schema["x-element-values"] !== undefined);
  const answer = answers.length === 1 ? answers[0] : undefined;
  for (const field of marked) {
    if (wanted === undefined || field !== answer) {
      errors.push(
        `output ${field.path}: x-element-values only on the answer field of the commands of ELEMENT_VALUES in output-checks.mjs (SR-224 AK9)`,
      );
    }
  }
  if (wanted === undefined) {
    return errors;
  }
  const names = answer?.schema["x-element-values"];
  if (!Array.isArray(names) || !equal([...names].sort(), [...wanted].sort())) {
    errors.push(`x-element-values on its answer field: exactly ${wanted.join(", ")} (SR-224 AK9)`);
    return errors;
  }
  for (const name of names) {
    if (!fields.some((field) => field.path === `${answer.path}[].${name}`)) {
      errors.push(`x-element-values names ${name}, which is no field of the entries of ${answer.path}`);
    }
  }
  return errors;
}

/**
 * The errors of the titles and marks of every output field of the catalog.
 * @param {{ commands: any[] }} catalog
 * @param {Record<string, any>} schemas the schema files by name (`loadContracts`)
 * @param {Map<string, string>} notCounts the integer fields that count no elements, with their reason
 */
export function checkOutputs(catalog, schemas, notCounts = NOT_ELEMENT_COUNTS) {
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
      errors.push(
        ...checkField(cmd, field, fields, schemas, notCounts).map(
          (e) => `${where}: output ${field.path}: ${e}`,
        ),
      );
    }
    errors.push(...checkEntry(cmd, fields).map((e) => `${where}: ${e}`));
  }
  errors.push(...staleNotCounts(catalog, schemas, notCounts));
  return [...new Set(errors)];
}
