import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown.js";
import { mathSyntax } from "./math-syntax.js";

/** The math nodes of `doc` as `name text`, in document order. */
const nodes = (doc: string): string[] => {
  const state = EditorState.create({ doc, extensions: [markdownSupport({ markdown: [mathSyntax] })] });
  const tree = ensureSyntaxTree(state, doc.length, 1e9);
  const found: string[] = [];
  tree?.iterate({
    enter: (node) => {
      if (["InlineMath", "BlockMath", "MathMark", "MathText"].includes(node.name)) {
        found.push(`${node.name} ${doc.slice(node.from, node.to)}`);
      }
    },
  });
  return found;
};

const inline = (doc: string): string[] =>
  nodes(doc)
    .filter((node) => node.startsWith("InlineMath "))
    .map((node) => node.slice("InlineMath ".length));

describe("inline formulas", () => {
  it("finds `$…$` with its marks, and `$$…$$` within a line", () => {
    expect(nodes("Energie $E = mc^2$ hier")).toEqual(["InlineMath $E = mc^2$", "MathMark $", "MathMark $"]);
    expect(nodes("Summe $$\\sum_i x_i$$.")).toEqual([
      "InlineMath $$\\sum_i x_i$$",
      "MathMark $$",
      "MathMark $$",
    ]);
    expect(inline("$a$ und $b$")).toEqual(["$a$", "$b$"]);
    expect(inline("$$a $ b$$")).toEqual(["$$a $ b$$"]);
  });

  it("follows the dollar rule: no space inside the delimiters, no digit after the closing one", () => {
    expect(inline("kostet $5 und $10")).toEqual([]);
    expect(inline("$ a$")).toEqual([]);
    expect(inline("$a $")).toEqual([]);
    expect(inline("$a$5")).toEqual([]);
    expect(inline("$a $b$")).toEqual(["$b$"]);
    expect(inline("$$  $$")).toEqual([]);
    expect(inline("only $")).toEqual([]);
  });

  it("takes `\\$` as an escaped dollar, also inside a formula, and does not span lines", () => {
    expect(inline("\\$a$")).toEqual([]);
    expect(inline("$a\\$b$")).toEqual(["$a\\$b$"]);
    expect(inline("$a\\$")).toEqual([]);
    expect(inline("$a\nb$")).toEqual([]);
    expect(inline("$$a\nb$$")).toEqual([]);
  });

  it("finds none in code, autolinks or link destinations", () => {
    expect(inline("`$a$` and <https://x.org/$a$> and [t](https://x.org/$a$)")).toEqual([]);
    expect(inline("[$a$](https://x.org)")).toEqual(["$a$"]);
  });
});

describe("block formulas", () => {
  it("are the lines between two `$$` lines, without Markdown inside", () => {
    expect(nodes("Text\n\n$$\na_1 * b_2 * c\n\\frac{1}{2}\n$$\n\nMehr")).toEqual([
      "BlockMath $$\na_1 * b_2 * c\n\\frac{1}{2}\n$$",
      "MathMark $$",
      "MathText a_1 * b_2 * c",
      "MathText \\frac{1}{2}",
      "MathMark $$",
    ]);
  });

  it("allows indentation up to three spaces and trailing white space on the `$$` lines", () => {
    expect(nodes("  $$  \nx\n   $$ ")[0]).toBe("BlockMath $$  \nx\n   $$ ");
    expect(nodes("$$\nx\n    $$")).toEqual([]);
  });

  it("holds an empty formula between two `$$` lines", () => {
    expect(nodes("$$\n$$")).toEqual(["BlockMath $$\n$$", "MathMark $$", "MathMark $$"]);
  });

  it("is no formula until its closing line is there: a lone `$$` stays a paragraph", () => {
    expect(nodes("$$\nx = 1\n\nNoch ein Absatz\n\n$$")).toEqual([]);
    expect(nodes("$$\nx = 1")).toEqual([]);
    expect(nodes("$$\nx\n# Heading\n$$")).toEqual([]);
  });

  it("ends at its closing line: what follows is a paragraph of its own", () => {
    const found = nodes("$$\nx\n$$\n$a$");
    expect(found[0]).toBe("BlockMath $$\nx\n$$");
    expect(found).toContain("InlineMath $a$");
  });

  it("is found in a quote, its lines without the quote marks", () => {
    expect(nodes("> $$\n> x\n> $$")).toEqual([
      "BlockMath $$\n> x\n> $$",
      "MathMark $$",
      "MathText x",
      "MathMark $$",
    ]);
  });

  it("needs a line that is only `$$`: `$$x$$` on one line is an inline formula", () => {
    expect(nodes("$$x$$")[0]).toBe("InlineMath $$x$$");
    expect(nodes("$$ x\ny\n$$").filter((node) => node.startsWith("BlockMath"))).toEqual([]);
  });
});
