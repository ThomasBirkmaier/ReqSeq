import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, StateEffect } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown.js";
import type { PreviewRule } from "./plugins.js";
import {
  BUILT_IN_RULES,
  alignments,
  focusEffect,
  focusState,
  livePreview,
  previewDecorations,
  sourceLines,
} from "./preview.js";
import { GlyphWidget, TableWidget } from "./widgets.js";

interface Deco {
  readonly from: number;
  readonly to: number;
  readonly kind: "line" | "mark" | "hide" | "glyph" | "table";
  readonly name?: string;
}

const stateOf = (doc: string, cursor?: number, to?: number): EditorState => {
  const state = EditorState.create({
    doc,
    ...(cursor === undefined ? {} : { selection: { anchor: cursor, head: to ?? cursor } }),
    extensions: [markdownSupport({}), focusState],
  });
  // `ensureSyntaxTree` parses to the end, but the state keeps the tree it was created with (the first parse
  // stops after 20 ms on a busy machine); the empty update hands the whole tree to the state (#542).
  ensureSyntaxTree(state, doc.length, 1e9);
  return state.update({}).state;
};

const describeSet = (set: DecorationSet, length: number): Deco[] => {
  const found: Deco[] = [];
  set.between(0, length, (from, to, value) => {
    const spec = value.spec as { class?: string; widget?: unknown; block?: boolean };
    if (spec.widget instanceof GlyphWidget) {
      found.push({ from, to, kind: "glyph", name: spec.widget.glyph });
    } else if (spec.widget instanceof TableWidget) {
      found.push({ from, to, kind: "table" });
    } else if (spec.class === undefined) {
      found.push({ from, to, kind: "hide" });
    } else {
      found.push({ from, to, kind: to === from ? "line" : "mark", name: spec.class });
    }
  });
  return found;
};

/** The decorations of `doc`, unfocused, or focused with the cursor (or selection) at `cursor`. */
const decorate = (
  doc: string,
  cursor?: number,
  to?: number,
  rules: readonly PreviewRule[] = BUILT_IN_RULES,
) => {
  const state = stateOf(doc, cursor, to);
  return describeSet(previewDecorations(state, rules, cursor !== undefined), doc.length);
};

const hidden = (found: Deco[]): [number, number][] =>
  found.filter((d) => d.kind === "hide").map((d) => [d.from, d.to]);
const named = (found: Deco[], name: string): Deco[] => found.filter((d) => d.name === name);

describe("sourceLines", () => {
  it("is empty without the focus and holds every line a selection range touches with it", () => {
    const state = stateOf("a\nb\nc\nd", 0, 3);
    expect([...sourceLines(state, false)]).toEqual([]);
    expect([...sourceLines(state, true)]).toEqual([1, 2]);
  });
});

describe("headings", () => {
  it("sets the size on the line always and hides the mark and its space off the cursor line", () => {
    const doc = "# One\n\n## Two";
    const off = decorate(doc);
    expect(named(off, "cm-lr-h1")).toEqual([{ from: 0, to: 0, kind: "line", name: "cm-lr-h1" }]);
    expect(named(off, "cm-lr-h2")).toHaveLength(1);
    expect(hidden(off)).toEqual([
      [0, 2],
      [7, 10],
    ]);
    const on = decorate(doc, 3);
    expect(named(on, "cm-lr-h1")).toHaveLength(1);
    expect(hidden(on)).toEqual([[7, 10]]);
  });

  it("hides the closing sequence with the space before it", () => {
    expect(hidden(decorate("# Title ##"))).toEqual([
      [0, 2],
      [7, 10],
    ]);
  });

  it("sets setext headings: the text lines sized, the underline muted", () => {
    const off = decorate("One\nTwo\n===\n\nThree\n---");
    expect(named(off, "cm-lr-h1").map((d) => d.from)).toEqual([0, 4]);
    expect(named(off, "cm-lr-h2").map((d) => d.from)).toEqual([13]);
    expect(named(off, "cm-lr-muted").map((d) => [d.from, d.to])).toEqual([
      [8, 11],
      [19, 22],
    ]);
  });
});

describe("inline formatting", () => {
  const doc = "*em* **st** ~~del~~ `co`";

  it("styles emphasis, strong, strikethrough and code, and hides their marks off the cursor line", () => {
    const off = decorate(doc);
    expect(named(off, "cm-lr-em")).toHaveLength(1);
    expect(named(off, "cm-lr-strong")).toHaveLength(1);
    expect(named(off, "cm-lr-strike")).toHaveLength(1);
    expect(named(off, "cm-lr-code")).toHaveLength(1);
    expect(hidden(off)).toEqual([
      [0, 1],
      [3, 4],
      [5, 7],
      [9, 11],
      [12, 14],
      [17, 19],
      [20, 21],
      [23, 24],
    ]);
  });

  it("keeps the source of the line with the cursor, and sets the other lines", () => {
    const text = "*a*\n*b*";
    expect(hidden(decorate(text, 1))).toEqual([
      [4, 5],
      [6, 7],
    ]);
    expect(named(decorate(text, 1), "cm-lr-em")).toHaveLength(2);
    expect(hidden(decorate(text, 1, 5))).toEqual([]);
  });

  it("hides the text of a link's markup and underlines the text; an empty link text is not styled", () => {
    const off = decorate('[text](logreq:abc?version=1 "t") and [](x)');
    expect(named(off, "cm-lr-link").map((d) => [d.from, d.to])).toEqual([[1, 5]]);
    expect(hidden(off)).toEqual([
      [0, 1],
      [5, 32],
      [37, 38],
      [38, 42],
    ]);
    expect(hidden(decorate("[text](u)", 2))).toEqual([]);
  });

  it("sets autolinks and bare URLs as links, hides the brackets of an autolink, leaves images alone", () => {
    const off = decorate("<http://a.b> http://c.d ![i](x)");
    expect(named(off, "cm-lr-link").map((d) => [d.from, d.to])).toEqual([
      [1, 11],
      [13, 23],
    ]);
    expect(hidden(off)).toEqual([
      [0, 1],
      [11, 12],
    ]);
  });

  it("does not touch HTML", () => {
    expect(decorate("<b>x</b> <!-- c -->")).toEqual([]);
  });
});

describe("lists", () => {
  it("replaces a bullet with a dot, keeps an ordered mark muted, and shows task boxes", () => {
    const doc = "- a\n- [ ] b\n- [X] c\n\n1. one";
    const off = decorate(doc);
    expect(off.filter((d) => d.kind === "glyph").map((d) => [d.from, d.name])).toEqual([
      [0, "•"],
      [6, "☐"],
      [14, "☑"],
    ]);
    expect(hidden(off)).toEqual([
      [4, 6],
      [12, 14],
    ]);
    expect(named(off, "cm-lr-muted").map((d) => [d.from, d.to])).toEqual([[21, 23]]);
  });

  it("keeps the source of the cursor line", () => {
    const on = decorate("- a\n- [ ] b", 1);
    expect(on.filter((d) => d.kind === "glyph").map((d) => d.name)).toEqual(["☐"]);
    expect(
      decorate("- a\n- [ ] b", 5)
        .filter((d) => d.kind === "glyph")
        .map((d) => d.name),
    ).toEqual(["•"]);
  });

  it("handles an empty item", () => {
    expect(decorate("-").filter((d) => d.kind === "glyph")).toHaveLength(1);
  });
});

describe("quotes, code and rules", () => {
  it("sets the lines of a quote and hides its marks and their spaces", () => {
    const off = decorate("> a\n>b");
    expect(named(off, "cm-lr-quote").map((d) => d.from)).toEqual([0, 4]);
    expect(hidden(off)).toEqual([
      [0, 2],
      [4, 5],
    ]);
    expect(hidden(decorate("> a\n>b", 1))).toEqual([[4, 5]]);
  });

  it("sets fenced code: all lines get the block class, the fences are hidden off the cursor lines", () => {
    const doc = "```ts\ncode\n```";
    const off = decorate(doc);
    expect(named(off, "cm-lr-codeblock").map((d) => d.from)).toEqual([0, 6, 11]);
    expect(named(off, "cm-lr-fence").map((d) => d.from)).toEqual([0, 11]);
    expect(named(off, "cm-lr-fence-hidden").map((d) => d.from)).toEqual([0, 11]);
    expect(hidden(off)).toEqual([
      [0, 5],
      [11, 14],
    ]);
    const on = decorate(doc, 7);
    expect(named(on, "cm-lr-fence").map((d) => d.from)).toEqual([0, 11]);
    expect(hidden(on)).toEqual([
      [0, 5],
      [11, 14],
    ]);
    const inFence = decorate(doc, 2);
    expect(named(inFence, "cm-lr-fence-hidden").map((d) => d.from)).toEqual([11]);
    expect(hidden(inFence)).toEqual([[11, 14]]);
  });

  it("handles a fence that is not closed", () => {
    const off = decorate("```\ncode");
    expect(named(off, "cm-lr-fence")).toHaveLength(1);
  });

  it("sets indented code as a code block", () => {
    expect(named(decorate("a\n\n    b\n    c"), "cm-lr-codeblock").map((d) => d.from)).toEqual([3, 9]);
  });

  it("hides a horizontal rule and draws its line, unless the cursor is on it", () => {
    const off = decorate("a\n\n---");
    expect(named(off, "cm-lr-hr")).toHaveLength(1);
    expect(hidden(off)).toEqual([[3, 6]]);
    expect(decorate("a\n\n---", 4)).toEqual([]);
  });
});

describe("tables", () => {
  const doc = "| a | *b* |\n|:--|--:|\n| 1 | `2` |\n\nafter";

  it("replaces the table by one block widget while the cursor is elsewhere", () => {
    const off = decorate(doc);
    expect(off.filter((d) => d.kind === "table").map((d) => [d.from, d.to])).toEqual([[0, 33]]);
    expect(decorate(doc, 39).filter((d) => d.kind === "table")).toHaveLength(1);
    const widget = (): TableWidget => {
      const state = stateOf(doc);
      let found: TableWidget | undefined;
      previewDecorations(state, BUILT_IN_RULES, false).between(0, doc.length, (_from, _to, value) => {
        const spec = value.spec as { widget?: unknown; block?: boolean };
        if (spec.widget instanceof TableWidget) {
          expect(spec.block).toBe(true);
          found = spec.widget;
        }
      });
      if (found === undefined) {
        throw new Error("no table widget");
      }
      return found;
    };
    expect(widget().data.align).toEqual(["left", "right"]);
    expect(widget().data.header.map((cell) => cell.map((s) => s.text))).toEqual([["a"], ["b"]]);
    expect(widget().data.body[0]?.[1]).toEqual([{ text: "2", classes: ["cm-lr-code"] }]);
  });

  it("shows the source of the whole table while the cursor is in any row (A1, #420)", () => {
    const on = decorate(doc, 20);
    expect(on.filter((d) => d.kind === "table")).toEqual([]);
    expect(named(on, "cm-lr-table-source").map((d) => d.from)).toEqual([0, 12, 22]);
  });

  it("keeps a table that does not start a line as source", () => {
    const nested = decorate("- | a |\n  |---|\n  | 1 |");
    expect(nested.filter((d) => d.kind === "table")).toEqual([]);
    expect(named(nested, "cm-lr-table-source").length).toBeGreaterThan(0);
  });

  it("reads the alignment of every column", () => {
    expect(alignments("|:-|:-:|-:|---|")).toEqual(["left", "center", "right", undefined]);
    expect(alignments(" a | b ")).toEqual([undefined, undefined]);
  });
});

describe("plugin rules", () => {
  it("calls a rule for its node, after the built-in ones, with the context", () => {
    const seen: string[] = [];
    const rule: PreviewRule = {
      nodes: ["Emphasis"],
      decorate: (node, context) => {
        seen.push(`${node.name}:${String(context.sourceLine(node.from))}`);
        return [];
      },
    };
    decorate("*a*\n*b*", 1, undefined, [...BUILT_IN_RULES, rule]);
    expect(seen).toEqual(["Emphasis:true", "Emphasis:false"]);
  });
});

describe("livePreview", () => {
  const make = (doc: string): EditorState => {
    const state = EditorState.create({ doc, extensions: [markdownSupport({}), livePreview(BUILT_IN_RULES)] });
    // As in `stateOf`: the empty update hands the whole tree to the state.
    ensureSyntaxTree(state, doc.length, 1e9);
    return state.update({}).state;
  };

  it("is computed unfocused first and again when the focus, the selection or the text changes", () => {
    let state = make("# a\n\n*b*");
    const decorations = () => describeSet(state.facet(decorationsFacet)[0] as DecorationSet, 8);
    expect(hidden(decorations())).toEqual([
      [0, 2],
      [5, 6],
      [7, 8],
    ]);
    // The view reports the focus through this facet.
    const report = state.facet(EditorView.focusChangeEffect)[0];
    expect(report?.(state, true)?.is(focusEffect)).toBe(true);
    state = state.update({ effects: focusEffect.of(true) }).state;
    expect(state.field(focusState)).toBe(true);
    // Focused with the cursor at 0: the heading line shows its source.
    expect(hidden(decorations())).toEqual([
      [5, 6],
      [7, 8],
    ]);
    const before = state.facet(decorationsFacet)[0];
    state = state.update({ effects: focusEffect.of(true) }).state;
    expect(state.facet(decorationsFacet)[0]).toBe(before);
    state = state.update({ effects: StateEffect.define<number>().of(1) }).state;
    expect(state.facet(decorationsFacet)[0]).toBe(before);
    state = state.update({ selection: { anchor: 6 } }).state;
    expect(hidden(decorations())).toEqual([[0, 2]]);
    state = state.update({ changes: { from: 8, insert: " x" } }).state;
    expect(state.doc.toString()).toBe("# a\n\n*b* x");
  });
});

import { EditorView } from "@codemirror/view";
const decorationsFacet = EditorView.decorations;
