// Version (Fassung) of an element as content hash, normal form n1 (ADR-0005, D-013, D-027, D-057, SR-091).
// Pure: no file system access. The model module reads the element and its linked files and passes them in.
import { createHash } from "node:crypto";

/** Prefix of every version this module computes. A new normal form gets a new prefix (D-027). */
export const NORMAL_FORM = "n1";

/** Value kind of a property (metamodel.schema.json, `kind`). */
export type VersionPropertyKind = "text" | "number" | "date" | "choice" | "relation";

/** A frontmatter value as parsed by the YAML 1.2 core schema: dates are `YYYY-MM-DD` strings, choices their key. */
export type VersionValue =
  string | number | boolean | null | readonly VersionValue[] | { readonly [key: string]: VersionValue };

/** The part of a metamodel property definition the version needs. */
export interface VersionPropertyDefinition {
  readonly key: string;
  readonly kind: VersionPropertyKind;
  /** "Counts to the version" (D-057). Absent means false. */
  readonly content?: boolean;
}

/**
 * An image the text embeds with a relative link that resolves inside the repository (D-057, ADR-0005 "Files").
 * The model module extracts and normalises the links; this block only writes them.
 */
export interface VersionFile {
  /** Normalised path relative to the folder of the element file, with `/`, e.g. `SR-825b7146fb54/layout.png`. */
  readonly path: string;
  /** SHA-256 of the file bytes, lower-case hex (see `sha256Hex`); `null` when the file does not exist. */
  readonly sha256: string | null;
}

/** Written instead of a hash for a linked file that does not exist, so adding the file changes the version. */
export const MISSING_FILE = "missing";

/** Everything the version of one element depends on. */
export interface VersionInput {
  /** Markdown body after the frontmatter, unchanged. */
  readonly text: string;
  /** Frontmatter values by key. Keys without a definition (structural keys, relation kinds, unknown keys) never count. */
  readonly properties: Readonly<Record<string, VersionValue | undefined>>;
  /** Definitions of the properties the element's type has. Only these can count (ADR-0005). */
  readonly definitions: readonly VersionPropertyDefinition[];
  /** Embedded images, each path once; a duplicate path throws. */
  readonly files: readonly VersionFile[];
}

/** SHA-256 as lower-case hex; strings are hashed as UTF-8. */
export const sha256Hex = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

/**
 * Normal form of a text (D-027): CRLF and CR become LF, trailing spaces and tabs are removed from every line,
 * runs of blank lines become one, leading and trailing blank lines are removed. Nothing else changes.
 */
export function normalizeText(text: string): string {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/[ \t]+$/, "");
    if (line !== "" || (out.length > 0 && out[out.length - 1] !== "")) {
      out.push(line);
    }
  }
  if (out[out.length - 1] === "") {
    out.pop();
  }
  return out.join("\n");
}

/** Order by Unicode code point, which equals the byte order of UTF-8. */
const byCodePoint = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

const isRecord = (value: VersionValue): value is Readonly<Record<string, VersionValue>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Canonical JSON (non-finite numbers throw a RangeError): no whitespace, object keys sorted by code point, every string in normal form. */
function canonicalJson(value: VersionValue): string {
  if (typeof value === "string") {
    return JSON.stringify(normalizeText(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).sort(([a], [b]) => byCodePoint(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError(`version: ${String(value)} is not a valid number`);
  }
  // Numbers as ECMAScript Number::toString (RFC 8785), booleans and null as JSON.
  return JSON.stringify(value);
}

/**
 * A relation target contributes only its id, so the version of a target never cascades (ADR-0005).
 * A malformed entry (no string `id`) is passed through unchanged; the element check reports it.
 */
function targetId(value: VersionValue): VersionValue {
  if (isRecord(value) && typeof value["id"] === "string") {
    return value["id"];
  }
  return value;
}

const relationIds = (value: VersionValue): VersionValue =>
  Array.isArray(value) ? value.map(targetId) : targetId(value);

/** Absent, `null` and an empty list are the same and are left out (ADR-0005). */
const isAbsent = (value: VersionValue | undefined): value is undefined | null | readonly [] =>
  value === undefined || value === null || (Array.isArray(value) && value.length === 0);

/** The canonical content of normal form n1 (ADR-0005). Its UTF-8 bytes are hashed. */
export function canonicalContent(input: VersionInput): string {
  // The text is one JSON string line, so no text can look like a `prop` or `file` section.
  const parts = [`logreq-version ${NORMAL_FORM}\n`, `text\n${JSON.stringify(normalizeText(input.text))}\n`];
  const counted = input.definitions.filter((d) => d.content === true);
  for (const def of counted.sort((a, b) => byCodePoint(a.key, b.key))) {
    // Own keys only: a property key such as `constructor` must not read Object.prototype.
    const value = Object.hasOwn(input.properties, def.key) ? input.properties[def.key] : undefined;
    if (isAbsent(value)) {
      continue;
    }
    parts.push(`prop ${def.key}\n${canonicalJson(def.kind === "relation" ? relationIds(value) : value)}\n`);
  }
  const seen = new Set<string>();
  for (const file of [...input.files].sort((a, b) => byCodePoint(a.path, b.path))) {
    if (seen.has(file.path)) {
      throw new Error(`version: file ${file.path} given twice`);
    }
    seen.add(file.path);
    parts.push(`file ${file.path}\n${file.sha256 ?? MISSING_FILE}\n`);
  }
  return parts.join("");
}

/** The version of an element: `n1:` and the first 64 bits of SHA-256 over the canonical content, as hex. */
export const computeVersion = (input: VersionInput): string =>
  `${NORMAL_FORM}:${sha256Hex(canonicalContent(input)).slice(0, 16)}`;
