// The syntax of formulas (SR-096, #108) as an extension of the Markdown parser: the notation GitHub shows,
// which follows from CommonMark with GitHub extensions (SR-065 AK2, SR-129). The file keeps the Markdown as
// written; these nodes only tell the preview where a formula is.
//
// - `InlineMath`: `$…$` within a line. The opening `$` is followed by a character that is no white space,
//   the closing `$` follows one and is not followed by a digit (so "kostet $5 und $10" holds no formula);
//   `\$` is an escaped dollar, also inside the formula. `$$…$$` within a line is a formula in display style.
//   A formula does not span lines. Code, autolinks and link destinations are parsed before a `$` in them is
//   seen, so they hold no formula.
// - `BlockMath`: a line that is only `$$`, the lines of the formula, and a line that is only `$$`, without a
//   blank line between them (a blank line in a display formula is an error in TeX too). It is a formula only
//   once its closing line is there; until then the lines are an ordinary paragraph, so a lone `$$` never
//   turns the rest of the text into a formula. A line that starts another block (a list item, a heading,
//   a quote) ends it as it ends a paragraph. Its lines are not parsed as Markdown (`_` and `*` stay TeX).
// - Fenced code with the info string `math` is a formula too; that is a `FencedCode` node of CommonMark,
//   which `formula-preview.ts` recognises.
import type {
  BlockContext,
  InlineContext,
  LeafBlock,
  LeafBlockParser,
  Line,
  MarkdownConfig,
} from "@lezer/markdown";

const DOLLAR = 36;
const BACKSLASH = 92;
const NEWLINE = 10;

const isSpace = (code: number): boolean => code === 32 || code === 9 || code === NEWLINE || code === 13;
const isDigit = (code: number): boolean => code >= 48 && code <= 57;

/** The end of the formula that starts with the delimiter at `start` - `open`, or -1 when there is none. */
const closingAt = (char: (pos: number) => number, end: number, start: number, open: 1 | 2): number => {
  for (let at = start; at < end; at += 1) {
    const code = char(at);
    if (code === NEWLINE) {
      return -1;
    }
    if (code === BACKSLASH) {
      at += 1;
    } else if (code === DOLLAR) {
      if (open === 1) {
        // The first `$` ends it, or there is no formula: it must follow a character and not precede a digit.
        return isSpace(char(at - 1)) || isDigit(char(at + 1)) ? -1 : at;
      }
      if (char(at + 1) === DOLLAR) {
        return at;
      }
    }
  }
  return -1;
};

/** A line that is only `$$` (up to three spaces before it, any white space after it). */
const isMathFence = (line: Line, text: string): boolean =>
  line.indent - line.baseIndent < 4 && text.trim() === "$$";

/** The lines of a `$$` block after its first one, until the closing `$$` line ends it. */
class BlockMathParser implements LeafBlockParser {
  private readonly lines: [number, number][] = [];

  nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    const from = cx.lineStart + line.pos;
    const to = cx.lineStart + line.text.length;
    if (!isMathFence(line, line.text.slice(line.pos))) {
      this.lines.push([from, to]);
      return false;
    }
    // The quote marks of the closing line (those of the lines before it are the leaf's), read before the
    // line moves on.
    const markers = [...line.markers];
    cx.nextLine();
    cx.addLeafElement(
      leaf,
      cx.elt("BlockMath", leaf.start, to, [
        cx.elt("MathMark", leaf.start, leaf.start + 2),
        ...this.lines.map(([start, end]) => cx.elt("MathText", start, end)),
        ...markers,
        cx.elt("MathMark", from, from + 2),
      ]),
    );
    return true;
  }

  // Ended by a blank line or another block before its closing line: an ordinary paragraph.
  finish(): boolean {
    return false;
  }
}

export const mathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "InlineMath" },
    { name: "BlockMath", block: true },
    { name: "MathMark" },
    { name: "MathText" },
  ],
  parseInline: [
    {
      name: "InlineMath",
      parse: (cx: InlineContext, next: number, pos: number): number => {
        if (next !== DOLLAR) {
          return -1;
        }
        const open = cx.char(pos + 1) === DOLLAR ? 2 : 1;
        const start = pos + open;
        if (open === 1 && isSpace(cx.char(start))) {
          return -1;
        }
        const close = closingAt((at) => cx.char(at), cx.end, start, open);
        if (close < 0 || cx.slice(start, close).trim() === "") {
          return -1;
        }
        return cx.addElement(
          cx.elt("InlineMath", pos, close + open, [
            cx.elt("MathMark", pos, start),
            cx.elt("MathMark", close, close + open),
          ]),
        );
      },
    },
  ],
  parseBlock: [
    {
      name: "BlockMath",
      leaf: (_cx, leaf) => (leaf.content.trim() === "$$" ? new BlockMathParser() : null),
    },
  ],
};
