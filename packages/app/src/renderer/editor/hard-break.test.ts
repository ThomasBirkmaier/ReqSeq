import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown.js";

/** Every node of `doc` as `name from-to`, in document order. */
const tree = (doc: string, language: Extension): string[] => {
  const state = EditorState.create({ doc, extensions: [language] });
  const found: string[] = [];
  ensureSyntaxTree(state, doc.length, 1e9)?.iterate({
    enter: (node) => {
      found.push(`${node.name} ${String(node.from)}-${String(node.to)}`);
    },
  });
  return found;
};

const editor = markdownSupport({});
const lezer = markdown({ base: markdownLanguage, codeLanguages: [], addKeymap: false });

describe("hard line breaks (#1785)", () => {
  it("gives the same tree as @lezer/markdown for breaks, single spaces and runs of spaces", () => {
    const docs = [
      "a  \nb",
      "a \nb",
      "a     \nb",
      "a\\\nb",
      "a\\ b",
      "a   b  \nc  ",
      "  a  \n  b",
      "*a*  \n`b`   \nc",
      "- a  \n  b",
      "> a   \n> b",
      "a \t  \nb",
      "| a  |\n| - |\n| b   |",
    ];
    for (const doc of docs) {
      expect(tree(doc, editor), doc).toEqual(tree(doc, lezer));
    }
    expect(tree("a  \nb", editor)).toContain("HardBreak 1-4");
    expect(tree("a\\\nb", editor)).toContain("HardBreak 1-3");
  });

  it("parses a line with a long run of spaces in linear time", () => {
    const doc = `a${" ".repeat(200_000)}b\nc`;
    const start = performance.now();
    expect(tree(doc, editor).filter((node) => node.startsWith("HardBreak"))).toEqual([]);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
