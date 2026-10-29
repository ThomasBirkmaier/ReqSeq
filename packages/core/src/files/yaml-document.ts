// Writing whole-file YAML documents that ReqSeq owns besides elements (ADR-0007): saved filters
// (SR-070) now, baselines and mappings later. A pure module: it returns the new text, and
// `writeFileAtomic` with the check kind `yaml` writes it.
//
// - A new document is rendered in one fixed style: block mappings and block lists, a list of plain
//   values as one flow list on one line (`type: [need, system-requirement]`), texts plain when they
//   read back as the same value, else double-quoted with escapes, never folded or as block scalars.
// - An existing document is changed by its top-level keys only: a changed key gets the lines from
//   its key to the last line of its value replaced by the new rendering, a removed key loses those
//   lines, a new key is appended at the end. Every other byte stays: comments, blank lines, quoting
//   and layout of the other keys, the byte order mark and the line breaks (LF or CRLF). The value of
//   a changed key is rewritten as a whole, so comments inside it go with it.
// - The result is parsed again and must hold exactly the intended data, so a write never breaks a
//   file or changes another value silently (an alias into a changed key, for example).
import { isDeepStrictEqual } from "node:util";
import { Document, LineCounter, isMap, isScalar, parseDocument, visit } from "yaml";
import { CommandError } from "../catalog.js";
import type { LineEnding } from "./frontmatter.js";
import { parseYamlFileBytes } from "./parse.js";

const BOM = "﻿";
const YAML_OPTIONS = { version: "1.2", schema: "core" } as const;

/** One edit of a top-level key: `value` sets it (appended when missing), no `value` removes it. */
export interface YamlKeyEdit {
  readonly key: string;
  /** JSON data: objects, lists, texts, numbers, booleans, null. */
  readonly value?: unknown;
}

/** The texts of a read YAML file the editor needs; a `YamlFile` fits. */
export interface EditableYaml {
  /** The text without the byte order mark. */
  readonly text: string;
  readonly bom: boolean;
}

export interface YamlEditResult {
  readonly bytes: Uint8Array;
  /** False when no byte changed; the caller then need not write. */
  readonly changed: boolean;
}

/** `data` in the fixed style (see the file comment), ending with a line break. */
const render = (data: object, eol: LineEnding): string => {
  const document = new Document(data, YAML_OPTIONS);
  visit(document, {
    Seq: (_, node) => {
      if (node.items.every((item) => isScalar(item))) {
        node.flow = true;
      }
    },
  });
  const text = document.toString({
    lineWidth: 0,
    minContentWidth: 0,
    blockQuote: false,
    flowCollectionPadding: false,
  });
  return eol === "\n" ? text : text.replaceAll("\n", eol);
};

/** A new YAML document with the keys of `data` in their order, in the fixed style, with LF line breaks. */
export const renderYamlDocument = (data: object): string => render(data, "\n");

const faulty = (reason: string): CommandError => new CommandError("file.faulty", `Not written: ${reason}`);

/** Where the lines of one top-level key lie in the text. */
interface KeyLines {
  /** Offset of the start of the key's line. */
  readonly start: number;
  /** Offset after the line break of the value's last line (or the end of the text). */
  readonly end: number;
  /** The spaces before the key. */
  readonly indent: string;
}

/** The lines of each top-level key of `text`; `file.faulty` for anything but a block mapping. */
const keyLinesOf = (text: string): { readonly data: unknown; readonly keys: Map<string, KeyLines> } => {
  const lines = new LineCounter();
  const document = parseDocument(text, { ...YAML_OPTIONS, lineCounter: lines });
  if (document.errors.length > 0) {
    throw faulty("the file is not valid YAML");
  }
  const keys = new Map<string, KeyLines>();
  const contents = document.contents;
  if (contents === null) {
    return { data: null, keys };
  }
  if (!isMap(contents) || contents.flow === true) {
    throw faulty("ReqSeq changes only YAML files that are a block mapping of `key: value` lines");
  }
  const lineStart = (line: number): number => lines.lineStarts[line - 1] ?? text.length;
  for (const pair of contents.items) {
    // A block mapping parsed from text has scalar keys with source ranges.
    const key = pair.key as { readonly value: unknown; readonly range: readonly [number, number, number] };
    // `null` for an explicit key without a value (`? key`).
    const value = pair.value as { readonly range: readonly [number, number, number] } | null;
    const keyLine = lines.linePos(key.range[0]).line;
    const start = lineStart(keyLine);
    // The spaces before the key; an explicit key (`? key`) gets the plain form.
    const indent = text.slice(start, key.range[0]).replace(/[^ ][\s\S]*$/, "");
    const last = Math.max(key.range[0], (value?.range[1] ?? key.range[1]) - 1);
    keys.set(String(key.value), { start, end: lineStart(lines.linePos(last).line + 1), indent });
  }
  return { data: document.toJS() as unknown, keys };
};

const indented = (rendered: string, indent: string): string =>
  indent === "" ? rendered : rendered.replace(/^(?=.)/gm, indent);

/** The new text of each edited key in place, and the keys to append, in edit order. */
interface Plan {
  readonly replaced: readonly { readonly at: KeyLines; readonly text: string }[];
  readonly appended: readonly string[];
  /** The data the edited file must hold. */
  readonly expected: Readonly<Record<string, unknown>>;
}

const planEdits = (
  data: unknown,
  keys: ReadonlyMap<string, KeyLines>,
  edits: readonly YamlKeyEdit[],
  eol: LineEnding,
): Plan => {
  const expected = new Map(Object.entries((data ?? {}) as Readonly<Record<string, unknown>>));
  const replaced: { readonly at: KeyLines; readonly text: string }[] = [];
  const appended: string[] = [];
  for (const edit of edits) {
    const at = keys.get(edit.key);
    const set = "value" in edit;
    const rendered = set ? render({ [edit.key]: edit.value }, eol) : "";
    if (set) {
      expected.set(edit.key, edit.value);
    } else {
      expected.delete(edit.key);
    }
    if (at !== undefined) {
      replaced.push({ at, text: indented(rendered, at.indent) });
    } else if (rendered !== "") {
      appended.push(rendered);
    }
  }
  return { replaced, appended, expected: Object.fromEntries(expected) };
};

/** `text` with the plan applied, from the last key up, so the offsets of the others stay right. */
const applyPlan = (text: string, plan: Plan, eol: LineEnding): string => {
  let out = text;
  for (const { at, text: lines } of [...plan.replaced].sort((a, b) => b.at.start - a.at.start)) {
    // The last key of a file without a final line break keeps it so.
    const kept = at.end === text.length && !/\r?\n$/.test(text) ? lines.replace(/\r?\n$/, "") : lines;
    out = out.slice(0, at.start) + kept + out.slice(at.end);
  }
  if (plan.appended.length === 0) {
    return out;
  }
  return `${out}${out === "" || out.endsWith("\n") ? "" : eol}${plan.appended.join("")}`;
};

/**
 * Applies `edits` to the top-level keys of `file` (see the file comment), at most one per key, and
 * returns the new bytes. Pure; writing is `writeFileAtomic` with `{ kind: "yaml" }`. Throws
 * `file.faulty` for a file that is not a block mapping, `internal` when the result would not hold
 * exactly the intended data.
 */
export const editYamlDocument = (file: EditableYaml, edits: readonly YamlKeyEdit[]): YamlEditResult => {
  const { text } = file;
  const eol: LineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const { data, keys } = keyLinesOf(text);
  const plan = planEdits(data, keys, edits, eol);
  const out = applyPlan(text, plan, eol);
  const bytes = new TextEncoder().encode(`${file.bom ? BOM : ""}${out}`);
  const changed = out !== text;
  if (changed) {
    const check = parseYamlFileBytes("(edited file)", bytes);
    const after = check.kind === "parsed" ? (check.content.data ?? {}) : undefined;
    if (!isDeepStrictEqual(after, plan.expected)) {
      throw new CommandError(
        "internal",
        "Not written: the edit would change other values too (for example through a YAML alias)",
      );
    }
  }
  return { bytes, changed };
};
