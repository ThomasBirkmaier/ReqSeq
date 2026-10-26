// Splits a text into parts for highlighting what matched. Only meaning, no colour: the marked parts are
// shown in a heavier weight.

export interface Part {
  readonly text: string;
  readonly mark: boolean;
}

/** `text` cut at the character ranges [start, end) (sorted, not overlapping). */
export const highlightRanges = (text: string, ranges: readonly (readonly [number, number])[]): Part[] => {
  const parts: Part[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) {
      parts.push({ text: text.slice(at, start), mark: false });
    }
    parts.push({ text: text.slice(start, end), mark: true });
    at = end;
  }
  if (at < text.length) {
    parts.push({ text: text.slice(at), mark: false });
  }
  return parts;
};

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char);

/**
 * `text` with the places marked where one of `terms` (lower case, as `element.search` gives them as
 * `terms`) begins a word of it, in any case.
 */
export const highlightTerms = (text: string, terms: readonly string[]): Part[] => {
  const lower = text.toLowerCase();
  const marked: [number, number][] = [];
  for (const term of terms) {
    for (let from = lower.indexOf(term); term !== "" && from >= 0; from = lower.indexOf(term, from + 1)) {
      if (!isWordChar(lower[from - 1])) {
        marked.push([from, from + term.length]);
      }
    }
  }
  marked.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const range of marked) {
    const last = merged.at(-1);
    if (last !== undefined && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  return highlightRanges(text, merged);
};
