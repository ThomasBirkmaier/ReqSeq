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
      "|      |        |      |
      | ---- | ------ | ---- |
      | tall | wide   |      |
      |      | listed | head |"
    `);
    expect(converted.losses).toEqual([
      { code: "xhtml-rowspan", reason: '<td rowspan="2">' },
      { code: "xhtml-colspan", reason: '<td colspan="2">' },
      { code: "xhtml-cell-block", reason: "<ul> in a table cell" },
      { code: "xhtml-cell-block", reason: "<h2> in a table cell" },
    ]);
  });

  it("[SR-095/AK1] flattens a cell at every depth: breaks as <br>, nested blocks as a loss", () => {
    const cell = (content: string): { markdown: string; losses: string[] } => {
      const converted = xhtmlToMarkdown(
        value(`<table><tr><th>h</th></tr><tr><td>${content}</td></tr><tr><td>after</td></tr></table>`),
      );
      return {
        markdown: converted.markdown.split("\n")[2] ?? "",
        losses: converted.losses.map(({ code, reason }) => `${code} ${reason}`),
      };
    };
    expect(cell("a<br/>b")).toEqual({ markdown: "| a<br>b |", losses: [] });
    expect(cell("<div><p>a</p><p>b</p></div>")).toEqual({ markdown: "| a<br>b |", losses: [] });
    expect(cell("<div><ul><li>a</li><li>b</li></ul></div>")).toEqual({
      markdown: "| a<br>b |",
      losses: ["xhtml-cell-block <ul> in a table cell"],
    });
    expect(cell("<span><h2>a</h2></span> b")).toEqual({
      markdown: "| a<br>b |",
      losses: ["xhtml-cell-block <h2> in a table cell"],
    });
    expect(cell("<pre>x\n\ny</pre>")).toEqual({
      markdown: "| x<br>y |",
      losses: ["xhtml-cell-block <pre> in a table cell"],
    });
    expect(cell("<p>a</p>\n  <strong>b\n c</strong><br/><br/>")).toEqual({
      markdown: "| a<br>**b c** |",
      losses: [],
    });
    expect(cell('<p>x</p><object data="i.png"/> <em> </em>y')).toEqual({
      markdown: "| x<br>![](i.png) y |",
      losses: [],
    });
    expect(
      xhtmlToMarkdown(value("<table><tr><td>a<br/>b</td></tr></table>")).markdown.split("\n"),
    ).toHaveLength(3);
  });

  it("joins runs of the same emphasis and drops emphasis of white space alone", () => {
    expect(markdown("<p><b>a</b><b>b</b> <em>c</em><i>d</i> x<em> </em>y <b><em>e</em></b></p>")).toBe(
      "**ab** *cd* x y **_e_**",
    );
  });

  it("writes a caption as a paragraph before its table", () => {
    expect(markdown("<table><caption>Cap <b>bold</b></caption><tr><th>h</th></tr></table>"))
      .toMatchInlineSnapshot(`
      "Cap **bold**

      | h |
      | - |"
    `);
    expect(codes("<table><caption>c</caption><tr><th>h</th></tr></table>")).toEqual([]);
  });

  it("writes line-through as strike-through; underline and colour stay losses", () => {
    const converted = xhtmlToMarkdown(
      value(
        '<p><span style="text-decoration:line-through">gone</span> <span style="text-decoration: line-through; color:red">red</span> <span style="">plain</span></p><table style="text-decoration:line-through"><tr><td>t</td></tr></table>',
      ),
    );
    expect(converted.markdown).toMatchInlineSnapshot(`
      "~~gone~~ ~~red~~ plain

      |   |
      | - |
      | t |"
    `);
    expect(converted.losses).toEqual([
      { code: "xhtml-style", reason: '<span style="text-decoration: line-through; color:red">' },
      { code: "xhtml-style", reason: '<table style="text-decoration:line-through">' },
    ]);
  });

  it("converts 200,000 siblings both ways without overflowing the stack", () => {
    // 100,000 lines are 200,000 siblings: text and break.
    const lines = 100_000;
    const imported = xhtmlToMarkdown(value(`<p>${"x<br/>".repeat(lines)}</p>`));
    expect(imported.markdown.split("\n")).toHaveLength(lines);
    const cell = xhtmlToMarkdown(value(`<table><tr><td>${"<p>x</p>".repeat(lines)}</td></tr></table>`));
    expect(cell.markdown.split("<br>")).toHaveLength(lines);
    const exportedLines = markdownToXhtml("x  \n".repeat(lines) + "x");
    expect(exportedLines.asWritten).toBe(false);
    expect(exportedLines.value.children[0]).toMatchObject({ name: "p", children: { length: 2 * lines + 1 } });
  }, 60_000);

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

  it("[SR-095/AK3] flattens blocks inside inline content to lines, keeps their text and lists them as losses (#580)", () => {
    const converted = xhtmlToMarkdown(
      value(
        "<p>a<ins>b<h1>H</h1>c<pre>P\nQ</pre>d<ul><li>L</li></ul>e<hr/>f<table><tr><td>T</td></tr></table>g<p>p</p></ins>z</p><div><strong>s<h2>S</h2></strong> <em>e<b>i<pre>E</pre></b></em></div>",
      ),
    );
    expect(converted.markdown).toBe(
      "ab\\\nH\\\nc\\\nP\\\nQ\\\nd\\\nL\\\ne\\\nf\\\nT\\\ng\\\np\\\nz\n\n**s\\\nS** *e**i\\\nE***",
    );
    expect(converted.losses).toEqual([
      { code: "xhtml-element", reason: "<h1> inside <p>" },
      { code: "xhtml-element", reason: "<pre> inside <p>" },
      { code: "xhtml-element", reason: "<ul> inside <p>" },
      { code: "xhtml-element", reason: "<hr> inside <p>" },
      { code: "xhtml-element", reason: "<table> inside <p>" },
      { code: "xhtml-element", reason: `<ins> in ${XHTML_NAMESPACE}` },
      { code: "xhtml-element", reason: "<h2> inside <strong>" },
      { code: "xhtml-element", reason: "<pre> inside <em>" },
    ]);
  });

  it("[SR-095/AK3] keeps a flattened heading in ATX form and a code span on one line (#580)", () => {
    const converted = xhtmlToMarkdown(
      value("<h1>a<ins><p>b</p></ins>c</h1><p><code>a<pre>b\nc</pre>d</code></p>"),
    );
    expect(converted.markdown).toBe("# a b c\n\n`a b c d`");
    expect(converted.losses).toEqual([
      { code: "xhtml-element", reason: `<ins> in ${XHTML_NAMESPACE}` },
      { code: "xhtml-element", reason: "<pre> inside <p>" },
    ]);
  });

  it("strikes each block of a struck div or a del at block level, without flattening or loss (#580)", () => {
    const struck = xhtmlToMarkdown(
      value(
        '<div style="text-decoration:line-through"><p>a</p><p>b</p></div><div><del><p>c</p><p>d</p></del></div><del><h1>H</h1></del>',
      ),
    );
    expect(struck.markdown).toBe("~~a~~\n\n~~b~~\n\n~~c~~\n\n~~d~~\n\n# ~~H~~");
    expect(struck.losses).toEqual([]);
  });

  it("lists the images of the text as written and keeps a non-image object's content", () => {
    const converted = xhtmlToMarkdown(
      value(
        '<p><object data="files/start.png" type="image/png">Start <b>now</b></object> <object data="img/plan.JPG"/> <img src="a.gif" alt="A"/> <img src="b"/> <img alt="no source"/> <img/> <object>none</object> <object data="" type="image/png">empty</object> <object data="doc.pdf" type="application/pdf">Doc</object> <object data="note.txt">Note</object></p>',
      ),
    );
    expect(converted.markdown).toMatchInlineSnapshot(
      `"![Start now](files/start.png) ![](img/plan.JPG) ![A](a.gif) ![](b) no source none empty Doc Note"`,
    );
    expect(converted.images).toEqual([
      { data: "files/start.png", type: "image/png" },
      { data: "img/plan.JPG", type: "image/jpeg" },
      { data: "a.gif", type: "image/gif" },
      { data: "b" },
    ]);
    expect(converted.losses).toEqual([
      { code: "xhtml-element", reason: "<img> without src" },
      { code: "xhtml-element", reason: "<object> without data" },
      { code: "xhtml-element", reason: '<object data="doc.pdf" type="application/pdf">' },
      { code: "xhtml-element", reason: '<object data="note.txt" type="undefined">' },
    ]);
  });

  it("keeps only the text of elements nested deeper than the Markdown libraries convert", () => {
    const depth = 20_000;
    let nested: XhtmlElement = {
      name: "div",
      namespace: XHTML_NAMESPACE,
      attributes: [],
      children: ["deep"],
    };
    for (let i = 0; i < depth; i++) {
      nested = { name: "div", namespace: XHTML_NAMESPACE, attributes: [], children: [nested] };
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
      "<div><h1>Start</h1><p>The system <strong>shall</strong> <em>start</em>, <del>slow</del>, <code>x</code> and <a href="https://example.org" title="Ex">here</a>.</p><ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul><ol><li>three</li></ol><blockquote><p>quoted</p></blockquote><pre><code>code
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
      "<div><table><tr><th align="left">Id</th><th align="right">Text</th></tr><tr><td align="left">1</td><td align="right">first<br></br>
      second</td></tr></table></div>"
    `);
  });

  it("keeps raw HTML as text, writes task boxes as text and footnotes as their content", () => {
    expect(
      exported(
        '- [ ] open\n- [x] done\n\n<span style="x">raw</span> and <b>inline</b>\n\nNote[^1] and[^Two][^3].\n\n[^1]: Footnote.\n\n[^Two]: > quoted\n\n[^3]:',
      ),
    ).toMatchInlineSnapshot(
      `"<div><ul><li>[ ] open</li><li>[x] done</li></ul><p><span style="x">raw</span> and <b>inline</b></p><p>Note[^1] and[^Two][^3].</p><p>[^1]: Footnote.</p><p>[^Two]: </p><blockquote><p>quoted</p></blockquote><p>[^3]: </p></div>"`,
    );
  });

  it("keeps inline raw HTML as text, in one run with the text around it", () => {
    const [paragraph] = markdownToXhtml("a <b>x</b>").value.children;
    expect(paragraph).toEqual({
      name: "p",
      namespace: XHTML_NAMESPACE,
      attributes: [],
      children: ["a <b>x</b>"],
    });
  });

  it("writes each run of text as one text node and no empty one, as a parser reads the file back (#579)", () => {
    const [paragraph, code] = markdownToXhtml("before\\\nafter  \nend\n\n```\n```").value.children;
    expect(paragraph).toMatchObject({
      children: ["before", { name: "br" }, "\nafter", { name: "br" }, "\nend"],
    });
    expect(code).toMatchObject({ name: "pre", children: [{ name: "code", children: [] }] });
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

  it("writes no attribute outside the driver modules: no start, class or id", () => {
    expect(exported("3. a\n4. b\n\n```js\nx\n```")).toMatchInlineSnapshot(`
      "<div><ol><li>a</li><li>b</li></ol><pre><code>x
      </code></pre></div>"
    `);
  });

  it("passes errors other than a stack overflow on", () => {
    const failing = (): string => {
      throw new Error("image copy failed");
    };
    expect(() => markdownToXhtml("![a](b.png)", { image: failing })).toThrow("image copy failed");
  });
});
