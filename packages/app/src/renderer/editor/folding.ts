// Sections under headings (SR-191): a heading of the text and everything up to the next heading of the same or a
// higher level fold to a quiet hint, and unfold again with a click on it, a command, or the cursor moving in. The
// toggle left of a heading shows only while the pointer is over the heading or the toggle itself. Folding is display
// state of the editor: the document, and so the file, stays as it is (D-061). "Go to heading" reads `headings`.
// Editor-only, no catalog command, like the slash menu (ADR-0010).
//
// Sections are the headings at the top level of the text: a `#` line in a list or a quote starts none, as in
// CommonMark, where it is a heading inside that block.
import { codeFolding, foldEffect, foldedRanges, syntaxTree, unfoldEffect } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { Command, DecorationSet, ViewUpdate } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { parsedTree } from "./parsed.js";

/** A heading of the text and the section under it. */
export interface Heading {
  /** 1 to 6. */
  readonly level: number;
  /** The text of the heading without its marks. */
  readonly name: string;
  /** The start of the heading's line: where "Go to heading" puts the cursor. */
  readonly from: number;
  /** The end of the heading (its last line, the underline of a Setext heading included): the fold starts here. */
  readonly end: number;
  /** The end of its section: the end of the last block before the next heading of the same or a higher level. */
  readonly to: number;
}

const LEVEL = /^(?:ATXHeading|SetextHeading)([1-6])$/;

const levelOf = (node: SyntaxNode): number | undefined => {
  const match = LEVEL.exec(node.name);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

/** The text of a heading without its marks: `## Zweck ##` is "Zweck", a Setext heading is its text lines. */
const nameOf = (state: EditorState, node: SyntaxNode): string => {
  const marks = node.getChildren("HeaderMark");
  if (node.name.startsWith("Setext")) {
    const underline = marks.at(-1);
    return state.doc
      .sliceString(node.from, underline?.from ?? node.to)
      .replace(/\s+/g, " ")
      .trim();
  }
  const open = marks.find((mark) => mark.from === node.from);
  const close = marks.find((mark) => mark.from !== node.from);
  return state.doc.sliceString(open?.to ?? node.from, close?.from ?? node.to).trim();
};

/**
 * The headings of the text at its top level, in order, each with its section; in `tree`, by default the tree of
 * the whole text, parsed first (the commands). The toggles take the tree as far as it is parsed.
 */
export const headings = (state: EditorState, tree: Tree = parsedTree(state)): readonly Heading[] => {
  const blocks: SyntaxNode[] = [];
  for (let node = tree.topNode.firstChild; node !== null; node = node.nextSibling) {
    blocks.push(node);
  }
  const found: Heading[] = [];
  // One pass: a heading stays open until a heading of its level or a higher one; each block extends the open ones.
  const open: { heading: Omit<Heading, "to">; to: number }[] = [];
  const close = (level: number): void => {
    while ((open.at(-1)?.heading.level ?? 0) >= level && open.length > 0) {
      const done = open.pop();
      if (done !== undefined) {
        found.push({ ...done.heading, to: done.to });
      }
    }
  };
  for (const node of blocks) {
    const level = levelOf(node);
    if (level !== undefined) {
      close(level);
      open.push({
        heading: { level, name: nameOf(state, node), from: node.from, end: node.to },
        to: node.to,
      });
    } else {
      for (const each of open) {
        each.to = node.to;
      }
    }
  }
  close(1);
  found.sort((a, b) => a.from - b.from);
  return found;
};

/** The heading whose section holds `pos`, its own lines included: the innermost one. */
export const sectionAt = (state: EditorState, pos: number): Heading | undefined =>
  headings(state).findLast((heading) => heading.from <= pos && pos <= Math.max(heading.end, heading.to));

/** The fold of a heading's section: none for a heading with nothing under it. */
const foldOf = (heading: Heading): { from: number; to: number } | undefined =>
  heading.to > heading.end ? { from: heading.end, to: heading.to } : undefined;

/** Whether the section of `heading` is folded now. */
const isFolded = (state: EditorState, heading: Heading): boolean => {
  let folded = false;
  foldedRanges(state).between(heading.end, heading.end, (from) => {
    folded ||= from === heading.end;
  });
  return folded;
};

const fold = (view: EditorView, heading: Heading): boolean => {
  const range = foldOf(heading);
  if (range === undefined) {
    return false;
  }
  // The cursor goes to the end of the heading: a cursor left inside the fold would open it again.
  view.dispatch({
    effects: [foldEffect.of(range), EditorView.scrollIntoView(heading.end)],
    selection: { anchor: heading.end },
  });
  return true;
};

const unfold = (view: EditorView, heading: Heading): boolean => {
  const effects: ReturnType<typeof unfoldEffect.of>[] = [];
  foldedRanges(view.state).between(heading.end, heading.to, (from, to) => {
    if (from >= heading.end && to <= heading.to) {
      effects.push(unfoldEffect.of({ from, to }));
    }
  });
  if (effects.length === 0) {
    return false;
  }
  view.dispatch({ effects });
  return true;
};

/** "Fold section" (SR-191 AK1): folds the section the cursor is in; false when it is in none or the section is empty. */
export const foldSection: Command = (view) => {
  const heading = sectionAt(view.state, view.state.selection.main.head);
  return heading !== undefined && fold(view, heading);
};

/**
 * "Unfold section" (SR-191 AK2): unfolds the section the cursor is in, and the sections folded inside it; false
 * when nothing there is folded.
 */
export const unfoldSection: Command = (view) => {
  const heading = sectionAt(view.state, view.state.selection.main.head);
  return heading !== undefined && unfold(view, heading);
};

/** "Go to heading" (SR-191 AK3): the cursor to the start of the heading at `from`, which a fold around it opens for. */
export const goToHeading =
  (from: number): Command =>
  (view) => {
    const at = Math.min(from, view.state.doc.length);
    view.dispatch({
      selection: { anchor: at },
      effects: EditorView.scrollIntoView(at, { y: "start", yMargin: 48 }),
    });
    return true;
  };

/** The toggle left of a heading with a section: seen only while the pointer is over the heading or the toggle (CSS). */
class FoldToggle extends WidgetType {
  readonly from: number;
  readonly folded: boolean;

  constructor(from: number, folded: boolean) {
    super();
    this.from = from;
    this.folded = folded;
  }

  override eq(other: FoldToggle): boolean {
    return other.from === this.from && other.folded === this.folded;
  }

  override toDOM(view: EditorView): HTMLElement {
    const toggle = document.createElement("span");
    toggle.className = "cm-lr-fold-toggle";
    toggle.textContent = this.folded ? "▸" : "▾";
    toggle.setAttribute("aria-hidden", "true");
    toggle.title = this.folded ? "Unfold section" : "Fold section";
    toggle.addEventListener("mousedown", (event) => {
      // Only the left button folds: a right press opens the context menu (SR-194).
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      const heading = headings(view.state).find((each) => each.from === view.posAtDOM(toggle));
      if (heading !== undefined) {
        if (isFolded(view.state, heading)) {
          unfold(view, heading);
        } else {
          fold(view, heading);
        }
      }
    });
    return toggle;
  }

  // The toggle takes its own clicks; the editor does not move the cursor for them.
  override ignoreEvent(): boolean {
    return true;
  }
}

const toggles = (state: EditorState): DecorationSet => {
  const ranges: Range<Decoration>[] = [];
  for (const heading of headings(state, syntaxTree(state))) {
    if (foldOf(heading) !== undefined) {
      ranges.push(
        Decoration.widget({ widget: new FoldToggle(heading.from, isFolded(state, heading)), side: -1 }).range(
          heading.from,
        ),
      );
    }
  }
  return Decoration.set(ranges);
};

const togglePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = toggles(view.state);
    }

    update(update: ViewUpdate): void {
      const folds = update.transactions.some((tr) =>
        tr.effects.some((effect) => effect.is(foldEffect) || effect.is(unfoldEffect)),
      );
      // The cursor moving into a fold opens it without an effect: the folds themselves changed then.
      if (
        update.docChanged ||
        folds ||
        foldedRanges(update.startState) !== foldedRanges(update.state) ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = toggles(update.state);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The hint in place of a folded section: a muted "…" with the count of its lines; a click unfolds it. */
const placeholder = (onclick: (event: Event) => void, lines: number): HTMLElement => {
  const hint = document.createElement("span");
  hint.className = "cm-lr-fold-hint";
  hint.textContent = `… ${String(lines)} ${lines === 1 ? "line" : "lines"}`;
  hint.title = "Unfold section";
  hint.addEventListener("click", onclick);
  return hint;
};

// Colour only for meaning: the toggle and the hint are muted (D-062).
const theme = EditorView.theme({
  // The toggle covers the left margin of its line from top to bottom (the line's top padding too), touching the
  // line, and stays under the pointer while unseen (opacity, not visibility, which would take it out of the
  // pointer's reach): the pointer on its way from the heading to the toggle, or on the toggle itself, keeps the
  // line hovered, and so the toggle seen (#1130).
  ".cm-line:has(> .cm-lr-fold-toggle)": { position: "relative" },
  ".cm-lr-fold-toggle": {
    position: "absolute",
    top: "0",
    bottom: "0",
    left: "-1.25em",
    boxSizing: "border-box",
    width: "1.25em",
    paddingTop: "inherit",
    paddingRight: "0.25em",
    textAlign: "center",
    color: "var(--muted)",
    cursor: "pointer",
    userSelect: "none",
    opacity: "0",
  },
  ".cm-line:hover .cm-lr-fold-toggle": { opacity: "1" },
  ".cm-lr-fold-hint": {
    marginLeft: "0.5em",
    color: "var(--muted)",
    fontSize: "13px",
    fontWeight: "400",
    cursor: "pointer",
  },
});

/** Folding of the sections under headings: the toggles, the hint and the fold state of the editor. */
export const sectionFolding = (): Extension => [
  theme,
  codeFolding({
    // The count is taken when the fold is drawn, on the document of that moment: CodeMirror keeps it with the
    // fold and does not map it, so offsets kept here would be wrong once the text above changed.
    placeholderDOM: (_view, onclick, prepared) => placeholder(onclick, prepared as number),
    preparePlaceholder: (state, range) =>
      state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number,
  }),
  togglePlugin,
];
