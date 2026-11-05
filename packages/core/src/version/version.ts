// Version (Fassung) of an element as content hash, normal forms n1 and n2 (ADR-0005, D-013, D-027, D-057, SR-091).
// Pure: no file system access. The model module reads the element and its linked files and passes them in.
import { createHash } from "node:crypto";

/** A normal form this module computes. A new normal form gets a new prefix (D-027). */
export type NormalForm = "n1" | "n2";

/** The normal form of every version the tool writes (n1 until the switch of #166). */
export const NORMAL_FORM: NormalForm = "n1";

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

/**
 * What canonical JSON does with a number that is not finite (`.inf`, `.nan`): `throw` a RangeError
 * (a version, ADR-0005), or `write` it as `String(value)` (`comparableContent`, never hashed).
 */
type NonFinite = "throw" | "write";

/** Canonical JSON: no whitespace, object keys sorted by code point, every string in normal form. */
function canonicalJson(value: VersionValue, nonFinite: NonFinite): string {
  if (typeof value === "string") {
    return JSON.stringify(normalizeText(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map((v: VersionValue) => canonicalJson(v, nonFinite)).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).sort(([a], [b]) => byCodePoint(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v, nonFinite)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    if (nonFinite === "write") {
      return String(value);
    }
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

/**
 * n2: the targets of a relation-valued property count as a set (D-027): the ids sorted by code
 * point and deduplicated, always as a list; malformed entries follow in file order (ADR-0005).
 */
function relationIdSet(value: VersionValue): VersionValue {
  const all = (Array.isArray(value) ? value : [value]).map(targetId);
  const ids = [...new Set(all.filter((v): v is string => typeof v === "string"))].sort(byCodePoint);
  return [...ids, ...all.filter((v) => typeof v !== "string")];
}

/** Absent, `null` and an empty list are the same and are left out (ADR-0005). */
const isAbsent = (value: VersionValue | undefined): value is undefined | null | readonly [] =>
  value === undefined || value === null || (Array.isArray(value) && value.length === 0);

/**
 * The canonical content of a normal form (ADR-0005). Its UTF-8 bytes are hashed. For n2 the caller
 * passes the text and string values with the `version=` parameters of their inline references
 * removed (`withoutReferenceVersions` in `model/version-input.ts`); this block only writes them.
 */
export const canonicalContent = (input: VersionInput, form: NormalForm = NORMAL_FORM): string =>
  contentOf(input, "throw", form);

/**
 * The canonical content with a number that is not finite written as `String(value)` instead of
 * throwing: equal for two inputs exactly when their versions would be equal, had they one. Never
 * hashed and never a version; for telling whether a save changed the content of an element whose
 * version cannot be computed (SR-024 AK2, AK3; #276).
 */
export const comparableContent = (input: VersionInput, form: NormalForm = NORMAL_FORM): string =>
  contentOf(input, "write", form);

/** The sections of a canonical content after its header, with the values each was written from. */
interface Sections {
  readonly text: string;
  readonly textSection: string;
  readonly props: readonly { readonly key: string; readonly value: VersionValue; readonly section: string }[];
  readonly files: string;
}

/**
 * The sections of `input` in `form`. With `like`, the sections of another form of the same element:
 * a section whose value is the same (the same string, the same object) and that both forms write
 * alike is taken from it instead of written again (n1 and n2 differ only in relation-valued
 * properties and in text and values with a `version=` parameter).
 */
function sectionsOf(input: VersionInput, nonFinite: NonFinite, form: NormalForm, like?: Sections): Sections {
  // The text is one JSON string line, so no text can look like a `prop` or `file` section.
  const textSection =
    like?.text === input.text ? like.textSection : `text\n${JSON.stringify(normalizeText(input.text))}\n`;
  const relation = form === "n1" ? relationIds : relationIdSet;
  const counted = input.definitions.filter((d) => d.content === true);
  const props: { key: string; value: VersionValue; section: string }[] = [];
  for (const def of counted.sort((a, b) => byCodePoint(a.key, b.key))) {
    // Own keys only: a property key such as `constructor` must not read Object.prototype.
    const value = Object.hasOwn(input.properties, def.key) ? input.properties[def.key] : undefined;
    if (isAbsent(value)) {
      continue;
    }
    const before = like?.props[props.length];
    const section =
      def.kind !== "relation" && before?.key === def.key && before.value === value
        ? before.section
        : `prop ${def.key}\n${canonicalJson(def.kind === "relation" ? relation(value) : value, nonFinite)}\n`;
    props.push({ key: def.key, value, section });
  }
  return { text: input.text, textSection, props, files: like?.files ?? filesSection(input.files) };
}

function filesSection(files: readonly VersionFile[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const file of [...files].sort((a, b) => byCodePoint(a.path, b.path))) {
    if (seen.has(file.path)) {
      throw new Error(`version: file ${file.path} given twice`);
    }
    seen.add(file.path);
    parts.push(`file ${file.path}\n${file.sha256 ?? MISSING_FILE}\n`);
  }
  return parts.join("");
}

const joined = (form: NormalForm, sections: Sections): string =>
  `reqseq-version ${form}\n${sections.textSection}${sections.props.map((p) => p.section).join("")}${sections.files}`;

function contentOf(input: VersionInput, nonFinite: NonFinite, form: NormalForm): string {
  return joined(form, sectionsOf(input, nonFinite, form));
}

/**
 * The version of an element in a normal form: the prefix (`n1:`, `n2:`) and the first 64 bits of
 * SHA-256 over the canonical content, as hex.
 */
export const computeVersion = (input: VersionInput, form: NormalForm = NORMAL_FORM): string =>
  `${form}:${sha256Hex(canonicalContent(input, form)).slice(0, 16)}`;

/** The version of an element in each normal form the tool computes (D-027: every published form stays computable). */
export interface VersionForms {
  readonly n1: string;
  readonly n2: string;
}

/**
 * The versions of one element in both normal forms, from its n1 input and its n2 input
 * (`n2Input` in `model/version-input.ts`: the same files and definitions, the text and values
 * without the `version=` parameters of their inline references). The sections both forms write
 * alike are written once.
 */
export const computeVersions = (n1: VersionInput, n2: VersionInput): VersionForms => {
  const first = sectionsOf(n1, "throw", "n1");
  const second = sectionsOf(n2, "throw", "n2", first);
  return {
    n1: `n1:${sha256Hex(joined("n1", first)).slice(0, 16)}`,
    n2: `n2:${sha256Hex(joined("n2", second)).slice(0, 16)}`,
  };
};

/** The normal form of a version by its prefix, or undefined for one of a form this tool does not know. */
export const formOf = (version: string): NormalForm | undefined =>
  version.startsWith("n1:") ? "n1" : version.startsWith("n2:") ? "n2" : undefined;

/**
 * Whether a stored version equals the current one, compared in the stored version's own form
 * (ADR-0005 "Normal form 2"): a stored n1 with the current n1, a stored n2 with the current n2.
 * False for a version of a form this tool does not know.
 */
export const sameVersion = (stored: string, current: VersionForms): boolean => {
  const form = formOf(stored);
  return form !== undefined && current[form] === stored;
};
