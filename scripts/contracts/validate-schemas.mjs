#!/usr/bin/env node
// Checks that every schema compiles, the command catalog is valid and every example file
// in schemas/examples/<format>/ matches its schema (SR-009 AK2, AK3).
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { loadContracts, commandSchema, schemasDir, BASE } from "./load.mjs";

const errors = [];
const { ajv, schemas, catalog } = loadContracts();

for (const f of Object.keys(schemas)) {
  try {
    ajv.getSchema(BASE + f);
  } catch (e) {
    errors.push(`${f}: ${e.message}`);
  }
}

const validCatalog = ajv.getSchema(BASE + "commands/catalog.meta.schema.json");
if (!validCatalog(catalog)) {
  errors.push(`catalog.json: ${ajv.errorsText(validCatalog.errors)}`);
}
const names = new Set();
for (const cmd of catalog.commands) {
  if (names.has(cmd.name)) {
    errors.push(`catalog.json: duplicate command ${cmd.name}`);
  }
  names.add(cmd.name);
  // D-045, SR-072 AK2: no access may offer deleting an element.
  if (/delete|remove/i.test(cmd.name) && !cmd.name.startsWith("relation.")) {
    errors.push(`catalog.json: ${cmd.name}: elements are superseded, never deleted (D-045)`);
  }
  for (const part of ["input", "output"]) {
    try {
      ajv.compile(commandSchema(cmd, part));
    } catch (e) {
      errors.push(`catalog.json: ${cmd.name}.${part}: ${e.message}`);
    }
  }
}

function parseExample(f, text) {
  if (!f.endsWith(".md")) {
    return YAML.parse(text, { version: "1.2", schema: "core" });
  }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) {
    throw new Error("no frontmatter");
  }
  return YAML.parse(m[1], { version: "1.2", schema: "core" });
}

// Examples: schemas/examples/<schema base name>/<file>.yaml|.md
const examplesDir = path.join(schemasDir, "examples");
let count = 0;
for (const dir of fs.readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const validate = ajv.getSchema(`${BASE}${dir.name}.schema.json`);
  if (!validate) {
    errors.push(`examples/${dir.name}: no schema ${dir.name}.schema.json`);
    continue;
  }
  for (const f of fs.readdirSync(path.join(examplesDir, dir.name))) {
    const text = fs.readFileSync(path.join(examplesDir, dir.name, f), "utf8");
    if (!f.endsWith(".md") && !f.endsWith(".yaml")) {
      continue;
    }
    let data;
    try {
      data = parseExample(f, text);
    } catch (e) {
      errors.push(`examples/${dir.name}/${f}: ${e.message}`);
      continue;
    }
    count++;
    if (!validate(data)) {
      errors.push(`examples/${dir.name}/${f}: ${ajv.errorsText(validate.errors)}`);
    }
  }
}

if (errors.length) {
  for (const e of errors) {
    console.error(`error: ${e}`);
  }
  process.exit(1);
}
console.log(
  `schemas ok: ${Object.keys(schemas).length} schemas, ${catalog.commands.length} commands, ${count} examples`,
);
