// The criterion keys of an editor that holds the acceptance criteria one per line (SR-204 AK7, AK8, AK9):
// which line keeps which key after one edit. Pure, with no import but `criterion-items`, so the app's
// renderer runs the same rules (`@reqseq/core/criterion-lines`); the app sends every line with its key, and
// `element.update` keeps a key it is given (AK5). Also the generator of new keys (AK1), with the random
// source passed in: `crypto.randomInt` in core, Web Crypto in the renderer.
import { criterionKey, isCriterionKey } from "./criterion-items.js";

/** A random integer from 0 below `below`. */
export type RandomInt = (below: number) => number;

/** The first character of a generated criterion key: consonants, so a key reads as no word. */
const FIRST = "bcdfghjkmnpqrstvwxyz";
/** The other characters of a generated key. */
const REST = `${FIRST}0123456789`;
/** Characters of a generated key; 540,000 keys, drawn again against those `taken` holds (SR-204 AK1). */
const GENERATED_LENGTH = 4;

/** A new criterion key that `taken` does not hold: 4 characters, the first a consonant (SR-204 AK1). */
export const drawCriterionKey = (taken: ReadonlySet<string>, random: RandomInt): string => {
  for (;;) {
    let key = FIRST.charAt(random(FIRST.length));
    while (key.length < GENERATED_LENGTH) {
      key += REST.charAt(random(REST.length));
    }
    if (!taken.has(key)) {
      return key;
    }
  }
};

/** A line that holds no criterion: blank lines are dropped when the criteria are saved. */
export const isBlankLine = (line: string): boolean => line.trim() === "";

/**
 * The key of each stored item as a line of the editor starts with it: its key, or none for an item without
 * key, with a key in another form, or with a key an earlier item holds already (the rule of
 * `carriedCriteria`, so the earlier one keeps it, SR-204 AK1).
 */
export const lineKeysOf = (items: readonly unknown[]): (string | undefined)[] => {
  const seen = new Set<string>();
  return items.map((item) => {
    const key = criterionKey(item);
    if (key === undefined || !isCriterionKey(key) || seen.has(key)) {
      return undefined;
    }
    seen.add(key);
    return key;
  });
};

/** One change of an edit: the range `fromA` to `toA` of the old document, replaced by `insert`. */
export interface LineChange {
  readonly fromA: number;
  readonly toA: number;
  readonly insert: string;
}

/** The lines of a document (split at `\n`) and the key of each; undefined where a line has none. */
export interface KeyedLines {
  readonly lines: readonly string[];
  readonly keys: readonly (string | undefined)[];
}

interface Range {
  readonly from: number;
  readonly to: number;
}

/** The deleted ranges of `changes` (in order, not overlapping), adjacent ones joined. */
const deletedRanges = (changes: readonly LineChange[]): Range[] => {
  const ranges: Range[] = [];
  for (const { fromA, toA } of changes) {
    const last = ranges.at(-1);
    if (fromA === toA) {
      continue;
    }
    if (last?.to === fromA) {
      ranges[ranges.length - 1] = { from: last.from, to: toA };
    } else {
      ranges.push({ from: fromA, to: toA });
    }
  }
  return ranges;
};

/** The document `old` after `changes`. */
const applied = (old: string, changes: readonly LineChange[]): string => {
  let text = "";
  let at = 0;
  for (const { fromA, toA, insert } of changes) {
    text += old.slice(at, fromA) + insert;
    at = toA;
  }
  return text + old.slice(at);
};

/** Where `pos` of the old document is after `changes`: a position in or at the edges of a replaced range goes after its new text. */
const mapped = (pos: number, changes: readonly LineChange[]): number => {
  let delta = 0;
  for (const { fromA, toA, insert } of changes) {
    if (toA < pos) {
      delta += insert.length - (toA - fromA);
    } else if (fromA <= pos) {
      return fromA + delta + insert.length;
    } else {
      break;
    }
  }
  return pos + delta;
};

/** The start of each line of `lines`. */
const startsOf = (lines: readonly string[]): number[] => {
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  return starts;
};

/** The index of the line of `starts` (ascending, from 0) that holds `pos`: the last start at or before it. */
const lineAt = (starts: readonly number[], pos: number): number => {
  const after = starts.findIndex((start) => start > pos);
  return (after < 0 ? starts.length : after) - 1;
};

/** An old line: its text, start and key, and whether the edit deleted it whole. */
interface OldLine {
  readonly text: string;
  readonly start: number;
  readonly key: string | undefined;
  readonly deleted: boolean;
}

/**
 * The key of each line after one edit of the lines `before` (SR-204 AK7, AK8):
 *
 * 0. A blank line holds no key.
 * 1. The start of each old line goes where the edit puts it (after the new text of a range replaced at or
 *    around it). A new line takes the key of the first old line that is not blank, is not wholly deleted
 *    (its text and a line break next to it) and starts in it: a reworded line keeps its key, the first
 *    part of a split one too, and of two lines merged into one the front one; a line that is deleted
 *    whole gives its key to none. An old line without key that starts in it leaves it without one.
 * 2. In a `move` (a line moved up or down, or dragged within the editor), a new line that no old line
 *    starts in takes the key of a wholly deleted line with the same text, the first one not taken.
 * 3. Every other line gets `newKey()`: a new, pasted or dropped line, also one whose text equals that
 *    of an old criterion, and every line that had no key (AK8, AK1).
 *
 * `changes` are those of the edit against the old document `before.lines.join("\n")`, in order.
 */
export const carryLineKeys = (
  before: KeyedLines,
  changes: readonly LineChange[],
  move: boolean,
  newKey: () => string,
): (string | undefined)[] => {
  const lines = applied(before.lines.join("\n"), changes).split("\n");
  const starts = startsOf(lines);
  const deleted = deletedRanges(changes);
  const covered = (from: number, to: number): boolean => deleted.some((r) => r.from <= from && to <= r.to);
  const last = before.lines.length - 1;
  let next = 0;
  const olds = before.lines.map((text, i): OldLine => {
    const start = next;
    const end = start + text.length;
    next = end + 1;
    return {
      text,
      start,
      key: before.keys[i],
      deleted: (i > 0 && covered(start - 1, end)) || (i < last && covered(start, end + 1)),
    };
  });
  const keys = new Map<number, string | undefined>();
  for (const line of olds) {
    const at = lineAt(starts, mapped(line.start, changes));
    if (!line.deleted && !isBlankLine(line.text) && !keys.has(at)) {
      keys.set(at, line.key);
    }
  }
  if (move) {
    const free = olds.filter((line) => line.deleted && line.key !== undefined);
    lines.forEach((text, at) => {
      const found = keys.has(at) ? -1 : free.findIndex((line) => line.text === text);
      if (found >= 0) {
        keys.set(at, free[found]?.key);
        free.splice(found, 1);
      }
    });
  }
  return lines.map((line, at) => (isBlankLine(line) ? undefined : (keys.get(at) ?? newKey())));
};

/**
 * The value `element.update` sets for the criteria of `lines` with their `keys`: one entry per line that
 * is not blank, `{ key, text }`, or the text alone for a line without key (core then matches it by text, AK4).
 */
export const criterionEntries = (
  lines: readonly string[],
  keys: readonly (string | undefined)[],
): (string | { readonly key: string; readonly text: string })[] =>
  lines.flatMap((text, i) => {
    if (isBlankLine(text)) {
      return [];
    }
    const key = keys[i];
    return [key === undefined ? text : { key, text }];
  });
