// The snippet of a search hit (SR-174): where a word of the query was found, and one line of at most
// 120 characters around it with the matched words marked, so a hit can be judged without opening it.
// Pure apart from reading the hit's file (`elementNow`); `element.search` computes it for the hits of
// its page only, in the turn it searches in, so every access gives the same snippet (AK5).
//
// - What counts: the words of `SearchHit.terms`, compared as the index compares them (split at
//   `WORD_SEPARATOR`, `normalizeWord`). Only the fields the hit was found in are read (`fields`, which
//   holds only searched ones): the `[[` search (title and IDs) reads no file.
// - Where (AK3): the text first, then the property values one by one in reading order: the properties
//   of the type in metamodel order (its effective `properties`), then the other keys in file order;
//   file order alone when the metamodel is not valid. Each item of a list and each value of a
//   mapping is a value of its own (AK2: the snippet comes from the value with the match). A choice
//   shows its name, the key when the metamodel names none. Left out, as no snippet shows them (AK4,
//   product owner decision, 2026-11-07): the title (marked in `titleMarks` instead), `id`, relation
//   keys, type, status and the identifier; and the words of the identifier wherever they stand
//   (`SR-174` finds `SR-174` by its ID, and its words `sr` and `174` in it: `SR-098` in another
//   property is no place where it was found).
// - Visible text (AK1): the text and Markdown properties (`markdownKeysOf`) are read as the reader
//   sees them. A cheap pass over the raw value finds the first word that matches; only the line it
//   stands in is parsed with mdast and GFM (cut to `MAX_LINE` characters around the match), with
//   the link reference definitions of the value, which give nothing to read. The block of the line
//   (`markdownBlocks`) decides how: a line of a fenced code block is code as it stands (its fence
//   lines nothing), a table row is parsed with the table's head and delimiter row, and an HTML
//   block is parsed from its start (at most 4 `MAX_LINE`). A whole block is not parsed: a list of
//   4 KB with links costs about 4 ms with mdast, one line of it 0.25 ms, and a page has up to 500
//   hits (SR-098). The parse gives runs of text, inline code, code and image alt texts; blocks,
//   breaks, table cells and HTML are joined with a space. Words are split inside runs, never across
//   them, as the index splits the raw text at the Markdown characters. A match the reader does not
//   see (a link destination or title, an HTML tag, an entity name) is skipped and the next line
//   with a raw match is read. A line without Markdown characters is not parsed. An inline
//   construct across lines (emphasis over a line break) is read per line, so its characters show.
// - The line: white space (also CR, LF, tab, U+2028, U+2029) collapses to one space; at most `MAX`
//   code points including `…` at a cut end. The window grows from the first match to both sides,
//   then shrinks to word boundaries; a word longer than the window is cut hard, with its mark
//   clipped. It is never cut inside a surrogate pair or before a combining mark. Marks are UTF-16
//   offsets into the snippet text, end exclusive, in order: every matching word in the window.
// - No snippet when no visible word matches: the match is in the title or an ID only, in the type or
//   status name, in words the reader does not see, or the file changed since the index read it and
//   no longer holds the word (then `fields` may still name `text`).
import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Metamodel } from "../metamodel/index.js";
import { findType, keyDefinition, markdownKeysOf } from "../metamodel/index.js";
import type { ElementRecord, MarkdownBlock } from "../model/index.js";
import { markdownBlocks, markdownLinks, relationKey, titleKeyOf } from "../model/index.js";
import { identifierKeyOf, identifierValue } from "../model/identifier-index.js";
import type { SearchField, SearchHit, SearchIndex } from "./search-index.js";
import { WORD_SEPARATOR, elementNow, normalizeWord, valueTexts } from "./search-index.js";

/** A matched word in a text: UTF-16 offsets, end exclusive. */
export interface TextMark {
  readonly start: number;
  readonly end: number;
}

/** The snippet of a hit (see the file comment). */
export type SearchSnippet =
  | { readonly field: "text"; readonly text: string; readonly marks: readonly TextMark[] }
  | {
      readonly field: "properties";
      /** The frontmatter key. */
      readonly property: string;
      /** Its name in the metamodel, the key when it has none. */
      readonly propertyName: string;
      readonly text: string;
      readonly marks: readonly TextMark[];
    };

/** The most code points of a snippet, `…` included (SR-174 AK1, AK2). */
export const MAX = 120;

/** The most characters of a line parsed for one snippet; a longer one is cut around the match. */
export const MAX_LINE = 1024;

/** A word: letters, marks and digits (the complement of `WORD_SEPARATOR`). */
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const MARK_CHAR = /\p{M}/u;
/** White space a line shows as one space. */
const SPACE = /\s+/gu;
/** What may make a block read differently than written: without it, it is not parsed. */
const MARKDOWN_SYNTAX = /[\\`*_~[\]<>&#|=+!:-]|^ {0,3}\d{1,9}[.)]|^(?: {4}|\t)/mu;
/** A link reference definition line (CommonMark), or a footnote definition. */
const DEFINITION_LINE = /^ {0,3}(?:> ?)*\[(?:\\[\s\S]|[^\\\]])+\]:.*$/gmu;
const ELLIPSIS = "…";
/** Block quote markers in front of a line. */
const QUOTE = /^(?: {0,3}> ?)*/u;
/** The first line of an HTML block (CommonMark, roughly): it runs to the next blank line. */
const HTML_START = /^(?: {0,3}> ?)* {0,3}<[A-Za-z!?/]/u;
/** The delimiter row of a GFM table, the second line of its block. */
const TABLE_DELIMITER = /^(?: {0,3}> ?)* {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/u;

/** The mdast options, created once. */
const PARSE = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] };

/**
 * What only GFM reads differently from CommonMark in what the reader sees: a table, strikethrough, a
 * footnote, a task list item. Its autolink literals show as written either way. Without it a line
 * is parsed without the GFM extensions, which costs about half.
 */
const GFM_SYNTAX = /[|~]|\[\^|\[[ xX]\]/u;

/**
 * `markdown` with the destination of each link and image as `x`: the reader never sees it, and
 * parsing it char by char costs most of a line with inline references (`reqseq:<UUID>?version=…`).
 */
const withoutDestinations = (markdown: string): string => {
  let out = "";
  let at = 0;
  for (const { start, end } of markdownLinks(markdown)) {
    out += `${markdown.slice(at, start)}x`;
    at = end;
  }
  return out + markdown.slice(at);
};

/** Text as a line shows it, with the runs words are split in (`[start, end]` pairs). */
interface Visible {
  text: string;
  readonly runs: number[];
}

const run = (visible: Visible, value: string): void => {
  let line = value.replace(SPACE, " ");
  if (visible.text === "" || visible.text.endsWith(" ")) {
    line = line.replace(/^ /u, "");
  }
  if (line !== "") {
    visible.runs.push(visible.text.length, visible.text.length + line.length);
    visible.text += line;
  }
};

const gap = (visible: Visible): void => {
  if (visible.text !== "" && !visible.text.endsWith(" ")) {
    visible.text += " ";
  }
};

/** Inline nodes whose children read on in the same line. */
const INLINE = new Set(["emphasis", "strong", "delete", "link", "linkReference"]);

/** Adds what the reader sees of `node` to `visible`. */
const visit = (node: Nodes, visible: Visible): void => {
  if (node.type === "text" || node.type === "inlineCode") {
    run(visible, node.value);
  } else if (node.type === "code") {
    gap(visible);
    run(visible, node.value);
    gap(visible);
  } else if (node.type === "image" || node.type === "imageReference") {
    // `join` gives "" for an alt text that is null or undefined, which the mdast types allow.
    run(visible, [node.alt].join(""));
  } else if ("children" in node) {
    const block = !INLINE.has(node.type);
    if (block) {
      gap(visible);
    }
    for (const child of node.children) {
      visit(child, visible);
    }
    if (block) {
      gap(visible);
    }
  } else {
    // HTML, a break, a thematic break, a definition, a footnote reference: nothing to read.
    gap(visible);
  }
};

/** The visible text of `markdown`, of which only the first `length` characters count (the rest defines references). */
const visibleMarkdown = (markdown: string, length: number): Visible => {
  const visible: Visible = { text: "", runs: [] };
  const root = GFM_SYNTAX.test(markdown) ? fromMarkdown(markdown, PARSE) : fromMarkdown(markdown);
  for (const child of root.children) {
    // Every node fromMarkdown gives has a position.
    if (Number(child.position?.start.offset) < length) {
      visit(child, visible);
    }
  }
  return visible;
};

/** `value` as one line, one run. */
const visiblePlain = (value: string): Visible => {
  const visible: Visible = { text: "", runs: [] };
  run(visible, value);
  return visible;
};

/** The words of `visible` (within its runs) that match `terms`, in order. */
const matchesIn = (visible: Visible, terms: ReadonlySet<string>): TextMark[] => {
  const { text, runs } = visible;
  const marks: TextMark[] = [];
  for (let at = 0; at < runs.length; at += 2) {
    const start = Number(runs[at]);
    const end = Number(runs[at + 1]);
    WORD.lastIndex = start;
    for (let found = WORD.exec(text); found !== null && found.index < end; found = WORD.exec(text)) {
      const wordEnd = Math.min(found.index + found[0].length, end);
      const term = normalizeWord(text.slice(found.index, wordEnd));
      if (term !== undefined && terms.has(term)) {
        marks.push({ start: found.index, end: wordEnd });
      }
      if (wordEnd === end) {
        break;
      }
    }
  }
  return marks;
};

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** The offset after the code point at `at`. */
const after = (text: string, at: number): number =>
  at + (isHigh(text.charCodeAt(at)) && isLow(text.charCodeAt(at + 1)) ? 2 : 1);

/** The offset of the code point before `at`. */
const before = (text: string, at: number): number =>
  at - (isLow(text.charCodeAt(at - 1)) && isHigh(text.charCodeAt(at - 2)) ? 2 : 1);

/** The code point at `at`, as a string. */
const pointAt = (text: string, at: number): string => text.slice(at, after(text, at));

const codePoints = (text: string): number => {
  let count = 0;
  for (let at = 0; at < text.length; at = after(text, at)) {
    count++;
  }
  return count;
};

/** A part of a text: UTF-16 offsets, end exclusive. */
interface Span {
  readonly start: number;
  readonly end: number;
}

/** A snippet line: its text and the marks in it. */
interface Line {
  readonly text: string;
  readonly marks: TextMark[];
}

/** `span` of `text` as a line, `…` at a cut end, with the `matches` within it marked. */
const lineIn = (text: string, span: Span, matches: readonly TextMark[]): Line => {
  const prefix = span.start > 0 ? ELLIPSIS : "";
  const suffix = span.end < text.length ? ELLIPSIS : "";
  const shift = prefix.length - span.start;
  return {
    text: `${prefix}${text.slice(span.start, span.end)}${suffix}`,
    marks: matches
      .filter((mark) => mark.start >= span.start && mark.end <= span.end)
      .map((mark) => ({ start: mark.start + shift, end: mark.end + shift })),
  };
};

/** A word longer than the window, from its start: cut hard, never before a combining mark, its mark clipped. */
const hardCut = (text: string, first: TextMark): Line => {
  const prefix = first.start > 0 ? 1 : 0;
  let end = first.start;
  for (let n = 0; n < MAX - prefix - 1; n++) {
    end = after(text, end);
  }
  while (end > first.start && MARK_CHAR.test(pointAt(text, end))) {
    end = before(text, end);
  }
  return lineIn(text, { start: first.start, end }, [{ start: first.start, end }]);
};

/** The window around `first` (`matched` code points): grown one code point to each side in turn while `…` at a cut end still fits. */
const grown = (text: string, first: TextMark, matched: number): Span => {
  const { length } = text;
  let start = first.start;
  let end = first.end;
  let used = matched;
  let left = true;
  while (start > 0 || end < length) {
    const goLeft = start > 0 && (left || end >= length);
    const nextStart = goLeft ? before(text, start) : start;
    const nextEnd = goLeft ? end : after(text, end);
    if (used + 1 + (nextStart > 0 ? 1 : 0) + (nextEnd < length ? 1 : 0) > MAX) {
      break;
    }
    start = nextStart;
    end = nextEnd;
    used++;
    left = !left;
  }
  return { start, end };
};

const isWordAt = (text: string, at: number): boolean => WORD_CHAR.test(pointAt(text, at));

/** `start` moved past a word it cuts and past the spaces after it, never past `first`. */
const startOnWord = (text: string, from: number, first: TextMark): number => {
  let start = from;
  if (start > 0 && isWordAt(text, start) && isWordAt(text, before(text, start))) {
    while (start < first.start && isWordAt(text, start)) {
      start = after(text, start);
    }
  }
  while (start > 0 && start < first.start && text[start] === " ") {
    start++;
  }
  return start;
};

/** `end` moved before a word it cuts and before the spaces in front of it, never before `first`. */
const endOnWord = (text: string, from: number, first: TextMark): number => {
  let end = from;
  if (end < text.length && isWordAt(text, end) && isWordAt(text, before(text, end))) {
    while (end > first.end && isWordAt(text, before(text, end))) {
      end = before(text, end);
    }
  }
  while (end < text.length && end > first.end && text[end - 1] === " ") {
    end--;
  }
  return end;
};

/** `span` shrunk to whole words at its cut ends, without the spaces next to a cut; `first` stays in it. */
const toWords = (text: string, span: Span, first: TextMark): Span => ({
  start: startOnWord(text, span.start, first),
  end: endOnWord(text, span.end, first),
});

/** The snippet line of `visible` around its first match `first`, with every match in it marked. */
const windowOf = (visible: Visible, first: TextMark, matches: readonly TextMark[]): Line => {
  const text = visible.text.trimEnd();
  if (codePoints(text) <= MAX) {
    return lineIn(text, { start: 0, end: text.length }, matches);
  }
  const matched = codePoints(text.slice(first.start, first.end));
  return matched > MAX - 2
    ? hardCut(text, first)
    : lineIn(text, toWords(text, grown(text, first, matched), first), matches);
};

/** The snippet line of `visible`, undefined when no word of it matches `terms`. */
const lineOf = (visible: Visible, terms: ReadonlySet<string>): Line | undefined => {
  const matches = matchesIn(visible, terms);
  const first = matches[0];
  return first === undefined ? undefined : windowOf(visible, first, matches);
};

/** Only ASCII: lower case keeps every offset, and NFC changes nothing. */
const ASCII = /^[\0-\x7f]*$/u;
const ASCII_WORD = /[0-9A-Za-z]/u;

/**
 * Finds the first raw word of `value` at or after an offset (a line end, never inside a word) that
 * matches `terms`, or -1. An ASCII value is searched for the terms in lower case with word boundaries
 * (as fast as the engine finds text); any other is split into words and each compared as the index
 * compares it.
 */
const rawMatcher = (value: string, terms: ReadonlySet<string>): ((from: number) => number) => {
  if (!ASCII.test(value)) {
    return (from) => {
      WORD.lastIndex = from;
      for (let found = WORD.exec(value); found !== null; found = WORD.exec(value)) {
        const term = normalizeWord(found[0]);
        if (term !== undefined && terms.has(term)) {
          return found.index;
        }
      }
      return -1;
    };
  }
  const lower = value.toLowerCase();
  const wordAt = (at: number): boolean => ASCII_WORD.test(lower.charAt(at));
  return (from) => {
    let first = -1;
    for (const term of terms) {
      for (
        let at = lower.indexOf(term, from);
        at >= 0 && (first < 0 || at < first);
        at = lower.indexOf(term, at + 1)
      ) {
        if (!wordAt(at - 1) && !wordAt(at + term.length)) {
          first = at;
        }
      }
    }
    return first;
  };
};

/** The line of `value` around `at`, without its line break. */
const lineAround = (value: string, at: number): Span => {
  const start = Math.max(value.lastIndexOf("\n", at - 1), value.lastIndexOf("\r", at - 1)) + 1;
  const breaks = [value.indexOf("\n", at), value.indexOf("\r", at)].filter((found) => found >= 0);
  return { start, end: breaks.length === 0 ? value.length : Math.min(...breaks) };
};

/**
 * What is read for a raw match at `at` in `block` (see the file comment): Markdown to parse, a line
 * of code as it stands, or nothing (a fence line, a long HTML block); the next raw match is looked
 * for after `end`.
 */
interface Unit {
  readonly kind: "markdown" | "code" | "none";
  readonly source: string;
  readonly end: number;
}

const unitOf = (value: string, block: MarkdownBlock, at: number): Unit => {
  const line = lineAround(value, at);
  const text = value.slice(line.start, line.end);
  const first = lineAround(value, block.start);
  if (block.fence) {
    // A word in a fence line is its info string; a closing fence holds none.
    return {
      kind: line.start === first.start ? "none" : "code",
      source: text.replace(QUOTE, ""),
      end: line.end,
    };
  }
  const head = value.slice(first.start, first.end);
  if (HTML_START.test(head)) {
    const source = value.slice(block.start, line.end);
    return source.length > MAX_LINE * 4
      ? { kind: "none", source: "", end: block.end }
      : { kind: "markdown", source, end: line.end };
  }
  if (first.end < block.end && head.includes("|")) {
    const second = lineAround(value, first.end + (value.startsWith("\r\n", first.end) ? 2 : 1));
    const delimiter = value.slice(second.start, second.end);
    // The delimiter row holds no word, so the match is in the head or a row below.
    if (TABLE_DELIMITER.test(delimiter)) {
      const rows = line.start > second.start ? [head, delimiter, text] : [head, delimiter];
      return { kind: "markdown", source: rows.join("\n"), end: line.end };
    }
  }
  if (text.length <= MAX_LINE) {
    return { kind: "markdown", source: text, end: line.end };
  }
  const start = Math.max(line.start, at - MAX_LINE / 2);
  return {
    kind: "markdown",
    source: value.slice(start, Math.min(line.end, start + MAX_LINE)),
    end: line.end,
  };
};

/** The snippet line of the Markdown `value` (see the file comment). */
const markdownLine = (value: string, terms: ReadonlySet<string>): Line | undefined => {
  const rawMatch = rawMatcher(value, terms);
  let at = rawMatch(0);
  if (at < 0) {
    return undefined;
  }
  const blocks = markdownBlocks(value);
  let definitions: string | undefined;
  while (at >= 0) {
    const found = at;
    const block = blocks.find((one) => one.end > found);
    /* v8 ignore next 3 -- a word stands in a line that is not blank, which a block holds. */
    if (block === undefined) {
      return undefined;
    }
    const unit = unitOf(value, block, at);
    let visible: Visible | undefined;
    if (unit.kind === "code" || (unit.kind === "markdown" && !MARKDOWN_SYNTAX.test(unit.source))) {
      visible = visiblePlain(unit.source);
    } else if (unit.kind === "markdown") {
      definitions ??= blocks
        .filter((one) => !one.fence)
        .flatMap((one) => value.slice(one.start, one.end).match(DEFINITION_LINE) ?? [])
        .join("\n");
      const source = withoutDestinations(unit.source);
      visible = visibleMarkdown(`${source}\n\n${definitions}`, source.length);
    }
    const line = visible === undefined ? undefined : lineOf(visible, terms);
    if (line !== undefined) {
      return line;
    }
    at = rawMatch(unit.end);
  }
  return undefined;
};

/** The values of the properties of `element` a snippet may come from, in reading order (see the file comment). */
const propertyValues = (
  element: ElementRecord,
  metamodel: Metamodel,
): { readonly key: string; readonly values: readonly string[] }[] => {
  const skipped = new Set(["id", "type", "status", titleKeyOf(metamodel), identifierKeyOf(metamodel)]);
  const typeKeys = metamodel.valid ? (findType(metamodel, element.type)?.properties ?? []) : [];
  const keys = [...new Set([...typeKeys.filter((key) => key in element.data), ...Object.keys(element.data)])];
  return keys
    .filter((key) => !skipped.has(key) && relationKey(metamodel, key) === undefined)
    .map((key) => {
      const values: string[] = [];
      valueTexts(element.data[key], values);
      const defined = keyDefinition(metamodel, key);
      const choices = defined?.kind === "property" ? defined.definition.choices : undefined;
      return {
        key,
        values:
          choices === undefined
            ? values
            : values.map((value) => choices.find((choice) => choice.key === value)?.name ?? value),
      };
    });
};

/** The name the tool shows for the property `key`. */
const propertyName = (metamodel: Metamodel, key: string): string => {
  const defined = keyDefinition(metamodel, key);
  return defined?.kind === "property" ? defined.definition.name : key;
};

/**
 * The snippet of `hit`, a hit of `index` (see the file comment); undefined when none is shown.
 * `fields` are the fields the hit was found in (`SearchHit.fields`).
 */
export const searchSnippet = (
  index: SearchIndex,
  hit: Pick<SearchHit, "element" | "fields" | "terms">,
): SearchSnippet | undefined => {
  const fields = new Set<SearchField>(hit.fields);
  if (!fields.has("text") && !fields.has("properties")) {
    return undefined;
  }
  const { metamodel } = index;
  let element = hit.element;
  // The words of the identifier are the ID's (AK4): a word of them found elsewhere is no snippet.
  const identifier = identifierValue(element, identifierKeyOf(metamodel)) ?? "";
  const own = new Set(identifier.split(WORD_SEPARATOR).map(normalizeWord));
  const terms = new Set(hit.terms.filter((term) => !own.has(term)));
  if (fields.has("text")) {
    // A file that no longer holds the element: its properties as the index read them.
    const now = elementNow(index.layout, hit.element);
    const line = now === undefined ? undefined : markdownLine(now.body, terms);
    if (line !== undefined) {
      return { field: "text", ...line };
    }
    element = now?.element ?? element;
  }
  if (!fields.has("properties")) {
    return undefined;
  }
  const markdown = markdownKeysOf(metamodel);
  for (const { key, values } of propertyValues(element, metamodel)) {
    for (const value of values) {
      const line = markdown.has(key) ? markdownLine(value, terms) : lineOf(visiblePlain(value), terms);
      if (line !== undefined) {
        return { field: "properties", property: key, propertyName: propertyName(metamodel, key), ...line };
      }
    }
  }
  return undefined;
};

/** The words of `title` that match `terms` (`SearchHit.terms`), for highlighting the title (SR-174 AK4). */
export const titleMarks = (title: string, terms: readonly string[]): TextMark[] =>
  matchesIn({ text: title, runs: [0, title.length] }, new Set(terms));
