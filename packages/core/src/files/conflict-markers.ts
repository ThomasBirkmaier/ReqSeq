// Git conflict markers are detected before parsing (ADR-0007, SR-008 AK2).
// A conflict is the ordered sequence of a `<<<<<<<` line, a later `=======` line and a later
// `>>>>>>>` line. Single marker-like lines are ordinary Markdown: `=======` underlines a setext
// heading, `>>>>>>> x` is a nested blockquote. A fenced example of a whole conflict is still reported.
const START = /^<{7}(?: |$)/;
const SEPARATOR = /^={7}$/;
const END = /^>{7}(?: |$)/;

/** Line number (from 1, counted at `\n`) of the first conflict's start marker, or undefined. */
export const findConflictMarker = (text: string): number | undefined => {
  const lines = text.split("\n");
  let start: number | undefined;
  let separated = false;
  for (const [i, raw] of lines.entries()) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (START.test(line)) {
      // A new start before the separator begins the conflict anew; after it, it is part of it.
      if (!separated) {
        start = i + 1;
      }
    } else if (start !== undefined && SEPARATOR.test(line)) {
      separated = true;
    } else if (separated && END.test(line)) {
      return start;
    }
  }
  return undefined;
};
