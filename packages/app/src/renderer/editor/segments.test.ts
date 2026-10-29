import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown.js";
import { inlineSegments } from "./segments.js";

const segments = (doc: string, from = 0, to = doc.length) => {
  const state = EditorState.create({ doc, extensions: [markdownSupport({})] });
  // `ensureSyntaxTree` parses to the end; the empty update hands that tree to the state, which kept the one of
  // its first parse (cut short after 20 ms on a busy machine, #542).
  ensureSyntaxTree(state, doc.length, 1e9);
  return inlineSegments(state.update({}).state, from, to);
};

describe("inlineSegments", () => {
  it("gives plain text as one piece without classes", () => {
    expect(segments("plain text")).toEqual([{ text: "plain text", classes: [] }]);
    expect(segments("")).toEqual([]);
  });

  it("drops the marks and carries the classes of the enclosing nodes", () => {
    expect(segments("a *b* **c** ~~d~~ `e`")).toEqual([
      { text: "a ", classes: [] },
      { text: "b", classes: ["cm-lr-em"] },
      { text: " ", classes: [] },
      { text: "c", classes: ["cm-lr-strong"] },
      { text: " ", classes: [] },
      { text: "d", classes: ["cm-lr-strike"] },
      { text: " ", classes: [] },
      { text: "e", classes: ["cm-lr-code"] },
    ]);
  });

  it("nests classes and shows the text of a link without its destination", () => {
    expect(segments("**a *b***")).toEqual([
      { text: "a ", classes: ["cm-lr-strong"] },
      { text: "b", classes: ["cm-lr-strong", "cm-lr-em"] },
    ]);
    expect(segments('[text](reqseq:x "t") end')).toEqual([
      { text: "text", classes: ["cm-lr-link"] },
      { text: " end", classes: [] },
    ]);
  });

  it("works on a range inside the document, also where a node reaches out of it", () => {
    expect(segments("xx *a* yy", 3, 6)).toEqual([{ text: "a", classes: ["cm-lr-em"] }]);
    expect(segments("*abc*", 1, 3)).toEqual([{ text: "ab", classes: ["cm-lr-em"] }]);
  });
});
