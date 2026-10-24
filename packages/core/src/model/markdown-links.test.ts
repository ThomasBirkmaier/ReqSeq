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
});
