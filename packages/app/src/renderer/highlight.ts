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

/**
 * `text` without its words more than `keep` characters before the first range, cut at the start of a word
 * and led by "…", the ranges moved with it: a line too narrow for the whole text still shows its first
 * marked part. Only display: the text and the ranges are the ones given, nothing is matched again. As it is
 * when there is no range or nothing before it to cut.
 */
export const trimLead = (
  text: string,
  ranges: readonly (readonly [number, number])[],
  keep: number,
): { readonly text: string; readonly ranges: readonly (readonly [number, number])[] } => {
  const first = ranges[0]?.[0] ?? 0;
  if (first - keep <= 1) {
    return { text, ranges };
  }
  // The first word that begins within `keep` characters of the range, or the range itself.
  const space = text.indexOf(" ", first - keep - 1);
  const cut = space < 0 || space >= first ? first : space + 1;
  const shift = cut - 1;
  return { text: `…${text.slice(cut)}`, ranges: ranges.map(([start, end]) => [start - shift, end - shift]) };
};
