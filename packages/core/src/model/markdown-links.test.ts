import { describe, expect, it } from "vitest";
import { markdownImages, markdownLinks, markdownLinksAndMentions } from "./markdown-links.js";

/** The destinations found, `!` in front of images. */
const found = (text: string): string[] =>
  markdownLinks(text).map((l) => `${l.image ? "!" : ""}${l.destination}`);

describe("Markdown links", () => {
  it("finds links and images with label, destination and its offsets", () => {
    const text = "See [a [b] \\] c](x/y.md) and ![img](p.png).\r\n";
    const links = markdownLinks(text);
    expect(links).toEqual([
      { image: false, label: "a [b] \\] c", destination: "x/y.md", start: 17, end: 23 },
      { image: true, label: "img", destination: "p.png", start: 36, end: 41 },
    ]);
    for (const link of links) {
      expect(text.slice(link.start, link.end)).toBe(link.destination);
    }
  });

  it("reads destinations in angle brackets, with parentheses, escapes and titles", () => {
    expect(
      found(
        [
          "[a](<with space.md>) [b](f(1).md) [c](a\\)b) [d](t.md \"T\") [e](t.md 'T') [f](t.md (T))",
          "![g](i.png) \\![h](j.md) [i]( k.md )",
        ].join("\n"),
      ),
    ).toEqual(["with space.md", "f(1).md", "a\\)b", "t.md", "t.md", "t.md", "!i.png", "j.md", "k.md"]);
  });

  it("finds no link where the syntax is incomplete or escaped", () => {
    expect(
      found(
        [
          "[open](<no close",
          "[label] (space) [unclosed label(x)",
          '[no paren](x "title" y) [end](x',
          "\\[escaped](x) `unmatched code [s](y.md)",
          "[t](u.md",
        ].join("\n"),
      ),
    ).toEqual(["y.md"]);
  });

  it("skips code spans, fenced and indented code, also in block quotes, but not list content", () => {
    const text = [
      "`[a](1)` ``[b](`2`)`` [c](3)",
      "```",
      "[d](4)",
      "```",
      "> ```",
      "> [e](5)",
      "> ```",
      "",
      "    [f](6)",
      "",
      "Paragraph",
      "    [g](7)",
      "",
      "- item",
      "",
      "    [h](8)",
      "1. next",
      "Lazy continuation of the item",
      "",
      "    [i](9)",
      "",
      "Plain text ends the list",
      "",
      "    [k](11)",
      "> [j](10)",
    ].join("\n");
    expect(found(text)).toEqual(["3", "7", "8", "9", "10"]);
  });

  it("does not nest links: a link in a label wins, images in a link label count, links in alt text do not", () => {
    expect(found("[a [b](x) c](y) [![i](a.png) d](z) ![alt [e](u)](img.png) [![j](b.png)](w)")).toEqual([
      "x",
      "!a.png",
      "z",
      "!img.png",
      "!b.png",
      "w",
    ]);
    const text = "[![i](a.png)](y)";
    for (const link of markdownLinks(text)) {
      expect(text.slice(link.start, link.end)).toBe(link.destination);
    }
  });

  it("lets code spans in a label take precedence over its brackets", () => {
    expect(markdownLinks("[a `]` b](x) [c `[d](e)` f](g) [h `i](j) k`")).toEqual([
      { image: false, label: "a `]` b", destination: "x", start: 10, end: 11 },
      { image: false, label: "c `[d](e)` f", destination: "g", start: 28, end: 29 },
    ]);
  });

  it("reads a destination as written, also with backticks, as CommonMark does", () => {
    // Read from left to right, the inner link closes first and takes its destination with the
    // backtick; that link makes the outer bracket text, and the next backtick opens the code span
    // `z](w) q`, so `(w)` is no destination.
    expect(found("[[a](x`y) `z](w) q`")).toEqual(["x`y"]);
    expect(found("[a](x`y) [b](c) `")).toEqual(["x`y", "c"]);
  });

  it("reads an escaped backslash before `!` as text, so the image stays one", () => {
    expect(found("\\\\![a](i.png) \\![b](j.md)")).toEqual(["!i.png", "j.md"]);
  });

  it("reads an indented line after an ATX heading as code, after other text as its continuation", () => {
    const text = ["# [a](1)", "    [b](2)", "## Heading", "    [c](3)", "#tag", "    [d](4)"].join("\n");
    expect(found(text)).toEqual(["1", "4"]);
  });

  it("does not recognise a fence indented by 4 or more spaces in a nested list item (known limitation)", () => {
    // CommonMark reads these lines as a fenced code block of the nested item; the scanner does not
    // track list indentation, so it reads them as list content and finds the link.
    const text = ["- item", "  - nested", "      ```", "      [a](1)", "      ```"].join("\n");
    expect(found(text)).toEqual(["1"]);
  });

  it("reads an indented line after a setext heading or a thematic break as code", () => {
    const text = [
      "Title [a](1)",
      "---",
      "    [b](2)",
      "Other",
      "===",
      "    [c](3)",
      "",
      "***",
      "    [d](4)",
      "===",
      "    [e](5)",
    ].join("\n");
    expect(found(text)).toEqual(["1", "5"]);
  });

  it("scans brackets nested 20,000 deep and long lines of unclosed brackets without recursion", () => {
    // A recursive scan overflows the stack here, and scanning each label again per level takes
    // exponential time; the scan takes milliseconds. The budget is generous so that a loaded
    // machine never fails it.
    const depth = 20_000;
    const started = performance.now();
    expect(found(`${"[".repeat(depth)}a${"](x)".repeat(depth)}`)).toEqual(["x"]);
    expect(found(`${"[".repeat(depth)}![i](p.png)${"](x)".repeat(depth)}`)).toEqual(["!p.png", "x"]);
    expect(found(`${"![".repeat(depth)}a${"](x)".repeat(depth)}`)).toEqual(["!x"]);
    expect(found(`${"[".repeat(depth)}a${"]".repeat(depth)}`)).toEqual([]);
    // About 100 KB of `[` that no `]` closes, of `(` and `<` that no `)` or `>` closes, and of
    // destinations that each run on to the end of the line.
    expect(found("[a".repeat(50_000))).toEqual([]);
    expect(found(`${"[a](<b".repeat(20_000)})`)).toEqual([]);
    expect(found(`${"[a](<b".repeat(20_000)}> x)`)).toEqual([]);
    expect(found("[a](".repeat(25_000))).toEqual([]);
    expect(found(`${"[a](b".repeat(20_000)} x)`)).toEqual([]);
    expect(found(`${"[a](b".repeat(20_000)})`)).toEqual(["b"]);
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it("allows quotes and parentheses in a title only when escaped (CommonMark)", () => {
    expect(
      found(
        [
          "[a](b \"c \\\" d\") [e](f 'g \\' h') [i](j (k \\( \\) l))",
          "[m](n (o (p)) [q](r)",
          "[](]( ((\\\\[a](s)) >]",
        ].join("\n"),
      ),
    ).toEqual(["b", "f", "j", "r", "s"]);
  });

  it("lets a backslash escape ASCII punctuation only, so it does not escape a space (CommonMark)", () => {
    expect(markdownLinks("[](\\ ) [a](b\\ c)")).toEqual([
      { image: false, label: "", destination: "\\", start: 3, end: 4 },
    ]);
    expect(found("[a](b\\(c) [d](e\\\\(f)) [g](h\\a)")).toEqual(["b\\(c", "e\\\\(f)", "h\\a"]);
  });

  it("finds no destination that ends with parentheses still open (CommonMark)", () => {
    expect(found('[](( ) [a](b( "t") [c](d(e) "t") [f](g(')).toEqual(["d(e)"]);
  });

  it("finds 200,000 links on one line", () => {
    const links = markdownLinks("[](x)".repeat(200_000));
    expect(links).toHaveLength(200_000);
    expect(links.at(-1)).toEqual({ image: false, label: "", destination: "x", start: 999_998, end: 999_999 });
  });

  it("reads 1 MB lines of failing titles and open parentheses in linear time (N-036)", () => {
    // A title that read past further `(` made the first line take 121 s before; the other lines guard
    // results and stay linear. Linear, all take milliseconds; the budget is generous for a loaded machine
    // and below the test timeout (30 s, vitest.config.ts).
    const started = performance.now();
    expect(found(`${"[a](x (".repeat(150_000)})`)).toEqual([]);
    expect(found(`${'[a](x "\\"'.repeat(100_000)}"`)).toEqual([]);
    expect(found(`${"[a](x '\\'".repeat(100_000)}'`)).toEqual([]);
    expect(found(`${"[a](x( ".repeat(150_000)})`)).toEqual([]);
    // Only the last one closes; a backslash before a space is text.
    expect(found(`${"[a](x\\ ".repeat(150_000)})`)).toEqual(["x\\"]);
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it("limits nested parentheses in a destination to 32 and ends a `<…>` destination at the next `<`", () => {
    const nested = (n: number): string => `[a](${"(".repeat(n)}x${")".repeat(n)})`;
    expect(found(nested(32))).toEqual([`${"(".repeat(32)}x${")".repeat(32)}`]);
    expect(found(nested(33))).toEqual([]);
    expect(found("[a](<b<c>) [d](<e\\>f>)")).toEqual(["e\\>f"]);
  });
});

describe("Markdown images", () => {
  it("reads lines that end with CR, CRLF or LF", () => {
    expect(markdownImages("![a][r]\r```\r![b](b.png)\r```\r\r[r]: r.png\r\n![c](c.png)\n")).toEqual([
      "c.png",
      "r.png",
    ]);
    const text = "x\r[a](1)";
    expect(markdownLinks(text)).toEqual([{ image: false, label: "a", destination: "1", start: 6, end: 7 }]);
  });

  it("finds inline images, then reference-style images whose label is defined", () => {
    const text = [
      "![a](inline.png) [link](not.png) ![full][Logo] ![collapsed][] ![shortcut] ![undefined][nope]",
      "",
      '[logo]: <logo file.svg> "Title"',
      "[collapsed]: c.png 'T'",
      " [SHORTCUT]: s.png (T)",
      "[link]: l.png",
    ].join("\n");
    expect(markdownImages(text)).toEqual(["inline.png", "logo file.svg", "c.png", "s.png"]);
  });

  it("matches labels ignoring case and white space; the first definition of a label wins", () => {
    const text = [
      "![x][ My   Label ] ![y][my label]",
      "",
      "[MY LABEL]: first.png",
      "[my label]: second.png",
    ].join("\n");
    expect(markdownImages(text)).toEqual(["first.png", "first.png"]);
  });

  it("reads a definition only on its own line, outside code and not inside a paragraph", () => {
    const text = [
      "![a] ![b] ![c] ![d] ![e] ![f]",
      "",
      "Paragraph text",
      "[a]: in-paragraph.png",
      "",
      "```",
      "[b]: in-code.png",
      "```",
      "",
      "    [c]: indented.png",
      "",
      "[d]: two words.png",
      "",
      '[e]: e.png "open title',
      "",
      "[]: empty-label.png",
      "",
      "[ ]: blank-label.png",
      "",
      "> [f]: quoted.png",
    ].join("\n");
    expect(markdownImages(text)).toEqual(["quoted.png"]);
  });

  it("finds no links on a definition line, and the links elsewhere as before", () => {
    const text = '[ref]: <a.png> "[b](c)"\n\n[d](e) ![f][ref]';
    expect(markdownLinks(text).map((l) => l.destination)).toEqual(["e"]);
    expect(markdownImages(text)).toEqual(["a.png"]);
  });

  it("drops reference images in the alt text of an inline image, and reads a label with escapes", () => {
    const text = [
      "![outer ![inner][r]](o.png) ![x][a\\]b] ![y][open [r]",
      "",
      "[r]: r.png",
      "[a\\]b]: ab.png",
    ].join("\n");
    // `[open` is not closed before the next `[`, so `![y]` is a shortcut, and `[r]` is no image.
    expect(markdownImages(text)).toEqual(["o.png", "ab.png"]);
  });

  it("reads a definition after a list item marker, also indented in a list, with balanced parentheses only", () => {
    const text = [
      "![a] ![b] ![c] ![d] ![e]",
      "",
      "- [a]: a(1).png",
      "1. [b]: b.png",
      "",
      "    [c]: c.png",
      "",
      "[d]: d(.png",
      "",
      "[e]: e).png",
      "",
      "[f]: f\\(.png",
      "",
      "![f]",
    ].join("\n");
    expect(markdownImages(text)).toEqual(["a(1).png", "b.png", "c.png", "f\\(.png"]);
  });

  it("reads the line after a definition as paragraph text, also when indented, so no definition follows it", () => {
    const text = ["[a]: a.png", "    ![b](b.png)", "[c]: c.png", "", "![a] ![c]"].join("\n");
    expect(markdownImages(text)).toEqual(["b.png", "a.png"]);
    expect(markdownImages(["[a]: a.png", "[c]: c.png", "", "![a] ![c]"].join("\n"))).toEqual([
      "a.png",
      "c.png",
    ]);
  });

  it("starts a new block at a list item marker or a new block quote marker, so a definition may follow text", () => {
    expect(markdownImages(["- foo", "- [x]: a.png", "", "![x]"].join("\n"))).toEqual(["a.png"]);
    expect(markdownImages(["foo", "> [x]: a.png", "", "![x]"].join("\n"))).toEqual(["a.png"]);
    // A lazy continuation keeps the quote: the next quoted line still continues the paragraph.
    expect(markdownImages(["> foo", "bar", "> [x]: a.png", "", "![x]"].join("\n"))).toEqual([]);
    expect(markdownImages(["> foo", "> [x]: a.png", "", "![x]"].join("\n"))).toEqual([]);
    // A list item after a quoted paragraph is no lazy continuation: the quote starts anew.
    expect(markdownImages(["> foo", "- bar", "> [x]: a.png", "", "![x]"].join("\n"))).toEqual(["a.png"]);
  });

  it("ends a list at an unindented line that does not continue paragraph text, so an indented line after it is code", () => {
    expect(markdownImages(["- a", "", "---", "    ![d](d.png)"].join("\n"))).toEqual([]);
    expect(markdownImages(["- a", "```", "```", "    ![e](e.png)"].join("\n"))).toEqual([]);
    expect(markdownImages(["- a", "", "[x]: x.png", "", "    ![f](f.png)"].join("\n"))).toEqual([]);
    expect(markdownImages(["- a", "# h", "    ![g](g.png)"].join("\n"))).toEqual([]);
    // Lazy paragraph text keeps the list open.
    expect(markdownImages(["- a", "b", "    ![h](h.png)"].join("\n"))).toEqual(["h.png"]);
  });

  it("reads a fence after a list item marker as code, and no backtick fence with a backtick in its info string", () => {
    expect(markdownImages(["- ```", "  ![a](a.png)", "  ```", "![b](b.png)"].join("\n"))).toEqual(["b.png"]);
    expect(markdownImages(["``` a`b", "![c](c.png)", "~~~ a`b", "![d](d.png)", "~~~"].join("\n"))).toEqual([
      "c.png",
    ]);
  });

  it("takes only `[]` as collapsed: `[ ]` and a label over 999 characters leave the image a shortcut", () => {
    const long = "y".repeat(1000);
    const text = [`![x][ ] ![x][${long}] ![z][]`, "", "[x]: x.png", "[z]: z.png", `[${long}]: long.png`].join(
      "\n",
    );
    expect(markdownImages(text)).toEqual(["x.png", "x.png", "z.png"]);
  });

  it("finds no reference image in code spans or code blocks", () => {
    expect(markdownImages("`![a][r]`\n\n    ![b][r]\n\n[r]: r.png")).toEqual([]);
  });
});

describe("mentions of a word in inline text (#633)", () => {
  it("gives where the word stands outside code spans, code blocks, link destinations and definitions, in the same pass as the links", () => {
    const text = [
      "w:a and [w:b label](w:c) and `w:d` and <w:e>",
      "```",
      "w:f",
      "```",
      "",
      "    w:g",
      "",
      "[ref]: w:h",
      "> quoted w:i ![w:j alt](w:k)",
      "no word here",
    ].join("\n");
    const { links, mentions } = markdownLinksAndMentions(text, "w:");
    expect(links.map((l) => l.destination)).toEqual(["w:c", "w:k"]);
    expect(mentions.map((at) => text.slice(at, at + 3))).toEqual(["w:a", "w:b", "w:e", "w:i", "w:j"]);
    expect(markdownLinksAndMentions("plain", "w:").mentions).toEqual([]);
  });
});
