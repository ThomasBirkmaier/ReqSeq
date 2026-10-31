// xhtmlText and markdownText (src/reqif/xhtml-text.ts): the plain text of an XHTML value, and a
// value escaped for a Markdown target.
import { describe, expect, it } from "vitest";
import type { XhtmlNode } from "./model.js";
import { markdownText, xhtmlText } from "./xhtml-text.js";

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

  it("keeps the text of other elements and names each once", () => {
    const nodes = [el("p", "a ", el("b", "*b*"), " ", el("b", "snake_case")), el("ul", el("li", "1. x"))];
    expect(xhtmlText(nodes)).toEqual({
      text: "a *b* snake_case\n\n1. x",
      unconverted: ["b", "ul", "li"],
    });
  });

  it("gives an empty text for an empty value", () => {
    expect(xhtmlText([])).toEqual({ text: "", unconverted: [] });
  });
});

describe("markdownText", () => {
  it("escapes what would make Markdown, inline and at a line start, so the text renders as written", () => {
    expect(markdownText("*Measure* the [wind] <b> `q` \\ &copy; a|b ~x~")).toBe(
      "\\*Measure\\* the \\[wind\\] \\<b\\> \\`q\\` \\\\ \\&copy; a\\|b \\~x\\~",
    );
    expect(markdownText("# H\n- item\n+ item\n===\n12) step\nplain 1. not")).toBe(
      "\\# H\n\\- item\n\\+ item\n\\===\n12\\) step\nplain 1. not",
    );
  });
});
