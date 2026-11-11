#!/usr/bin/env node
// Checks that every schema compiles, the command catalog is valid, every example file
// in schemas/examples/<format>/ matches its schema (SR-009 AK2, AK3) and every example input in
// schemas/examples/commands/ the input schema of its command.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import { loadContracts, commandSchema, schemasDir, BASE, CATALOG_HEADER } from "./load.mjs";
import { checkCatalog } from "./catalog-checks.mjs";
import { checkCommandExamples } from "./command-examples.mjs";
import { PROBLEM_CODES_FILE, checkProblemCodes } from "./problem-codes.mjs";

const errors = [];
let contracts;
try {
  contracts = loadContracts();
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
const { ajv, schemas, catalog } = contracts;

for (const f of Object.keys(schemas)) {
  try {
    ajv.getSchema(BASE + f);
  } catch (e) {
    errors.push(`${f}: ${e.message}`);
  }
}

// The catalog is one file per command plus catalog.header.json (ADR-0002, load.mjs): each command file is
// checked against the entry schema and the header keys against the root, so every message names its file
// and each problem is reported once.
const meta = `${BASE}commands/catalog.meta.schema.json`;
const validHeader = ajv.getSchema(meta);
if (!validHeader({ ...catalog, commands: [] })) {
  errors.push(`schemas/commands/${CATALOG_HEADER}: ${ajv.errorsText(validHeader.errors)}`);
}
const validEntry = ajv.compile({ $ref: `${meta}#/properties/commands/items` });
let entriesValid = true;
for (const cmd of catalog.commands) {
  const file = `schemas/commands/${cmd.name}.json`;
  if (!validEntry(cmd)) {
    entriesValid = false;
    errors.push(`${file}: ${ajv.errorsText(validEntry.errors)}`);
  }
  // D-045, SR-072 AK2: no access may offer deleting an element.
  if (/delete|remove/i.test(cmd.name) && !cmd.name.startsWith("relation.")) {
    errors.push(`${file}: elements are superseded, never deleted (D-045)`);
  }
  for (const part of ["input", "output"]) {
    try {
      ajv.compile(commandSchema(cmd, part));
    } catch (e) {
      errors.push(`${file}: ${part}: ${e.message}`);
    }
  }
}

// Titles, argument sources of the command prompt (SR-108) and jsonLines; needs entries that match the meta-schema.
if (entriesValid) {
  errors.push(...checkCatalog(catalog, schemas));
}

// Each example with a general parser of its format and no extensions (SR-009 AK3): JSON.parse for .json,
// YAML 1.2 core schema for .yaml and for the frontmatter of .md. A .jsonl example is read line by line elsewhere.
function parseExample(f, text) {
  if (f.endsWith(".json")) {
    const data = JSON.parse(text);
    // JSON.parse keeps the last of two equal keys; JSON is YAML 1.2, whose parser rejects them.
    YAML.parse(text, { version: "1.2", schema: "core", uniqueKeys: true });
    return data;
  }
  if (!f.endsWith(".md")) {
    return YAML.parse(text, { version: "1.2", schema: "core" });
  }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) {
    throw new Error("no frontmatter");
  }
  return YAML.parse(m[1], { version: "1.2", schema: "core" });
}

// Version test vectors (ADR-0005): schemas/examples/version/vectors.yaml lists element file, embedded files,
// missing files, canonical bytes and version. Checks the element against its schema, that the files exist and
// the missing ones do not, and that the version is "n1:" + the first 16 hex of SHA-256 over the canonical
// bytes. The core test (packages/core/src/version/vectors.test.ts) recomputes the bytes.
const vectorsWhere = "examples/version/vectors.yaml";
const isPath = (p) => typeof p === "string" && p !== "";
// A path exists only when every name is spelled as on disk (ADR-0005 "Files": case and normal form
// are never ignored), so a file system that ignores case (Windows, macOS) does not find `Photo.png`
// for `photo.png`.
const existsIn = (dir, p) => {
  if (!isPath(p)) {
    return false;
  }
  let folder = dir;
  for (const name of p.split("/")) {
    if (name === "." || name === "..") {
      folder = path.join(folder, name);
      continue;
    }
    let names;
    try {
      names = fs.readdirSync(folder);
    } catch {
      return false;
    }
    if (!names.includes(name)) {
      return false;
    }
    folder = path.join(folder, name);
  }
  return true;
};
// Mirrors `windowsChanges` in packages/core/src/model/discover.ts (this script runs before the
// build, so it cannot import core): a name that Windows changes or refuses.
const DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu;
const windowsChanges = (name) =>
  /\p{Cc}/u.test(name) || /[. ]$/.test(name) || /[<>:"|?*]/.test(name) || DEVICE_NAME.test(name);
// A path the ADR-0005 rules count as missing by its spelling alone (a trailing `/`, a `\`, a name
// that Windows changes) may name a file the operating system finds anyway (Windows), so only the
// other missing paths must not exist.
const missingBySpelling = (p) =>
  isPath(p) && (p.endsWith("/") || p.includes("\\") || p.split("/").some(windowsChanges));

function vectorList(v, key) {
  if (Array.isArray(v[key])) {
    return v[key];
  }
  errors.push(`${vectorsWhere}: ${v.element}: ${key} must be a list`);
  return [];
}

// The version a canonical file gives in a normal form: the prefix and the first 16 hex of its SHA-256.
const versionOfFile = (dir, form, file) =>
  `${form}:${crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(dir, file)))
    .digest("hex")
    .slice(0, 16)}`;

// The n2 entry of a vector (#166): its canonical file exists and gives its version.
function checkN2(dir, v) {
  if (v.n2 === undefined) {
    return;
  }
  if (!existsIn(dir, v.n2?.canonical)) {
    errors.push(`${vectorsWhere}: ${v.element}: n2 canonical ${v.n2?.canonical} not found`);
    return;
  }
  const got = versionOfFile(dir, "n2", v.n2.canonical);
  if (v.n2.version !== got) {
    errors.push(`${vectorsWhere}: ${v.element}: n2 version ${v.n2.version}, canonical bytes give ${got}`);
  }
}

function checkVector(dir, v, validate) {
  checkN2(dir, v);
  for (const f of [v.element, v.canonical, ...vectorList(v, "files")]) {
    if (!existsIn(dir, f)) {
      errors.push(`${vectorsWhere}: ${f} not found`);
    }
  }
  for (const f of vectorList(v, "missing")) {
    if (!isPath(f) || (!missingBySpelling(f) && existsIn(dir, f))) {
      errors.push(`${vectorsWhere}: missing file ${f} must be a path that does not exist`);
    }
  }
  if (!existsIn(dir, v.element) || !existsIn(dir, v.canonical)) {
    return 0;
  }
  const data = parseExample(v.element, fs.readFileSync(path.join(dir, v.element), "utf8"));
  if (!validate(data)) {
    errors.push(`examples/version/${v.element}: ${ajv.errorsText(validate.errors)}`);
  }
  const got = versionOfFile(dir, "n1", v.canonical);
  if (v.version !== got) {
    errors.push(`${vectorsWhere}: ${v.element}: version ${v.version}, canonical bytes give ${got}`);
  }
  return 1;
}

function checkVersionVectors(dir) {
  const validate = ajv.getSchema(`${BASE}element.schema.json`);
  const index = YAML.parse(fs.readFileSync(path.join(dir, "vectors.yaml"), "utf8"), {
    version: "1.2",
    schema: "core",
  });
  if (!existsIn(dir, index?.metamodel)) {
    errors.push(`${vectorsWhere}: metamodel ${index?.metamodel} not found`);
  }
  let n = 0;
  for (const v of Array.isArray(index?.vectors) ? index.vectors : []) {
    n += checkVector(dir, v, validate);
  }
  return n;
}

// The lines of a JSON Lines example (SR-009 AK3), each read with JSON.parse and checked against `#/$defs/line`
// of its schema; an empty file or an empty line is an error.
function checkJsonLines(where, text, schemaName) {
  const validate = ajv.getSchema(`${BASE}${schemaName}.schema.json#/$defs/line`);
  if (!validate) {
    return [`${where}: no $defs/line in ${schemaName}.schema.json`];
  }
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  return lines.flatMap((line, index) => {
    let data;
    try {
      data = JSON.parse(line);
      // JSON.parse keeps the last of two equal keys; JSON is YAML 1.2, whose parser rejects them.
      YAML.parse(line, { version: "1.2", schema: "core", uniqueKeys: true });
    } catch (e) {
      return [`${where}:${index + 1}: ${e.message}`];
    }
    return validate(data) ? [] : [`${where}:${index + 1}: ${ajv.errorsText(validate.errors)}`];
  });
}

// Examples: schemas/examples/<schema base name>/<file>.yaml|.md|.json|.jsonl
const examplesDir = path.join(schemasDir, "examples");
let count = 0;
for (const dir of fs.readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  if (dir.name === "version") {
    count += checkVersionVectors(path.join(examplesDir, dir.name));
    continue;
  }
  if (dir.name === "commands") {
    const found = checkCommandExamples(path.join(examplesDir, dir.name), catalog, ajv);
    count += found.count;
    errors.push(...found.errors);
    continue;
  }
  const validate = ajv.getSchema(`${BASE}${dir.name}.schema.json`);
  if (!validate) {
    errors.push(`examples/${dir.name}: no schema ${dir.name}.schema.json`);
    continue;
  }
  for (const f of fs.readdirSync(path.join(examplesDir, dir.name))) {
    const text = fs.readFileSync(path.join(examplesDir, dir.name, f), "utf8");
    if (f.endsWith(".jsonl")) {
      count++;
      errors.push(...checkJsonLines(`examples/${dir.name}/${f}`, text, dir.name));
      continue;
    }
    if (![".md", ".yaml", ".json"].some((ext) => f.endsWith(ext))) {
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

// Cause and remedy of every problem and error code (SR-139 AK2).
errors.push(
  ...checkProblemCodes(
    fs.readFileSync(path.join(schemasDir, PROBLEM_CODES_FILE), "utf8"),
    schemas["common.schema.json"],
  ),
);

if (errors.length) {
  for (const e of errors) {
    console.error(`error: ${e}`);
  }
  process.exit(1);
}
console.log(
  `schemas ok: ${Object.keys(schemas).length} schemas, ${catalog.commands.length} commands, ${count} examples`,
);
