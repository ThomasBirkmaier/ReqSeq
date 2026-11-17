// The snippet of a search hit (SR-174): where a word of the query was found, and one line of at most
// 120 characters around it with the matched words marked, so a hit can be judged without opening it.
// Pure apart from reading the hit's file (`elementNow`); `element.search` computes it for the hits of
// its page only, in the turn it searches in, so every access gives the same snippet (AK5).
//
// - What counts: the words of `SearchHit.terms`, compared as the index compares them (split at
//   `WORD_SEPARATOR`, `normalizeWord`). Only the fields the hit was found in are read (`fields`, which
//   holds only searched ones): the `[[` search (title and IDs) reads no file. A search restricted to
//   single properties (SR-216 AK5) reads only those, in the order below.
// - Phrases (`SearchHit.phrases`, SR-174 AK6): only a place where a phrase stands whole counts. It
//   is found raw as the index finds it (`findPhrase` within `phraseUnits`, the link destinations as
//   spaces, so the offsets stay), the lines from its first word to its last are read, and in their
//   visible text the phrase is one mark from its first word to its last, within one block
//   (`Visible.bounds`; a hard line break is none). Its words are marked elsewhere only as words of
//   `terms`; overlapping phrases are one mark.
// - Where (AK3): the text first, then the property values one by one in reading order: the properties
//   of the type in metamodel order (its effective `properties`), then the other keys in file order;
//   file order alone when the metamodel is not valid. Each item of a list and each value of a
//   mapping is a value of its own (AK2: the snippet comes from the value with the match). A choice
//   shows its name, the key when the metamodel names none. Left out, as no snippet shows them (AK4):
//   the title (marked in `titleMarks` instead), `id`, relation
//   keys, type, status and the identifier. A choice found by its key shows its name, marked whole.
// - Visible text (AK1): the text and Markdown properties (`markdownKeysOf`) are read as the reader
//   sees them. A cheap pass over the raw value finds the first word that matches; only the line it
//   stands in is parsed with mdast, without the link destinations (`visibleText`, never seen) and
//   with GFM only when the line needs it. A line whose inline constructs do not close in it (a
//   hard-wrapped link or emphasis, `openEnds`) is parsed with the lines around it, one more to the
//   side it goes on to at a time, at most `MAX_WRAP`; a line longer than `MAX_LINE` is cut around the
//   match and the scan goes on after the cut.
//   The labels of the link reference definitions of the value are added when the line may refer to
//   one. The block of the line (`markdownBlocks`) decides how: a line of a fenced code block is code
//   as it stands (its fence lines nothing), a table row is parsed with the table's head and
//   delimiter row and read alone, and an HTML block is parsed from its start (at most 4 `MAX_LINE`).
//   A whole block is not parsed: a list of 4 KB with links costs about 4 ms with mdast, one line of
//   it 0.1 to 0.25 ms, and a page has up to 500 hits (SR-098). The parse gives runs of text, inline
//   code, code and image alt texts; blocks, breaks, table cells and HTML are joined with a space.
//   Words are split inside runs, never across them, as the index splits the raw text at the
//   Markdown characters. A match the reader does not see (a link destination or title, an HTML tag,
//   an entity name) is skipped and the next raw match is read. A line without Markdown characters is
//   not parsed.
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
import {
  markdownBlocks,
  markdownDefinitions,
  markdownLinks,
  relationKey,
  titleKeyOf,
} from "../model/index.js";
import { identifierKeyOf } from "../model/identifier-index.js";
import type { PhraseSpan, SearchPhrase } from "./phrase-text.js";
import {
  QUOTE_MARKERS,
  TABLE_DELIMITER,
  findPhrase,
  normalizeWord,
  phraseWordMatches,
} from "./phrase-text.js";
import type { SearchField, SearchHit, SearchIndex } from "./search-index.js";
import { elementNow, valueTexts, visibleText } from "./search-index.js";

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
/** A `]` that may close a reference-style link: not followed by `(`. */
const REFERENCE = /\](?!\()/u;
const ELLIPSIS = "…";
/** The first line of an HTML block (CommonMark, roughly): it runs to the next blank line. */
const HTML_START = /^(?: {0,3}> ?)* {0,3}<[A-Za-z!?/]/u;

/** The mdast options, created once. */
const PARSE = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] };

/**
 * What only GFM reads differently from CommonMark in what the reader sees: a table, strikethrough, a
 * footnote, a task list item. Its autolink literals show as written either way. Without it a line
 * is parsed without the GFM extensions, which costs about half.
 */
const GFM_SYNTAX = /[|~]|\[\^|\[[ xX]\]/u;

/**
 * Text as a line shows it, with the runs words are split in (`[start, end]` pairs) and, in order,
 * the offsets where a block begins or ends (a paragraph, a list item, a table cell): a phrase never
 * spans one (SR-068 AK4), a line break inside a paragraph is none.
 */
interface Visible {
  text: string;
  readonly runs: number[];
  readonly bounds: number[];
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

/** A gap that ends a block (`Visible.bounds`). */
const bound = (visible: Visible): void => {
  gap(visible);
  visible.bounds.push(visible.text.length);
};

/** Inline nodes whose children read on in the same line. */
const INLINE = new Set(["emphasis", "strong", "delete", "link", "linkReference"]);

/** Adds what the reader sees of `node` to `visible`. */
const visit = (node: Nodes, visible: Visible): void => {
  if (node.type === "text" || node.type === "inlineCode") {
    run(visible, node.value);
  } else if (node.type === "code") {
    bound(visible);
    run(visible, node.value);
    bound(visible);
  } else if (node.type === "image" || node.type === "imageReference") {
    // `join` gives "" for an alt text that is null or undefined, which the mdast types allow.
    run(visible, [node.alt].join(""));
  } else if ("children" in node) {
    const block = !INLINE.has(node.type);
    if (block) {
      bound(visible);
    }
    for (const child of node.children) {
      visit(child, visible);
    }
    if (block) {
      bound(visible);
    }
  } else if (node.type === "break") {
    // A hard line break inside a paragraph: a space, no end of a block.
    gap(visible);
  } else {
    // HTML, a thematic break, a definition, a footnote reference: nothing to read.
    bound(visible);
  }
};

/**
 * The visible text of `markdown`, of which only the first `length` characters count (the rest defines
 * references). Of a table only the row `row` counts (0 the head, -1 the last), when given.
 */
const visibleMarkdown = (markdown: string, length: number, row?: number): Visible => {
  const visible: Visible = { text: "", runs: [], bounds: [] };
  const root = GFM_SYNTAX.test(markdown) ? fromMarkdown(markdown, PARSE) : fromMarkdown(markdown);
  for (const child of root.children) {
    // Every node fromMarkdown gives has a position.
    if (Number(child.position?.start.offset) < length) {
      if (child.type === "table" && row !== undefined) {
        const pick = row === 0 ? 0 : child.children.length - 1;
        child.children.forEach((tableRow, at) => {
          if (at === pick) {
            visit(tableRow, visible);
          }
        });
      } else {
        visit(child, visible);
      }
    }
  }
  return visible;
};

/** `value` as one line, one run. */
const visiblePlain = (value: string): Visible => {
  const visible: Visible = { text: "", runs: [], bounds: [] };
  run(visible, value);
  return visible;
};

/** A word of a visible text: its offsets, as the index compares it, and the number of block bounds before it. */
interface Token {
  readonly start: number;
  readonly end: number;
  readonly term: string;
  readonly block: number;
}

/** The words of `visible`, within its runs, in order. */
const tokensIn = (visible: Visible): Token[] => {
  const { text, runs, bounds } = visible;
  const tokens: Token[] = [];
  let block = 0;
  for (let at = 0; at < runs.length; at += 2) {
    const start = Number(runs[at]);
    const end = Number(runs[at + 1]);
    WORD.lastIndex = start;
    for (let found = WORD.exec(text); found !== null && found.index < end; found = WORD.exec(text)) {
      const wordEnd = Math.min(found.index + found[0].length, end);
      while (block < bounds.length && Number(bounds[block]) <= found.index) {
        block++;
      }
      tokens.push({
        start: found.index,
        end: wordEnd,
        term: String(normalizeWord(text.slice(found.index, wordEnd))),
        block,
      });
      if (wordEnd === end) {
        break;
      }
    }
  }
  return tokens;
};

/** The words of `visible` (within its runs) that match `terms`, in order. */
const matchesIn = (visible: Visible, terms: ReadonlySet<string>): TextMark[] =>
  tokensIn(visible)
    .filter((token) => terms.has(token.term))
    .map((token) => ({ start: token.start, end: token.end }));

/** The places of `phrases` in `visible`, each from its first word to its last, inside one block, merged where they overlap. */
const phraseMarksIn = (visible: Visible, phrases: readonly SearchPhrase[]): TextMark[] => {
  const tokens = tokensIn(visible);
  const found: TextMark[] = [];
  for (const { words, prefix } of phrases) {
    const last = words.length - 1;
    for (let at = 0; at + last < tokens.length; at++) {
      const first = tokens[at];
      const end = tokens[at + last];
      if (
        first?.block === end?.block &&
        words.every((word, n) => phraseWordMatches(String(tokens[at + n]?.term), word, n === last && prefix))
      ) {
        found.push({ start: Number(first?.start), end: Number(end?.end) });
      }
    }
  }
  const merged: { start: number; end: number }[] = [];
  for (const mark of found.sort((a, b) => a.start - b.start)) {
    const before = merged.at(-1);
    if (before !== undefined && mark.start < before.end) {
      before.end = Math.max(before.end, mark.end);
    } else {
      merged.push({ ...mark });
    }
  }
  return merged;
};

/**
 * The marks of `visible`: every place of a phrase (SR-174 AK6), and every word that matches `terms`
 * outside them, in order.
 */
const marksIn = (
  visible: Visible,
  terms: ReadonlySet<string>,
  phrases: readonly SearchPhrase[],
): TextMark[] => {
  if (phrases.length === 0) {
    return matchesIn(visible, terms);
  }
  const whole = phraseMarksIn(visible, phrases);
  const words = matchesIn(visible, terms).filter(
    (mark) => !whole.some((phrase) => mark.start < phrase.end && phrase.start < mark.end),
  );
  return [...whole, ...words].sort((a, b) => a.start - b.start);
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

/** The snippet line of `visible`, undefined when no word of it matches `terms` and no phrase stands in it. */
const lineOf = (
  visible: Visible,
  terms: ReadonlySet<string>,
  phrases: readonly SearchPhrase[],
): Line | undefined => {
  const matches = marksIn(visible, terms, phrases);
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
 * What is read for a raw match at `at` in `block` (see the file comment): Markdown to parse (of a
 * table only the row `row`), a line of code as it stands, or nothing (a fence line, a long HTML
 * block); the next raw match is looked for after `end`.
 */
interface Unit {
  readonly kind: "markdown" | "code" | "none";
  readonly source: string;
  readonly end: number;
  readonly row?: number;
}

/** List item markers at the start of a line, which are no emphasis. */
const LIST_MARKERS = /^[ \t>]*(?:[-+*]|\d{1,9}[.)])[ \t]/gmu;
/** An escaped character, which opens or closes nothing. */
const ESCAPED = /\\[\s\S]/gu;
/** Runs of stars and backticks, and of underscores that can open or close emphasis (not inside a word). */
const STARS = /\*+/gu;
const BACKTICKS = /`+/gu;
const UNDERSCORES = /(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu;

const count = (text: string, of: string | RegExp): number =>
  typeof of === "string" ? text.split(of).length - 1 : (text.match(of) ?? []).length;

/**
 * Where the inline constructs of `text` go on beyond it, roughly: after it when brackets,
 * parentheses or angle brackets open more than close, before it when they close more, and to both
 * sides when the runs of backticks, of stars or of the underscores that can be emphasis do not pair
 * up. A hard-wrapped link or emphasis.
 */
const openEnds = (text: string): { readonly before: boolean; readonly after: boolean } => {
  const plain = text.replace(ESCAPED, "").replace(LIST_MARKERS, "");
  const balances = [
    count(plain, "[") - count(plain, "]"),
    count(plain, "(") - count(plain, ")"),
    count(plain, "<") - count(plain, ">"),
  ];
  const odd = [BACKTICKS, STARS, UNDERSCORES].some((runs) => count(plain, runs) % 2 === 1);
  return { before: odd || balances.some((n) => n < 0), after: odd || balances.some((n) => n > 0) };
};

/** Lines a hard-wrapped construct may span to each side of the match's line (`openEnds`). */
const MAX_WRAP = 3;

/**
 * The lines of `block` around `line` that a construct of it spans: the line alone when nothing goes
 * on beyond it (`openEnds`), else one more line to the side it goes on to at a time, at most
 * `MAX_WRAP` steps and `MAX_LINE` characters.
 */
const wrapped = (value: string, block: MarkdownBlock, line: Span): Span => {
  let { start, end } = line;
  const last = lineAround(value, Math.max(block.start, block.end - 1)).end;
  for (let n = 0; n < MAX_WRAP && end - start < MAX_LINE; n++) {
    const open = openEnds(value.slice(start, end));
    const up = open.before && start > block.start;
    const down = open.after && end < last;
    if (!up && !down) {
      break;
    }
    start = up ? lineAround(value, start - 2).start : start;
    end = down ? lineAround(value, end + (value.startsWith("\r\n", end) ? 2 : 1)).end : end;
  }
  return { start, end };
};

/** The unit of a match in a table (`unitOf`): the row it stands in, parsed with the head and delimiter row. */
const tableUnit = (value: string, first: Span, line: Span): Unit | undefined => {
  const head = value.slice(first.start, first.end);
  if (!head.includes("|")) {
    return undefined;
  }
  const second = lineAround(value, first.end + (value.startsWith("\r\n", first.end) ? 2 : 1));
  const delimiter = value.slice(second.start, second.end);
  if (!TABLE_DELIMITER.test(delimiter)) {
    return undefined;
  }
  // The delimiter row holds no word, so the match is in the head or a row below.
  const body = line.start > second.start;
  const rows = body ? [head, delimiter, value.slice(line.start, line.end)] : [head, delimiter];
  return { kind: "markdown", source: rows.join("\n"), end: line.end, row: body ? -1 : 0 };
};

/**
 * The unit of a raw match `match` in `block` (see the file comment): of the lines from the one of
 * its start to the one of its end (a phrase may span a line break, SR-068 AK4).
 */
const unitOf = (value: string, block: MarkdownBlock, match: PhraseSpan): Unit => {
  const { start: at } = match;
  const line = {
    start: lineAround(value, at).start,
    end: lineAround(value, Math.max(at, match.end - 1)).end,
  };
  const first = lineAround(value, block.start);
  if (block.fence) {
    // A word in a fence line is its info string; a closing fence holds none.
    const kind = line.start === first.start ? "none" : "code";
    return { kind, source: value.slice(line.start, line.end).replace(QUOTE_MARKERS, ""), end: line.end };
  }
  if (HTML_START.test(value.slice(first.start, first.end))) {
    return line.end - block.start > MAX_LINE * 4
      ? { kind: "none", source: "", end: line.end }
      : { kind: "markdown", source: value.slice(block.start, line.end), end: line.end };
  }
  const table = first.end < block.end ? tableUnit(value, first, line) : undefined;
  if (table !== undefined) {
    return table;
  }
  if (line.end - line.start > MAX_LINE) {
    // A long line, cut around the match; the scan goes on after the cut.
    const start = Math.max(line.start, at - MAX_LINE / 2);
    const end = Math.min(line.end, Math.max(start + MAX_LINE, match.end));
    return { kind: "markdown", source: value.slice(start, end), end };
  }
  const span = wrapped(value, block, line);
  return { kind: "markdown", source: value.slice(span.start, span.end), end: line.end };
};

/** The visible text of `unit` of `value` (`definitions` of `value` computed once, when needed). */
const visibleOf = (unit: Unit, definitions: () => string): Visible | undefined => {
  if (unit.kind === "none") {
    return undefined;
  }
  if (unit.kind === "code" || !MARKDOWN_SYNTAX.test(unit.source)) {
    return visiblePlain(unit.source);
  }
  const source = visibleText(unit.source, "x");
  const references = REFERENCE.test(source) ? definitions() : "";
  return visibleMarkdown(`${source}\n\n${references}`, source.length, unit.row);
};

/** `value` with the destinations of its links and images as spaces: the visible words at the offsets of `value`. */
const withoutDestinations = (value: string): string => {
  let out = "";
  let at = 0;
  for (const { start, end } of markdownLinks(value)) {
    out += value.slice(at, start) + " ".repeat(end - start);
    at = end;
  }
  return out + value.slice(at);
};

/**
 * Finds the first raw match in `value` at or after an offset (a line end): a word that matches
 * `terms` (`rawMatcher`) or a place of a phrase inside one unit (`findPhrase`, `phraseUnits`, as
 * the index looks for it, without the link destinations), whichever comes first.
 */
const rawLocator = (
  value: string,
  terms: ReadonlySet<string>,
  phrases: readonly SearchPhrase[],
): ((from: number) => PhraseSpan | undefined) => {
  const rawMatch = terms.size === 0 ? (): number => -1 : rawMatcher(value, terms);
  const text = phrases.length === 0 ? value : withoutDestinations(value);
  return (from) => {
    const at = rawMatch(from);
    let first = at < 0 ? undefined : { start: at, end: at + 1 };
    for (const phrase of phrases) {
      const place = findPhrase(text, phrase, true, from);
      if (place !== undefined && (first === undefined || place.start < first.start)) {
        first = place;
      }
    }
    return first;
  };
};

/** The snippet line of the Markdown `value` (see the file comment). */
const markdownLine = (
  value: string,
  terms: ReadonlySet<string>,
  phrases: readonly SearchPhrase[],
): Line | undefined => {
  const locate = rawLocator(value, terms, phrases);
  let match = locate(0);
  if (match === undefined) {
    return undefined;
  }
  const blocks = markdownBlocks(value);
  let known: string | undefined;
  // The definitions give nothing to read, so their labels with any destination do.
  const definitions = (): string =>
    (known ??= markdownDefinitions(value)
      .map((label) => `[${label}]: x`)
      .join("\n"));
  while (match !== undefined) {
    const { start } = match;
    const block = blocks.find((one) => one.end > start);
    /* v8 ignore next 3 -- a word stands in a line that is not blank, which a block holds. */
    if (block === undefined) {
      return undefined;
    }
    const unit = unitOf(value, block, match);
    const visible = visibleOf(unit, definitions);
    const line = visible === undefined ? undefined : lineOf(visible, terms, phrases);
    if (line !== undefined) {
      return line;
    }
    match = locate(unit.end);
  }
  return undefined;
};

/** A value a snippet may come from: the text shown, and for a choice its key, which the index holds too. */
interface Value {
  readonly shown: string;
  readonly key?: string;
}

/** The values of the properties of `element` a snippet may come from, in reading order (see the file comment). */
const propertyValues = (
  element: ElementRecord,
  metamodel: Metamodel,
): { readonly key: string; readonly values: readonly Value[] }[] => {
  const skipped = new Set(["id", "type", "status", titleKeyOf(metamodel), identifierKeyOf(metamodel)]);
  const typeKeys = metamodel.valid ? (findType(metamodel, element.type)?.properties ?? []) : [];
  const keys = [...new Set([...typeKeys.filter((key) => key in element.data), ...Object.keys(element.data)])];
  return keys
    .filter((key) => !skipped.has(key) && relationKey(metamodel, key) === undefined)
    .map((key) => {
      const texts: string[] = [];
      valueTexts(element.data[key], texts);
      const defined = keyDefinition(metamodel, key);
      const choices = defined?.kind === "property" ? defined.definition.choices : undefined;
      const values = texts.map((text): Value => {
        const name = choices?.find((choice) => choice.key === text)?.name;
        return name === undefined ? { shown: text } : { shown: name, key: text };
      });
      return { key, values };
    });
};

/** The name the tool shows for the property `key`. */
const propertyName = (metamodel: Metamodel, key: string): string => {
  const defined = keyDefinition(metamodel, key);
  return defined?.kind === "property" ? defined.definition.name : key;
};

/** The snippet line of a property value: a choice found by its key shows its name, marked whole (AK2). */
const valueLine = (
  value: Value,
  markdown: boolean,
  terms: ReadonlySet<string>,
  phrases: readonly SearchPhrase[],
): Line | undefined => {
  if (markdown) {
    return markdownLine(value.shown, terms, phrases);
  }
  const visible = visiblePlain(value.shown);
  const line = lineOf(visible, terms, phrases);
  if (
    line !== undefined ||
    value.key === undefined ||
    marksIn(visiblePlain(value.key), terms, phrases).length === 0
  ) {
    return line;
  }
  const whole = { start: 0, end: visible.text.trimEnd().length };
  return windowOf(visible, whole, [whole]);
};

/** The snippet of the first value of `element` that matches `terms` or holds a phrase, of the properties `propertyKeys` (all when undefined). */
const propertySnippet = (
  metamodel: Metamodel,
  element: ElementRecord,
  terms: ReadonlySet<string>,
  phrases: readonly SearchPhrase[],
  propertyKeys: readonly string[] | undefined,
): SearchSnippet | undefined => {
  const markdown = markdownKeysOf(metamodel);
  const chosen = propertyKeys === undefined ? undefined : new Set(propertyKeys);
  for (const { key, values } of propertyValues(element, metamodel)) {
    for (const value of chosen === undefined || chosen.has(key) ? values : []) {
      const line = valueLine(value, markdown.has(key), terms, phrases);
      if (line !== undefined) {
        return { field: "properties", property: key, propertyName: propertyName(metamodel, key), ...line };
      }
    }
  }
  return undefined;
};

/**
 * The snippet of `hit`, a hit of `index` (see the file comment); undefined when none is shown.
 * `fields` are the fields the hit was found in (`SearchHit.fields`); `propertyKeys` the single
 * properties searched (`SearchElementsOptions.propertyKeys`), undefined for every property.
 */
export const searchSnippet = (
  index: SearchIndex,
  hit: Pick<SearchHit, "element" | "fields" | "terms" | "phrases">,
  propertyKeys?: readonly string[],
): SearchSnippet | undefined => {
  const fields = new Set<SearchField>(hit.fields);
  const terms = new Set(hit.terms);
  const { phrases } = hit;
  if ((terms.size === 0 && phrases.length === 0) || (!fields.has("text") && !fields.has("properties"))) {
    return undefined;
  }
  const { metamodel } = index;
  let element = hit.element;
  if (fields.has("text")) {
    // A file that no longer holds the element: its properties as the index read them.
    const now = elementNow(index.layout, hit.element);
    const line = now === undefined ? undefined : markdownLine(now.body, terms, phrases);
    if (line !== undefined) {
      return { field: "text", ...line };
    }
    element = now?.element ?? element;
  }
  if (!fields.has("properties")) {
    return undefined;
  }
  return propertySnippet(metamodel, element, terms, phrases, propertyKeys);
};

/**
 * The marks of `title` for highlighting it (SR-174 AK4): the places of `phrases` (`SearchHit.phrases`)
 * as a whole (AK6) and the words that match `terms` (`SearchHit.terms`) outside them.
 */
export const titleMarks = (
  title: string,
  terms: readonly string[],
  phrases: readonly SearchPhrase[] = [],
): TextMark[] => marksIn({ text: title, runs: [0, title.length], bounds: [] }, new Set(terms), phrases);
