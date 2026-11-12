import { describe, expect, it } from "vitest";
import type { XhtmlNode } from "./pasted-markdown.js";
import { XHTML_NAMESPACE, pastedMarkdown } from "./pasted-markdown.js";

/** An element of the pasted tree, as the app builds it from the clipboard's HTML. */
const h = (name: string, attributes: Record<string, string> = {}, ...children: XhtmlNode[]): XhtmlNode => ({
  name,
  namespace: XHTML_NAMESPACE,
  attributes: Object.entries(attributes).flat(),
  children,
});

const md = (...nodes: XhtmlNode[]): string | undefined => pastedMarkdown(nodes)?.markdown;

describe("pastedMarkdown", () => {
  it("[SR-190/AK-wrfc] writes headings, emphasis, lists, links and tables as GFM, and nothing as HTML", () => {
    const markdown = md(
      h("h2", {}, "Wind"),
      h(
        "p",
        {},
        "Die ",
        h("strong", {}, "Böe"),
        " ist ",
        h("em", {}, "kurz"),
        " und ",
        h("del", {}, "alt"),
        ".",
      ),
      h("ul", {}, h("li", {}, "eins"), h("li", {}, "zwei", h("ol", { start: "3" }, h("li", {}, "drei")))),
      h("p", {}, h("a", { href: "https://example.org/a b" }, "Quelle")),
      h(
        "table",
        {},
        h("tr", {}, h("th", {}, "Größe"), h("th", {}, "Wert")),
        h("tr", {}, h("td", {}, h("p", {}, "Böe"), h("p", {}, "max")), h("td", {}, "25 | 30")),
      ),
      h("p", {}, h("img", { src: "https://example.org/w.png", alt: "Wind" })),
    );
    expect(markdown).toBe(
      [
        "## Wind",
        "",
        "Die **Böe** ist *kurz* und ~~alt~~.",
        "",
        "- eins",
        "- zwei",
        "",
        "  3. drei",
        "",
        "[Quelle](<https://example.org/a b>)",
        "",
        "| Größe   | Wert     |",
        "| ------- | -------- |",
        "| Böe max | 25 \\| 30 |",
        "",
        "![Wind](https://example.org/w.png)",
      ].join("\n"),
    );
    expect(markdown).not.toMatch(/<\/?[a-z][a-z0-9-]*[\s/>]/i);
  });

  it("reads Google Docs and Office styles, and Word's list paragraphs", () => {
    // Google Docs wraps the whole paste in a `b` of normal weight.
    expect(
      md(
        h(
          "b",
          { style: "font-weight:normal;", id: "docs-internal-guid-1" },
          h(
            "p",
            {},
            h("span", { style: "font-weight:700" }, "fett"),
            " ",
            h("span", { style: "font-style:italic" }, "schräg"),
          ),
        ),
      ),
    ).toBe("**fett** *schräg*");
    const marker = (text: string): XhtmlNode =>
      h("span", { style: "mso-list:Ignore" }, text, h("span", {}, "  "));
    expect(
      md(
        h(
          "p",
          { class: "MsoListParagraphCxSpFirst", style: "mso-list:l0 level1 lfo1" },
          marker("1."),
          "Erstens",
        ),
        h(
          "p",
          { class: "MsoListParagraphCxSpMiddle", style: "mso-list:l0 level2 lfo1" },
          marker("o"),
          "Unterpunkt",
        ),
        h(
          "p",
          { class: "MsoListParagraphCxSpLast", style: "mso-list:l0 level1 lfo1" },
          marker("2."),
          "Zweitens",
        ),
        "\n",
        h("p", {}, "Danach"),
      ),
    ).toBe("1. Erstens\n   - Unterpunkt\n2. Zweitens\n\nDanach");
    // A list that starts deeper, then goes back; Word's other styles.
    expect(
      md(
        h("p", { style: "mso-list:l1 level2 lfo2" }, marker("·"), "tief"),
        h("p", { style: "mso-list:l1 level1 lfo2" }, marker("·"), "oben"),
        h(
          "p",
          {},
          h("b", { style: "font-weight:400" }, "normal"),
          " ",
          h("span", { style: "font-weight:bold" }, "fett"),
        ),
        h(
          "p",
          {},
          h("span", { style: "text-decoration: line-through" }, "weg"),
          h("img", { alt: "ohne Quelle" }),
        ),
      ),
    ).toBe("- tief\n\n* oben\n\nnormal **fett**\n\n~~weg~~ohne Quelle");
  });

  it("keeps links and images it may show only, and counts the images it leaves out", () => {
    const result = pastedMarkdown([
      h(
        "p",
        {},
        h("a", { href: "javascript:alert(1)" }, "böse"),
        " ",
        h("a", { href: "mailto:a@example.org" }, "Mail"),
        " ",
        h("a", {}, "ohne"),
        h("img", { src: "data:image/png;base64,AAAA", alt: "Bild" }),
        h("img", { src: "file:///etc/x.png" }),
      ),
    ]);
    expect(result).toEqual({ markdown: "böse [Mail](mailto:a@example.org) ohneBild", droppedImages: 2 });
  });

  it("escapes what the editor would read as Markdown or a formula", () => {
    expect(md(h("p", {}, h("b", {}, "Preis"), " $5 und $6, *kein* [Link] # 1"))).toBe(
      "**Preis** \\$5 und \\$6, \\*kein\\* \\[Link] # 1",
    );
  });

  it("gives undefined for plain HTML and for styled code, which paste as plain text", () => {
    expect(md(h("div", {}, h("span", {}, "# Überschrift"), h("br"), "- Punkt"))).toBeUndefined();
    expect(
      md(
        h(
          "div",
          { style: "font-family: Menlo; white-space: pre;" },
          h("span", { style: "font-weight: bold" }, "# Titel"),
        ),
      ),
    ).toBeUndefined();
    expect(md(h("script", {}, "alert(1)"), h("style", {}, "b{}"), h("p", {}, h("b", {}, "x")))).toBe("**x**");
  });

  it("keeps only the text of elements nested too deep", () => {
    let node: XhtmlNode = h("b", {}, "tief");
    for (let i = 0; i < 300; i += 1) {
      node = h("span", {}, node);
    }
    expect(md(h("p", {}, h("i", {}, "flach")), node)).toBe("*flach*\n\ntief");
  });
});
