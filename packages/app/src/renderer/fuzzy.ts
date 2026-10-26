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

/**
 * The items whose name matches `query`, the best first. An empty query keeps all items in the given
 * order. The words of the query match in order; no word matches across words of a name without a space
 * ("go el", not "gote").
 */
export const rank = <T>(items: readonly T[], name: (item: T) => string, query: string): Ranked<T>[] => {
  const needle = query.trim();
  if (needle === "") {
    return items.map((item) => ({ item, ranges: [] }));
  }
  const names = items.map(name);
  for (const matcher of [IN_ORDER, ONE_SLIP]) {
    const found = matcher.filter(names, needle);
    if (found !== null) {
      const info = matcher.info(found, names, needle);
      const order = (matcher.sort as Sort)(info, names, needle, keepOrder);
      if (order.length > 0) {
        return order.map((at) => ({
          item: nth(items, nth(info.idx, at)),
          ranges: pairs(nth(info.ranges, at)),
        }));
      }
    }
  }
  return [];
};
