// Phrases of a search (SR-068 AK4, SR-174 AK6): words in quotes that match only as a whole: the
// words one after the other in this order, as whole words, in any case and Unicode form, without a
// typo, within one unit of one field value. Pure and on its own, so that every field that holds
// words can check a phrase the same way: the index (`search-index.ts`, a phrase found by its words
// is checked against the texts) and the snippet (`search-snippet.ts`, where it stands).
//
// - The query (`parseQuery`): `"`, `„`, `“` and `”` open a phrase only at the start of the query or
//   after white space; the next of the four closes it, else it runs to the end of the query and is
//   open: its last word also matches the words it begins. Any other quote character, and one that
//   opens nothing, is a character that is not part of a word, as before; after a closing quote the
//   query goes on outside the phrase (`"filter"list` is the phrase `filter` and the word `list`).
//   The words of a phrase are split and compared as the index splits and compares words
//   (`WORD_SEPARATOR`, `normalizeWord`); a phrase without a word counts for nothing.
// - The units (`phraseUnits`): the parts of a Markdown text a phrase may stand in, so that it never
//   spans the border of a paragraph, a list item, a table cell, a heading or a line of a fenced
//   code block (SR-068 AK4). Read by lines, not parsed: the blocks between blank lines and the
//   fenced code blocks (`markdownBlocks`); in a block a list item marker, an ATX heading, a setext
//   underline, a thematic break or a deeper block quote begins a new unit (fewer markers continue a
//   paragraph), a table (a line with a bar followed by the delimiter row, also after the lines of a
//   paragraph, to the end of the block) is a unit per cell, and in a fenced code block every line but
//   the fence lines is one. A line break inside a paragraph, and the characters between the words
//   that are no letters or digits (Markdown characters, block quote markers too), do not end a unit.
//   The marker of a list item is not in the unit of the item. A title and a value that is no
//   Markdown are one unit as a whole.
// - Matching (`findPhrase`): the first place, from an offset on, where the words of the phrase
//   follow one another inside one unit, as offsets from the start of its first word to the end of
//   its last one. A place within one line is mostly decided by that line (`inLine`); the units are
//   read only for the others. A phrase of ASCII words is one regular expression over the text as it
//   is (most phrases: no copy of the text, no expression per word); any other is compared word by
//   word as the index splits the text.
import { markdownBlocks } from "../model/index.js";

/** Splits text into words: at every character that is not a letter, a mark or a digit. */
export const WORD_SEPARATOR = /[^\p{L}\p{M}\p{N}]+/u;

/** A word as it is indexed and searched: NFC, lower case; undefined for none. */
export const normalizeWord = (word: string): string | undefined => {
  const term = word.normalize("NFC").toLowerCase();
  return term === "" ? undefined : term;
};

/** The words of `text` as the index has them (`WORD_SEPARATOR`, `normalizeWord`). */
export const wordsOf = (text: string): string[] =>
  text.split(WORD_SEPARATOR).flatMap((word) => normalizeWord(word) ?? []);

/** The characters that open and close a phrase (SR-068 AK4). */
const QUOTES: ReadonlySet<string> = new Set(['"', "„", "“", "”"]);
const SPACE = /\s/u;

/** A phrase of a query as written: its text between the quotes and its words. */
export interface QueryPhrase {
  readonly content: string;
  readonly words: readonly string[];
  /** No closing quote: the phrase runs to the end of the query, and its last word is a word start. */
  readonly open: boolean;
}

/** A query split into its words outside quotes (split at white space, as written) and its phrases. */
export interface ParsedQuery {
  readonly words: readonly string[];
  readonly phrases: readonly QueryPhrase[];
}

/** The words and phrases of `query` (see the file comment). */
export const parseQuery = (query: string): ParsedQuery => {
  const phrases: QueryPhrase[] = [];
  let outside = "";
  let at = 0;
  while (at < query.length) {
    const char = query.charAt(at);
    if (QUOTES.has(char) && (at === 0 || SPACE.test(query.charAt(at - 1)))) {
      let end = at + 1;
      while (end < query.length && !QUOTES.has(query.charAt(end))) {
        end++;
      }
      const content = query.slice(at + 1, end);
      phrases.push({ content, words: wordsOf(content), open: end >= query.length });
      // The phrase separates what stands before and after it.
      outside += " ";
      at = end + 1;
    } else {
      outside += char;
      at++;
    }
  }
  return { words: outside.split(/\s+/u).filter((word) => word !== ""), phrases };
};

/** A phrase as it is matched: its words, and whether the last one also matches the words it begins. */
export interface SearchPhrase {
  readonly words: readonly string[];
  readonly prefix: boolean;
}

/** Whether the word `term` of a text matches the phrase word `word`: the same, or one it begins (`prefix`). */
export const phraseWordMatches = (term: string, word: string, prefix: boolean): boolean =>
  prefix ? term.startsWith(word) : term === word;

/** Block quote markers in front of a line. */
export const QUOTE_MARKERS = /^(?: {0,3}> ?)*/u;
/** The delimiter row of a GFM table, the second line of its block. */
export const TABLE_DELIMITER =
  /^(?: {0,3}> ?)* {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/u;
/** A fence line: an opening or closing fence, also indented in a list item. */
const FENCE_LINE = /^[ \t]*(?:`{3,}|~{3,})/u;
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/u;
/** A setext underline or a thematic break: a line that holds no words and ends what stands before it. */
const RULE = /^ {0,3}(?:=+|-+|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})[ \t]*$/u;
const LIST_MARKER = /^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/u;

/** A line of a text: offsets without its line break, end exclusive. */
interface Line {
  readonly start: number;
  readonly end: number;
}

/** The lines of `text` from `start` to `end` (whole lines: LF, CRLF or CR). */
const linesIn = (text: string, start: number, end: number): Line[] => {
  const lines: Line[] = [];
  for (const match of text.slice(start, end).matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)) {
    const line = match[0].replace(/(?:\r\n|\r|\n)$/u, "");
    if (match[0] !== "") {
      lines.push({ start: start + match.index, end: start + match.index + line.length });
    }
  }
  return lines;
};

/** The offset in `line` after its block quote markers. */
const contentStart = (text: string, line: Line): number =>
  line.end - text.slice(line.start, line.end).replace(QUOTE_MARKERS, "").length;

/** Adds the cells of a table row to `units`: the parts between bars that are not escaped. */
const cells = (text: string, line: Line, units: number[]): void => {
  let start = contentStart(text, line);
  for (let at = start; at < line.end; at++) {
    const char = text.charAt(at);
    if (char === "\\") {
      at++;
    } else if (char === "|") {
      units.push(start, at);
      start = at + 1;
    }
  }
  units.push(start, line.end);
};

/** The number of block quote markers that `line` starts with. */
const quoteDepth = (text: string, line: Line): number =>
  (QUOTE_MARKERS.exec(text.slice(line.start, line.end))?.[0].match(/>/gu) ?? []).length;

/** Adds the units of lines of a block that are no table and no fenced code to `units` (see the file comment). */
const paragraphs = (text: string, lines: readonly Line[], units: number[]): void => {
  let open: number | undefined;
  let last = 0;
  let depth = 0;
  const close = (): void => {
    if (open !== undefined) {
      units.push(open, last);
      open = undefined;
    }
  };
  for (const line of lines) {
    const at = contentStart(text, line);
    const content = text.slice(at, line.end);
    const marker = LIST_MARKER.exec(content);
    const quoted = quoteDepth(text, line);
    // A deeper block quote starts a new block; a line with fewer markers continues the paragraph (lazy).
    if (quoted > depth) {
      close();
    }
    depth = quoted;
    if (ATX_HEADING.test(content)) {
      close();
      units.push(at, line.end);
    } else if (RULE.test(content)) {
      close();
    } else if (marker !== null) {
      close();
      open = at + marker[0].length;
      last = line.end;
    } else {
      open ??= at;
      last = line.end;
    }
  }
  close();
};

/** Whether the lines `head` and `delimiter` begin a table: a line with a bar and a delimiter row. */
const tableStart = (text: string, head: Line | undefined, delimiter: Line | undefined): boolean =>
  head !== undefined &&
  delimiter !== undefined &&
  text.slice(head.start, head.end).includes("|") &&
  TABLE_DELIMITER.test(text.slice(delimiter.start, delimiter.end));

/** The units of the Markdown text `markdown`, as `[start, end]` pairs in order (see the file comment). */
export const phraseUnits = (markdown: string): number[] => {
  const units: number[] = [];
  for (const block of markdownBlocks(markdown)) {
    const lines = linesIn(markdown, block.start, block.end);
    if (block.fence) {
      for (const line of lines) {
        const at = contentStart(markdown, line);
        if (!FENCE_LINE.test(markdown.slice(at, line.end))) {
          units.push(at, line.end);
        }
      }
      continue;
    }
    // A table may start inside a block, after the lines of a paragraph: it runs to the end of the block.
    const table = lines.findIndex((line, at) => tableStart(markdown, line, lines[at + 1]));
    paragraphs(markdown, table < 0 ? lines : lines.slice(0, table), units);
    if (table >= 0) {
      lines.forEach((line, at) => {
        if (at >= table && at !== table + 1) {
          cells(markdown, line, units);
        }
      });
    }
  }
  return units;
};

/** Where a phrase stands in a text: UTF-16 offsets from the start of its first word to the end of its last, end exclusive. */
export interface PhraseSpan {
  readonly start: number;
  readonly end: number;
}

const ASCII = /^[\0-\x7f]*$/u;

/** Per phrase its regular expression (`phraseRegex`), or null for a phrase with another word. */
const phraseRegexes = new WeakMap<SearchPhrase, RegExp | null>();

/**
 * The phrase `phrase` as a regular expression over any text when its words are ASCII, else null,
 * made once per phrase: its words as whole words in any case, with characters that are no letter,
 * mark or digit between them, and the last word as a word start in an open phrase.
 */
const phraseRegex = (phrase: SearchPhrase): RegExp | null => {
  let known = phraseRegexes.get(phrase);
  if (known === undefined) {
    const letter = "[\\p{L}\\p{M}\\p{N}]";
    const last = phrase.words.length - 1;
    // `İ` is `i̇` in lower case: as the start of an open last word `i`, it begins a word with `i`.
    const [first, ...rest] = phrase.words.map((word, n) =>
      phrase.prefix && word === "i" && n === last ? "[i\\u0130]" : word,
    );
    // The first word, then the look back: it scans faster than a look back at every character.
    const between = rest.map((word) => `[^\\p{L}\\p{M}\\p{N}]+${word}`).join("");
    const end = phrase.prefix ? `${letter}*` : `(?!${letter})`;
    const source = `${String(first)}(?<!${letter}${String(first)})${between}${end}`;
    known = phrase.words.every((word) => ASCII.test(word)) ? new RegExp(source, "giu") : null;
    phraseRegexes.set(phrase, known);
  }
  return known;
};

const WORD = /[\p{L}\p{M}\p{N}]+/gu;

/** The places of `phrase` in `text`, from `from` on, in order, ignoring units: word by word, as the index splits them. */
function* wordPlaces(text: string, phrase: SearchPhrase, from: number): Generator<PhraseSpan> {
  const tokens: { readonly start: number; readonly end: number; readonly term: string }[] = [];
  for (const found of text.slice(from).matchAll(WORD)) {
    tokens.push({
      start: from + found.index,
      end: from + found.index + found[0].length,
      term: String(normalizeWord(found[0])),
    });
  }
  const { words } = phrase;
  const last = words.length - 1;
  for (let at = 0; at + last < tokens.length; at++) {
    if (
      words.every((word, n) =>
        phraseWordMatches(String(tokens[at + n]?.term), word, n === last && phrase.prefix),
      )
    ) {
      yield { start: Number(tokens[at]?.start), end: Number(tokens[at + last]?.end) };
    }
  }
}

/** Whether `[start, end)` lies inside one of `units` (`[start, end]` pairs). */
const inOneUnit = (units: readonly number[], span: PhraseSpan): boolean => {
  for (let at = 0; at < units.length; at += 2) {
    if (Number(units[at]) <= span.start && span.end <= Number(units[at + 1])) {
      return true;
    }
  }
  return false;
};

/** A line break, or a bar that may end a table cell. */
const BREAK_OR_BAR = /[\r\n|]/u;
const DIGIT = /\d/u;

/**
 * Whether `place` lies inside a unit of the Markdown `text` by its line alone, without the units: it
 * spans no line break and no bar, and it does not start a line with a digit (the number of a list
 * item) or stand in a fence line (an info string). Any other line with words lies in a unit as a
 * whole or, in a list item, from after its marker; most places are decided so (SR-098).
 */
export const inLine = (text: string, place: PhraseSpan): boolean => {
  if (BREAK_OR_BAR.test(text.slice(place.start, place.end))) {
    return false;
  }
  const start =
    Math.max(text.lastIndexOf("\n", place.start - 1), text.lastIndexOf("\r", place.start - 1)) + 1;
  const lead = text.slice(start, place.start).replace(/^[ \t>]*/u, "");
  return lead === ""
    ? !DIGIT.test(text.charAt(place.start))
    : !lead.startsWith("```") && !lead.startsWith("~~~");
};

/**
 * The first place of `phrase` in `text` from `from` on, or undefined; in a Markdown text (`markdown`)
 * inside one of its units (see the file comment), else anywhere. A phrase without a word stands
 * nowhere.
 */
export const findPhrase = (
  text: string,
  phrase: SearchPhrase,
  markdown = false,
  from = 0,
): PhraseSpan | undefined => {
  if (phrase.words.length === 0) {
    return undefined;
  }
  let units: readonly number[] | undefined;
  const inUnit = (place: PhraseSpan): boolean =>
    !markdown || inLine(text, place) || inOneUnit((units ??= phraseUnits(text)), place);
  const regex = phraseRegex(phrase);
  // A phrase of ASCII words: one regular expression over the text as it is, no copy in lower case
  // (SR-098). A place of ASCII characters is one as the index splits and compares words. Case
  // folding also takes a few other characters for ASCII letters (`ſ` for `s`, the Kelvin sign for
  // `k`): from a place with any other character on, the text is compared word by word, as the index
  // does.
  let next = from;
  while (regex !== null) {
    regex.lastIndex = next;
    const found = regex.exec(text);
    if (found === null) {
      return undefined;
    }
    if (!ASCII.test(found[0])) {
      next = found.index;
      break;
    }
    const place = { start: found.index, end: found.index + found[0].length };
    if (inUnit(place)) {
      return place;
    }
    next = found.index + 1;
  }
  for (const place of wordPlaces(text, phrase, next)) {
    if (inUnit(place)) {
      return place;
    }
  }
  return undefined;
};
