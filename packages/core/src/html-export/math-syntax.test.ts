// The formula syntax of the HTML export (SR-231 AK5): the cases shared with the app's editor.
import { MATH_SYNTAX_CASES } from "@reqseq/testkit";
import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { describe, expect, it } from "vitest";
import type { MathNode } from "./math-syntax.js";
import { mathFromMarkdown, mathSyntax } from "./math-syntax.js";

/** The formula nodes of `text` in text order. */
const formulas = (text: string): { source: string; display: boolean }[] => {
  const tree = fromMarkdown(text, {
    extensions: [gfm(), mathSyntax()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  });
  const found: { source: string; display: boolean }[] = [];
  const stack: Nodes[] = [tree];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    const type = node.type as string;
    if (type === "inlineMath" || type === "math") {
      const math = node as unknown as MathNode;
      found.push({ source: math.value, display: math.display });
    }
    if ("children" in node) {
      stack.push(...[...node.children].reverse());
    }
  }
  return found;
};

describe("mathSyntax finds the formulas the app's editor finds (SR-231 AK5)", () => {
  for (const { name, text, formulas: expected } of MATH_SYNTAX_CASES) {
    it(`finds the formulas of ${name}`, () => {
      expect(formulas(text)).toEqual(expected);
    });
  }

  it("keeps a tab inside a formula and takes a block in a list item", () => {
    expect(formulas("$a\tb$")).toEqual([{ source: "a\tb", display: false }]);
    expect(formulas("- $$\n  x\n  $$")).toEqual([{ source: "x", display: true }]);
    expect(formulas("$$$a$$")).toEqual([{ source: "$a", display: true }]);
    expect(formulas("> $$\nx\n> $$")).toEqual([]);
    expect(formulas("$a\\\nb$")).toEqual([]);
  });
});
