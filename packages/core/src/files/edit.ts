// Lossless writing of element files (ADR-0007 "Writing", ADR-0004 "Stable writing", SR-102).
//
// A pure function: it takes the raw texts of a read file and a list of edits and returns the new
// bytes. Only the lines of the keys an edit really changes are rewritten, by replacing their source
// ranges in the raw frontmatter text; every other byte stays as it was (comments, quoting, leading
// zeros, spacing, key order, long lines). New values are rendered in one fixed style
// (`yaml-text.ts`). The result is parsed again and must hold exactly the intended data, so a
// write never breaks or silently changes a file.
import { isDeepStrictEqual } from "node:util";
import { Scalar, isCollection, isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { CST, Node, Pair, YAMLSeq } from "yaml";
import { CommandError } from "../catalog.js";
import type { LineEnding } from "./frontmatter.js";
import { parseFileBytes } from "./parse.js";
import type { ItemValue, PropertyValue, ScalarValue } from "./yaml-text.js";
import {
  NEEDS_ESCAPE,
  doubleQuoted,
  renderItem,
  renderItemLines,
  renderKey,
  renderScalar,
  renderValue,
} from "./yaml-text.js";

export type FrontmatterEdit =
  /** Sets a top-level key; a missing key is appended (ordered by `keyOrder`). */
  | { readonly kind: "set"; readonly key: string; readonly value: PropertyValue }
  /** Removes a top-level key with its value. Only for commands that need it; elements are never deleted. */
  | { readonly kind: "remove"; readonly key: string }
  /** Replaces item `index` of a list, for example the version of one relation target (SR-027). */
  | { readonly kind: "replace-item"; readonly key: string; readonly index: number; readonly value: ItemValue }
  /** Appends an item to a list; a missing or empty key becomes a list. */
  | { readonly kind: "append-item"; readonly key: string; readonly value: ItemValue }
  /** Removes item `index` of a list, for example one relation. */
  | { readonly kind: "remove-item"; readonly key: string; readonly index: number }
  /**
   * Replaces the text of one string scalar at `path` inside the value of `key`, for example the
   * stored version of one relation target (SR-027 AK1): only that scalar's source range is
   * rewritten, in its own quoting; every other byte of the file stays. The key may have no other
   * kind of edit in the same request. With `ifPlain`, a value at `path` that is not a string scalar
   * on one line without an anchor (an alias, a block scalar, an anchored scalar that an alias may
   * repeat, a missing path) is left as it is instead of refusing the request, so many such edits
   * (the stored titles of relation targets, decision on #307) go in one pass. With `source`, the
   * scalar's new text is written as given (with its quotes) instead of being quoted from `value`,
   * which the file must then read as: for a caller that changes only some characters of the
   * scalar's source (the version in a link, SR-127) and so keeps plain text plain; the check of the
   * whole frontmatter refuses a `source` that does not read as `value`.
   */
  | {
      readonly kind: "set-scalar";
      readonly key: string;
      readonly path: readonly (string | number)[];
      readonly value: string;
      readonly ifPlain?: boolean;
      readonly source?: string;
    };

/** The edits that work on the state of a whole key. */
type KeyEdit = Exclude<FrontmatterEdit, { readonly kind: "set-scalar" }>;
/** An edit of one scalar inside the value of a key. */
type ScalarEdit = Extract<FrontmatterEdit, { readonly kind: "set-scalar" }>;

/** The texts of a read file the writer needs; a `ParsedFile` fits. */
export interface EditableFile {
  /** Raw YAML between the `---` lines: empty or ending with a line break. */
  readonly frontmatter: string;
  readonly body: string;
  readonly eol: LineEnding;
  readonly closingEol: LineEnding | "";
  readonly bom: boolean;
}

export interface FileEditRequest {
  /** Applied in order; item indexes refer to the list as left by the edits before. */
  readonly edits?: readonly FrontmatterEdit[];
  /** New Markdown text; written only when it differs. */
  readonly body?: string;
  /** Key order of the element's type in the metamodel; new keys are appended in this order (ADR-0004). */
  readonly keyOrder?: readonly string[];
}

export interface FileEditResult {
  readonly bytes: Uint8Array;
  /** False when nothing changed; the caller then need not write. */
  readonly changed: boolean;
}

type BlockMapItem = CST.BlockMap["items"][number];

/** A top-level pair of the file as it was read. */
interface Original {
  readonly pair: Pair;
  readonly token: BlockMapItem;
  readonly data: unknown;
  /** The value is a sequence: the data of its items, which list edits refer to. */
  readonly items: readonly unknown[] | undefined;
}

/** An original item, or a new one; `replaces` is the original item whose content a new one replaces. */
type Slot = { readonly orig: number } | { readonly value: ItemValue; readonly replaces?: number | undefined };

type KeyState =
  | { readonly kind: "absent" }
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "list"; readonly slots: readonly Slot[] };

interface Splice {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const invalid = (message: string): CommandError => new CommandError("input.invalid", message);

const BOM = "\ufeff";
const DELIMITER = "---";

/** Pairs `a[i]` with `b[i]`; stops at the shorter list. */
export const zip = <A, B>(a: readonly A[], b: readonly B[]): [A, B][] =>
  a.flatMap((x, i): [A, B][] => {
    const y = b[i];
    return y === undefined ? [] : [[x, y]];
  });

// --- reading the frontmatter -------------------------------------------------------------------

interface Frontmatter {
  readonly originals: ReadonlyMap<string, Original>;
  readonly data: Readonly<Record<string, unknown>> | null;
  /** Indent of the top-level keys. */
  readonly indent: string;
}

const parseFrontmatter = (text: string): Frontmatter => {
  const doc = parseDocument(text, { version: "1.2", schema: "core", keepSourceTokens: true });
  if (doc.errors.length > 0) {
    throw new CommandError("file.faulty", "Not written: the frontmatter is not valid YAML");
  }
  const contents = doc.contents;
  if (contents === null) {
    return { originals: new Map(), data: null, indent: "" };
  }
  if (!isMap(contents) || contents.srcToken?.type !== "block-map") {
    throw new CommandError(
      "file.faulty",
      "Not written: ReqSeq writes only frontmatter that is a block mapping of `key: value` lines",
    );
  }
  const token = contents.srcToken;
  const data = doc.toJS() as Record<string, unknown>;
  const originals = new Map<string, Original>();
  for (const [pair, item] of zip(contents.items, token.items)) {
    const key = pair.key;
    if (isScalar(key) && typeof key.value === "string") {
      const value = data[key.value];
      originals.set(key.value, {
        pair,
        token: item,
        data: value,
        items: isSeq(pair.value) ? (value as unknown[]) : undefined,
      });
    }
  }
  return { originals, data, indent: " ".repeat(token.indent) };
};

// --- applying edits to per-key states --------------------------------------------------------

/** Data of the original list items that `orig` slots refer to (empty for a key that was no list). */
const itemsOf = (original: Original | undefined): readonly unknown[] => original?.items ?? [];

const slotData = (slot: Slot, items: readonly unknown[]): unknown =>
  "orig" in slot ? items[slot.orig] : slot.value;

const initialState = (original: Original | undefined): KeyState => {
  if (original === undefined) {
    return { kind: "absent" };
  }
  if (original.items !== undefined) {
    return { kind: "list", slots: original.items.map((_, i) => ({ orig: i })) };
  }
  return { kind: "value", value: original.data };
};

/** Slots for a new list: equal items at the start and at the end keep their original lines. */
const diffSlots = (old: readonly unknown[], next: readonly ItemValue[]): Slot[] => {
  const same = (i: number, j: number): boolean => isDeepStrictEqual(old[i], next[j]);
  let prefix = 0;
  while (prefix < old.length && prefix < next.length && same(prefix, prefix)) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < old.length - prefix &&
    suffix < next.length - prefix &&
    same(old.length - 1 - suffix, next.length - 1 - suffix)
  ) {
    suffix++;
  }
  return next.map((value, j): Slot => {
    if (j < prefix) {
      return { orig: j };
    }
    return j >= next.length - suffix ? { orig: old.length - next.length + j } : { value };
  });
};

const listSlots = (state: KeyState, key: string, allowNew: boolean): readonly Slot[] => {
  if (state.kind === "list") {
    return state.slots;
  }
  if (allowNew && (state.kind === "absent" || state.value === null)) {
    return [];
  }
  throw invalid(`Cannot change an item of ${key}: it is not a list`);
};

const checkIndex = (slots: readonly Slot[], key: string, index: number): void => {
  if (!Number.isInteger(index) || index < 0 || index >= slots.length) {
    throw invalid(`${key} has no item ${String(index)}`);
  }
};

const applyEdit = (state: KeyState, edit: KeyEdit, original: Original | undefined): KeyState => {
  switch (edit.kind) {
    case "set":
      return Array.isArray(edit.value)
        ? { kind: "list", slots: diffSlots(itemsOf(original), edit.value as readonly ItemValue[]) }
        : { kind: "value", value: edit.value };
    case "remove":
      return { kind: "absent" };
    case "append-item":
      return { kind: "list", slots: [...listSlots(state, edit.key, true), { value: edit.value }] };
    case "remove-item": {
      const slots = listSlots(state, edit.key, false);
      checkIndex(slots, edit.key, edit.index);
      return { kind: "list", slots: slots.filter((_, i) => i !== edit.index) };
    }
    case "replace-item": {
      const slots = listSlots(state, edit.key, false);
      checkIndex(slots, edit.key, edit.index);
      const items = itemsOf(original);
      const replace = (slot: Slot, i: number): Slot =>
        i === edit.index && !isDeepStrictEqual(slotData(slot, items), edit.value)
          ? { value: edit.value, replaces: "orig" in slot ? slot.orig : slot.replaces }
          : slot;
      return { kind: "list", slots: slots.map(replace) };
    }
  }
};

/** `-0` is written as `0`, which reads back as 0; data is compared after the same change. */
const withoutNegativeZero = <T>(value: T): T => {
  if (typeof value === "number") {
    return (Object.is(value, -0) ? 0 : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(withoutNegativeZero) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutNegativeZero(v)])) as T;
  }
  return value;
};

const cleanEdit = (edit: KeyEdit): KeyEdit => {
  switch (edit.kind) {
    case "set":
      return { ...edit, value: withoutNegativeZero(edit.value) };
    case "replace-item":
    case "append-item":
      return { ...edit, value: withoutNegativeZero(edit.value) };
    case "remove":
    case "remove-item":
      return edit;
  }
};

/** The data a key holds after the edits; `undefined` when it is absent. */
const stateData = (state: KeyState, original: Original | undefined): unknown => {
  switch (state.kind) {
    case "absent":
      return undefined;
    case "value":
      return state.value;
    case "list":
      return state.slots.map((slot) => slotData(slot, itemsOf(original)));
  }
};

const isUnchanged = (state: KeyState, original: Original | undefined): boolean =>
  original === undefined
    ? state.kind === "absent"
    : state.kind !== "absent" && isDeepStrictEqual(stateData(state, original), original.data);

// --- turning states into text ------------------------------------------------------------------

const isScalarValue = (value: unknown): value is ScalarValue =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

/** An original list item rendered again (a flow sequence is rewritten as a block sequence). */
const asItemValue = (value: unknown, key: string): ItemValue => {
  if (isScalarValue(value)) {
    return value;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.every(([, v]) => isScalarValue(v))) {
      return Object.fromEntries(entries);
    }
  }
  throw invalid(`Cannot rewrite ${key}: an item holds nested values`);
};

type PresentState = Exclude<KeyState, { readonly kind: "absent" }>;

const finalValue = (state: PresentState, original: Original | undefined, key: string): PropertyValue =>
  state.kind === "list"
    ? state.slots.map((slot) =>
        "orig" in slot ? asItemValue(slotData(slot, itemsOf(original)), key) : slot.value,
      )
    : (state.value as PropertyValue);

const lineStart = (text: string, offset: number): number => text.lastIndexOf("\n", offset - 1) + 1;

/** Offset after the line break that ends the line of `offset` (the frontmatter ends with one). */
const lineEndAfter = (text: string, offset: number): number => text.indexOf("\n", offset) + 1;

const rangeOf = (node: unknown): readonly [number, number, number] =>
  (node as Node).range as [number, number, number];

/** End of a node's content without the line breaks that the range of a block value includes. */
const contentEnd = (text: string, node: unknown): number => {
  let end = rangeOf(node)[1];
  while (text[end - 1] === "\n" || text[end - 1] === "\r") {
    end--;
  }
  return end;
};

/** Offset of the first token of `type`, or -1. */
const tokenOffset = (tokens: readonly CST.SourceToken[], type: CST.SourceToken["type"]): number =>
  tokens.find((t) => t.type === type)?.offset ?? -1;

interface PairSpans {
  /** Start of the key's line. */
  readonly lineStart: number;
  /** Offset after the `:` indicator. */
  readonly afterColon: number;
  /** Start of the value when only spaces stand between it and the `:`; a new value on the key line starts here. */
  readonly valueStart: number | undefined;
  /** End of the value's content; equal to `afterColon` when the value is empty. */
  readonly valueEnd: number;
}

const pairSpans = (text: string, original: Original, key: string): PairSpans => {
  const { pair, token } = original;
  // Only `?` with an empty key has no `sep`; such pairs are skipped in `parseFrontmatter`.
  const { sep = [] } = token;
  const colon = tokenOffset(sep, "map-value-ind");
  if (colon < 0) {
    throw invalid(`Cannot change ${key}: it is an explicit key without a value`);
  }
  const explicit = tokenOffset(token.start, "explicit-key-ind");
  const afterColon = colon + 1;
  const spaced = sep.every((t) => t.offset <= colon || t.type === "space");
  return {
    lineStart: lineStart(text, explicit < 0 ? rangeOf(pair.key)[0] : explicit),
    afterColon,
    valueStart: token.value !== undefined && spaced ? rangeOf(pair.value)[0] : undefined,
    valueEnd: token.value === undefined ? afterColon : contentEnd(text, pair.value),
  };
};

/** Rebuilds the items of a block sequence; kept items keep their lines byte for byte. */
const blockSequenceSplice = (text: string, seq: YAMLSeq, slots: readonly Slot[], eol: LineEnding): Splice => {
  const token = seq.srcToken as CST.BlockSequence;
  const items = zip(token.items, seq.items).map(([item, node]) => {
    const dash = tokenOffset(item.start, "seq-item-ind");
    return { start: lineStart(text, dash), dash, node, content: item.value };
  });
  // Each item's lines run to the start of the next item; the last one to the end of its content line.
  const chunks = items.map((item, i) => ({
    start: item.start,
    end: items[i + 1]?.start ?? lineEndAfter(text, contentEnd(text, item.node)),
  }));
  // All items of a block sequence share one indent.
  const indent = " ".repeat(Math.min(...items.map((item) => item.dash - item.start)));
  // Each item with the text of its lines and the offsets of its content inside that text.
  const parts = zip(items, chunks).map(([item, c]) => ({
    text: text.slice(c.start, c.end),
    content:
      item.content === undefined
        ? undefined
        : [rangeOf(item.node)[0] - c.start, contentEnd(text, item.node) - c.start],
  }));
  const out = slots.map((slot) => {
    if ("orig" in slot) {
      return parts
        .slice(slot.orig, slot.orig + 1)
        .map((part) => part.text)
        .join("");
    }
    const old = slot.replaces === undefined ? undefined : parts[slot.replaces];
    if (old?.content === undefined) {
      return `${renderItemLines([slot.value], indent, eol)}${eol}`;
    }
    // A replaced item changes only its content: the dash, its spacing and a trailing comment stay.
    const [from, to] = old.content as [number, number];
    return `${old.text.slice(0, from)}${renderItem(slot.value)}${old.text.slice(to)}`;
  });
  return {
    start: Math.min(...chunks.map((c) => c.start)),
    end: Math.max(...chunks.map((c) => c.end)),
    text: out.join(""),
  };
};

const changedPairSplice = (
  text: string,
  original: Original,
  key: string,
  state: KeyState,
  itemIndent: string,
  eol: LineEnding,
): Splice => {
  const spans = pairSpans(text, original, key);
  if (state.kind === "absent") {
    return { start: spans.lineStart, end: lineEndAfter(text, spans.valueEnd), text: "" };
  }
  const value = original.pair.value;
  if (
    state.kind === "list" &&
    state.slots.length > 0 &&
    isSeq(value) &&
    value.srcToken?.type === "block-seq"
  ) {
    return blockSequenceSplice(text, value, state.slots, eol);
  }
  const rendered = renderValue(finalValue(state, original, key), itemIndent, eol);
  // A value on the key line keeps the spacing after the `:` (for example aligned values).
  return rendered.startsWith(" ") && spans.valueStart !== undefined
    ? { start: spans.valueStart, end: spans.valueEnd, text: rendered.slice(1) }
    : { start: spans.afterColon, end: spans.valueEnd, text: rendered };
};

// --- editing one scalar in place ---------------------------------------------------------------

/** `value` in the quoting of `node`: single quotes stay where they can, plain where it reads back the same, else double quotes. */
const requoted = (node: Scalar, value: string): string => {
  if (node.type === Scalar.QUOTE_SINGLE && !NEEDS_ESCAPE.test(value)) {
    return `'${value.replaceAll("'", "''")}'`;
  }
  // A flow value is the strictest place for a plain scalar, so plain there reads back anywhere.
  return node.type === Scalar.PLAIN ? renderScalar(value, "flow-value") : doubleQuoted(value);
};

/** A copy of `data` with `value` at `path` (`scalarSplice` checked that `data` has the path). */
const withValueAt = (data: unknown, path: readonly (string | number)[], value: string): unknown => {
  const [head, ...rest] = path;
  if (head === undefined) {
    return value;
  }
  if (Array.isArray(data)) {
    return data.map((item: unknown, i) => (i === head ? withValueAt(item, rest, value) : item));
  }
  const record = data as Readonly<Record<string, unknown>>;
  return { ...record, [head]: withValueAt(record[String(head)], rest, value) };
};

/** The splice of one `set-scalar` edit; undefined when the scalar holds the value already. */
const scalarSplice = (originals: ReadonlyMap<string, Original>, edit: ScalarEdit): Splice | undefined => {
  const value = originals.get(edit.key)?.pair.value;
  const node: unknown =
    edit.path.length === 0 ? value : isCollection(value) ? value.getIn(edit.path, true) : undefined;
  const oneLine =
    isScalar(node) &&
    typeof node.value === "string" &&
    node.type !== Scalar.BLOCK_LITERAL &&
    node.type !== Scalar.BLOCK_FOLDED;
  if (edit.ifPlain === true && (!oneLine || node.anchor !== undefined)) {
    return undefined;
  }
  if (!oneLine) {
    throw invalid(`Cannot change ${[edit.key, ...edit.path].join(".")}: it is no text on one line`);
  }
  if (node.value === edit.value) {
    return undefined;
  }
  const [start, end] = rangeOf(node);
  return { start, end, text: edit.source ?? requoted(node, edit.value) };
};

// --- the writer --------------------------------------------------------------------------------

interface Change {
  readonly key: string;
  readonly state: KeyState;
  readonly original: Original | undefined;
}

/** The keys whose data the edits really change, in the order of their first edit. */
const changesOf = (edits: readonly KeyEdit[], originals: ReadonlyMap<string, Original>): Change[] => {
  const states = new Map<string, KeyState>();
  for (const edit of edits.map(cleanEdit)) {
    const original = originals.get(edit.key);
    states.set(edit.key, applyEdit(states.get(edit.key) ?? initialState(original), edit, original));
  }
  return [...states]
    .map(([key, state]) => ({ key, state, original: originals.get(key) }))
    .filter((c) => !isUnchanged(c.state, c.original));
};

/** A key that reads as a string only after conversion (for example `1:`) is never edited or duplicated. */
const checkKeys = (
  edits: readonly FrontmatterEdit[],
  originals: ReadonlyMap<string, Original>,
  data: Readonly<Record<string, unknown>> | null,
): void => {
  for (const { key } of edits) {
    if (!originals.has(key) && Object.hasOwn(data ?? {}, key)) {
      throw invalid(
        `Cannot change ${key}: the file writes this key in a form ReqSeq does not edit (for example an alias or a number)`,
      );
    }
  }
};

const rank = (keyOrder: readonly string[], key: string): number => {
  const i = keyOrder.indexOf(key);
  return i < 0 ? keyOrder.length : i;
};

interface Plan {
  readonly frontmatter: string;
  /** The data the new frontmatter must hold. */
  readonly expected: Readonly<Record<string, unknown>> | null;
}

const expectedData = (
  data: Readonly<Record<string, unknown>> | null,
  changes: readonly Change[],
): Record<string, unknown> => {
  const next = new Map(changes.map((c) => [c.key, stateData(c.state, c.original)]));
  const expected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    const v = next.has(key) ? next.get(key) : value;
    if (v !== undefined) {
      expected[key] = v;
    }
  }
  for (const c of changes) {
    if (c.original === undefined) {
      expected[c.key] = next.get(c.key);
    }
  }
  return expected;
};

/** Line ending of the first line of the frontmatter text; `fallback` when it has no line. */
const firstLineEnding = (text: string, fallback: LineEnding): LineEnding => {
  const i = text.indexOf("\n");
  if (i < 0) {
    return fallback;
  }
  return text[i - 1] === "\r" ? "\r\n" : "\n";
};

const planFrontmatter = (file: EditableFile, request: FileEditRequest): Plan => {
  const text = file.frontmatter;
  if (text !== "" && !text.endsWith("\n")) {
    throw invalid("The frontmatter text must end with a line break");
  }
  const { originals, data, indent } = parseFrontmatter(text);
  const keyOrder = request.keyOrder ?? [];
  const all = request.edits ?? [];
  checkKeys(all, originals, data);
  const edits = all.filter((e): e is KeyEdit => e.kind !== "set-scalar");
  const keyEdited = new Set(edits.map((e) => e.key));
  const scalars = all
    .filter((e): e is ScalarEdit => e.kind === "set-scalar")
    .flatMap((edit) => {
      if (keyEdited.has(edit.key)) {
        throw invalid(`Cannot change ${edit.key}: a scalar in it and the whole key in one write`);
      }
      const splice = scalarSplice(originals, edit);
      return splice === undefined ? [] : [{ edit, splice }];
    });
  // Existing keys first (their place is fixed), then new keys in metamodel order (ADR-0004).
  const place = (c: Change): number => (c.original === undefined ? rank(keyOrder, c.key) : -1);
  const changes = changesOf(edits, originals).sort((a, b) => place(a) - place(b));
  if (changes.length === 0 && scalars.length === 0) {
    return { frontmatter: text, expected: data };
  }
  const itemIndent = `${indent}  `;
  const eol = firstLineEnding(text, file.eol);
  const splices: Splice[] = [];
  let appended = "";
  for (const { key, state, original } of changes) {
    if (original !== undefined) {
      splices.push(changedPairSplice(text, original, key, state, itemIndent, eol));
    } else {
      // A new key is never absent: unchanged keys were left out above.
      appended += `${indent}${renderKey(key)}:${renderValue(finalValue(state as PresentState, undefined, key), itemIndent, eol)}${eol}`;
    }
  }
  let out = text + appended;
  for (const s of [...splices, ...scalars.map((c) => c.splice)].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
  }
  const expected = expectedData(data, changes);
  for (const { edit } of scalars) {
    expected[edit.key] = withValueAt(expected[edit.key], edit.path, edit.value);
  }
  return { frontmatter: out, expected };
};

/** Parses the result again: it must be readable and hold exactly the intended data and text. */
const verify = (
  bytes: Uint8Array,
  expected: Readonly<Record<string, unknown>> | null,
  body: string,
): void => {
  const outcome = parseFileBytes("(edited file)", bytes);
  if (outcome.kind !== "parsed") {
    if (outcome.kind === "problem" && outcome.problem.code === "file.conflict-markers") {
      throw invalid("Not written: the text contains a Git conflict (<<<<<<<, =======, >>>>>>> lines)");
    }
    throw new CommandError("internal", "Not written: the edit would make the frontmatter unreadable");
  }
  // An empty frontmatter reads as null; compare it as an empty mapping.
  const data = outcome.content.data ?? {};
  const want = expected ?? {};
  if (
    !isDeepStrictEqual(Object.keys(data), Object.keys(want)) ||
    !isDeepStrictEqual(data, want) ||
    outcome.content.body !== body
  ) {
    throw new CommandError(
      "internal",
      "Not written: the edit would change other values too (for example through a YAML alias, or a `|+` block scalar at the end of the frontmatter)",
    );
  }
};

const LINE_BREAKS = /\r?\n/g;

/** The new text with the file's line breaks; a text that differs only in line breaks is no change. */
const bodyOf = (file: EditableFile, requested: string | undefined): string => {
  if (requested === undefined) {
    return file.body;
  }
  const converted = requested.replace(LINE_BREAKS, file.eol);
  return converted.replace(LINE_BREAKS, "\n") === file.body.replace(LINE_BREAKS, "\n")
    ? file.body
    : converted;
};

/**
 * Applies `request` to `file` and returns the new file bytes. Pure; writing to disk is
 * `writeFileAtomic`. Throws `input.invalid` for an impossible edit, `file.faulty` for frontmatter
 * that is not a block mapping, `internal` when the result would not hold exactly the intended data.
 */
export const editElementFile = (file: EditableFile, request: FileEditRequest): FileEditResult => {
  const plan = planFrontmatter(file, request);
  const body = bodyOf(file, request.body);
  // A file that ended right after the closing line gets a line break there once it has a text.
  const closing = file.closingEol === "" && body !== "" ? file.eol : file.closingEol;
  const text = `${file.bom ? BOM : ""}${DELIMITER}${file.eol}${plan.frontmatter}${DELIMITER}${closing}${body}`;
  const changed = plan.frontmatter !== file.frontmatter || body !== file.body;
  const bytes = new TextEncoder().encode(text);
  if (changed) {
    verify(bytes, plan.expected, body);
  }
  return { bytes, changed };
};
