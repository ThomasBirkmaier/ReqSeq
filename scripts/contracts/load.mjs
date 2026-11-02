// Loads all JSON Schemas and the command catalog into one Ajv instance (ADR-0003).
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const root = path.resolve(import.meta.dirname, "../..");
export const schemasDir = path.join(root, "schemas");
export const BASE = "https://reqseq.dev/schemas/";
/** The header of the catalog: every catalog key except `commands`, plus `order` (ADR-0002). */
export const CATALOG_HEADER = "catalog.header.json";

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

/** Why `name` from `order` cannot be read, or undefined; `seen` maps the lower-case names listed before. */
function listedProblem(name, seen, onDisk, where) {
  const other = seen.get(name.toLowerCase());
  if (other !== undefined) {
    return other === name ? `${name} is listed twice` : `${name} and ${other} differ only in case`;
  }
  seen.set(name.toLowerCase(), name);
  if (name.endsWith(".schema")) {
    return `${name}: a command name must not end in ".schema"`;
  }
  return onDisk.includes(`${name}.json`)
    ? undefined
    : `${name} is listed, but ${where}/${name}.json does not exist`;
}

/** The files of the folder that are neither the header, a schema nor a listed command. */
function unlistedProblems(onDisk, names, where) {
  return onDisk.flatMap((file) => {
    if (file === "catalog.json") {
      return [
        `${where}/catalog.json is no longer read; move the entries you changed into ${where}/<name>.json and list new names in ${where}/${CATALOG_HEADER} (#528)`,
      ];
    }
    const listed = names.includes(file.slice(0, -".json".length));
    return !file.endsWith(".json") || file === CATALOG_HEADER || file.endsWith(".schema.json") || listed
      ? []
      : [
          `${where}/${file} is not listed in ${where}/${CATALOG_HEADER}; add its name to "order", at the end of its group`,
        ];
  });
}

/**
 * Assembles the command catalog from `schemas/commands/` (ADR-0002, #528): `catalog.header.json` holds the
 * catalog keys and `order`, the command names in catalog order; each command is in `<name>.json`. Returns
 * the catalog as one object, `{ $schema, ...header without order, commands }`. Throws one error that lists
 * every problem of the folder: a file that is no JSON, a listed name without its file (spelled as on disk),
 * a command file that is not listed, a name listed twice or twice ignoring case (Windows, macOS), and a file
 * whose `name` differs from its file name. validate-schemas.mjs checks the header and the entries against
 * the meta-schema.
 * @param {string} dir the folder, `schemas/commands`
 * @param {string} where the folder as messages name it
 */
export function loadCatalog(dir = path.join(schemasDir, "commands"), where = "schemas/commands") {
  const problems = [];
  const parse = (file) => {
    try {
      return readJson(path.join(dir, file));
    } catch (e) {
      problems.push(`${where}/${file}: ${e.message}`);
      return undefined;
    }
  };
  // Names as on disk: a file system that ignores case (Windows, macOS) would find `Element.get.json` too.
  const onDisk = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .sort();
  if (!onDisk.includes(CATALOG_HEADER)) {
    throw new Error(`${where}/${CATALOG_HEADER} is missing`);
  }
  const { order, ...header } = parse(CATALOG_HEADER) ?? {};
  if (!Array.isArray(order) || order.some((name) => typeof name !== "string")) {
    problems.push(`${where}/${CATALOG_HEADER}: "order" must be a list of command names`);
  }
  const names = Array.isArray(order) ? order.filter((name) => typeof name === "string") : [];
  const seen = new Map();
  const commands = [];
  for (const name of names) {
    const problem = listedProblem(name, seen, onDisk, where);
    const cmd = problem === undefined ? parse(`${name}.json`) : undefined;
    if (problem !== undefined) {
      problems.push(`${where}/${CATALOG_HEADER}: ${problem}`);
    } else if (cmd !== undefined && cmd?.name !== name) {
      problems.push(`${where}/${name}.json: "name" must be ${JSON.stringify(name)}, as the file name`);
    }
    commands.push(cmd);
  }
  problems.push(...unlistedProblems(onDisk, names, where));
  if (problems.length > 0) {
    throw new Error(`the command catalog cannot be assembled:\n${problems.join("\n")}`);
  }
  return { $schema: "./catalog.meta.schema.json", ...header, commands };
}

export function loadContracts() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  const schemas = {};
  for (const f of fs.readdirSync(schemasDir).filter((f) => f.endsWith(".schema.json"))) {
    const s = readJson(path.join(schemasDir, f));
    if (s.$id !== BASE + f) {
      throw new Error(`${f}: $id must be ${BASE + f}`);
    }
    schemas[f] = s;
    ajv.addSchema(s);
  }
  const meta = readJson(path.join(schemasDir, "commands", "catalog.meta.schema.json"));
  ajv.addSchema(meta);
  const catalog = loadCatalog();
  return { ajv, schemas, meta, catalog };
}

/** Command input/output schemas use refs relative to schemas/commands/. */
export function commandSchema(cmd, part) {
  return { $id: `${BASE}commands/${cmd.name}.${part}.json`, ...cmd[part] };
}
