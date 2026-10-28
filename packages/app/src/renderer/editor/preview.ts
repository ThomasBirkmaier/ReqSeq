// The live preview (D-061): formatting appears set, and the Markdown source shows only on the lines the
// cursor touches. It is made of decorations only; the document is never changed (D-027: the file stays
// exactly the Markdown one sees). The decorations come from a state field, because the table is a block
// widget and block decorations cannot come from a view plugin.
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { StateEffect, StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { INLINE_NODES, inlineMarkup } from "./markup.js";
import type { PreviewContext, PreviewRule } from "./plugins.js";
import { inlineSegments } from "./segments.js";
import type { Align, TableData } from "./widgets.js";
import { GlyphWidget, TableWidget } from "./widgets.js";

export const focusEffect = StateEffect.define<boolean>();

/** Builds the preview again for something a rule reads besides the document (the titles of references, D-058). */
export const refreshPreview = StateEffect.define();

/** Whether the editor has the focus. Without the focus there is no cursor line: everything is set. */
export const focusState = StateField.define<boolean>({
  create: () => false,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(focusEffect)) {
        return effect.value;
      }
    }
    return value;
  },
  provide: () => EditorView.focusChangeEffect.of((_state, focusing) => focusEffect.of(focusing)),
});

/** The numbers of the lines whose source is shown: every line a selection range touches, while focused. */
export const sourceLines = (state: EditorState, focused: boolean): ReadonlySet<number> => {
  const lines = new Set<number>();
  if (focused) {
    for (const range of state.selection.ranges) {
      for (
        let number = state.doc.lineAt(range.from).number;
        number <= state.doc.lineAt(range.to).number;
        number += 1
      ) {
        lines.add(number);
      }
    }
  }
  return lines;
};

const hide = Decoration.replace({});
const decorations = new Map<string, Decoration>();
const cached = (kind: "line" | "mark", className: string): Decoration => {
  const key = `${kind}:${className}`;
  let found = decorations.get(key);
  if (found === undefined) {
    found = kind === "line" ? Decoration.line({ class: className }) : Decoration.mark({ class: className });
    decorations.set(key, found);
  }
  return found;
};

type Ranges = Range<Decoration>[];

/** A line class on every line from the one at `from` to the one at `to`. */
const lineClasses = (state: EditorState, from: number, to: number, className: string): Ranges => {
  const ranges: Ranges = [];
  for (let number = state.doc.lineAt(from).number; number <= state.doc.lineAt(to).number; number += 1) {
    ranges.push(cached("line", className).range(state.doc.line(number).from));
  }
  return ranges;
};

const hideRange = (from: number, to: number): Ranges => [hide.range(from, to)];
const styleRange = (className: string, from: number, to: number): Ranges =>
  from < to ? [cached("mark", className).range(from, to)] : [];

/** A mark and the space after it (`# `, `> `). */
const markAndSpace = (state: EditorState, from: number, to: number): [number, number] => [
  from,
  state.doc.sliceString(to, to + 1) === " " ? to + 1 : to,
];

const heading = (level: number): PreviewRule => ({
  nodes: [`ATXHeading${String(level)}`],
  decorate: (node, { state, sourceLine }) => {
    const ranges = lineClasses(state, node.from, node.from, `cm-lr-h${String(level)}`);
    if (!sourceLine(node.from)) {
      for (const mark of node.node.getChildren("HeaderMark")) {
        if (mark.from === node.from) {
          ranges.push(...hideRange(...markAndSpace(state, mark.from, mark.to)));
        } else {
          // The optional closing sequence: `# Title #`.
          const before = state.doc.sliceString(node.from, mark.from);
          ranges.push(...hideRange(mark.from - (before.length - before.trimEnd().length), mark.to));
        }
      }
    }
    return ranges;
  },
});

const setextHeading = (level: number): PreviewRule => ({
  nodes: [`SetextHeading${String(level)}`],
  decorate: (node, { state }) => {
    // The text lines are all lines but the last, which is the underline.
    const last = state.doc.line(state.doc.lineAt(node.to).number - 1);
    return [
      ...lineClasses(state, node.from, last.from, `cm-lr-h${String(level)}`),
      ...node.node.getChildren("HeaderMark").flatMap((mark) => styleRange("cm-lr-muted", mark.from, mark.to)),
    ];
  },
});

/** Inline formatting only: emphasis, strikethrough, code, links (what a Markdown property box shows, SR-127). */
export const inline: PreviewRule = {
  nodes: INLINE_NODES,
  decorate: (node, { sourceLine }) => {
    const markup = inlineMarkup(node.node);
    return [
      ...markup.styled.flatMap((style) => styleRange(style.className, style.from, style.to)),
      ...markup.hidden.flatMap((mark) => (sourceLine(mark.from) ? [] : hideRange(mark.from, mark.to))),
    ];
  },
};

const listMark: PreviewRule = {
  nodes: ["ListMark"],
  decorate: (node, { state, sourceLine }) => {
    if (node.matchContext(["OrderedList", "ListItem"])) {
      return styleRange("cm-lr-muted", node.from, node.to);
    }
    if (sourceLine(node.from)) {
      return [];
    }
    // A task item shows its box instead of a bullet.
    return node.node.nextSibling?.name === "Task"
      ? hideRange(...markAndSpace(state, node.from, node.to))
      : [Decoration.replace({ widget: new GlyphWidget("•", "cm-lr-bullet") }).range(node.from, node.to)];
  },
};

const taskMarker: PreviewRule = {
  nodes: ["TaskMarker"],
  decorate: (node, { state, sourceLine }) => {
    if (sourceLine(node.from)) {
      return [];
    }
    const checked = state.doc.sliceString(node.from, node.to).toLowerCase() === "[x]";
    return [
      Decoration.replace({ widget: new GlyphWidget(checked ? "☑" : "☐", "cm-lr-task") }).range(
        node.from,
        node.to,
      ),
    ];
  },
};

const blockquote: PreviewRule = {
  nodes: ["Blockquote"],
  decorate: (node, { state }) => lineClasses(state, node.from, node.to, "cm-lr-quote"),
};

// A quote mark is a child of the quote or of its paragraph (`>b` inside a paragraph), so it has its own rule.
const quoteMark: PreviewRule = {
  nodes: ["QuoteMark"],
  decorate: (node, { state, sourceLine }) =>
    sourceLine(node.from) ? [] : hideRange(...markAndSpace(state, node.from, node.to)),
};

/** A fence line (``` and the info string): a thin gap while its source is hidden. */
const fence = (state: EditorState, sourceLine: PreviewContext["sourceLine"], from: number): Ranges => {
  const line = state.doc.lineAt(from);
  return sourceLine(from)
    ? [cached("line", "cm-lr-fence").range(line.from)]
    : [
        cached("line", "cm-lr-fence").range(line.from),
        cached("line", "cm-lr-fence-hidden").range(line.from),
        ...hideRange(from, line.to),
      ];
};

const fencedCode: PreviewRule = {
  nodes: ["FencedCode"],
  decorate: (node, { state, sourceLine }) => {
    return [
      ...lineClasses(state, node.from, node.to, "cm-lr-codeblock"),
      ...node.node.getChildren("CodeMark").flatMap((mark) => fence(state, sourceLine, mark.from)),
    ];
  },
};

const codeBlock: PreviewRule = {
  nodes: ["CodeBlock"],
  decorate: (node, { state }) => lineClasses(state, node.from, node.to, "cm-lr-codeblock"),
};

const horizontalRule: PreviewRule = {
  nodes: ["HorizontalRule"],
  decorate: (node, { state, sourceLine }) =>
    sourceLine(node.from)
      ? []
      : [...lineClasses(state, node.from, node.from, "cm-lr-hr"), ...hideRange(node.from, node.to)],
};

/** The alignment of the columns, from the delimiter row (`|:--|:-:|--:|`). */
export const alignments = (delimiterRow: string): Align[] =>
  delimiterRow
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((column) => {
      const cell = column.trim();
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      if (left && right) {
        return "center";
      }
      return left ? "left" : right ? "right" : undefined;
    });

const tableData = (state: EditorState, table: SyntaxNode): TableData => {
  const cells = (row: SyntaxNode) =>
    row.getChildren("TableCell").map((cell) => inlineSegments(state, cell.from, cell.to));
  let align: Align[] = [];
  let header: ReturnType<typeof cells> = [];
  const body: ReturnType<typeof cells>[] = [];
  for (let child = table.firstChild; child !== null; child = child.nextSibling) {
    if (child.name === "TableHeader") {
      header = cells(child);
    } else if (child.name === "TableRow") {
      body.push(cells(child));
    } else {
      // The only other child is the delimiter row.
      align = alignments(state.doc.sliceString(child.from, child.to));
    }
  }
  return { align, header, body };
};

// Assumption A1 (spec question #420): a table row cannot be set while the next row is source, so the
// whole table shows its source while the cursor is in any of its rows. A table that does not start at
// the beginning of a line (inside a list item or a quote) cannot be a block widget: it stays source.
const table: PreviewRule = {
  nodes: ["Table"],
  decorate: (node, { state, sourceLine }) => {
    const first = state.doc.lineAt(node.from);
    const last = state.doc.lineAt(node.to);
    let touched = node.from !== first.from;
    for (let number = first.number; number <= last.number; number += 1) {
      touched ||= sourceLine(state.doc.line(number).from);
    }
    return touched
      ? lineClasses(state, node.from, node.to, "cm-lr-table-source")
      : [
          Decoration.replace({ widget: new TableWidget(tableData(state, node.node)), block: true }).range(
            first.from,
            last.to,
          ),
        ];
  },
};

export const BUILT_IN_RULES: readonly PreviewRule[] = [
  ...[1, 2, 3, 4, 5, 6].map(heading),
  setextHeading(1),
  setextHeading(2),
  inline,
  listMark,
  taskMarker,
  blockquote,
  quoteMark,
  fencedCode,
  codeBlock,
  horizontalRule,
  table,
];

/** All decorations of the preview for `state`; pure, so the node tests can read them. */
export const previewDecorations = (
  state: EditorState,
  rules: readonly PreviewRule[],
  focused: boolean,
): DecorationSet => {
  const lines = sourceLines(state, focused);
  const context: PreviewContext = {
    state,
    sourceLine: (pos) => lines.has(state.doc.lineAt(pos).number),
  };
  const byName = new Map<string, PreviewRule[]>();
  for (const rule of rules) {
    for (const name of rule.nodes) {
      byName.set(name, [...(byName.get(name) ?? []), rule]);
    }
  }
  const ranges: Ranges = [];
  syntaxTree(state).iterate({
    enter: (node: SyntaxNodeRef) => {
      const all = byName.get(node.name) ?? [];
      const owners = all.filter((rule) => rule.owns?.(node, context) === true);
      for (const rule of owners.length > 0 ? owners : all) {
        ranges.push(...rule.decorate(node, context));
      }
    },
  });
  return Decoration.set(ranges, true);
};

/** The preview as an editor extension; the rules are the built-in ones and those of the plugins. */
export const livePreview = (rules: readonly PreviewRule[]): Extension => [
  focusState,
  StateField.define<DecorationSet>({
    create: (state) => previewDecorations(state, rules, false),
    update: (value, transaction) =>
      transaction.docChanged ||
      transaction.selection !== undefined ||
      transaction.startState.field(focusState) !== transaction.state.field(focusState) ||
      syntaxTree(transaction.startState) !== syntaxTree(transaction.state) ||
      transaction.effects.some((effect) => effect.is(refreshPreview))
        ? previewDecorations(transaction.state, rules, transaction.state.field(focusState))
        : value,
    provide: (field) => EditorView.decorations.from(field),
  }),
];
