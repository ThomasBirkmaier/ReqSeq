// The formulas of Markdown texts (SR-096, SR-231 AK5): one case table that runs against the parser of the app's
// editor (`packages/app/src/renderer/editor/math-syntax.ts`) and the one of the HTML export
// (`packages/core/src/html-export/math-syntax.ts`), so both find the same formulas.

/** One formula: its TeX source as written between its delimiters, and whether it is set in display style. */
export interface FoundFormula {
  readonly source: string;
  readonly display: boolean;
}

export interface MathSyntaxCase {
  readonly name: string;
  readonly text: string;
  /** The formulas of `text` in text order. */
  readonly formulas: readonly FoundFormula[];
}

const inline = (source: string): FoundFormula => ({ source, display: false });
const display = (source: string): FoundFormula => ({ source, display: true });

export const MATH_SYNTAX_CASES: readonly MathSyntaxCase[] = [
  { name: "an inline formula", text: "Energy $E = mc^2$ here", formulas: [inline("E = mc^2")] },
  { name: "`$$…$$` within a line", text: "Sum $$\\sum_i x_i$$.", formulas: [display("\\sum_i x_i")] },
  { name: "two formulas in a line", text: "$a$ and $b$", formulas: [inline("a"), inline("b")] },
  { name: "a single `$` within `$$…$$`", text: "$$a $ b$$", formulas: [display("a $ b")] },
  { name: "amounts of money", text: "costs $5 and $10", formulas: [] },
  { name: "a space after the opening `$`", text: "$ a$", formulas: [] },
  { name: "a space before the closing `$`", text: "$a $", formulas: [] },
  { name: "a digit after the closing `$`", text: "$a$5", formulas: [] },
  { name: "a formula after a failed one", text: "$a $b$", formulas: [inline("b")] },
  { name: "an empty `$$…$$`", text: "$$  $$", formulas: [] },
  { name: "a lone `$`", text: "only $", formulas: [] },
  { name: "an escaped opening `$`", text: "\\$a$", formulas: [] },
  { name: "an escaped `$` inside", text: "$a\\$b$", formulas: [inline("a\\$b")] },
  { name: "an escaped closing `$`", text: "$a\\$", formulas: [] },
  { name: "a formula across lines", text: "$a\nb$", formulas: [] },
  { name: "a display formula across lines", text: "$$a\nb$$", formulas: [] },
  { name: "Markdown characters inside", text: "$a_1 * b_2 * c$", formulas: [inline("a_1 * b_2 * c")] },
  {
    name: "code, autolinks and link destinations",
    text: "`$a$` and <https://x.org/$a$> and [t](https://x.org/$a$)",
    formulas: [],
  },
  { name: "a formula in a link text", text: "[$a$](https://x.org)", formulas: [inline("a")] },
  {
    name: "a block between two `$$` lines",
    text: "Text\n\n$$\na_1 * b_2 * c\n\\frac{1}{2}\n$$\n\nMore",
    formulas: [display("a_1 * b_2 * c\n\\frac{1}{2}")],
  },
  { name: "an empty block", text: "$$\n$$", formulas: [display("")] },
  { name: "a block without its closing line", text: "$$\nx = 1", formulas: [] },
  { name: "a block with a blank line", text: "$$\nx = 1\n\nAnother paragraph\n\n$$", formulas: [] },
  { name: "a block that a heading ends", text: "$$\nx\n# Heading\n$$", formulas: [] },
  {
    name: "a block and a formula after it",
    text: "$$\nx\n$$\n$a$",
    formulas: [display("x"), inline("a")],
  },
  { name: "a block in a quote", text: "> $$\n> x\n> $$", formulas: [display("x")] },
  { name: "`$$x$$` on one line", text: "$$x$$", formulas: [display("x")] },
  { name: "a block whose first line holds more", text: "$$ x\ny\n$$", formulas: [] },
  { name: "a block after a paragraph line", text: "Text\n$$\nx\n$$", formulas: [] },
];
