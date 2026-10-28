// Diagrams in the live preview (SR-096 AK2, AK3; D-061). Decorations only, the text is never changed.
//
// - A fenced `mermaid` block off the lines that show their source appears drawn in place of its source.
// - While the cursor is in it, its whole source shows with the drawing directly below it, drawn again
//   after a pause of at least 300 ms that grows with the time the last drawing took, and at once when the
//   cursor leaves it (assumption A1, spec question #420); the last drawing stays until then.
// - A diagram with an error is never hidden: its source stays, and the error follows it in grey (AK3).
//
// Mermaid draws on the main thread (it measures the text in the DOM), so it is kept off the keystroke
// path: the view plugin draws the diagrams of the visible ranges after a pause, one at a time, and keeps
// the results by source; `decorate` only reads them. A diagram not drawn yet shows its source as code.
import type { EditorState, Extension, Range } from "@codemirror/state";
import { MapMode, StateEffect, StateField } from "@codemirror/state";
import type { EditorView, PluginValue, ViewUpdate } from "@codemirror/view";
import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";
import { errorNode } from "./formula.js";
import type { DiagramResult, DiagramTheme } from "./mermaid-renderer.js";
import { pageTheme, renderDiagram } from "./mermaid-renderer.js";
import type { PreviewContext, PreviewRule } from "./plugins.js";
import { focusState, refreshPreview } from "./preview.js";

/**
 * How long after the last change a diagram is drawn again: at least this, and three times as long as the
 * last drawing took, at most DIAGRAM_MAX_DELAY, so a large diagram is drawn again only on a real pause.
 */
export const DIAGRAM_DELAY = 300;
export const DIAGRAM_MAX_DELAY = 5000;

/** The pause after a change before drawing again, for a last drawing that took `cost` ms. */
export const redrawDelay = (cost: number): number =>
  Math.min(DIAGRAM_MAX_DELAY, Math.max(DIAGRAM_DELAY, 3 * cost));

/** Whether the caret of the focused editor stands in a diagram. */
export const caretInDiagram = (state: EditorState): boolean => {
  if (state.field(focusState, false) !== true) {
    return false;
  }
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(state.selection.main.head, -1);
    node !== null;
    node = node.parent
  ) {
    if (node.name === "FencedCode") {
      return isDiagram(state, node);
    }
  }
  return false;
};
/** How many drawn diagrams are kept, by source, for all editors of the app. */
export const DIAGRAM_CACHE_SIZE = 64;

interface Drawn {
  readonly theme: string;
  readonly result: DiagramResult;
}

const drawings = new Map<string, Drawn>();

/** The drawing of `source`, in any theme, most recently used last. */
export const drawingOf = (source: string): Drawn | undefined => {
  const found = drawings.get(source);
  if (found !== undefined) {
    drawings.delete(source);
    drawings.set(source, found);
  }
  return found;
};

export const keepDrawing = (source: string, drawn: Drawn): void => {
  drawings.delete(source);
  drawings.set(source, drawn);
  if (drawings.size > DIAGRAM_CACHE_SIZE) {
    const [oldest = source] = drawings.keys();
    drawings.delete(oldest);
  }
};

/** Forgets every drawing (tests). */
export const forgetDrawings = (): void => {
  drawings.clear();
};

/** A drawing arrived for the diagram that starts at `from`. */
export const diagramDrawn = StateEffect.define<{ readonly from: number; readonly result: DiagramResult }>();

/**
 * The last drawing each diagram showed, by the position of its fence, moved with the changes: shown below
 * the source while the new source waits for its drawing, so the drawing does not blink while typing.
 */
export const lastDrawings = StateField.define<ReadonlyMap<number, DiagramResult>>({
  create: () => new Map(),
  update: (value, transaction) => {
    let next = value;
    if (transaction.docChanged && value.size > 0) {
      // A fence whose first character was deleted is gone: its drawing is not shown under a new one there.
      const kept = new Map<number, DiagramResult>();
      for (const [from, result] of value) {
        const moved = transaction.changes.mapPos(from, 1, MapMode.TrackAfter);
        if (moved !== null) {
          kept.set(moved, result);
        }
      }
      next = kept;
    }
    for (const effect of transaction.effects) {
      if (effect.is(diagramDrawn)) {
        next = new Map(next).set(effect.value.from, effect.value.result);
      }
    }
    return next;
  },
});

/** A drawn diagram: an image of its SVG, in place of or below its source. */
export class DiagramWidget extends WidgetType {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly title: string;

  constructor(result: Extract<DiagramResult, { ok: true }>) {
    super();
    this.url = result.url;
    this.width = result.width;
    this.height = result.height;
    this.title = result.title;
  }

  override eq(other: DiagramWidget): boolean {
    return other.url === this.url && other.title === this.title;
  }

  override toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "cm-lr-diagram-block";
    const image = document.createElement("img");
    image.className = "cm-lr-diagram";
    image.alt = this.title;
    image.width = this.width;
    image.height = this.height;
    image.src = this.url;
    element.append(image);
    return element;
  }

  override get estimatedHeight(): number {
    return this.height;
  }

  // A click on the drawing reaches the editor, so it puts the cursor there and the source appears.
  override ignoreEvent(): boolean {
    return false;
  }
}

/** The error of a diagram, below its source (AK3). */
export class DiagramErrorWidget extends WidgetType {
  readonly message: string;

  constructor(message: string) {
    super();
    this.message = message;
  }

  override eq(other: DiagramErrorWidget): boolean {
    return other.message === this.message;
  }

  override toDOM(): HTMLElement {
    return errorNode(this.message, true);
  }
}

/** Whether a fenced code block is a diagram: the first word of its info string is `mermaid`. */
export const isDiagram = (state: EditorState, node: SyntaxNode): boolean => {
  const info = node.getChild("CodeInfo");
  return info !== null && state.sliceDoc(info.from, info.to).split(/\s/)[0]?.toLowerCase() === "mermaid";
};

/** The Mermaid source of a diagram: its code lines without quote or list markers. */
export const diagramSource = (state: EditorState, node: SyntaxNode): string =>
  node
    .getChildren("CodeText")
    .map((text) => state.sliceDoc(text.from, text.to))
    .join("");

/** What the diagram at `node` shows now: its drawing, or the last one while its new source waits. */
const shown = (node: SyntaxNodeRef, state: EditorState, source: string): DiagramResult | undefined =>
  drawings.get(source)?.result ?? state.field(lastDrawings, false)?.get(node.from);

/** Whether the drawing replaces the source: drawn without error, at the start of a line, no cursor in it. */
const replaces = (node: SyntaxNodeRef, { state, sourceLine }: PreviewContext): boolean => {
  if (!isDiagram(state, node.node)) {
    return false;
  }
  const source = diagramSource(state, node.node);
  if (source.trim() === "" || drawings.get(source)?.result.ok !== true) {
    return false;
  }
  const first = state.doc.lineAt(node.from);
  if (node.from !== first.from) {
    return false;
  }
  for (let number = first.number; number <= state.doc.lineAt(node.to).number; number += 1) {
    if (sourceLine(state.doc.line(number).from)) {
      return false;
    }
  }
  return true;
};

const widgetOf = (result: DiagramResult): WidgetType =>
  result.ok ? new DiagramWidget(result) : new DiagramErrorWidget(result.message);

/**
 * Fenced `mermaid` blocks. While drawn in place of its source, this rule draws the block alone; otherwise
 * the built-in rule draws the code block and this one adds the drawing or the error below it.
 */
export const diagramRule: PreviewRule = {
  nodes: ["FencedCode"],
  owns: replaces,
  decorate: (node, context) => {
    const { state } = context;
    if (!isDiagram(state, node.node)) {
      return [];
    }
    const source = diagramSource(state, node.node);
    const result = source.trim() === "" ? undefined : shown(node, state, source);
    if (result === undefined) {
      return [];
    }
    const first = state.doc.lineAt(node.from);
    const last = state.doc.lineAt(node.to);
    const ranges: Range<Decoration>[] = [];
    if (replaces(node, context)) {
      ranges.push(Decoration.replace({ widget: widgetOf(result), block: true }).range(first.from, last.to));
    } else {
      // Below the source: a widget at the end of the last line that is a block of its own within that line.
      ranges.push(Decoration.widget({ widget: widgetOf(result), side: 1 }).range(last.to));
    }
    return ranges;
  },
};

interface Pending {
  readonly from: number;
  readonly source: string;
}

/** The diagrams in the visible ranges of `view` whose drawing is missing or of another theme. */
export const undrawn = (view: EditorView, theme: string): Pending[] => {
  const found: Pending[] = [];
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "FencedCode") {
          return;
        }
        if (isDiagram(view.state, node.node)) {
          const source = diagramSource(view.state, node.node);
          if (source.trim() !== "" && drawings.get(source)?.theme !== theme) {
            found.push({ from: node.from, source });
          }
        }
        return false;
      },
    });
  }
  return found;
};

/** What the plugin needs from the page; replaced in tests. */
export interface DiagramHost {
  readonly theme: () => DiagramTheme;
  readonly render: (source: string, theme: DiagramTheme) => Promise<DiagramResult>;
  /** Calls `changed` when the colour scheme of the page changes; returns the function that stops it. */
  readonly watchScheme: (changed: () => void) => () => void;
}

const watchPageScheme = (changed: () => void): (() => void) => {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", changed);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", changed);
  };
};

export const PAGE_HOST: DiagramHost = {
  theme: pageTheme,
  render: renderDiagram,
  watchScheme: watchPageScheme,
};

/** Draws the visible diagrams of an editor after a pause and hands the drawings to the preview. */
export const diagramDrawer = (host: DiagramHost): ViewPlugin<PluginValue> =>
  ViewPlugin.define((view): PluginValue => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    // Read again after each drawing (a closure's `let` would look constant to the type checker).
    const life = { destroyed: false, again: false };
    const wanted = (): boolean => life.again;
    // How long the last drawing took (it holds the main thread that long). It includes the wait in the shared
    // queue and, the first time, Mermaid's loading, so the first pause after a start can be longer than needed.
    let cost = 0;
    let theme = host.theme();
    let themeKey = JSON.stringify(theme);

    const drawAll = async (): Promise<void> => {
      running = true;
      life.again = false;
      for (const { source } of undrawn(view, themeKey)) {
        const drawnIn = themeKey;
        const started = Date.now();
        const result = await host.render(source, theme);
        // Only a drawing counts: a parse error takes milliseconds and says nothing about the next drawing.
        if (result.ok) {
          cost = Date.now() - started;
        }
        keepDrawing(source, { theme: drawnIn, result });
        if (life.destroyed) {
          return;
        }
        // The fences that hold this source now (positions may have moved while it was drawn).
        const effects = fencesOf(view.state, source).map((from) => diagramDrawn.of({ from, result }));
        view.dispatch({ effects: [...effects, refreshPreview.of(null)] });
      }
      running = false;
      if (wanted()) {
        schedule(0);
      }
    };

    const schedule = (delay: number): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (running) {
          life.again = true;
          return;
        }
        void drawAll();
      }, delay);
    };

    const stopWatching = host.watchScheme(() => {
      theme = host.theme();
      themeKey = JSON.stringify(theme);
      schedule(0);
    });
    schedule(0);

    return {
      update: (update: ViewUpdate) => {
        if (caretInDiagram(update.startState) && !caretInDiagram(update.state)) {
          // The cursor left the diagram (or the editor): its final drawing at once.
          schedule(0);
        } else if (update.docChanged) {
          schedule(redrawDelay(cost));
        } else if (update.viewportChanged) {
          schedule(0);
        }
      },
      destroy: () => {
        life.destroyed = true;
        clearTimeout(timer);
        stopWatching();
      },
    };
  });

/** The positions of the diagrams of the text whose source is `source`. */
const fencesOf = (state: EditorState, source: string): number[] => {
  const found: number[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") {
        return;
      }
      if (isDiagram(state, node.node) && diagramSource(state, node.node) === source) {
        found.push(node.from);
      }
      return false;
    },
  });
  return found;
};

/** The diagrams of the editor: the rule, the last drawings and the plugin that draws them. */
export const diagrams = (host: DiagramHost = PAGE_HOST): Extension => [lastDrawings, diagramDrawer(host)];
