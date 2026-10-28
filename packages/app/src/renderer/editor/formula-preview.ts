// Formulas in the live preview (SR-096 AK1, AK3; D-061). Decorations only, the text is never changed.
//
// - Off the lines that show their source, a formula appears set in place of its source: `$…$` within the
//   line, a `$$` block or a fenced `math` block as a block of its own.
// - While the cursor is in a block formula, its whole source shows and the set formula directly below it,
//   and it follows the typing (assumption A1, spec question #420). While the caret is inside a `$…$`, its
//   line shows the source (D-061) and the set formula appears under it in a tooltip that takes no input.
// - A formula with an error is never hidden: its source stays, and the error follows it in grey (AK3).
//   A block that does not start at the beginning of its line (in a list item or a quote) cannot be replaced
//   by a block: it keeps its source, with the formula below.
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import type { Tooltip } from "@codemirror/view";
import { Decoration, WidgetType, showTooltip } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { errorNode, formulaNode, renderFormula } from "./formula.js";
import type { PreviewContext, PreviewRule } from "./plugins.js";
import { focusState } from "./preview.js";

/** A set formula, or the error of one, in place of or below its source. */
export class FormulaWidget extends WidgetType {
  readonly source: string;
  readonly display: boolean;
  readonly block: boolean;

  constructor(source: string, display: boolean, block: boolean) {
    super();
    this.source = source;
    this.display = display;
    this.block = block;
  }

  override eq(other: FormulaWidget): boolean {
    return other.source === this.source && other.display === this.display && other.block === this.block;
  }

  override toDOM(): HTMLElement {
    const element = document.createElement(this.block ? "div" : "span");
    element.className = this.block ? "cm-lr-formula-block" : "cm-lr-formula";
    element.append(formulaNode(this.source, this.display));
    return element;
  }

  // A click on the formula reaches the editor, so it puts the cursor there and the source appears.
  override ignoreEvent(): boolean {
    return false;
  }
}

/** The error of a formula within its line, after its source. */
export class FormulaErrorWidget extends WidgetType {
  readonly message: string;

  constructor(message: string) {
    super();
    this.message = message;
  }

  override eq(other: FormulaErrorWidget): boolean {
    return other.message === this.message;
  }

  override toDOM(): HTMLElement {
    return errorNode(this.message, false);
  }
}

type Ranges = Range<Decoration>[];

const lineClass = new Map<string, Decoration>();
const linesOf = (state: EditorState, from: number, to: number, className: string): Ranges => {
  let line = lineClass.get(className);
  if (line === undefined) {
    line = Decoration.line({ class: className });
    lineClass.set(className, line);
  }
  const ranges: Ranges = [];
  for (let number = state.doc.lineAt(from).number; number <= state.doc.lineAt(to).number; number += 1) {
    ranges.push(line.range(state.doc.line(number).from));
  }
  return ranges;
};

/** The TeX source of a block formula: its lines without the `$$` lines and without quote or list markers. */
const blockSource = (state: EditorState, node: SyntaxNode): string =>
  node.name === "BlockMath"
    ? node
        .getChildren("MathText")
        .map((text) => state.sliceDoc(text.from, text.to))
        .join("\n")
    : node
        .getChildren("CodeText")
        .map((text) => state.sliceDoc(text.from, text.to))
        .join("");

/** Whether a fenced code block is a formula: its info string is `math`. */
const isMathFence = (state: EditorState, node: SyntaxNode): boolean => {
  const info = node.getChild("CodeInfo");
  return info !== null && state.sliceDoc(info.from, info.to).split(/\s/)[0]?.toLowerCase() === "math";
};

/** Whether the block formula is set in place of its source: no error, at the start of a line, no cursor in it. */
const replaces = (node: SyntaxNodeRef, { state, sourceLine }: PreviewContext, source: string): boolean => {
  if (source.trim() === "" || !renderFormula(source, true).ok) {
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

const blockFormula = (node: SyntaxNodeRef, context: PreviewContext, codeLines: boolean): Ranges => {
  const { state } = context;
  const source = blockSource(state, node.node);
  if (source.trim() === "") {
    return codeLines ? linesOf(state, node.from, node.to, "cm-lr-codeblock") : [];
  }
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  if (replaces(node, context, source)) {
    return [
      Decoration.replace({ widget: new FormulaWidget(source, true, true), block: true }).range(
        first.from,
        last.to,
      ),
    ];
  }
  // Below the source: a widget at the end of the last line that is a block of its own within that line. A
  // block widget after the line would give a formula at the end of the text an empty line after it.
  return [
    ...(codeLines ? linesOf(state, node.from, node.to, "cm-lr-codeblock") : []),
    Decoration.widget({ widget: new FormulaWidget(source, true, true), side: 1 }).range(last.to),
  ];
};

/** `$$` blocks: their lines look like code while their source shows. */
const blockMath: PreviewRule = {
  nodes: ["BlockMath"],
  decorate: (node, context) => blockFormula(node, context, true),
};

/**
 * Fenced `math` blocks. While it is set in place of its source, this rule draws the block alone; otherwise
 * the built-in rule draws the code block and this one adds the formula below it.
 */
const mathFence: PreviewRule = {
  nodes: ["FencedCode"],
  owns: (node, context) =>
    isMathFence(context.state, node.node) && replaces(node, context, blockSource(context.state, node.node)),
  decorate: (node, context) =>
    isMathFence(context.state, node.node) ? blockFormula(node, context, false) : [],
};

interface Inline {
  readonly from: number;
  readonly to: number;
  readonly source: string;
  readonly display: boolean;
}

const inlineOf = (state: EditorState, node: SyntaxNode): Inline => {
  const [open, close] = node.getChildren("MathMark") as [SyntaxNode, SyntaxNode];
  return {
    from: node.from,
    to: node.to,
    source: state.sliceDoc(open.to, close.from),
    display: open.to - open.from === 2,
  };
};

/** Whether a caret of the selection stands inside the formula (after its first character, up to its end). */
const caretIn = (state: EditorState, from: number, to: number): boolean =>
  state.selection.ranges.some((range) => range.empty && range.head > from && range.head <= to);

const inlineMath: PreviewRule = {
  nodes: ["InlineMath"],
  decorate: (node, { state, sourceLine }) => {
    const formula = inlineOf(state, node.node);
    const result = renderFormula(formula.source, formula.display);
    if (!result.ok) {
      // With the caret inside, the tooltip shows the error.
      return sourceLine(node.from) && caretIn(state, node.from, node.to)
        ? []
        : [Decoration.widget({ widget: new FormulaErrorWidget(result.message), side: 1 }).range(node.to)];
    }
    return sourceLine(node.from)
      ? []
      : [
          Decoration.replace({ widget: new FormulaWidget(formula.source, formula.display, false) }).range(
            node.from,
            node.to,
          ),
        ];
  },
};

export const FORMULA_RULES: readonly PreviewRule[] = [inlineMath, blockMath, mathFence];

/** The `$…$` the caret of the focused editor is inside, if any. */
export const formulaAtCaret = (state: EditorState): Inline | undefined => {
  if (state.field(focusState, false) !== true || !state.selection.main.empty) {
    return undefined;
  }
  const { head } = state.selection.main;
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(head, -1);
    node !== null;
    node = node.parent
  ) {
    // Looking left of the caret: a caret before the opening `$` is not in the formula.
    if (node.name === "InlineMath") {
      return inlineOf(state, node);
    }
  }
  return undefined;
};

const tooltipOf = (formula: Inline): Tooltip => ({
  pos: formula.from,
  above: false,
  arrow: false,
  create: () => {
    const dom = document.createElement("div");
    dom.className = "cm-lr-formula-tooltip";
    dom.setAttribute("aria-hidden", "true");
    dom.append(formulaNode(formula.source, formula.display));
    return { dom };
  },
});

interface Shown {
  readonly formula: Inline;
  readonly tooltip: Tooltip;
}

/** The set `$…$` under its source while the caret is inside it (A1); the same tooltip while it is unchanged. */
export const formulaTooltip: Extension = StateField.define<Shown | undefined>({
  create: (state) => {
    const formula = formulaAtCaret(state);
    return formula === undefined ? undefined : { formula, tooltip: tooltipOf(formula) };
  },
  update: (value, transaction) => {
    const formula = formulaAtCaret(transaction.state);
    if (formula === undefined) {
      return undefined;
    }
    const same =
      value?.formula.from === formula.from &&
      value.formula.source === formula.source &&
      value.formula.display === formula.display;
    return same ? value : { formula, tooltip: tooltipOf(formula) };
  },
  provide: (field) => showTooltip.compute([field], (state) => state.field(field)?.tooltip ?? null),
});
