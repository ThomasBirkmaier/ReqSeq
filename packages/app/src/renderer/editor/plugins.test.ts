import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { mergePlugins } from "./plugins.js";
import type { PreviewRule } from "./plugins.js";

describe("mergePlugins", () => {
  it("puts the lists of the plugins together in the given order, and takes plugins without a list", () => {
    const rule: PreviewRule = { nodes: ["Link"], decorate: () => [] };
    const extension = EditorView.editable.of(true);
    const merged = mergePlugins(
      { rules: [rule] },
      {},
      { extensions: [extension, extension] },
      { rules: [rule] },
    );
    expect(merged.rules).toEqual([rule, rule]);
    expect(merged.extensions).toEqual([extension, extension]);
    expect(merged.markdown).toEqual([]);
    expect(mergePlugins()).toEqual({ markdown: [], rules: [], extensions: [] });
  });
});
