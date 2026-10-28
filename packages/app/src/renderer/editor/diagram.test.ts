// @vitest-environment happy-dom
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { ViewUpdate } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramHost } from "./diagram.js";
import {
  DIAGRAM_CACHE_SIZE,
  DIAGRAM_DELAY,
  DIAGRAM_MAX_DELAY,
  DiagramErrorWidget,
  DiagramWidget,
  PAGE_HOST,
  caretInDiagram,
  diagramDrawn,
  diagramDrawer,
  diagramRule,
  diagramSource,
  diagrams,
  drawingOf,
  forgetDrawings,
  isDiagram,
  keepDrawing,
  lastDrawings,
  redrawDelay,
  undrawn,
} from "./diagram.js";
import { markdownSupport } from "./markdown.js";
import type { DiagramResult, DiagramTheme } from "./mermaid-renderer.js";
import { BUILT_IN_RULES, focusEffect, focusState, previewDecorations, refreshPreview } from "./preview.js";

const RULES = [...BUILT_IN_RULES, diagramRule];
const DRAWN = {
  ok: true,
  url: "data:image/svg+xml;charset=utf-8,%3Csvg%3E",
  width: 40,
  height: 30,
  title: "Diagram",
} as const satisfies DiagramResult;
const BROKEN: DiagramResult = { ok: false, message: "Parse error on line 2:" };

const THEME: DiagramTheme = {
  dark: false,
  text: "black",
  muted: "grey",
  rule: "silver",
  edge: "grey",
  sheet: "white",
  raised: "white",
  fontFamily: "sans-serif",
};
const THEME_KEY = JSON.stringify(THEME);

const DOC = "Text\n\n```mermaid\nflowchart TD\nA --> B\n```\n\nMehr";
const SOURCE = "flowchart TD\nA --> B";
const FENCE = { from: 6, to: 41 };

const stateOf = (doc: string, cursor?: number, extra: readonly unknown[] = []): EditorState => {
  const state = EditorState.create({
    doc,
    ...(cursor === undefined ? {} : { selection: { anchor: cursor } }),
    extensions: [markdownSupport({}), focusState, lastDrawings, ...(extra as [])],
  });
  ensureSyntaxTree(state, doc.length, 1e9);
  return state.update({ effects: focusEffect.of(cursor !== undefined) }).state;
};

const fenceOf = (state: EditorState, index = 0): SyntaxNode => {
  const found: SyntaxNode[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FencedCode") {
        found.push(node.node);
      }
    },
  });
  const fence = found[index];
  if (fence === undefined) {
    throw new Error(`no fence ${String(index)}`);
  }
  return fence;
};

interface Deco {
  readonly from: number;
  readonly to: number;
  readonly kind: string;
}

/** The decorations of the fence as kind names: the drawing (in place or below), an error, line classes. */
const decorate = (state: EditorState): Deco[] => {
  const found: Deco[] = [];
  previewDecorations(state, RULES, state.field(focusState)).between(
    0,
    state.doc.length,
    (from, to, value) => {
      const spec = value.spec as { class?: string; widget?: unknown };
      if (spec.widget instanceof DiagramWidget) {
        found.push({ from, to, kind: from === to ? "diagram-below" : "diagram-block" });
      } else if (spec.widget instanceof DiagramErrorWidget) {
        found.push({ from, to, kind: "error-below" });
      } else {
        found.push({ from, to, kind: spec.class ?? "hide" });
      }
    },
  );
  return found;
};

const kinds = (found: readonly Deco[]): string[] => [...new Set(found.map((deco) => deco.kind))];

beforeEach(() => {
  forgetDrawings();
});

describe("diagram fences", () => {
  it("are fenced code blocks whose info string starts with mermaid, in any case", () => {
    const state = stateOf("```Mermaid title\nA\n```\n\n```ts\nx\n```\n\n```\nx\n```");
    expect(isDiagram(state, fenceOf(state, 0))).toBe(true);
    expect(isDiagram(state, fenceOf(state, 1))).toBe(false);
    expect(isDiagram(state, fenceOf(state, 2))).toBe(false);
  });

  it("have their code lines as source, with the line breaks and without quote markers", () => {
    const state = stateOf(DOC);
    expect(diagramSource(state, fenceOf(state))).toBe(SOURCE);
    const quoted = stateOf("> ```mermaid\n> flowchart TD\n> A --> B\n> ```");
    expect(diagramSource(quoted, fenceOf(quoted))).toBe(SOURCE);
  });
});

describe("the drawings", () => {
  it("are kept by source, most recently used last, at most DIAGRAM_CACHE_SIZE", () => {
    for (let at = 0; at <= DIAGRAM_CACHE_SIZE; at += 1) {
      keepDrawing(`graph ${String(at)}`, { theme: "t", result: DRAWN });
    }
    expect(drawingOf("graph 0")).toBeUndefined();
    expect(drawingOf("graph 1")).toEqual({ theme: "t", result: DRAWN });
    keepDrawing("graph new", { theme: "t", result: BROKEN });
    // graph 1 was used last, so graph 2 is the oldest now.
    expect(drawingOf("graph 1")).toBeDefined();
    expect(drawingOf("graph 2")).toBeUndefined();
    keepDrawing("graph 1", { theme: "u", result: BROKEN });
    expect(drawingOf("graph 1")).toEqual({ theme: "u", result: BROKEN });
  });

  it("last shown move with the changes of the text", () => {
    const state = stateOf(DOC);
    const drawn = state.update({ effects: diagramDrawn.of({ from: FENCE.from, result: DRAWN }) }).state;
    expect(drawn.field(lastDrawings).get(FENCE.from)).toBe(DRAWN);
    const moved = drawn.update({ changes: { from: 0, insert: "Neu " } }).state;
    expect([...moved.field(lastDrawings)]).toEqual([[FENCE.from + 4, DRAWN]]);
    const unchanged = state.update({ changes: { from: 0, insert: "x" } }).state;
    expect(unchanged.field(lastDrawings).size).toBe(0);
  });

  it("last shown are dropped with their fence: no old drawing under a new diagram at its place", () => {
    const drawn = stateOf(DOC).update({
      effects: diagramDrawn.of({ from: FENCE.from, result: DRAWN }),
    }).state;
    const deleted = drawn.update({ changes: { from: FENCE.from, to: FENCE.to } }).state;
    expect(deleted.field(lastDrawings).size).toBe(0);
    const typedAfter = drawn.update({ changes: { from: FENCE.to, insert: "\n" } }).state;
    expect([...typedAfter.field(lastDrawings)]).toEqual([[FENCE.from, DRAWN]]);
  });
});

describe("diagrams in the preview", () => {
  it("not drawn yet show their source as a code block", () => {
    expect(kinds(decorate(stateOf(DOC)))).toEqual([
      "cm-lr-codeblock",
      "cm-lr-fence",
      "cm-lr-fence-hidden",
      "hide",
    ]);
  });

  it("drawn appear in place of their lines while the cursor is not in them", () => {
    keepDrawing(SOURCE, { theme: THEME_KEY, result: DRAWN });
    expect(decorate(stateOf(DOC))).toEqual([{ ...FENCE, kind: "diagram-block" }]);
    expect(decorate(stateOf(DOC, 0))).toEqual([{ ...FENCE, kind: "diagram-block" }]);
  });

  it("show their source with the drawing below it while the cursor is in them", () => {
    keepDrawing(SOURCE, { theme: THEME_KEY, result: DRAWN });
    const found = decorate(stateOf(DOC, 20));
    expect(kinds(found)).toContain("cm-lr-codeblock");
    expect(found.filter((deco) => deco.kind === "diagram-below")).toEqual([
      { from: FENCE.to, to: FENCE.to, kind: "diagram-below" },
    ]);
  });

  it("with an error keep their source and show the error below it", () => {
    keepDrawing(SOURCE, { theme: THEME_KEY, result: BROKEN });
    const found = decorate(stateOf(DOC));
    expect(kinds(found)).toContain("cm-lr-codeblock");
    expect(found.filter((deco) => deco.kind === "error-below")).toEqual([
      { from: FENCE.to, to: FENCE.to, kind: "error-below" },
    ]);
  });

  it("whose new source is not drawn yet show the last drawing below the source", () => {
    const typed = stateOf(DOC, 20)
      .update({ effects: diagramDrawn.of({ from: FENCE.from, result: DRAWN }) })
      .state.update({ changes: { from: 37, insert: " --> C" } }).state;
    ensureSyntaxTree(typed, typed.doc.length, 1e9);
    expect(decorate(typed).filter((deco) => deco.kind === "diagram-below")).toHaveLength(1);
  });

  it("that do not start a line (in a list item) keep their source with the drawing below", () => {
    const doc = "- ```mermaid\n  flowchart TD\n  ```";
    keepDrawing("flowchart TD", { theme: THEME_KEY, result: DRAWN });
    expect(kinds(decorate(stateOf(doc)))).toContain("diagram-below");
  });

  it("leave other code blocks and empty diagrams to the built-in rule", () => {
    keepDrawing("x", { theme: THEME_KEY, result: DRAWN });
    for (const doc of ["```ts\nx\n```", "```mermaid\n\n```", "```mermaid\n```"]) {
      const found = kinds(decorate(stateOf(doc)));
      expect(found).not.toContain("diagram-block");
      expect(found).not.toContain("diagram-below");
    }
  });
});

describe("when a diagram is drawn again", () => {
  it("waits at least DIAGRAM_DELAY, three times the last drawing, at most DIAGRAM_MAX_DELAY", () => {
    expect(redrawDelay(0)).toBe(DIAGRAM_DELAY);
    expect(redrawDelay(1000)).toBe(3000);
    expect(redrawDelay(4000)).toBe(DIAGRAM_MAX_DELAY);
  });

  it("knows whether the caret of the focused editor is in a diagram", () => {
    expect(caretInDiagram(stateOf(DOC, 20))).toBe(true);
    expect(caretInDiagram(stateOf(DOC, 2))).toBe(false);
    expect(caretInDiagram(stateOf(DOC))).toBe(false);
    expect(caretInDiagram(stateOf("```ts\nx\n```", 7))).toBe(false);
    expect(caretInDiagram(EditorState.create({ doc: DOC, selection: { anchor: 20 } }))).toBe(false);
  });
});

describe("DiagramWidget", () => {
  it("is an image of the drawing with its size and title, that lets clicks through", () => {
    const widget = new DiagramWidget(DRAWN);
    const dom = widget.toDOM();
    expect(dom.className).toBe("cm-lr-diagram-block");
    const image = dom.querySelector("img");
    expect(image?.className).toBe("cm-lr-diagram");
    expect(image?.getAttribute("src")).toBe(DRAWN.url);
    expect(image?.alt).toBe("Diagram");
    expect([image?.width, image?.height]).toEqual([40, 30]);
    expect(widget.estimatedHeight).toBe(30);
    expect(widget.ignoreEvent()).toBe(false);
    expect(widget.eq(new DiagramWidget({ ...DRAWN }))).toBe(true);
    expect(widget.eq(new DiagramWidget({ ...DRAWN, title: "B" }))).toBe(false);
    expect(widget.eq(new DiagramWidget({ ...DRAWN, url: "data:," }))).toBe(false);
  });

  it("of an error is the message in grey after the word Error", () => {
    const widget = new DiagramErrorWidget("Parse error on line 2:");
    const dom = widget.toDOM();
    expect(dom.tagName).toBe("DIV");
    expect(dom.className).toBe("cm-lr-render-error");
    expect(dom.textContent).toBe("Error Parse error on line 2:");
    expect(widget.eq(new DiagramErrorWidget("Parse error on line 2:"))).toBe(true);
    expect(widget.eq(new DiagramErrorWidget("other"))).toBe(false);
  });
});

/** A host that draws on demand: each render waits until the test resolves it. */
const fakeHost = () => {
  const pending: { source: string; theme: DiagramTheme; resolve: (result: DiagramResult) => void }[] = [];
  let changed = (): void => undefined;
  let theme = THEME;
  const stop = vi.fn();
  const host: DiagramHost = {
    theme: () => theme,
    render: (source, drawnIn) =>
      new Promise((resolve) => {
        pending.push({ source, theme: drawnIn, resolve });
      }),
    watchScheme: (callback) => {
      changed = callback;
      return stop;
    },
  };
  return {
    host,
    drawer: diagramDrawer(host),
    pending,
    stop,
    switchTheme: (next: DiagramTheme) => {
      theme = next;
      changed();
    },
  };
};

const viewOf = (doc: string, fake: { drawer: Extension }): EditorView =>
  new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [markdownSupport({}), focusState, lastDrawings, fake.drawer],
    }),
  });

describe("the drawer", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("finds the visible diagrams without a drawing in the theme", () => {
    const view = viewOf(`${DOC}\n\n\`\`\`mermaid\nflowchart LR\n\`\`\`\n\n\`\`\`ts\nx\n\`\`\``, fakeHost());
    ensureSyntaxTree(view.state, view.state.doc.length, 1e9);
    expect(undrawn(view, THEME_KEY).map((pending) => pending.source)).toEqual([SOURCE, "flowchart LR"]);
    keepDrawing(SOURCE, { theme: THEME_KEY, result: DRAWN });
    keepDrawing("flowchart LR", { theme: "other", result: DRAWN });
    expect(undrawn(view, THEME_KEY).map((pending) => pending.source)).toEqual(["flowchart LR"]);
    view.destroy();
  });

  it("draws the diagrams one at a time, keeps the drawings and refreshes the preview", async () => {
    vi.useFakeTimers();
    const fake = fakeHost();
    const view = viewOf(`${DOC}\n\n\`\`\`mermaid\nflowchart LR\n\`\`\``, fake);
    const dispatched = vi.spyOn(view, "dispatch");
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.pending.map((call) => call.source)).toEqual([SOURCE]);
    fake.pending[0]?.resolve(DRAWN);
    await vi.advanceTimersByTimeAsync(0);
    expect(drawingOf(SOURCE)).toEqual({ theme: THEME_KEY, result: DRAWN });
    expect(view.state.field(lastDrawings).get(FENCE.from)).toBe(DRAWN);
    const effects = [dispatched.mock.calls[0]?.[0]?.effects ?? []].flat();
    expect(effects.some((effect) => effect.is(refreshPreview))).toBe(true);
    expect(fake.pending.map((call) => call.source)).toEqual([SOURCE, "flowchart LR"]);
    fake.pending[1]?.resolve(BROKEN);
    await vi.advanceTimersByTimeAsync(0);
    expect(drawingOf("flowchart LR")?.result).toBe(BROKEN);
    view.destroy();
  });

  it("draws again DIAGRAM_DELAY after the last change, and once more for changes made while it draws", async () => {
    vi.useFakeTimers();
    const fake = fakeHost();
    const view = viewOf(DOC, fake);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.pending).toHaveLength(1);
    // Typed while the first drawing runs: the next waits for it.
    view.dispatch({ changes: { from: 37, insert: " --> C" } });
    await vi.advanceTimersByTimeAsync(DIAGRAM_DELAY);
    expect(fake.pending).toHaveLength(1);
    fake.pending[0]?.resolve(DRAWN);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.pending.map((call) => call.source)).toEqual([SOURCE, `${SOURCE} --> C`]);
    fake.pending[1]?.resolve(DRAWN);
    await vi.advanceTimersByTimeAsync(0);
    // A change resets the pause.
    view.dispatch({ changes: { from: 37, insert: "D" } });
    await vi.advanceTimersByTimeAsync(DIAGRAM_DELAY - 1);
    view.dispatch({ changes: { from: 38, insert: "E" } });
    await vi.advanceTimersByTimeAsync(DIAGRAM_DELAY - 1);
    expect(fake.pending).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.pending).toHaveLength(3);
    view.destroy();
  });

  it("draws again in another colour scheme, and for a changed viewport", async () => {
    vi.useFakeTimers();
    const fake = fakeHost();
    const view = viewOf(DOC, fake);
    await vi.advanceTimersByTimeAsync(0);
    fake.pending[0]?.resolve(DRAWN);
    await vi.advanceTimersByTimeAsync(0);
    const dark = { ...THEME, dark: true, text: "white" };
    fake.switchTheme(dark);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.pending[1]).toMatchObject({ source: SOURCE, theme: dark });
    fake.pending[1]?.resolve(DRAWN);
    await vi.advanceTimersByTimeAsync(0);
    expect(drawingOf(SOURCE)?.theme).toBe(JSON.stringify(dark));
    // Nothing to draw for an update that changes neither the text nor the viewport.
    view.dispatch({ effects: refreshPreview.of(null) });
    await vi.advanceTimersByTimeAsync(DIAGRAM_DELAY);
    expect(fake.pending).toHaveLength(2);
    // A new viewport looks for diagrams at once.
    forgetDrawings();
    view.plugin(fake.drawer)?.update?.({
      docChanged: false,
      viewportChanged: true,
      startState: view.state,
      state: view.state,
    } as ViewUpdate);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.pending).toHaveLength(3);
    view.destroy();
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });

  it("waits longer after a change when the last drawing took long, and draws at once when the cursor leaves", async () => {
    vi.useFakeTimers();
    const fake = fakeHost();
    const view = viewOf(DOC, fake);
    view.dispatch({ selection: { anchor: 20 }, effects: focusEffect.of(true) });
    await vi.advanceTimersByTimeAsync(0);
    // The first drawing takes 1 s.
    await vi.advanceTimersByTimeAsync(1000);
    fake.pending[0]?.resolve(DRAWN);
    await vi.advanceTimersByTimeAsync(0);
    view.dispatch({ changes: { from: 37, insert: "C" } });
    await vi.advanceTimersByTimeAsync(2999);
    expect(fake.pending).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.pending).toHaveLength(2);
    // An error comes at once: the pause still follows the last drawing (1 s), not the error.
    fake.pending[1]?.resolve(BROKEN);
    await vi.advanceTimersByTimeAsync(0);
    view.dispatch({ changes: { from: 37, insert: "X" } });
    await vi.advanceTimersByTimeAsync(2999);
    expect(fake.pending).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.pending).toHaveLength(3);
    fake.pending[2]?.resolve(DRAWN);
    await vi.advanceTimersByTimeAsync(0);
    // A change, then the cursor leaves the diagram: drawn at once, not after the pause.
    view.dispatch({ changes: { from: 38, insert: "D" } });
    await vi.advanceTimersByTimeAsync(10);
    view.dispatch({ selection: { anchor: 2 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.pending).toHaveLength(4);
    view.destroy();
  });

  it("drops a drawing that arrives after the editor is gone", async () => {
    vi.useFakeTimers();
    const fake = fakeHost();
    const view = viewOf(DOC, fake);
    await vi.advanceTimersByTimeAsync(0);
    const dispatched = vi.spyOn(view, "dispatch");
    view.destroy();
    fake.pending[0]?.resolve(DRAWN);
    await vi.advanceTimersByTimeAsync(DIAGRAM_DELAY);
    expect(drawingOf(SOURCE)?.result).toBe(DRAWN);
    expect(dispatched).not.toHaveBeenCalled();
  });
});

describe("the page host", () => {
  it("watches data-theme on the root and the system scheme until stopped", async () => {
    const listeners = new Set<() => void>();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      })),
    );
    const changed = vi.fn();
    const stop = PAGE_HOST.watchScheme(changed);
    document.documentElement.dataset["theme"] = "dark";
    await vi.waitFor(() => {
      expect(changed).toHaveBeenCalledTimes(1);
    });
    for (const listener of listeners) {
      listener();
    }
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
    expect(listeners.size).toBe(0);
    delete document.documentElement.dataset["theme"];
    vi.unstubAllGlobals();
  });

  it("is the extension of the editor with the last drawings", () => {
    for (const extension of [diagrams(), diagrams(fakeHost().host)] as unknown[][]) {
      expect(extension[0]).toBe(lastDrawings);
      expect(extension).toHaveLength(2);
    }
  });
});
