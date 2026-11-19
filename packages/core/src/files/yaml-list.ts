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

/** A node parsed from text has a source range. */
const rangeOf = (node: Node): readonly [number, number, number] => node.range as [number, number, number];

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
  const { text } = yaml;
  const lines = new LineCounter();
  const document = parseDocument(text, { ...YAML_OPTIONS, lineCounter: lines });
  const contents = document.contents;
  if (document.errors.length > 0 || (contents !== null && (!isMap(contents) || contents.flow === true))) {
    throw faulty(file, "is not a block mapping of `key: value` lines");
  }
  const lineOf = (node: unknown): number | undefined =>
    isNode(node) ? lines.linePos(rangeOf(node)[0]).line : undefined;
  const insertion = insertionFor({ text, contents, lines, lineOf }, file, at, item);
  const out = text.slice(0, insertion.at) + insertion.text + text.slice(insertion.at);
  // The planned file is parsed again as a metamodel file before it is written (`metamodel/write.ts`).
  const after: unknown = parseDocument(out, YAML_OPTIONS).toJS();
  if (!isDeepStrictEqual(after, withItem(document.toJS() ?? {}, at, item))) {
    throw new CommandError(
      "internal",
      `Not written: adding to ${at.join(".")} would change other values of ${file} too`,
    );
  }
  return { bytes: encode(yaml, out), changed: true };
};
