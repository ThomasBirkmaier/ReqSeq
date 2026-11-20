// The word-level difference of two wordings on an element page (SR-232 AK7): the old wording with each removed run of
// words in `<del>` and each added run in `<ins>`, the rest as written; every part escaped (SR-235). Words are the runs
// between white space, and white space is kept as written. The common start and end are cut off first; when the rest
// is too long to compare word by word (more than `LIMIT` pairs of words), it shows as removed and added as a whole, so
// the export stays fast for long texts (N-036).
import { escapeHtml } from "./markdown.js";

/** At most this many pairs of words are compared after the common start and end are cut off. */
export const LIMIT = 250_000;

const wordsOf = (text: string): string[] => text.split(/(\s+)/u).filter((part) => part !== "");

/**
 * The lengths of the longest common runs of words of `a` from `i` and `b` from `j`, at `i * (b.length + 1) + j`. Every
 * index read is in range, so `Number` only narrows the type.
 */
const commonLengths = (a: readonly string[], b: readonly string[]): Uint32Array => {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? Number(table[(i + 1) * width + j + 1]) + 1
          : Math.max(Number(table[(i + 1) * width + j]), Number(table[i * width + j + 1]));
    }
  }
  return table;
};

type Part = readonly ["same" | "removed" | "added", string];

/** The parts of the middle of the two wordings, word by word. */
const middleParts = (a: readonly string[], b: readonly string[]): Part[] => {
  if (a.length * b.length > LIMIT) {
    return [
      ["removed", a.join("")],
      ["added", b.join("")],
    ];
  }
  const table = commonLengths(a, b);
  const width = b.length + 1;
  const parts: Part[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      parts.push(["same", String(a[i])]);
      i += 1;
      j += 1;
    } else if (
      j >= b.length ||
      (i < a.length && Number(table[(i + 1) * width + j]) >= Number(table[i * width + j + 1]))
    ) {
      parts.push(["removed", String(a[i])]);
      i += 1;
    } else {
      parts.push(["added", String(b[j])]);
      j += 1;
    }
  }
  return parts;
};

/** The word-level difference of `before` and `after` as HTML (see the file comment). */
export const wordDiff = (before: string, after: string): string => {
  const a = wordsOf(before);
  const b = wordsOf(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end += 1;
  }
  const parts: Part[] = [
    ["same", a.slice(0, start).join("")],
    ...middleParts(a.slice(start, a.length - end), b.slice(start, b.length - end)),
    ["same", a.slice(a.length - end).join("")],
  ];
  // Each change makes one mark of its removed and one of its added words, the removed first.
  let html = "";
  let removed = "";
  let added = "";
  const flush = (): void => {
    html += removed === "" ? "" : `<del>${escapeHtml(removed)}</del>`;
    html += added === "" ? "" : `<ins>${escapeHtml(added)}</ins>`;
    removed = "";
    added = "";
  };
  for (const [kind, text] of parts) {
    if (kind === "removed") {
      removed += text;
    } else if (kind === "added") {
      added += text;
    } else {
      flush();
      html += escapeHtml(text);
    }
  }
  flush();
  return html;
};
