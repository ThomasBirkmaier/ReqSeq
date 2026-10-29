import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { describe, expect, it } from "vitest";
import { cell, codeBlock, inline, table } from "./markdown.js";

const html = (markdown: string): string =>
  micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });

describe("markdown", () => {
  it('keeps text like <ref> and {"status":null} as text, and code spans as code', () => {
    const text = 'Give <ref> as {"status":null}, *not* [this](x) or `a <b> | c`.';
    expect(html(inline(text))).toBe(
      "<p>Give &lt;ref&gt; as {&quot;status&quot;:null}, *not* [this](x) or <code>a &lt;b&gt; | c</code>.</p>",
    );
  });

  it("puts a text with line breaks and | into one table cell", () => {
    const rendered = html(table(["A", "B"], [[cell("one\ntwo | three"), cell("`x | y`")]]));
    expect(rendered).toContain("<td>one two | three</td>");
    expect(rendered).toContain("<td><code>x | y</code></td>");
  });

  it("fences code longer than any backtick run in it", () => {
    expect(codeBlock("a ``` b\n\n")).toBe("````text\na ``` b\n````");
    expect(codeBlock("plain", "json")).toBe("```json\nplain\n```");
  });
});
