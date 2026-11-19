// Line-wise edits of the lists of a YAML file (the metamodel files, SR-236 AK3). A pure module: it
// returns the new bytes, and `writeFileAtomic` with the check kind `yaml` writes them.
//
// - A list is addressed by its path in the document (`["types"]`, `["types", 2, "required"]`).
// - The document is never rendered again: text is inserted, so every other line stays byte for
//   byte with its comment and line ending. A new item comes at the end of its list.
// - A block list (`- ...` items) gets the item in the fixed style of `yaml-document.ts`, its `-` in
//   the column of the list's first `-`, after the line of its last value and the comment lines that
//   follow indented to that column or more; a blank line or a comment further left (the heading of
//   the next key) stays below it. A flow list (`[...]`) gets the item in flow style after
//   its last item (after `[` when empty), so only that line changes. A missing list is added with
//   the item after the last line of the block mapping that gets it (the same way), in the column of
//   its keys; a missing top-level list at the end of the file, before a document end marker `...`.
// - The line ending is that of the line the item follows, else CRLF when the file has one, else LF.
// - A list, or a node on the path to it, that is an alias or carries an anchor is refused
//   (`file.faulty` with file and line), as an edit there would change what another place of the file
//   means (SR-236 AK5).
// - The result is parsed again and must hold exactly the old data with the item added, so a write
//   never breaks a file or changes another value silently.
import { isDeepStrictEqual } from "node:util";
import type { Node, YAMLMap, YAMLSeq } from "yaml";
import { LineCounter, isAlias, isMap, isNode, isScalar, isSeq, parseDocument } from "yaml";
import { CommandError } from "../catalog.js";
import type { LineEnding } from "./frontmatter.js";
import type { EditableYaml, YamlEditResult } from "./yaml-document.js";
import { BOM, YAML_OPTIONS, renderYaml } from "./yaml-document.js";

/** The path of a list in a document: mapping keys and list positions. */
export type YamlPath = readonly [string, ...(string | number)[]];

const faulty = (file: string, reason: string, line?: number): CommandError =>
  new CommandError(
    "file.faulty",
    `Not written: ${file}${line === undefined ? "" : `:${String(line)}`} ${reason}`,
    { file, ...(line === undefined ? {} : { line }) },
  );

/** The line ending of the line that ends at `offset`, or the file's when none ends there. */
const lineEndingBefore = (text: string, offset: number): LineEnding => {
  if (text[offset - 1] === "\n") {
    return text[offset - 2] === "\r" ? "\r\n" : "\n";
  }
  return text.includes("\r\n") ? "\r\n" : "\n";
};

/**
 * `rendered` with `indent` spaces before each line that is not empty. Split at line feeds only, as a
 * text may hold other line separators (U+2028, U+2029) that are no line break of YAML.
 */
const indented = (rendered: string, indent: number): string =>
  rendered
    .split("\n")
    .map((line) => (line === "" || line === "\r" ? line : `${" ".repeat(indent)}${line}`))
    .join("\n");

/** The offset after the line break of the line that holds `offset - 1` (`offset` when it starts a line). */
const lineEndAfter = (text: string, offset: number): number => {
  if (offset === 0 || text[offset - 1] === "\n") {
    return offset;
  }
  const next = text.indexOf("\n", offset);
  return next === -1 ? text.length : next + 1;
};

/**
 * The end of the content of the block collection `node` (after the line break of its last item's
 * last line), and after the comment lines that follow it indented to `col` or more: they belong to
 * it. The parser's range of a collection also takes the blank lines and the comments below it, which
 * may belong to the next key (`# Properties` above `properties:`).
 */
const contentEnd = (text: string, node: YAMLSeq | YAMLMap, col: number): number => {
  // A block collection has at least one item.
  const last = node.items.at(-1) as Node | { readonly key: Node; readonly value: Node | null };
  const lastNode = isNode(last) ? last : (last.value ?? last.key);
  let end = lineEndAfter(text, rangeOf(lastNode)[1]);
  for (;;) {
    const line = text.slice(end, lineEndAfter(text, end + 1));
    const comment = /^ *(?=#)/.exec(line);
    if (comment === null || comment[0].length < col) {
      return end;
    }
    end += line.length;
  }
};

/** Where the end marker `...` of the document starts, else the end of the text (SR-236 AK4). */
const documentEnd = (text: string, from: number): number => {
  const marker = /^\.\.\.(?=[ \t\r\n#]|$)/m.exec(text.slice(from));
  return marker === null ? text.length : from + marker.index;
};

/** Where and what to insert into the text. */
interface Insertion {
  readonly at: number;
  readonly text: string;
}

/**
 * A node parsed from text has a source range. Takes any value, so a caller may pass an item it
 * knows is there without a cast.
 */
const rangeOf = (node: unknown): readonly [number, number, number] =>
  (node as Node).range as [number, number, number];

/** `rendered` (lines ending in its line ending) on lines of their own from `end`, the end of a block node. */
const linesAt = (text: string, end: number, rendered: string, eol: LineEnding): Insertion => ({
  at: end,
  // The node's last line ends the file without a line break: the new lines start on a line of their own.
  text: end === 0 || text[end - 1] === "\n" ? rendered : `${eol}${rendered}`,
});

/** The insertion of `item` into the block list `seq`, after its end; the list starts at its first `-`. */
const intoBlockList = (text: string, seq: YAMLSeq, lines: LineCounter, item: unknown): Insertion => {
  const col = lines.linePos(rangeOf(seq)[0]).col - 1;
  const end = contentEnd(text, seq, col);
  const eol = lineEndingBefore(text, end);
  return linesAt(text, end, indented(renderYaml([item], eol, "block-list"), col), eol);
};

/** The insertion of `item` into the flow list `seq`, after its last item or after `[`. */
const intoFlowList = (seq: YAMLSeq, item: unknown): Insertion => {
  const flowItem = renderYaml([item], "\n", "flow").replace(/^\[|\]\n$/g, "");
  const last = seq.items.at(-1) as Node | undefined;
  return last === undefined
    ? { at: rangeOf(seq)[0] + 1, text: flowItem }
    : { at: rangeOf(last)[1], text: `, ${flowItem}` };
};

/** A new list `key` with `item` in the block mapping `map` (the document's: at the end of the file). */
const newList = (
  text: string,
  map: YAMLMap | null,
  top: boolean,
  lines: LineCounter,
  key: string,
  item: unknown,
): Insertion => {
  const indent = top || map === null ? 0 : lines.linePos(rangeOf(map)[0]).col - 1;
  const end =
    map === null ? text.length : top ? documentEnd(text, rangeOf(map)[1]) : contentEnd(text, map, indent);
  const eol = lineEndingBefore(text, end);
  return linesAt(text, end, indented(renderYaml({ [key]: [item] }, eol), indent), eol);
};

/** `data` with `item` added at the end of the list at `at` (created when missing). */
const withItem = (data: unknown, at: YamlPath, item: unknown): unknown => {
  const copy = structuredClone(data) as Record<string | number, unknown>;
  let node = copy;
  for (const segment of at.slice(0, -1)) {
    node = node[segment] as Record<string | number, unknown>;
  }
  const key = at.at(-1) as string;
  node[key] = [...((node[key] as readonly unknown[] | undefined) ?? []), item];
  return copy;
};

/** The value under `segment` of a mapping or list node; undefined when there is none. */
const child = (node: unknown, segment: string | number): unknown => {
  if (isMap(node) && typeof segment === "string") {
    return node.items.find((p) => isScalar(p.key) && p.key.value === segment)?.value ?? undefined;
  }
  return isSeq(node) && typeof segment === "number" ? node.items[segment] : undefined;
};

const encode = (yaml: EditableYaml, text: string): Uint8Array =>
  new TextEncoder().encode(`${yaml.bom ? BOM : ""}${text}`);

/** Whether `node` is an alias or a collection with an anchor (see the file comment). */
const shared = (node: unknown): boolean =>
  isAlias(node) || ((isMap(node) || isSeq(node)) && node.anchor !== undefined);

/**
 * The line of the anchor of `node`, or of the alias that `node` is: an anchor stands before the
 * node's content, on its line or one above it (`types: &all` before `- ...`).
 */
const sharedLine = (parsed: Parsed, node: unknown): number | undefined => {
  if (!isMap(node) && !isSeq(node)) {
    return parsed.lineOf(node);
  }
  const start = rangeOf(node)[0];
  const at = parsed.text.lastIndexOf(`&${String(node.anchor)}`, start);
  return parsed.lines.linePos(at).line;
};

/** A parsed document and how to name its lines. */
interface Parsed {
  readonly text: string;
  readonly contents: unknown;
  readonly lines: LineCounter;
  readonly lineOf: (node: unknown) => number | undefined;
}

/** The node that holds the list at `at`, and the list or undefined; refuses as `appendListItem` says. */
const locateList = (parsed: Parsed, file: string, at: YamlPath): { holder: unknown; value: unknown } => {
  const shown = at.join(".");
  let holder = parsed.contents;
  for (const segment of at.slice(0, -1)) {
    holder = child(holder, segment);
    if (shared(holder)) {
      throw faulty(
        file,
        `uses a YAML anchor or alias on the way to ${shown}; ReqSeq does not change it there`,
        sharedLine(parsed, holder),
      );
    }
  }
  const value = holder === null ? undefined : child(holder, at.at(-1) as string);
  if (shared(value)) {
    throw faulty(
      file,
      `uses a YAML anchor or alias for ${shown}; ReqSeq does not change it there`,
      sharedLine(parsed, value),
    );
  }
  return { holder, value };
};

/** Where `item` goes into the list at `at` (see the file comment). */
const insertionFor = (parsed: Parsed, file: string, at: YamlPath, item: unknown): Insertion => {
  const { text, contents, lines } = parsed;
  const { holder, value } = locateList(parsed, file, at);
  if (isSeq(value)) {
    return value.flow === true ? intoFlowList(value, item) : intoBlockList(text, value, lines, item);
  }
  if (value === undefined && (holder === null || (isMap(holder) && holder.flow !== true))) {
    return newList(text, holder, holder === contents, lines, at.at(-1) as string, item);
  }
  throw faulty(file, `has no list at ${at.join(".")}`, parsed.lineOf(value ?? holder));
};

/** `yaml` parsed, with its data; `file.faulty` for a document that is no block mapping. */
const parsedOf = (yaml: EditableYaml, file: string): Parsed & { readonly data: unknown } => {
  const { text } = yaml;
  const lines = new LineCounter();
  const document = parseDocument(text, { ...YAML_OPTIONS, lineCounter: lines });
  const contents = document.contents;
  if (document.errors.length > 0 || (contents !== null && (!isMap(contents) || contents.flow === true))) {
    throw faulty(file, "is not a block mapping of `key: value` lines");
  }
  const lineOf = (node: unknown): number | undefined =>
    isNode(node) ? lines.linePos(rangeOf(node)[0]).line : undefined;
  return { text, contents, lines, lineOf, data: document.toJS() ?? {} };
};

/**
 * The bytes of `out`, after checking that it reads as `intended`; `internal` naming `what` when it
 * does not. The planned file is parsed again as a metamodel file before it is written
 * (`metamodel/write.ts`).
 */
const checked = (
  yaml: EditableYaml,
  file: string,
  out: string,
  intended: unknown,
  what: string,
): YamlEditResult => {
  const after: unknown = parseDocument(out, YAML_OPTIONS).toJS();
  if (!isDeepStrictEqual(after, intended)) {
    throw new CommandError("internal", `Not written: ${what} would change other values of ${file} too`);
  }
  return { bytes: encode(yaml, out), changed: out !== yaml.text };
};

/** `text` with `[from, to)` replaced by `by`. */
const spliced = (text: string, from: number, to: number, by: string): string =>
  text.slice(0, from) + by + text.slice(to);

/**
 * Adds `item` (JSON data) at the end of the list at `at` in `yaml`, read from `file` (named in
 * errors), as the file comment says, and returns the new bytes. Throws `file.faulty` for a document
 * that is not a block mapping, a path that does not lead to a list or to a block mapping that can
 * get it, and an alias or anchor on the path; `internal` when the result would not hold exactly the
 * intended data.
 */
export const appendListItem = (
  yaml: EditableYaml,
  file: string,
  at: YamlPath,
  item: unknown,
): YamlEditResult => {
  const parsed = parsedOf(yaml, file);
  const insertion = insertionFor(parsed, file, at, item);
  const out = spliced(parsed.text, insertion.at, insertion.at, insertion.text);
  return checked(yaml, file, out, withItem(parsed.data, at, item), `adding to ${at.join(".")}`);
};

/** The node at `at` (a mapping or list); refuses an alias or anchor on the way or on it. */
const nodeAt = (parsed: Parsed, file: string, at: YamlPath): unknown => {
  const shown = at.join(".");
  let node = parsed.contents;
  for (const segment of at) {
    node = child(node, segment);
    if (shared(node)) {
      throw faulty(
        file,
        `uses a YAML anchor or alias at ${shown}; ReqSeq does not change it there`,
        sharedLine(parsed, node),
      );
    }
  }
  return node;
};

/** `data` with the value under `last` of the node at `at` set to `value`, or removed when undefined. */
const withValue = (
  data: unknown,
  at: readonly (string | number)[],
  last: string | number,
  value: unknown,
): unknown => {
  const copy = structuredClone(data) as Record<string | number, unknown>;
  let node = copy;
  for (const segment of at) {
    node = node[segment] as Record<string | number, unknown>;
  }
  if (Array.isArray(node)) {
    node.splice(last as number, 1);
  } else if (value === undefined) {
    Reflect.deleteProperty(node, last);
  } else {
    node[last] = value;
  }
  return copy;
};

/** The offset of the line break that ends the line holding `offset - 1`, or the end of the text. */
const lineBreakAt = (text: string, offset: number): number => {
  const after = lineEndAfter(text, offset);
  if (text[after - 1] !== "\n") {
    return after;
  }
  return text[after - 2] === "\r" ? after - 2 : after - 1;
};

/** The start of the line that holds `offset`. */
const lineStartOf = (text: string, offset: number): number => text.lastIndexOf("\n", offset - 1) + 1;

/** `key: value` in flow style, without braces (an entry of a flow mapping). */
const flowPair = (key: string, value: unknown): string =>
  renderYaml({ [key]: value }, "\n", "flow").replace(/^\{|\}\n$/g, "");

/** The new text of a block mapping `map` with `key` set to `value`, or removed when undefined. */
const blockMapEdit = (parsed: Parsed, map: YAMLMap, key: string, value: unknown): string => {
  const { text, lines } = parsed;
  const index = map.items.findIndex((p) => isScalar(p.key) && p.key.value === key);
  const col = lines.linePos(rangeOf(map)[0]).col - 1;
  const eol = lineEndingBefore(text, rangeOf(map)[0]);
  if (index === -1) {
    if (value === undefined) {
      return text;
    }
    const end = contentEnd(text, map, col);
    const at = lineEndingBefore(text, end);
    const insertion = linesAt(text, end, indented(renderYaml({ [key]: value }, at), col), at);
    return spliced(text, insertion.at, insertion.at, insertion.text);
  }
  const pair = map.items[index] as { readonly key: Node; readonly value: Node | null };
  const start = rangeOf(pair.key)[0];
  // A key without a value has a null scalar with its range, so every pair parsed from text has a value node.
  const valueEnd = rangeOf(pair.value)[1];
  if (value !== undefined) {
    // From the key to the end of the value's last line: a comment at the end of it goes (SR-236 AK3).
    const rendered = renderYaml({ [key]: value }, eol).slice(0, -eol.length);
    return spliced(text, start, lineBreakAt(text, valueEnd), indented(rendered, col).slice(col));
  }
  const next = map.items[index + 1] as { readonly key: Node } | undefined;
  const lineStart = lineStartOf(text, start);
  if (/-\s*$/.test(text.slice(lineStart, start)) && next !== undefined) {
    // The first key of a list item, on the line of its dash: the next key moves up to the dash when
    // it is on the next line; else the dash keeps its line, and the comment lines between stay.
    const after = lineEndAfter(text, valueEnd);
    const nextKey = rangeOf(next.key)[0];
    return /^[ \t]*$/.test(text.slice(after, nextKey))
      ? spliced(text, start, nextKey, "")
      : spliced(
          text,
          lineStart + text.slice(lineStart, start).trimEnd().length,
          lineBreakAt(text, valueEnd),
          "",
        );
  }
  return spliced(text, lineStart, lineEndAfter(text, valueEnd), "");
};

/** The new text of a flow mapping `map` with `key` set to `value`, or removed when undefined. */
const flowMapEdit = (text: string, map: YAMLMap, key: string, value: unknown): string => {
  const index = map.items.findIndex((p) => isScalar(p.key) && p.key.value === key);
  const pairs = map.items as unknown as readonly { readonly key: Node; readonly value: Node | null }[];
  const endOf = (i: number): number => {
    const pair = pairs[i] as { readonly key: Node; readonly value: Node | null };
    return rangeOf(pair.value)[1];
  };
  if (index === -1) {
    if (value === undefined) {
      return text;
    }
    const last = pairs.length - 1;
    return last === -1
      ? spliced(text, rangeOf(map)[0] + 1, rangeOf(map)[0] + 1, ` ${flowPair(key, value)} `)
      : spliced(text, endOf(last), endOf(last), `, ${flowPair(key, value)}`);
  }
  const start = rangeOf((pairs[index] as { readonly key: Node }).key)[0];
  if (value !== undefined) {
    return spliced(text, start, endOf(index), flowPair(key, value));
  }
  const next = pairs[index + 1];
  if (next !== undefined) {
    return spliced(text, start, rangeOf(next.key)[0], "");
  }
  return index === 0
    ? spliced(text, start, endOf(index), "")
    : spliced(text, endOf(index - 1), endOf(index), "");
};

/**
 * Sets `key` of the mapping at `at` in `yaml` to `value` (JSON data), or removes it when `value` is
 * undefined, in place: in a block mapping the lines from the key to the end of its value are
 * replaced by the key and the value in the fixed style (a comment at the end of them goes, SR-236
 * AK3), a missing key comes after the mapping's last line in the column of its keys, and a removed
 * key loses its lines; in a flow mapping only the text of the entry changes. Throws as
 * `appendListItem` does, `file.faulty` also when `at` leads to no mapping.
 */
export const setMapValue = (
  yaml: EditableYaml,
  file: string,
  at: YamlPath,
  key: string,
  value: unknown,
): YamlEditResult => {
  const parsed = parsedOf(yaml, file);
  const map = nodeAt(parsed, file, at);
  if (!isMap(map)) {
    throw faulty(file, `has no mapping at ${at.join(".")}`, parsed.lineOf(map));
  }
  const entry = child(map, key);
  if (shared(entry)) {
    throw faulty(
      file,
      `uses a YAML anchor or alias for ${[...at, key].join(".")}; ReqSeq does not change it there`,
      sharedLine(parsed, entry),
    );
  }
  const out =
    map.flow === true ? flowMapEdit(parsed.text, map, key, value) : blockMapEdit(parsed, map, key, value);
  return checked(
    yaml,
    file,
    out,
    withValue(parsed.data, at, key, value),
    `changing ${[...at, key].join(".")}`,
  );
};

/** The start of the line of the dash of a block list item that starts at `start`. */
const dashLine = (text: string, start: number): number => {
  let at = start - 1;
  while (at > 0 && text[at] !== "-") {
    at -= 1;
  }
  return lineStartOf(text, at);
};

/**
 * `from`, moved up over the comment lines directly above it (no blank line between) whose `#` is in
 * column `col`, the column of the item's dash, as `contentEnd` takes the comments that belong to a
 * list. A list item has the line of its list's key above it, so the walk stops there at the latest.
 */
const withCommentsAbove = (text: string, from: number, col: number): number => {
  let start = from;
  for (;;) {
    const above = lineStartOf(text, start - 1);
    const comment = /^ *(?=#)/.exec(text.slice(above, start));
    if (comment?.[0].length !== col) {
      return start;
    }
    start = above;
  }
};

/** The new text of the block list `seq` without its item `index`. */
const blockItemRemoved = (parsed: Parsed, at: YamlPath, seq: YAMLSeq, index: number): string => {
  const { text } = parsed;
  const item = seq.items[index] as Node;
  // A block mapping ends with its last value and the comment lines below it in the column of its
  // keys or further right (`contentEnd`); a flow item (`- { ... }`, over several lines too) at its brace.
  const end =
    isMap(item) && item.flow !== true
      ? contentEnd(text, item, parsed.lines.linePos(rangeOf(item)[0]).col - 1)
      : lineEndAfter(text, rangeOf(item)[1]);
  const dash = dashLine(text, rangeOf(item)[0]);
  const start = withCommentsAbove(text, dash, text.indexOf("-", dash) - dash);
  if (seq.items.length > 1) {
    return spliced(text, start, end, "");
  }
  // The only item: the list stays as an empty flow list after its key.
  // The holder of the list: the document's mapping for a top-level list (an empty `at.slice(0, -1)`).
  const holder = nodeAt(parsed, "", at.slice(0, -1) as unknown as YamlPath) as YAMLMap;
  const pairs = holder.items as unknown as readonly { readonly key: Node; readonly value: unknown }[];
  const pair = pairs.find((p) => p.value === seq) as { readonly key: Node };
  const colon = text.indexOf(":", rangeOf(pair.key)[1]) + 1;
  return spliced(spliced(text, start, end, ""), colon, colon, " []");
};

/** The new text of the flow list `seq` without its item `index`. */
const flowItemRemoved = (text: string, seq: YAMLSeq, index: number): string => {
  const items = seq.items as readonly Node[];
  const next = items[index + 1];
  const [start, end] = rangeOf(items[index]);
  if (next !== undefined) {
    return spliced(text, start, rangeOf(next)[0], "");
  }
  return index === 0 ? spliced(text, start, end, "") : spliced(text, rangeOf(items[index - 1])[1], end, "");
};

/**
 * Removes the item `index` of the list at `at` in `yaml`: a block item with its lines and the
 * comment lines directly above it (SR-236 AK3), a flow item with its text and separator; a list
 * left without items stays as `[]`. Throws as `appendListItem` does, `file.faulty` also when `at`
 * leads to no list or the item is an alias or carries an anchor.
 */
export const removeListItem = (
  yaml: EditableYaml,
  file: string,
  at: YamlPath,
  index: number,
): YamlEditResult => {
  const parsed = parsedOf(yaml, file);
  const seq = nodeAt(parsed, file, at);
  if (!isSeq(seq) || seq.items[index] === undefined) {
    throw faulty(file, `has no list item at ${[...at, index].join(".")}`, parsed.lineOf(seq));
  }
  const item = seq.items[index];
  if (shared(item)) {
    throw faulty(
      file,
      `uses a YAML anchor or alias at ${[...at, index].join(".")}; ReqSeq does not change it there`,
      sharedLine(parsed, item),
    );
  }
  const out =
    seq.flow === true ? flowItemRemoved(parsed.text, seq, index) : blockItemRemoved(parsed, at, seq, index);
  return checked(
    yaml,
    file,
    out,
    withValue(parsed.data, at, index, undefined),
    `removing ${[...at, index].join(".")}`,
  );
};
