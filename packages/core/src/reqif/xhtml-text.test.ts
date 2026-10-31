// xhtmlText (src/reqif/xhtml-text.ts): the plain text of an XHTML value until SR-095 converts it.
import { describe, expect, it } from "vitest";
import type { XhtmlNode } from "./model.js";
import { xhtmlText } from "./xhtml-text.js";

const el = (name: string, ...children: XhtmlNode[]): XhtmlNode => ({
  name,
  namespace: "http://www.w3.org/1999/xhtml",
  attributes: [],
  children,
});

describe("xhtmlText", () => {
  it("keeps paragraphs and line breaks, collapses white space and names nothing for div, p and br", () => {
    expect(xhtmlText([el("div", el("p", "One\n   two"), el("p", "Three", el("br"), "  four  "))])).toEqual({
      text: "One two\n\nThree\nfour",
      unconverted: [],
    });
  });

  it("keeps the text of other elements, names each once and escapes Markdown characters", () => {
    expect(
      xhtmlText([
        el("p", "a ", el("b", "*b*"), " ", el("b", "c")),
        el("ul", el("li", "x_[y]"), el("li", "<z> `q` \\")),
      ]),
    ).toEqual({ text: "a \\*b\\* c\n\nx\\_\\[y\\]\n\n\\<z\\> \\`q\\` \\\\", unconverted: ["b", "ul", "li"] });
  });

  it("gives an empty text for an empty value", () => {
    expect(xhtmlText([])).toEqual({ text: "", unconverted: [] });
  });
});
