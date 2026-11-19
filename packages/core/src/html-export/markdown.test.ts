// The safe rendering of texts in the HTML export (SR-235 AK4, AK5): what runs, loads or links outside
// the export is shown as text and reported; the writer keeps only its allowlist.
import { describe, expect, it } from "vitest";
import type { ImageLink } from "../model/index.js";
import type { ImageOutcome, TextContext } from "./markdown.js";
import { escapeHtml, madeToHast, mermaidRisk, renderMarkdown, writeHast } from "./markdown.js";
import { MAX_STATEMENTS } from "./render-options.js";
import { expectSafe } from "./safe-html.test-helper.js";

const context = (
  image: (link: ImageLink) => ImageOutcome = () => ({ src: "../images/x-0.png" }),
): TextContext => ({
  elementFile: "requirements/SR-1.md",
  ignored: () => false,
  image: (link) => Promise.resolve(image(link)),
  reference: () => ({ text: true }),
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
      "![net](https://example.org/x.png) ![data](data:image/png;base64,AAAA) ![up](../../../etc/x.png) ![drive](C:/pics/x.png)",
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
      "![net](https://example.org/x.png) ![data](data:image/png;base64,AAAA) ![up](../../../etc/x.png) ![drive](C:/pics/x.png)",
    );
    expect(html).toContain("[go][ref]");
    // A risky diagram stays code without its language, so the page script never draws it.
    expect(html).toContain("<pre><code>flowchart LR");
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
    const { html, findings } = await render(deep);
    expect(findings.map((f) => f.message)).toEqual([
      "the text is nested too deeply to be checked; it is shown as written",
    ]);
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
    await expect(
      renderMarkdown("![a](x.png)", {
        ...context(),
        image: () => Promise.reject(new RangeError("Invalid array length")),
      }),
    ).rejects.toThrow("Invalid array length");
    const { html, findings } = await render(
      "```\nplain\n```\n\n```js\nx\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n[go][nowhere] ![x][nothing]",
    );
    expect(findings).toEqual([]);
    expect(html).toContain("<pre><code>plain\n</code></pre>");
    expect(html).toContain(
      '<pre class="rq-diagram" data-rq-diagram><code class="language-mermaid">flowchart LR',
    );
    expect(html).toContain("<p>[go][nowhere] ![x][nothing]</p>");
  });

  it("shows a reference to no element as its text, a block formula error under its source and a too large diagram as its error", async () => {
    const big = `flowchart LR\n%% ${"x".repeat(50_001)}`;
    const { html, findings, formulas, diagrams } = await render(
      `[x](reqseq:D-031)\n\n$$\n\\frac{1\n$$\n\n\`\`\`mermaid\n${big}\n\`\`\``,
    );
    expect(html).toContain("<p>x</p>");
    expect(html).toContain('<pre><code>\\frac{1</code></pre><div class="rq-render-error">');
    expect(html).toContain("Diagram too large: ");
    const many = await render(`\`\`\`mermaid\nflowchart LR\n${"A --> B;".repeat(MAX_STATEMENTS)}\n\`\`\``);
    expect(many.html).toContain(`statements, at most ${String(MAX_STATEMENTS)}.`);
    expect([formulas, diagrams]).toEqual([false, false]);
    expect(findings.map((f) => f.code)).toEqual(["html.formula-error"]);
  });

  it("keeps a quote that is no callout, and a callout of only its marker or with more on its first line", async () => {
    const quote = async (text: string) => (await render(text)).html;
    expect(await quote("> - item")).toBe("<blockquote>\n<ul>\n<li>item</li>\n</ul>\n</blockquote>");
    expect(await quote("> **[!NOTE]**")).toContain("<blockquote>");
    expect(await quote("> [!NOTE]")).toMatch(
      /^<aside aria-label="Note" class="starlight-aside starlight-aside--note">/u,
    );
    // Only a first line that is the marker alone: more on its line keeps the quote; a hard break after it goes.
    expect(await quote("> [!NOTE] **bold** text")).toMatch(/^<blockquote>/u);
    const broken = await quote("> [!NOTE]  \n> after a hard break");
    expect(broken).toContain('<div class="starlight-aside__content"><p>after a hard break</p>');
    expect(broken).not.toContain("<br>");
    const mixed = await quote("> [!TIP]\n> **b** c");
    expect(mixed).toContain("starlight-aside--tip");
    expect(mixed).toContain("<strong>b</strong> c");
  });

  it("keeps a whole long formula line, and the formulas of an image's alt text as written", async () => {
    // A line longer than the arguments a call takes (a TeX comment, which KaTeX sets quickly).
    const long = await renderMarkdown(`# Head\n\n$$\n%${"x".repeat(150_000)}\n$$\n\nend`, context());
    expect(long.findings).toEqual([]);
    expect(long.formulas).toBe(true);
    expect(long.html).toMatch(/^<h1>Head<\/h1>\n<div class="rq-formula">/u);
    expect(long.html).toContain("<p>end</p>");
    const { html } = await renderMarkdown(
      "![cost $a$ and *$b$*](img.png) [link $c$](https://example.org)",
      context(),
    );
    expect(html).toContain('alt="cost $a$ and $b$"');
    expect(html).toContain(
      '<a href="https://example.org" rel="noopener noreferrer">link <span class="katex">',
    );
  });

  it("passes no node of an unknown type to the tree", () => {
    const handle = madeToHast(
      { raw: new WeakSet(), asides: new WeakMap() },
      { raw: new WeakSet(), elements: new WeakMap() },
    );
    expect(handle({} as never, { type: "rqRaw", value: "<b>" })).toBeUndefined();
    expect(handle({} as never, { type: "rqAside" })).toBeUndefined();
    expect(handle({} as never, { type: "other" })).toBeUndefined();
  });
});
