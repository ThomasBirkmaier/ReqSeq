// @vitest-environment happy-dom
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Tooltip } from "@codemirror/view";
import { showTooltip } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import {
  FORMULA_RULES,
  FormulaErrorWidget,
  FormulaWidget,
  formulaAtCaret,
  formulaTooltip,
} from "./formula-preview.js";
import { markdownSupport } from "./markdown.js";
import { mathSyntax } from "./math-syntax.js";
import { BUILT_IN_RULES, focusEffect, focusState, previewDecorations } from "./preview.js";

// The page of the app has a doctype; happy-dom's test document has none, and KaTeX refuses quirks mode.
vi.hoisted(() => {
  Object.defineProperty(document, "compatMode", { value: "CSS1Compat", configurable: true });
});

const RULES = [...BUILT_IN_RULES, ...FORMULA_RULES];

const stateOf = (doc: string, cursor?: number, to?: number, focused = cursor !== undefined): EditorState => {
  const state = EditorState.create({
    doc,
    ...(cursor === undefined ? {} : { selection: { anchor: cursor, head: to ?? cursor } }),
    extensions: [markdownSupport({ markdown: [mathSyntax] }), focusState, formulaTooltip],
  });
  ensureSyntaxTree(state, doc.length, 1e9);
  return state.update({ effects: focusEffect.of(focused) }).state;
};

interface Deco {
  readonly from: number;
  readonly to: number;
  readonly kind: string;
}

/** The decorations of `doc` as `kind` names: a line class, a formula widget (inline, block, below), an error. */
const decorate = (doc: string, cursor?: number, to?: number): Deco[] => {
  const state = stateOf(doc, cursor, to);
  const found: Deco[] = [];
  previewDecorations(state, RULES, cursor !== undefined).between(0, doc.length, (from, end, value) => {
    const spec = value.spec as { class?: string; widget?: unknown; block?: boolean };
    if (spec.widget instanceof FormulaWidget) {
      const where = spec.widget.block ? (from === end ? "below" : "block") : "inline";
      found.push({ from, to: end, kind: `formula-${where}` });
    } else if (spec.widget instanceof FormulaErrorWidget) {
      found.push({ from, to: end, kind: "error" });
    } else {
      found.push({ from, to: end, kind: spec.class ?? "hide" });
    }
  });
  return found;
};

const kinds = (found: readonly Deco[]): string[] => found.map((deco) => deco.kind);

describe("inline formulas in the preview", () => {
  const doc = "Energie $E = mc^2$ hier";

  it("are set in place of their source off the cursor line", () => {
    expect(decorate(doc)).toEqual([{ from: 8, to: 18, kind: "formula-inline" }]);
  });

  it("show their source on the cursor line", () => {
    expect(decorate(doc, 2)).toEqual([]);
    expect(decorate(doc, 10)).toEqual([]);
  });

  it("with a syntax error keep their source and show the error after it, also on the cursor line", () => {
    const broken = "Bruch $\\frac{1}{$ hier";
    expect(decorate(broken)).toEqual([{ from: 17, to: 17, kind: "error" }]);
    expect(decorate(broken, 1)).toEqual([{ from: 17, to: 17, kind: "error" }]);
  });

  it("with a syntax error and the caret inside leave the error to the tooltip", () => {
    expect(decorate("Bruch $\\frac{1}{$ hier", 10)).toEqual([]);
  });
});

describe("block formulas in the preview", () => {
  const doc = "Text\n\n$$\n\\frac{1}{2}\n$$\n\nMehr";
  const [from, to] = [6, 23];

  it("are set as a block in place of their lines while the cursor is not in them", () => {
    expect(decorate(doc)).toEqual([{ from, to, kind: "formula-block" }]);
    expect(decorate(doc, 0)).toEqual([{ from, to, kind: "formula-block" }]);
  });

  it("show their source as code with the set formula below while the cursor is in them (A1)", () => {
    expect(decorate(doc, 12)).toEqual([
      { from: 6, to: 6, kind: "cm-lr-codeblock" },
      { from: 9, to: 9, kind: "cm-lr-codeblock" },
      { from: 21, to: 21, kind: "cm-lr-codeblock" },
      { from: 23, to: 23, kind: "formula-below" },
    ]);
  });

  it("with a syntax error keep their source and show the error below, with or without the cursor (AK3)", () => {
    const broken = "$$\n\\frac{1}{\n$$";
    const expected = [
      { from: 0, to: 0, kind: "cm-lr-codeblock" },
      { from: 3, to: 3, kind: "cm-lr-codeblock" },
      { from: 13, to: 13, kind: "cm-lr-codeblock" },
      { from: 15, to: 15, kind: "formula-below" },
    ];
    expect(decorate(broken)).toEqual(expected);
    expect(decorate(broken, 5)).toEqual(expected);
  });

  it("without content show their source as code only", () => {
    expect(kinds(decorate("$$\n$$"))).toEqual(["cm-lr-codeblock", "cm-lr-codeblock"]);
  });

  it("in a quote keep their source, with the set formula below", () => {
    expect(kinds(decorate("> $$\n> x\n> $$"))).toEqual([
      "cm-lr-quote",
      "cm-lr-codeblock",
      "hide",
      "cm-lr-quote",
      "cm-lr-codeblock",
      "hide",
      "cm-lr-quote",
      "cm-lr-codeblock",
      "hide",
      "formula-below",
    ]);
  });
});

describe("fenced math blocks in the preview", () => {
  const doc = "```math\nx^2\n```";

  it("are set as a block alone, without the code block rule, while the cursor is not in them", () => {
    expect(decorate(doc)).toEqual([{ from: 0, to: 15, kind: "formula-block" }]);
  });

  it("are a code block with the set formula below while the cursor is in them", () => {
    // The built-in rule draws the code block: the fence lines off the cursor line are thin.
    expect(kinds(decorate(doc, 9))).toEqual([
      "cm-lr-codeblock",
      "cm-lr-fence",
      "cm-lr-fence-hidden",
      "hide",
      "cm-lr-codeblock",
      "cm-lr-codeblock",
      "cm-lr-fence",
      "cm-lr-fence-hidden",
      "hide",
      "formula-below",
    ]);
  });

  it("with the info string in any case and more words after it", () => {
    expect(kinds(decorate("```Math title\nx\n```"))).toEqual(["formula-block"]);
  });

  it("stay code blocks when they are empty or of another language", () => {
    expect(kinds(decorate("```math\n```"))).not.toContain("formula-block");
    expect(kinds(decorate("```ts\nx\n```"))).not.toContain("formula-block");
    expect(kinds(decorate("```\nx\n```"))).not.toContain("formula-below");
  });

  it("read their source without the quote marks", () => {
    const state = stateOf("> ```math\n> a\n> b\n> ```");
    const found: string[] = [];
    previewDecorations(state, RULES, false).between(0, state.doc.length, (_from, _to, value) => {
      const widget = (value.spec as { widget?: unknown }).widget;
      if (widget instanceof FormulaWidget) {
        found.push(widget.source);
      }
    });
    expect(found).toEqual(["a\nb"]);
  });
});

describe("FormulaWidget", () => {
  it("draws the set formula within the line or as a block", () => {
    const inline = new FormulaWidget("x^2", false, false).toDOM();
    expect(inline.tagName).toBe("SPAN");
    expect(inline.className).toBe("cm-lr-formula");
    expect(inline.querySelector(".katex")).not.toBeNull();
    const block = new FormulaWidget("x^2", true, true).toDOM();
    expect(block.tagName).toBe("DIV");
    expect(block.className).toBe("cm-lr-formula-block");
    expect(block.querySelector(".katex-display")).not.toBeNull();
  });

  it("is equal to a widget of the same formula, and lets a click reach the editor", () => {
    const widget = new FormulaWidget("x", false, false);
    expect(widget.eq(new FormulaWidget("x", false, false))).toBe(true);
    expect(widget.eq(new FormulaWidget("y", false, false))).toBe(false);
    expect(widget.eq(new FormulaWidget("x", true, false))).toBe(false);
    expect(widget.eq(new FormulaWidget("x", false, true))).toBe(false);
    expect(widget.ignoreEvent()).toBe(false);
  });
});

describe("FormulaErrorWidget", () => {
  it("draws the message as text within the line and is equal to one with the same message", () => {
    const widget = new FormulaErrorWidget("KaTeX parse error: x");
    expect(widget.toDOM().textContent).toBe("Error KaTeX parse error: x");
    expect(widget.eq(new FormulaErrorWidget("KaTeX parse error: x"))).toBe(true);
    expect(widget.eq(new FormulaErrorWidget("other"))).toBe(false);
  });
});

describe("the formula at the caret", () => {
  const doc = "a $x^2$ b $$y$$";

  it("is the `$…$` the caret of the focused editor is in, from after its first character to its end", () => {
    expect(formulaAtCaret(stateOf(doc, 3))).toEqual({ from: 2, to: 7, source: "x^2", display: false });
    expect(formulaAtCaret(stateOf(doc, 7))?.source).toBe("x^2");
    expect(formulaAtCaret(stateOf(doc, 13))).toEqual({ from: 10, to: 15, source: "y", display: true });
    expect(formulaAtCaret(stateOf(doc, 2))).toBeUndefined();
    expect(formulaAtCaret(stateOf(doc, 0))).toBeUndefined();
  });

  it("is none without the focus or with a selection", () => {
    expect(formulaAtCaret(stateOf(doc, 3, undefined, false))).toBeUndefined();
    expect(formulaAtCaret(stateOf(doc, 3, 5))).toBeUndefined();
  });
});

describe("formulaTooltip", () => {
  const tooltips = (state: EditorState): readonly (Tooltip | null)[] => state.facet(showTooltip);

  it("shows the set formula under its source while the caret is inside, nothing otherwise", () => {
    expect(tooltips(stateOf("a $x$ b", 0)).filter(Boolean)).toEqual([]);
    const [tooltip] = tooltips(stateOf("a $x^2$ b", 4)).filter((entry) => entry !== null);
    expect(tooltip?.pos).toBe(2);
    expect(tooltip?.above).toBe(false);
    const view = tooltip?.create({} as never);
    expect(view?.dom.className).toBe("cm-lr-formula-tooltip");
    expect(view?.dom.getAttribute("aria-hidden")).toBe("true");
    expect(view?.dom.querySelector(".katex")).not.toBeNull();
  });

  it("shows the error while the formula has one", () => {
    const [tooltip] = tooltips(stateOf("a $\\frac{1}$ b", 5)).filter((entry) => entry !== null);
    expect(tooltip?.create({} as never).dom.textContent).toMatch(/^Error KaTeX parse error/);
  });

  it("keeps its tooltip while the caret moves in the same formula, and follows the typing", () => {
    const state = stateOf("a $x^2$ b", 4);
    const [first] = tooltips(state);
    const moved = state.update({ selection: { anchor: 5 } }).state;
    expect(tooltips(moved)[0]).toBe(first);
    const typed = moved.update({ changes: { from: 5, insert: "3" }, selection: { anchor: 6 } }).state;
    expect(tooltips(typed)[0]).not.toBe(first);
    const left = typed.update({ selection: { anchor: 0 } }).state;
    expect(tooltips(left).filter(Boolean)).toEqual([]);
  });

  it("is created with the state for an editor that starts with the caret in a formula", () => {
    const state = EditorState.create({
      doc: "a $x$",
      selection: { anchor: 4 },
      extensions: [markdownSupport({ markdown: [mathSyntax] }), focusState, formulaTooltip],
    });
    // Not focused at its creation: no tooltip.
    expect(tooltips(state).filter(Boolean)).toEqual([]);
    const focused = EditorState.create({
      doc: "a $x$",
      selection: { anchor: 4 },
      extensions: [markdownSupport({ markdown: [mathSyntax] }), focusState.init(() => true), formulaTooltip],
    });
    expect(tooltips(focused).filter(Boolean)).toHaveLength(1);
  });
});
