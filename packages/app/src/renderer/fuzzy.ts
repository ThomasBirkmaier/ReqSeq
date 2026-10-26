// Fuzzy ranking of the names of the app's own actions and open buffers in the minibuffer. It is UI
// only: elements are found by `element.search` in core (ADR-0002).
import uFuzzy from "@leeoniya/ufuzzy";
import { nth } from "./lists.js";

/** A match: the item and the character ranges [start, end) of the name that matched, for highlighting. */
export interface Ranked<T> {
  readonly item: T;
  readonly ranges: readonly (readonly [number, number])[];
}

// uFuzzy's options with plain numbers for its `const enum`s, which a build with `isolatedModules`
// cannot import.
const options = (plain: Readonly<Record<string, number>>): uFuzzy.Options => plain;
// uFuzzy orders equal matches alphabetically; keeping the caller's order (recent first) needs its
// `compare`, which `sort` takes as a fourth argument that the type declarations leave out.
const keepOrder = (): number => 0;
type Sort = (info: uFuzzy.Info, haystack: string[], needle: string, compare: () => number) => number[];
// First try: the letters of each word in order, anything in between ("srch" finds "Search").
const IN_ORDER = new uFuzzy(options({ intraMode: 0, intraIns: Infinity }));
// Second try when that finds nothing: one slip per word ("filtre" finds "Filter").
const ONE_SLIP = new uFuzzy(options({ intraMode: 1, intraSub: 1, intraTrn: 1, intraDel: 1 }));

const pairs = (flat: readonly number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push([nth(flat, i), nth(flat, i + 1)]);
  }
  return out;
};

type Span = readonly [number, number];

/** A match: the index of the item, and the character ranges of its name that matched. */
interface Match {
  readonly index: number;
  readonly ranges: readonly Span[];
}

/**
 * The character ranges of `name` in which `needle` (one word, lower case) matches as the beginnings
 * of words (SR-121 AK1): it falls into pieces, each the beginning of a later word than the piece
 * before, the first one of the first word; words may be skipped ("flp" finds "Filter list by
 * property", "lae" "List all elements", "crel" "Create relation"). Undefined when it does not.
 */
const prefixRanges = (name: string, needle: string): Span[] | undefined => {
  const words = [...name.toLowerCase().matchAll(/\S+/g)].map((word) => ({
    start: word.index,
    text: word[0],
  }));
  const from = (at: number, first: number, last: number): Span[] | undefined => {
    if (at === needle.length) {
      return [];
    }
    for (const [offset, word] of words.slice(first, last).entries()) {
      const index = first + offset;
      for (let length = Math.min(word.text.length, needle.length - at); length > 0; length -= 1) {
        if (word.text.startsWith(needle.slice(at, at + length))) {
          const rest = from(at + length, index + 1, words.length);
          if (rest !== undefined) {
            return [[word.start, word.start + length], ...rest];
          }
        }
      }
    }
    return undefined;
  };
  return from(0, 0, 1);
};

/** The names matched by the beginnings of their words, in the given order (only for a query of one word). */
const byPrefix = (names: readonly string[], needle: string): Match[] => {
  const word = needle.toLowerCase();
  if (word.length < 2 || /\s/.test(word)) {
    return [];
  }
  return names.flatMap((name, index) => {
    const ranges = prefixRanges(name, word);
    return ranges === undefined ? [] : [{ index, ranges }];
  });
};

/** The names `matcher` finds, the best first. */
const byLetters = (matcher: uFuzzy, names: string[], needle: string): Match[] => {
  const found = matcher.filter(names, needle);
  if (found === null) {
    return [];
  }
  const info = matcher.info(found, names, needle);
  const order = (matcher.sort as Sort)(info, names, needle, keepOrder);
  return order.map((at) => ({ index: nth(info.idx, at), ranges: pairs(nth(info.ranges, at)) }));
};

/**
 * The items whose name matches `query`, the best first. An empty query keeps all items in the given
 * order. A query of one word that gives the beginnings of the words of a name finds it first
 * ("lae" for "List all elements", SR-121 AK1), in the given order. The words of the query match in order; no word matches across
 * words of a name without a space unless as such beginnings. When nothing matches, one slip per word
 * is allowed.
 */
export const rank = <T>(items: readonly T[], name: (item: T) => string, query: string): Ranked<T>[] => {
  const needle = query.trim();
  if (needle === "") {
    return items.map((item) => ({ item, ranges: [] }));
  }
  const names = items.map(name);
  const first = byPrefix(names, needle);
  const taken = new Set(first.map((match) => match.index));
  const found = [...first, ...byLetters(IN_ORDER, names, needle).filter((match) => !taken.has(match.index))];
  return (found.length > 0 ? found : byLetters(ONE_SLIP, names, needle)).map((match) => ({
    item: nth(items, match.index),
    ranges: match.ranges,
  }));
};
