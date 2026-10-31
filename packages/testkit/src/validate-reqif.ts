// Checks a ReqIF file against the ReqIF 1.2 XSDs (ADR-0013) with libxml2 as WebAssembly
// (`xmllint-wasm`, in a worker thread, `--nonet`, files in memory only). The XSDs are not in the
// repository: CI downloads them into REQSEQ_REQIF_XSD_DIR (toolchain/reqif/README.md), and the tests
// that need them are skipped locally with that reason and required in CI.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateXML } from "xmllint-wasm";

export interface XsdFile {
  readonly name: string;
  readonly contents: string;
}

/** A pinned schema file: its base name and SHA-256. */
export interface XsdPin {
  readonly name: string;
  readonly sha256: string;
}

export interface ReqifValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** The repository's pins of the ReqIF XSDs, `sha256sum` format. */
export const REQIF_XSD_PINS = path.join(ROOT, "toolchain/reqif/xsd.sha256");
/** The schema a ReqIF file is checked against; it imports the others. */
export const REQIF_ROOT_SCHEMA = "reqif.xsd";
export const REQIF_XSD_SKIP_REASON =
  "the ReqIF XSDs are not in the repository (product owner decision, 2026-10-31); CI downloads them. " +
  "Agent sessions cannot reach omg.org or w3.org. Elsewhere run `node scripts/reqif-xsd/fetch.mjs <dir>` and set REQSEQ_REQIF_XSD_DIR=<dir>.";

/** The pins of a `sha256sum` file: `<sha256>  <name>` per line; `#` starts a comment line. */
export const readPins = (text: string): XsdPin[] =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"))
    .map((line) => {
      const match = /^([0-9a-f]{64}) [ *](\S+)$/.exec(line.trim());
      if (match === null) {
        throw new Error(`Not a pinned SHA-256: "${line.trim()}"`);
      }
      return { name: String(match[2]), sha256: String(match[1]) };
    });

const LOCATION =
  /(<(?:[\w.-]+:)?(?:import|include|redefine)\b[^>]*?\bschemaLocation\s*=\s*)(["'])([^"']*)\2/g;

/**
 * The schemas with every `schemaLocation` of `xs:import`, `xs:include` and `xs:redefine` pointed to the
 * loaded file of the same base name, in memory only (the files stay as downloaded). Throws for a location
 * no loaded file has, so a missing schema is never a skipped import.
 */
export const localSchemas = (files: readonly XsdFile[]): XsdFile[] => {
  const names = new Set(files.map((file) => file.name));
  return files.map(({ name, contents }) => ({
    name,
    contents: contents.replace(LOCATION, (_all, start: string, quote: string, location: string) => {
      const base = location.slice(location.lastIndexOf("/") + 1);
      if (!names.has(base)) {
        throw new Error(`${name} names the schema ${location}, which is not loaded`);
      }
      return `${start}${quote}${base}${quote}`;
    }),
  }));
};

/** The IDENTIFIERs of the file and every `*-REF` text that names none of them. */
const danglingReferences = (xml: string): string[] => {
  const defined = new Set(Array.from(xml.matchAll(/\sIDENTIFIER\s*=\s*"([^"]*)"/g), (match) => match[1]));
  const dangling: string[] = [];
  for (const match of xml.matchAll(/<((?:[\w.-]+:)?[A-Z][A-Z-]*-REF)>\s*([^<]*?)\s*<\//g)) {
    const [, element, identifier] = match;
    if (!defined.has(identifier)) {
      dangling.push(`<${String(element)}> ${String(identifier)} names no IDENTIFIER of the file`);
    }
  }
  return dangling;
};

/**
 * Checks `xml` against `root` of `schemas` (rewritten by `localSchemas`): libxml2's errors, its schema
 * warnings as errors too, and every `*-REF` that resolves to no IDENTIFIER (libxml2 does not resolve
 * IDREFs in element content).
 */
export const validateXml = async (
  xml: string,
  schemas: readonly XsdFile[],
  root: string,
): Promise<ReqifValidation> => {
  const local = localSchemas(schemas);
  const rootSchema = local.find((file) => file.name === root);
  if (rootSchema === undefined) {
    throw new Error(`The schema ${root} is not loaded`);
  }
  let found: string[];
  try {
    const result = await validateXML({
      xml: { fileName: "file.reqif", contents: xml },
      schema: { fileName: rootSchema.name, contents: rootSchema.contents },
      preload: local
        .filter((file) => file !== rootSchema)
        .map(({ name, contents }) => ({ fileName: name, contents })),
      modifyArguments: (args) => ["--nonet", ...args],
    });
    found = [
      ...result.errors.map((error) => error.rawMessage),
      ...result.rawOutput.split("\n").filter((line) => /\bwarning\b/i.test(line)),
    ];
  } catch (error) {
    // A schema that does not compile: libxml2 ends with its messages.
    found = String(error)
      .split("\n")
      .filter((line) => line.trim() !== "");
  }
  const errors = [...found, ...danglingReferences(xml)];
  return { valid: errors.length === 0, errors };
};

const loaded = new Map<string, XsdFile[]>();

/**
 * The pinned schema files of `dir`, each checked against its SHA-256; read once per folder and process.
 * A missing file or one with another hash throws, so a stale or partial folder fails clearly.
 */
export const loadXsdDir = (dir: string, pins: readonly XsdPin[]): XsdFile[] => {
  const key = `${dir}\n${pins.map((pin) => `${pin.sha256} ${pin.name}`).join("\n")}`;
  const cached = loaded.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const files = pins.map(({ name, sha256 }) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      throw new Error(`${name} is missing in ${dir}`);
    }
    const bytes = fs.readFileSync(file);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== sha256) {
      throw new Error(`${name} in ${dir} has SHA-256 ${actual}, not the pinned ${sha256}`);
    }
    return { name, contents: bytes.toString("utf8") };
  });
  loaded.set(key, files);
  return files;
};

/** What a test needs to skip itself with a note (Vitest's test context). */
export interface SkippableContext {
  skip(note?: string): never;
}

/**
 * The folder of the ReqIF XSDs from `env`: REQSEQ_REQIF_XSD_DIR when it exists; in CI a missing one
 * throws (the step `ReqIF XSDs` must have run); elsewhere the test skips with `REQIF_XSD_SKIP_REASON`.
 */
export const reqifXsdDir = (
  context: SkippableContext,
  env: Readonly<Record<string, string | undefined>>,
): string => {
  const dir = env["REQSEQ_REQIF_XSD_DIR"];
  if (dir !== undefined && dir !== "" && fs.existsSync(dir)) {
    return dir;
  }
  if (env["CI"] !== undefined && env["CI"] !== "") {
    throw new Error(
      `The ReqIF XSDs are missing in CI (REQSEQ_REQIF_XSD_DIR="${String(dir)}"): run the step ReqIF XSDs first`,
    );
  }
  return context.skip(REQIF_XSD_SKIP_REASON);
};

/** Checks a ReqIF file against the pinned ReqIF 1.2 XSDs in `dir` (`pins`: the text of a `sha256sum` file). */
export const validateReqif = (xml: string, dir: string, pins: string): Promise<ReqifValidation> =>
  validateXml(xml, loadXsdDir(dir, readPins(pins)), REQIF_ROOT_SCHEMA);
