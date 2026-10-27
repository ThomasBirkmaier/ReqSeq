import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown.js";

const names = (extensions: ReturnType<typeof markdownSupport>[], doc: string): string[] => {
  const state = EditorState.create({ doc, extensions });
  const found: string[] = [];
  // `syntaxTree` gives what the incremental parser has reached within its time budget, which a loaded machine
  // (coverage run, many workers) can cut short; `ensureSyntaxTree` parses the whole document (#460).
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000);
  if (tree === null) {
    throw new Error("the document was not parsed in time");
  }
  tree.iterate({ enter: (node) => void found.push(node.name) });
  return found;
};

describe("markdownSupport", () => {
  it("parses CommonMark with the GitHub extensions", () => {
    const found = names([markdownSupport({})], "| a |\n|---|\n| ~~b~~ |\n\n- [x] t");
    expect(found).toEqual(expect.arrayContaining(["Table", "Strikethrough", "Task", "TaskMarker"]));
  });

  it("takes parser extensions of plugins", () => {
    const plugin = { defineNodes: ["Formula"] };
    const state = EditorState.create({ doc: "x", extensions: [markdownSupport({ markdown: [plugin] })] });
    expect(syntaxTree(state).type.name).toBe("Document");
  });
});
