// Rendering of new YAML values in ReqSeq's one fixed style (ADR-0004, ADR-0007). Only values a
// command writes go through here; untouched bytes of a file are never rendered again.
//
// - Scalars are plain when that reads back as the same value, else double-quoted with escapes.
// - Nothing is ever folded or wrapped (the effect of `lineWidth: 0`): one value, one line.
// - Lists are block sequences; a mapping item (a relation target) is one flow mapping per line,
//   `- { id: \u2026, version: \u2026, title: \u2026 }`, so a Git diff shows one line per relation (SR-102).
import { isMap, isScalar, isSeq, parseDocument, Scalar } from "yaml";
import { CommandError } from "../catalog.js";
import type { LineEnding } from "./frontmatter.js";

export type ScalarValue = string | number | boolean | null;
/** A mapping in a list, for example a relation target `{ id, version, title }`. */
export type FlowMappingValue = Readonly<Record<string, ScalarValue>>;
export type ItemValue = ScalarValue | FlowMappingValue;
/**
 * What a command may write under a top-level key: a scalar, one relation target (a property with
 * one target, `element.schema.json#/$defs/value`) or a list (ADR-0004).
 */
export type PropertyValue = ScalarValue | FlowMappingValue | readonly ItemValue[];

/** Where a scalar stands; plain style is checked in exactly that place. */
type Context = "key" | "value" | "item" | "flow-key" | "flow-value";

const PROBES: Readonly<Record<Context, (text: string) => string>> = {
  key: (text) => `${text}: x\n`,
  value: (text) => `k: ${text}\n`,
  item: (text) => `- ${text}\n`,
  "flow-key": (text) => `{ ${text}: x }\n`,
  "flow-value": (text) => `{ k: ${text} }\n`,
};

const only = <T>(items: readonly T[]): T | undefined => (items.length === 1 ? items[0] : undefined);

/** The node a probe document holds in the probed place, if it has that shape. */
const probedNode = (contents: unknown, context: Context): unknown => {
  if (isSeq(contents)) {
    return only(contents.items);
  }
  if (!isMap(contents)) {
    return undefined;
  }
  const pair = only(contents.items);
  if (pair === undefined) {
    return undefined;
  }
  return context === "key" || context === "flow-key" ? pair.key : pair.value;
};

// Characters outside YAML's printable set, plus line breaks, tab, U+0085, U+2028/U+2029 and the
// byte order mark: never written raw.
export const NEEDS_ESCAPE = /[\p{Cc}\p{Cs}\u2028\u2029\ufeff\ufffe\uffff]/u;

/** True when `text` written plain in `context` reads back as exactly this string. */
export const isPlainSafe = (text: string, context: Context): boolean => {
  if (text === "" || text.trim() !== text || NEEDS_ESCAPE.test(text)) {
    return false;
  }
  // Plain only if YAML 1.2 (core) and YAML 1.1 readers agree: `yes`, `on`, `1_000`, `12:30` and
  // `2026-10-24` are strings in 1.2 but a boolean, number or date in 1.1.
  return (["1.2", "1.1"] as const).every((version) => {
    const probe = parseDocument(
      PROBES[context](text),
      version === "1.2" ? { version, schema: "core" } : { version },
    );
    if (probe.errors.length > 0 || probe.warnings.length > 0) {
      return false;
    }
    const node = probedNode(probe.contents, context);
    return isScalar(node) && node.type === Scalar.PLAIN && node.value === text;
  });
};

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  "\0": "\\0",
  "\x07": "\\a",
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\v": "\\v",
  "\f": "\\f",
  "\r": "\\r",
  "\x1b": "\\e",
  '"': '\\"',
  "\\": "\\\\",
};

const hex = (code: number, digits: number): string => code.toString(16).toUpperCase().padStart(digits, "0");

/** A YAML double-quoted scalar on one line. */
export const doubleQuoted = (text: string): string => {
  let out = '"';
  for (const ch of text) {
    const short = SHORT_ESCAPES[ch];
    // Every character that needs an escape is a single UTF-16 code unit.
    const code = ch.charCodeAt(0);
    if (short !== undefined) {
      out += short;
    } else if (NEEDS_ESCAPE.test(ch)) {
      out += code <= 0xff ? `\\x${hex(code, 2)}` : `\\u${hex(code, 4)}`;
    } else {
      out += ch;
    }
  }
  return `${out}"`;
};

export const renderScalar = (value: ScalarValue, context: Context): string => {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CommandError("input.invalid", `Cannot write the number ${String(value)} to a file`);
    }
    // String(-0) is "0"; the writer turns -0 into 0 before it compares data.
    return String(value);
  }
  return isPlainSafe(value, context) ? value : doubleQuoted(value);
};

export const renderKey = (key: string): string => renderScalar(key, "key");

const isFlowMapping = (value: PropertyValue): value is FlowMappingValue =>
  typeof value === "object" && value !== null;

/**
 * One list item without the `- `: a scalar, or a relation target as one flow mapping. Keys are
 * written in `Object.entries` order, so callers build `{ id, version, title }` in that order.
 */
export const renderItem = (value: ItemValue): string => {
  if (!isFlowMapping(value)) {
    return renderScalar(value, "item");
  }
  const entries = Object.entries(value).map(
    ([k, v]) => `${renderScalar(k, "flow-key")}: ${renderScalar(v, "flow-value")}`,
  );
  return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
};

/** Lines of a block sequence at `indent`, joined by `eol`, without a final line ending. */
export const renderItemLines = (items: readonly ItemValue[], indent: string, eol: LineEnding): string =>
  items.map((item) => `${indent}- ${renderItem(item)}`).join(eol);

/**
 * Text of a value after `key:`. A scalar, one relation target (one flow mapping) or an empty list
 * is ` value` on the key line; a list starts on the next line, its items at `itemIndent`. No final
 * line ending.
 */
export const renderValue = (value: PropertyValue, itemIndent: string, eol: LineEnding): string => {
  if (!Array.isArray(value)) {
    const single = value as ScalarValue | FlowMappingValue;
    return ` ${isFlowMapping(single) ? renderItem(single) : renderScalar(single, "value")}`;
  }
  return value.length === 0 ? " []" : `${eol}${renderItemLines(value, itemIndent, eol)}`;
};
