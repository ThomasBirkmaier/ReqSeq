import { describe, expect, it } from "vitest";
import { markdownLinks } from "./markdown-links.js";

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

  it("limits nested parentheses in a destination to 32 and ends a `<…>` destination at the next `<`", () => {
    const nested = (n: number): string => `[a](${"(".repeat(n)}x${")".repeat(n)})`;
    expect(found(nested(32))).toEqual([`${"(".repeat(32)}x${")".repeat(32)}`]);
    expect(found(nested(33))).toEqual([]);
    expect(found("[a](<b<c>) [d](<e\\>f>)")).toEqual(["e\\>f"]);
  });
});
