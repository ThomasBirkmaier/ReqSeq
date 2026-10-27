import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown.js";
import { valueLines } from "./value-lines.js";

const names = (doc: string): string[] => {
  const state = EditorState.create({ doc, extensions: [markdownSupport({ markdown: [valueLines] })] });
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000);
  if (tree === null) {
    throw new Error("the document was not parsed in time");
  }
  const found: string[] = [];
  tree.iterate({ enter: (node) => void found.push(node.name) });
  return found;
};

describe("valueLines", () => {
  it("[SR-127/AK1] makes every line a paragraph of its own, so a mark never pairs across two values", () => {
    expect(names("*a*\nb*")).toEqual([
      "Document",
      "Paragraph",
      "Emphasis",
      "EmphasisMark",
      "EmphasisMark",
      "Paragraph",
    ]);
    expect(names("**c\nd**").filter((name) => name === "StrongEmphasis")).toEqual([]);
    expect(names("a\nb\nc").filter((name) => name === "Paragraph")).toHaveLength(3);
  });

  it("[SR-127/AK1] leaves the block syntax of a text to the text: it is a paragraph in a value", () => {
    for (const value of [
      "# x",
      "- x",
      "1. x",
      "> x",
      "```",
      "    x",
      "---",
      "| a |\n|---|\n| b |",
      "x\n===",
    ]) {
      const found = names(value);
      expect(
        found.filter((name) => name !== "Document" && name !== "Paragraph"),
        value,
      ).toEqual([]);
    }
  });

  it("has no HTML block either: a tag is inline syntax, which the preview never interprets", () => {
    expect(names("<div>")).not.toContain("HTMLBlock");
    expect(names("[a]: http://x")).not.toContain("LinkReference");
    expect(names("- [x] t")).not.toContain("Task");
    expect(names("<!-- x -->")).not.toContain("CommentBlock");
  });

  it("keeps the inline syntax: emphasis, code, links and strikethrough", () => {
    expect(names("**b** `c` ~~d~~ [e](logreq:x)")).toEqual(
      expect.arrayContaining(["StrongEmphasis", "InlineCode", "Strikethrough", "Link"]),
    );
  });
});
