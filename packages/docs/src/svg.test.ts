import { describe, expect, it } from "vitest";
import { arrow, box, boxHeight, escapeXml, family, svgDocument, text, wrap } from "./svg.js";

describe("svg", () => {
  it("escapes text for XML", () => {
    expect(escapeXml(`a<b>&"c"`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
  });

  it("gives each runner label its colour family", () => {
    expect(["ubuntu-24.04", "macos-14", "windows-2025", "self-hosted"].map(family)).toEqual([
      "u",
      "m",
      "w",
      "o",
    ]);
  });

  it("wraps at spaces and keeps a long word on its own line", () => {
    expect(wrap("aa bb cc averyveryverylongword d", 6)).toEqual([
      "aa bb",
      "cc",
      "averyveryverylongword",
      "d",
    ]);
  });

  it("draws boxes, text, arrows with and without a head, and a document that follows the colour scheme", () => {
    expect(text(1, 2, "x", "s", "middle")).toBe('<text class="s" x="1" y="2" text-anchor="middle">x</text>');
    expect(
      arrow(
        [
          [0, 0],
          [1, 1],
        ],
        "arr",
        false,
      ),
    ).toBe('<path class="arr" d="M0,0 L1,1"/>');
    expect(
      arrow([
        [0, 0],
        [1, 1],
      ]),
    ).toContain('marker-end="url(#ah)"');
    expect(box(0, 0, 10, boxHeight(1), "box", [])).toContain('<text class="n" x="10" y="19"></text>');
    expect(boxHeight(2)).toBe(46);
    const doc = svgDocument(10.2, 20, "A & B", ["<g/>"]);
    expect(doc).toContain('viewBox="0 0 11 20"');
    expect(doc).toContain('aria-label="A &amp; B"');
    expect(doc).toContain("prefers-color-scheme: dark");
  });
});
