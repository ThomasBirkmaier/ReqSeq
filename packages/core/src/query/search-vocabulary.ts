// The words of a MiniSearch object as one string, so that a query word can be found inside the
// words of the index (SR-221 AK1: word parts), which MiniSearch's term tree cannot do: it finds a
// word and the words it begins, never one inside a longer word. The string holds every word of the
// tree once, each between two `\0`; a query term is found with `indexOf` from match to match, and
// the word around a match is read back between the `\0`s (`partWords`). At N-036 the generated
// workspace has about 93,000 words (0.63 MB) and one scan takes less than a millisecond; walking the
// tree for it takes 90 to 210 ms, so it is built once per MiniSearch object and change
// (`SearchEngine.generation`) and carried over a change:
// - a build walks the tree at its end, in slices with a turn of the event loop between them
//   (`buildVocabulary`), as the build itself pauses;
// - an object loaded from the cache has none until its first search that looks for word parts
//   (`vocabularyOf`, which walks the tree at once);
// - a carry appends the words of the documents it adds that the tree does not hold yet, taken before
//   the old documents are removed (`newWords`, `carryVocabulary`). A word that leaves the tree stays
//   in the string; the tree has no data for it, so it finds nothing (`derivedTerms` of
//   `search-scoring.ts`), and when it comes back it is appended again, so a scan may give a word
//   twice (the caller takes each once). When the appended words outgrow the words of the walk, the
//   next walk replaces them (`carryVocabulary` returns false, and `prepareSearchIndex` of
//   `search-index.ts` or the next search walks the tree at once, `vocabularyOf`).
import type MiniSearch from "minisearch";

/** The words as one string, and how much of it the last walk of the tree gave. */
interface Vocabulary {
  readonly generation: number;
  /** `\0`, then every word followed by `\0`. */
  readonly text: string;
  /** The length of `text` after the walk; the rest was appended by carries. */
  readonly walked: number;
}

/** What the vocabulary reads of a MiniSearch 7.2.0 object (protected members, as `search-scoring.ts`). */
interface TreeInternals {
  readonly _index: { keys(): Iterable<string>; has(term: string): boolean };
  readonly _options: {
    readonly fields: readonly string[];
    readonly extractField: (document: unknown, field: string) => unknown;
    readonly tokenize: (text: string, field?: string) => string[];
    readonly processTerm: (term: string, field?: string) => string | null | undefined | false;
  };
}

// Internal by design, as in search-scoring.ts: the version of MiniSearch is pinned.
const internals = (mini: MiniSearch): TreeInternals => mini as unknown as TreeInternals;

const SEPARATOR = "\0";

const cache = new WeakMap<MiniSearch, Vocabulary>();

/** Words walked between two looks at the clock (`buildVocabulary`). */
const CHUNK = 2000;

/** The words of the tree of `mini`, walked in slices of `sliceMs` with `pause` between them. */
const walk = async (mini: MiniSearch, sliceMs: number, pause: () => Promise<void>): Promise<string> => {
  const words: string[] = [];
  let since = performance.now();
  let counted = 0;
  for (const word of internals(mini)._index.keys()) {
    words.push(word);
    counted += 1;
    if (counted >= CHUNK) {
      counted = 0;
      if (performance.now() - since >= sliceMs) {
        await pause();
        since = performance.now();
      }
    }
  }
  return `${SEPARATOR}${words.map((word) => `${word}${SEPARATOR}`).join("")}`;
};

/** The words of the tree of `mini`, walked at once. */
const walkNow = (mini: MiniSearch): string => {
  const words = Array.from(internals(mini)._index.keys(), (word) => `${word}${SEPARATOR}`);
  return `${SEPARATOR}${words.join("")}`;
};

/**
 * The vocabulary of `mini` as it is after `generation` changes, walked in slices of `sliceMs` with
 * `pause` between them (a build or a carry, which may throw from `pause` to stop); kept for the
 * next search. A change of `mini` during a pause is not seen: the caller builds it for an object
 * that does not change meanwhile.
 */
export const buildVocabulary = async (
  mini: MiniSearch,
  generation: number,
  sliceMs: number,
  pause: () => Promise<void>,
): Promise<void> => {
  const text = await walk(mini, sliceMs, pause);
  cache.set(mini, { generation, text, walked: text.length });
};

/** The vocabulary string of `mini` after `generation` changes: kept, else walked now. */
export const vocabularyOf = (mini: MiniSearch, generation: number): string => {
  const known = cache.get(mini);
  if (known?.generation === generation) {
    return known.text;
  }
  const text = walkNow(mini);
  cache.set(mini, { generation, text, walked: text.length });
  return text;
};

/**
 * The words of `documents` that the tree of `mini` does not hold, as the engine would index them
 * (its fields, `extractField`, tokenizer and term processing); taken before a carry changes `mini`.
 */
export const newWords = (mini: MiniSearch, documents: readonly unknown[]): string[] => {
  const { _index: tree, _options: options } = internals(mini);
  const found = new Set<string>();
  for (const document of documents) {
    for (const field of options.fields) {
      const value = options.extractField(document, field);
      if (typeof value !== "string") {
        continue;
      }
      for (const token of options.tokenize(value, field)) {
        const term = options.processTerm(token, field);
        if (typeof term === "string" && term !== "" && !tree.has(term)) {
          found.add(term);
        }
      }
    }
  }
  return [...found];
};

/**
 * The vocabulary of `mini` after its change `generation`, derived from the one of `generation - 1`
 * with `words` appended (`newWords`). False when there was none to derive it from, or when the
 * appended words outgrow the walked ones: then the next `vocabularyOf` walks the tree again.
 */
export const carryVocabulary = (mini: MiniSearch, generation: number, words: readonly string[]): boolean => {
  const known = cache.get(mini);
  if (known?.generation !== generation - 1) {
    return false;
  }
  const text = `${known.text}${words.map((word) => `${word}${SEPARATOR}`).join("")}`;
  if (text.length - known.walked > known.walked) {
    cache.delete(mini);
    return false;
  }
  cache.set(mini, { generation, text, walked: known.walked });
  return true;
};

/**
 * The words of `text` (a vocabulary string) that contain `term` after their first character, in
 * the order of the string; a word that begins with `term` is none (it is a word start). A word may
 * come twice (see the file comment).
 */
export const partWords = (text: string, term: string): string[] => {
  const out: string[] = [];
  for (let at = text.indexOf(term, 1); at >= 0;) {
    const start = text.lastIndexOf(SEPARATOR, at) + 1;
    const end = text.indexOf(SEPARATOR, at + term.length);
    if (at > start) {
      out.push(text.slice(start, end));
    }
    at = text.indexOf(term, end + 1);
  }
  return out;
};
