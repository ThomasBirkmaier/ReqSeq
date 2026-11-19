// The safe rendering of texts in the HTML export (SR-235 AK4, AK5): what runs, loads or links outside
// the export is shown as text and reported; the writer keeps only its allowlist.
import { describe, expect, it } from "vitest";
import type { ImageLink } from "../model/index.js";
import type { ImageOutcome, TextContext } from "./markdown.js";
import { escapeHtml, mermaidRisk, renderMarkdown, writeHast } from "./markdown.js";
import { expectSafe } from "./safe-html.test-helper.js";

const context = (
  image: (link: ImageLink) => ImageOutcome = () => ({ src: "../images/x-0.png" }),
): TextContext => ({
  elementFile: "requirements/SR-1.md",
  ignored: () => false,
  image: (link) => Promise.resolve(image(link)),
});

const render = async (text: string, ctx = context()) => {
  const rendered = await renderMarkdown(text, ctx);
  expectSafe(rendered.html);
  return rendered;
};

describe("renderMarkdown (SR-235 AK4, AK5)", () => {
  it("[SR-235/AK-f3tk] shows raw HTML, other link schemes, network and data images and risky Mermaid as text and reports each", async () => {
    const text = [
      'Intro <img src=x onerror="alert(1)"> and <script>alert(2)</script>.',
      "",
      '<div onclick="alert(3)">block</div>',
      "",
      "[run](javascript:alert(4)) [file](file:///etc/passwd) <vbscript:x> [ok](https://example.org) [mail](mailto:a@b.c)",
      "",
      "![net](https://example.org/x.png) ![data](data:image/png;base64,AAAA) ![up](../../../etc/x.png)",
      "",
      "[ref]: javascript:alert(5)",
      "[go][ref]",
      "",
      "```mermaid",
      "flowchart LR",
      "  A --> B",
      '  click A "https://example.org"',
      "```",
    ].join("\n");
    const { html, findings } = await render(text);
    expect(html).toContain(
      "Intro &lt;img src=x onerror=&quot;alert(1)&quot;&gt; and &lt;script&gt;alert(2)&lt;/script&gt;.",
    );
    expect(html).toContain("&lt;div onclick=&quot;alert(3)&quot;&gt;block&lt;/div&gt;");
    expect(html).toContain("[run](javascript:alert(4)) [file](file:///etc/passwd) &lt;vbscript:x&gt;");
    expect(html).toContain('<a href="https://example.org" rel="noopener noreferrer">ok</a>');
    expect(html).toContain('<a href="mailto:a@b.c" rel="noopener noreferrer">mail</a>');
    expect(html).toContain(
      "![net](https://example.org/x.png) ![data](data:image/png;base64,AAAA) ![up](../../../etc/x.png)",
    );
    expect(html).toContain("[go][ref]");
    expect(html).toContain('<pre><code class="language-mermaid">flowchart LR');
    expect(findings.map((f) => [f.line, f.message])).toEqual([
      [1, "raw HTML is shown as text"],
      [1, "raw HTML is shown as text"],
      [1, "raw HTML is shown as text"],
      [3, "raw HTML is shown as text"],
      [5, "a link with the scheme javascript is shown as text"],
      [5, "a link with the scheme file is shown as text"],
      [5, "a link with the scheme vbscript is shown as text"],
      [7, "an image with an address in the network is shown as text"],
      [7, "an image with a data: address is shown as text"],
      [7, "an image with a path outside the element's repository is shown as text"],
      [10, "a link with the scheme javascript is shown as text"],
      [12, "a Mermaid diagram with a click action is shown as text"],
    ]);
    expect(new Set(findings.map((f) => f.code))).toEqual(new Set(["html.unsafe-content"]));
  });

  it("[SR-235/AK-t7cw] keeps an image that is not copied and a link to another file of the repository as text without a link", async () => {
    const { html, findings } = await render(
      "![missing](img/gone.png) and [spec](../docs/spec.pdf) and [anchor](#top) and [ref](reqseq:3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c)",
      context(() => ({ code: "html.image-not-copied", reason: "is not in the repository" })),
    );
    expect(html).toBe("<p>![missing](img/gone.png) and spec and anchor and ref</p>");
    expect(findings).toEqual([
      {
        code: "html.image-not-copied",
        message: "the image img/gone.png is not in the repository; it is shown as text",
        line: 1,
      },
    ]);
  });

  it("shows a copied image by its copy, once per file, and resolves link and image references", async () => {
    const seen: string[] = [];
    const { html } = await render(
      "![a](img/a.png) [![b][pic]](https://example.org)\n\n[pic]: img/a.png\n\n[site][s]\n\n[s]: https://example.org/s",
      context((link) => {
        seen.push(link.path);
        return { src: "../images/x-0.png" };
      }),
    );
    expect(html).toBe(
      '<p><img src="../images/x-0.png" alt="a"> <a href="https://example.org" rel="noopener noreferrer"><img src="../images/x-0.png" alt="b"></a></p>\n<p><a href="https://example.org/s" rel="noopener noreferrer">site</a></p>',
    );
    expect(seen).toEqual(["img/a.png", "img/a.png"]);
  });

  it("writes GFM tables, task lists, footnotes and strikethrough within the allowlist", async () => {
    const { html, findings } = await render(
      "| a | b |\n|:-|-:|\n| 1 | 2 |\n\n- [x] done\n- [ ] open\n\n3. three\n\n~~gone~~ note[^1]\n\n[^1]: The note.\n\n---\n\nline  \nbreak",
    );
    expect(findings).toEqual([]);
    expect(html).toContain('<th align="left">a</th>');
    expect(html).toContain('<td align="right">2</td>');
    expect(html).toContain('<input type="checkbox" disabled checked> done');
    expect(html).toContain('<input type="checkbox" disabled> open');
    expect(html).toContain('<ol start="3">');
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain(
      '<a id="user-content-fnref-1" data-footnote-ref aria-describedby="footnote-label" href="#user-content-fn-1">1</a>',
    );
    expect(html).toContain('<section class="footnotes" data-footnotes>');
    expect(html).toContain('aria-label="Back to reference 1"');
    expect(html).toContain("<hr>");
    expect(html).toContain("<br>");
  });

  it("shows a text nested too deeply for the Markdown libraries as written", async () => {
    const deep = `${"> ".repeat(20000)}x <b>`;
    const { html } = await render(deep);
    expect(html.startsWith("<pre>&gt; &gt; ")).toBe(true);
    expect(html.endsWith("x &lt;b&gt;</pre>")).toBe(true);
  });

  it("names the risk of a Mermaid diagram", () => {
    expect(mermaidRisk("flowchart LR\n  A --> B")).toBeUndefined();
    expect(mermaidRisk('classDiagram\n  callback A "f"')).toBe("a click action");
    expect(mermaidRisk('flowchart LR\n  A["<img src=x onerror=f()>"]')).toBe("an HTML label");
    expect(mermaidRisk('flowchart LR\n  A["#lt;b#gt;"]')).toBe("an HTML label");
    expect(mermaidRisk("%%{init: {'securityLevel':'loose'}}%%\nflowchart LR")).toBe("its own configuration");
    expect(mermaidRisk("---\nconfig:\n  htmlLabels: true\n---\nflowchart LR")).toBe("its own configuration");
    expect(escapeHtml('<a href="x">&')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
  });

  it("shows a link whose address holds a space or a control character as text", async () => {
    const { html, findings } = await render("[x](<java script:alert(1)>)");
    expect(html).toBe("<p>[x](&lt;java script:alert(1)&gt;)</p>");
    expect(findings.map((f) => f.message)).toEqual([
      "a link with a space or control character is shown as text",
    ]);
  });

  it("writes no element outside its list, no comment and no raw node, and keeps their text", () => {
    expect(
      writeHast(
        {
          type: "root",
          children: [
            {
              type: "element",
              tagName: "script",
              properties: {},
              children: [{ type: "text", value: "alert(1)" }],
            },
            { type: "comment", value: "c" },
            { type: "raw", value: "<b>raw</b>" },
            {
              type: "element",
              tagName: "a",
              properties: { href: "javascript:x", onClick: "y" },
              children: [{ type: "text", value: "x" }],
            },
            {
              type: "element",
              tagName: "img",
              properties: { src: "https://e.org/x.png", alt: "a" },
              children: [],
            },
            { type: "element", tagName: "input", properties: { type: "text" }, children: [] },
            { type: "element", tagName: "td", properties: { align: "middle" }, children: [] },
            { type: "element", tagName: "a", properties: {}, children: [] },
          ],
        },
        new Set(),
      ),
    ).toBe("alert(1)<a>x</a><img><input><td></td><a></a>");
  });

  it("passes on an error other than a too deeply nested text, keeps code blocks and unresolved references", async () => {
    await expect(
      renderMarkdown("![a](x.png)", { ...context(), image: () => Promise.reject(new Error("read failed")) }),
    ).rejects.toThrow("read failed");
    const { html, findings } = await render(
      "```\nplain\n```\n\n```js\nx\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n[go][nowhere] ![x][nothing]",
    );
    expect(findings).toEqual([]);
    expect(html).toContain("<pre><code>plain\n</code></pre>");
    expect(html).toContain('<pre><code class="language-mermaid">flowchart LR');
    expect(html).toContain("<p>[go][nowhere] ![x][nothing]</p>");
  });
});
