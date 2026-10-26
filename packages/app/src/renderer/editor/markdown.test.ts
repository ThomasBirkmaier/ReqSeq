import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown.js";

const names = (extensions: ReturnType<typeof markdownSupport>[], doc: string): string[] => {
  const state = EditorState.create({ doc, extensions });
  const found: string[] = [];
  syntaxTree(state).iterate({ enter: (node) => void found.push(node.name) });
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
