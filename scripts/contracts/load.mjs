// Loads all JSON Schemas and the command catalog into one Ajv instance (ADR-0003).
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const root = path.resolve(import.meta.dirname, "../..");
export const schemasDir = path.join(root, "schemas");
export const BASE = "https://reqseq.dev/schemas/";

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

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
  const catalog = readJson(path.join(schemasDir, "commands", "catalog.json"));
  return { ajv, schemas, meta, catalog };
}

/** Command input/output schemas use refs relative to schemas/commands/. */
export function commandSchema(cmd, part) {
  return { $id: `${BASE}commands/${cmd.name}.${part}.json`, ...cmd[part] };
}
