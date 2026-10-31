import { describe, expect, it } from "vitest";
import type { XhtmlElement, XhtmlNode } from "./model.js";
import { XHTML_NAMESPACE } from "./model.js";
import { parseReqif } from "./parse.js";
import { markdownToXhtml, xhtmlToMarkdown } from "./xhtml-markdown.js";

/** The value of an `ATTRIBUTE-VALUE-XHTML` whose `THE-VALUE` is `markup` (default namespace XHTML). */
const value = (markup: string): readonly XhtmlNode[] => {
  const outcome = parseReqif(
    new TextEncoder().encode(
      `<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd"><THE-HEADER><REQ-IF-HEADER IDENTIFIER="h"/></THE-HEADER><CORE-CONTENT><REQ-IF-CONTENT><SPEC-OBJECTS><SPEC-OBJECT IDENTIFIER="o"><VALUES><ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>a</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE><div xmlns="http://www.w3.org/1999/xhtml">${markup}</div></THE-VALUE></ATTRIBUTE-VALUE-XHTML></VALUES><TYPE><SPEC-OBJECT-TYPE-REF>t</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT></SPEC-OBJECTS></REQ-IF-CONTENT></CORE-CONTENT></REQ-IF>`,
    ),
  );
  if (outcome.kind !== "parsed") {
    throw new Error(outcome.message);
  }
  const [found] = outcome.file.specObjects[0]?.values ?? [];
  if (found?.kind !== "xhtml") {
    throw new Error("no XHTML value");
  }
  return found.value;
};
const markdown = (markup: string): string => xhtmlToMarkdown(value(markup)).markdown;
const codes = (markup: string): string[] => xhtmlToMarkdown(value(markup)).losses.map(({ code }) => code);

/** An XHTML element written back as markup, to compare exports readably. */
const markup = (node: XhtmlNode): string => {
  if (typeof node === "string") {
    return node;
  }
  const attributes: string[] = [];
  for (let i = 0; i < node.attributes.length; i += 2) {
    attributes.push(` ${String(node.attributes[i])}="${String(node.attributes[i + 1])}"`);
  }
  return `<${node.name}${attributes.join("")}>${node.children.map(markup).join("")}</${node.name}>`;
};
const exported = (text: string, image?: (url: string) => string): string =>
  markup(markdownToXhtml(text, image === undefined ? {} : { image }).value);

describe("xhtmlToMarkdown", () => {
  it("[SR-095/AK1] writes headings, lists, emphasis and links in the editor's style", () => {
    expect(
      markdown(
        '<h1>Start</h1><h2>Scope</h2><h3>Detail</h3><p>The system <b>shall</b> <em>start</em>, <strong>fast</strong> <i>and</i> <del>slow</del> <s>late</s>; see <a href="https://example.org" title="Ex">here</a>.<br/>Next <code>x</code> <span>line</span>.</p><ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul><ol start="3"><li>three</li></ol><blockquote><p>quoted</p></blockquote><pre><code>code</code></pre><hr/>',
      ),
    ).toMatchInlineSnapshot(`
      "# Start

      ## Scope

      ### Detail

      The system **shall** *start*, **fast** *and* ~~slow~~ ~~late~~; see [here](https://example.org "Ex").\\
      Next \`x\` line.

      - one
        - nested
      - two

      3. three

      > quoted

      \`\`\`
      code
      \`\`\`

      ---"
    `);
  });

  it("[SR-095/AK1] writes a table as a GFM table and joins blocks in a cell with <br>", () => {
    expect(
      markdown(
        "<table><thead><tr><th>Id</th><th>Text</th></tr></thead><tbody><tr><td>1</td><td><p>first</p>\n<p>second <b>bold</b></p></td></tr><tr><td><div>a</div> <em>b</em> c</td><td>plain</td></tr></tbody></table>",
      ),
    ).toMatchInlineSnapshot(`
      "| Id         | Text                     |
      | ---------- | ------------------------ |
      | 1          | first<br>second **bold** |
      | a<br>*b* c | plain                    |"
    `);
    expect(xhtmlToMarkdown(value("<table><tr><td><p>a</p><p>b</p></td></tr></table>")).losses).toEqual([]);
  });

  it("[SR-095/AK1] simplifies spanned cells and blocks in cells, keeps their text and names the loss", () => {
    const converted = xhtmlToMarkdown(
      value(
        '<table><tr><td rowspan="2">tall</td><td colspan="2">wide</td></tr><tr><td colspan="1"><ul><li>listed</li></ul></td><td><h2>head</h2></td></tr></table>',
      ),
    );
    expect(converted.markdown).toMatchInlineSnapshot(`
      "|      |          |         |
      | ---- | -------- | ------- |
      | tall | wide     |         |
      |      | - listed | ## head |"
    `);
    expect(converted.losses).toEqual([
      { code: "xhtml-rowspan", reason: '<td rowspan="2">' },
      { code: "xhtml-colspan", reason: '<td colspan="2">' },
      { code: "xhtml-cell-block", reason: "<ul> in a table cell" },
      { code: "xhtml-cell-block", reason: "<h2> in a table cell" },
    ]);
  });

  it("[SR-095/AK3] lists a style and elements without Markdown counterpart as losses and keeps their text", () => {
    const converted = xhtmlToMarkdown(
      value(
        '<p>a <span style="color:red">red</span> <span style="color:red">again</span> <u>under</u> <sub>low</sub> <q xmlns="urn:other">foreign</q> <q xmlns="">bare</q></p>',
      ),
    );
    expect(converted.markdown).toBe("a red again under low foreign bare");
    expect(converted.losses).toEqual([
      { code: "xhtml-style", reason: '<span style="color:red">' },
      { code: "xhtml-element", reason: `<u> in ${XHTML_NAMESPACE}` },
      { code: "xhtml-element", reason: `<sub> in ${XHTML_NAMESPACE}` },
      { code: "xhtml-element", reason: "<q> in urn:other" },
      { code: "xhtml-element", reason: "<q> in no namespace" },
    ]);
    expect(codes('<p style="margin:0">x</p>')).toEqual(["xhtml-style"]);
  });

  it("lists the images of the text as written and keeps a non-image object's content", () => {
    const converted = xhtmlToMarkdown(
      value(
        '<p><object data="files/start.png" type="image/png">Start <b>now</b></object> <object data="img/plan.JPG"/> <img src="a.gif" alt="A"/> <img src="b"/> <object>none</object> <object data="doc.pdf" type="application/pdf">Doc</object> <object data="note.txt">Note</object></p>',
      ),
    );
    expect(converted.markdown).toMatchInlineSnapshot(
      `"![Start now](files/start.png) ![](img/plan.JPG) ![A](a.gif) ![](b) none Doc Note"`,
    );
    expect(converted.images).toEqual([
      { data: "files/start.png", type: "image/png" },
      { data: "img/plan.JPG", type: "image/jpeg" },
      { data: "a.gif", type: "image/gif" },
      { data: "b" },
    ]);
    expect(converted.losses).toEqual([
      { code: "xhtml-element", reason: '<object data="" type="undefined">' },
      { code: "xhtml-element", reason: '<object data="doc.pdf" type="application/pdf">' },
      { code: "xhtml-element", reason: '<object data="note.txt" type="undefined">' },
    ]);
  });

  it("keeps only the text of elements nested deeper than the Markdown libraries convert", () => {
    const depth = 20_000;
    let nested: XhtmlElement = {
      name: "span",
      namespace: XHTML_NAMESPACE,
      attributes: [],
      children: ["deep"],
    };
    for (let i = 0; i < depth; i++) {
      nested = { name: "span", namespace: XHTML_NAMESPACE, attributes: [], children: [nested] };
    }
    const converted = xhtmlToMarkdown([nested]);
    expect(converted.markdown).toBe("deep");
    expect(converted.losses).toEqual([{ code: "xhtml-element", reason: "elements nested deeper than 256" }]);
  });
});

describe("markdownToXhtml", () => {
  it("writes the text as one div of driver XHTML elements", () => {
    expect(
      exported(
        '# Start\n\nThe system **shall** *start*, ~~slow~~, `x` and [here](https://example.org "Ex").\n\n- one\n  - nested\n- two\n\n3. three\n\n> quoted\n\n```js\ncode\n```\n\n---\n\nline  \nbreak',
      ),
    ).toMatchInlineSnapshot(`
      "<div><h1>Start</h1><p>The system <strong>shall</strong> <em>start</em>, <del>slow</del>, <code>x</code> and <a href="https://example.org" title="Ex">here</a>.</p><ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul><ol start="3"><li>three</li></ol><blockquote><p>quoted</p></blockquote><pre><code class="language-js">code
      </code></pre><hr></hr><p>line<br></br>
      break</p></div>"
    `);
    const { value: div, asWritten } = markdownToXhtml("text");
    expect(div.name).toBe("div");
    expect(div.namespace).toBe(XHTML_NAMESPACE);
    expect(asWritten).toBe(false);
  });

  it("writes tables with alignment and <br> in a cell as a break", () => {
    expect(exported("| Id | Text |\n| :-- | --: |\n| 1 | first<br>second |")).toMatchInlineSnapshot(`
      "<div><table><thead><tr><th align="left">Id</th><th align="right">Text</th></tr></thead><tbody><tr><td align="left">1</td><td align="right">first<br></br>
      second</td></tr></tbody></table></div>"
    `);
  });

  it("keeps raw HTML as text, writes task boxes as text and footnotes as their content", () => {
    expect(
      exported(
        '- [ ] open\n- [x] done\n\n<span style="x">raw</span> and <b>inline</b>\n\nNote[^1].\n\n[^1]: Footnote.',
      ),
    ).toMatchInlineSnapshot(
      `"<div><ul class="contains-task-list"><li class="task-list-item">[ ] open</li><li class="task-list-item">[x] done</li></ul><p><span style="x">raw</span> and <b>inline</b></p><p>Note<sup><a href="#user-content-fn-1" id="user-content-fnref-1">1</a></sup>.</p><h2 class="sr-only" id="footnote-label">Footnotes</h2><ol><li id="user-content-fn-1"><p>Footnote. <a href="#user-content-fnref-1" class="data-footnote-backref">↩</a></p></li></ol></div>"`,
    );
  });

  it("keeps inline raw HTML as text nodes", () => {
    const [paragraph] = markdownToXhtml("a <b>x</b>").value.children;
    expect(paragraph).toEqual({
      name: "p",
      namespace: XHTML_NAMESPACE,
      attributes: [],
      children: ["a ", "<b>", "x", "</b>"],
    });
  });

  it("writes images as object with data and type, through the image option", () => {
    expect(exported("![Start](images/start.png) ![](plain)")).toMatchInlineSnapshot(
      `"<div><p><object data="images/start.png" type="image/png">Start</object> <object data="plain"></object></p></div>"`,
    );
    expect(exported("![Start](images/start.png)", (url) => `files/${url}`)).toMatchInlineSnapshot(
      `"<div><p><object data="files/images/start.png" type="image/png">Start</object></p></div>"`,
    );
  });

  it("keeps a text nested too deeply for the Markdown libraries as written, in one pre", () => {
    const text = `${">".repeat(20_000)} x`;
    const { value: div, asWritten } = markdownToXhtml(text);
    expect(asWritten).toBe(true);
    expect(markup(div)).toBe(`<div><pre>${text}</pre></div>`);
  });
});
