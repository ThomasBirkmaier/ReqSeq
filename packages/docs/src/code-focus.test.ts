import { describe, expect, it } from "vitest";
import type { HastNode } from "./code-focus.js";
import { addCodeTabStops, focusableCodeBlocks } from "./code-focus.js";

const block = (): HastNode => ({
  type: "element",
  tagName: "figure",
  properties: { className: ["frame"] },
  children: [
    { type: "element", tagName: "figcaption", children: [{ type: "text" }] },
    {
      type: "element",
      tagName: "pre",
      properties: { dataLanguage: "sh" },
      children: [{ type: "element", tagName: "code" }],
    },
    { type: "element", tagName: "pre" },
  ],
});

describe("tab stops of the docs site's code blocks (#2190)", () => {
  it("gives each pre of a rendered block tabindex 0 and keeps its other properties", () => {
    const ast = block();
    focusableCodeBlocks().hooks.postprocessRenderedBlock({ renderData: { blockAst: ast } });
    expect(ast.children?.[1]?.properties).toEqual({ dataLanguage: "sh", tabindex: "0" });
    expect(ast.children?.[2]?.properties).toEqual({ tabindex: "0" });
    expect(ast.properties).toEqual({ className: ["frame"] });
    expect(ast.children?.[1]?.children?.[0]?.properties).toBeUndefined();
  });

  it("counts the pre elements it changed", () => {
    expect(addCodeTabStops(block())).toBe(2);
    expect(addCodeTabStops({ type: "text" })).toBe(0);
  });
});
