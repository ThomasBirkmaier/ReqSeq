// The hard line break of the editor's Markdown (CommonMark: two or more spaces, or a backslash, before a line
// end). @lezer/markdown 1.8.0 scans the spaces after every space of a run, which takes quadratic time on a long
// run of spaces inside a line and froze the window for seconds (#1785). This parser replaces it by name and
// gives the same breaks: it scans a run only from its first space, since every later space of the run reaches
// the same character after it.
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

const NEWLINE = 10;
const SPACE = 32;
const BACKSLASH = 92;

const hardBreak = (cx: InlineContext, next: number, start: number): number => {
  if (next === BACKSLASH && cx.char(start + 1) === NEWLINE) {
    return cx.addElement(cx.elt("HardBreak", start, start + 2));
  }
  if (next !== SPACE || cx.char(start - 1) === SPACE) {
    return -1;
  }
  let end = start + 1;
  while (cx.char(end) === SPACE) {
    end++;
  }
  return cx.char(end) === NEWLINE && end >= start + 2
    ? cx.addElement(cx.elt("HardBreak", start, end + 1))
    : -1;
};

export const linearHardBreak: MarkdownConfig = {
  parseInline: [{ name: "HardBreak", parse: hardBreak }],
};
