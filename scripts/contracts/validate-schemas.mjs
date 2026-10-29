#!/usr/bin/env node
// Checks that every schema compiles, the command catalog is valid and every example file
// in schemas/examples/<format>/ matches its schema (SR-009 AK2, AK3).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import { loadContracts, commandSchema, schemasDir, BASE } from "./load.mjs";
import { checkCatalog } from "./catalog-checks.mjs";
import { PROBLEM_CODES_FILE, checkProblemCodes } from "./problem-codes.mjs";

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

// Titles, argument sources of the command prompt (SR-108) and jsonLines; needs a catalog that matches the meta-schema.
if (validCatalog.errors === null) {
  errors.push(...checkCatalog(catalog, schemas));
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

function checkVector(dir, v, validate) {
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
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(dir, v.canonical)))
    .digest("hex");
  if (v.version !== `n1:${hash.slice(0, 16)}`) {
    errors.push(
      `${vectorsWhere}: ${v.element}: version ${v.version}, canonical bytes give n1:${hash.slice(0, 16)}`,
    );
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

// Examples: schemas/examples/<schema base name>/<file>.yaml|.md
const examplesDir = path.join(schemasDir, "examples");
let count = 0;
for (const dir of fs.readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  if (dir.name === "version") {
    count += checkVersionVectors(path.join(examplesDir, dir.name));
    continue;
  }
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
