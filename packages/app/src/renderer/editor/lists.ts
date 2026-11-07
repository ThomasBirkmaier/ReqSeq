// Editing lists with the keyboard (SR-187): Tab and Shift+Tab indent and outdent the list item at the caret with
// its sub-items (AK1), and Alt+Up and Alt+Down (Option on macOS) move the item with its sub-items past its
// neighbour at the same level, or the line when the caret is not in a list item (AK2). Each change is one undo
// step of its own (AK4). Outside lists Tab and Shift+Tab are left alone (`false`), so they go on to the next or
// previous field as before; the table keys (`tables.ts`) take them in a table. The logic reads the syntax tree of
// the Markdown parser (lezer: `BulletList`, `OrderedList`, `ListItem`, `ListMark`), parsed past the caret's block
// first (`parsed.ts`).
import { completionStatus } from "@codemirror/autocomplete";
import { isolateHistory, moveLineDown, moveLineUp } from "@codemirror/commands";
import { EditorSelection, Prec } from "@codemirror/state";
import type { ChangeSpec, EditorState, Extension, SelectionRange, TransactionSpec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { Command } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { parsedTree } from "./parsed.js";

/** The user events of the list changes: none of them is typing, so the history never joins them to typing. */
export const LIST_EVENTS = { indent: "input.indent.list", move: "move.list" } as const;

/** Spaces a tab counts for in the indentation (CommonMark). */
const TAB = 4;

/** The column of offset `at` in `text` (a tab goes to the next multiple of four). */
const columnOf = (text: string, at: number): number => {
  let column = 0;
  for (let i = 0; i < at; i += 1) {
    column = text.charAt(i) === "\t" ? column + TAB - (column % TAB) : column + 1;
  }
  return column;
};

/** A list item as lines: its first line to the last line of its last sub-item. */
export interface ListItemLines {
  readonly node: SyntaxNode;
  /** The start of its first line. */
  readonly from: number;
  /** The end of its last line (before its line break). */
  readonly to: number;
}

const linesOf = (state: EditorState, node: SyntaxNode): ListItemLines => {
  const { doc } = state;
  const first = doc.lineAt(node.from);
  let last = doc.lineAt(node.to);
  if (last.from === node.to && node.to > first.to) {
    last = doc.lineAt(node.to - 1);
  }
  // A list item can end in blank lines (a loose list): they stay between the items.
  while (last.number > first.number && last.text.trim() === "") {
    last = doc.line(last.number - 1);
  }
  return { node, from: first.from, to: last.to };
};

/** Whether only white space comes before the mark of `item` on its line (no quote mark, no outer mark). */
const markStartsLine = (state: EditorState, item: SyntaxNode): boolean => {
  const line = state.doc.lineAt(item.from);
  return line.text.slice(0, item.from - line.from).trim() === "";
};

/** The innermost list item the line at `pos` belongs to, whose mark starts its line; undefined outside lists. */
export const listItemAt = (state: EditorState, pos: number): ListItemLines | undefined => {
  const line = state.doc.lineAt(pos);
  const indent = line.text.length - line.text.trimStart().length;
  let node: SyntaxNode | null = parsedTree(state, pos).resolveInner(line.from + indent, 1);
  while (node !== null && node.name !== "ListItem") {
    node = node.parent;
  }
  return node === null || !markStartsLine(state, node) ? undefined : linesOf(state, node);
};

const sibling = (node: SyntaxNode, forward: boolean): SyntaxNode | null => {
  const next = forward ? node.nextSibling : node.prevSibling;
  return next?.name === "ListItem" ? next : null;
};

/** The column of the mark of `item` and the column its content starts at (where a sub-item's mark goes). */
const columns = (
  state: EditorState,
  item: SyntaxNode,
): { readonly mark: number; readonly content: number } => {
  const line = state.doc.lineAt(item.from);
  const mark = item.getChild("ListMark");
  const markEnd = (mark?.to ?? item.from) - line.from;
  const rest = line.text.slice(markEnd);
  const spaces = rest.length - rest.trimStart().length;
  // After the mark one to four spaces belong to it; more (an indented code block) or none (end of line) count one.
  const gap = spaces >= 1 && spaces <= TAB && rest.trim() !== "" ? spaces : 1;
  return { mark: columnOf(line.text, item.from - line.from), content: columnOf(line.text, markEnd) + gap };
};

/** The items a change at the selection acts on: the one at the head, and its siblings below it that the selection reaches. */
const selectedItems = (state: EditorState): readonly ListItemLines[] | undefined => {
  const range = state.selection.main;
  const first = listItemAt(state, range.from);
  if (first === undefined) {
    return undefined;
  }
  const items = [first];
  const end = range.empty ? range.to : range.to - 1;
  for (let next = sibling(first.node, true); next !== null && next.from <= end; next = sibling(next, true)) {
    items.push(linesOf(state, next));
  }
  return items;
};

/** The changes that shift the non-blank lines from `from` to `to` by `by` columns (outdent: up to that many). */
const shiftLines = (state: EditorState, from: number, to: number, by: number): ChangeSpec[] => {
  const changes: ChangeSpec[] = [];
  for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n += 1) {
    const line = state.doc.line(n);
    if (line.text.trim() !== "") {
      if (by > 0) {
        changes.push({ from: line.from, insert: " ".repeat(by) });
      } else {
        let cut = 0;
        while (
          cut < line.text.length &&
          /[ \t]/u.test(line.text.charAt(cut)) &&
          columnOf(line.text, cut + 1) <= -by
        ) {
          cut += 1;
        }
        if (cut > 0) {
          changes.push({ from: line.from, to: line.from + cut });
        }
      }
    }
  }
  return changes;
};

const listChange = (
  changes: ChangeSpec[],
  userEvent: string,
  selection?: EditorSelection,
): TransactionSpec => ({
  changes,
  ...(selection === undefined ? {} : { selection }),
  userEvent,
  annotations: isolateHistory.of("full"),
  scrollIntoView: true,
});

/** A menu at the caret (the slash menu) takes Tab itself. */
const menuOpen = (state: EditorState): boolean => completionStatus(state) === "active";

/**
 * Tab in a list item: the item with its sub-items (and the siblings the selection reaches) becomes a sub-item of the
 * item before it, indented to its content. The first item of a list has none to go under: nothing changes, and the
 * key is taken all the same, so it does not leave the text. False outside lists.
 */
export const indentListItem: Command = (view) => {
  const { state } = view;
  const items = menuOpen(state) ? undefined : selectedItems(state);
  const first = items?.[0];
  if (items === undefined || first === undefined) {
    return false;
  }
  const before = sibling(first.node, false);
  if (before !== null && !state.readOnly) {
    const by = columns(state, before).content - columns(state, first.node).mark;
    const last = items[items.length - 1] ?? first;
    view.dispatch(listChange(shiftLines(state, first.from, last.to, by), LIST_EVENTS.indent));
  }
  return true;
};

/**
 * Shift+Tab in a sub-item: the item with its sub-items moves out to the level of its parent item; the items after
 * it in its list then are its sub-items, as in an outliner. An item at the top level stays; the key is taken.
 * False outside lists.
 */
export const outdentListItem: Command = (view) => {
  const { state } = view;
  const items = menuOpen(state) ? undefined : selectedItems(state);
  const first = items?.[0];
  if (items === undefined || first === undefined) {
    return false;
  }
  const parent = first.node.parent?.parent;
  if (parent?.name === "ListItem" && !state.readOnly) {
    const by = columns(state, first.node).mark - columns(state, parent).mark;
    const last = items[items.length - 1] ?? first;
    view.dispatch(listChange(shiftLines(state, first.from, last.to, -by), LIST_EVENTS.indent));
  }
  return true;
};

/** The number of an ordered item's mark (`3.` → `3`), with its text. */
const numberOf = (
  state: EditorState,
  item: SyntaxNode,
): { readonly from: number; readonly text: string } | undefined => {
  const mark = item.getChild("ListMark");
  if (mark === null || item.parent?.name !== "OrderedList") {
    return undefined;
  }
  return { from: mark.from, text: state.doc.sliceString(mark.from, mark.to - 1) };
};

/** A range moved with its block keeps its place in it; one in the other block likewise. */
const mapRange = (
  range: SelectionRange,
  blocks: readonly { from: number; to: number; by: number }[],
): SelectionRange => {
  const shift = (pos: number): number => {
    const block = blocks.find((entry) => pos >= entry.from && pos <= entry.to);
    return block === undefined ? pos : pos + block.by;
  };
  return EditorSelection.range(shift(range.anchor), shift(range.head));
};

/**
 * Swaps the list item `upper` with the item `lower` after it, each with its sub-items; what lies between them (a
 * blank line of a loose list) stays between them. In an ordered list the numbers stay at their places (the first
 * of the two keeps the first number), when both have the same width.
 */
const swapItems = (state: EditorState, upper: ListItemLines, lower: ListItemLines): TransactionSpec => {
  const top = state.doc.sliceString(upper.from, upper.to);
  const between = state.doc.sliceString(upper.to, lower.from);
  const bottom = state.doc.sliceString(lower.from, lower.to);
  const one = numberOf(state, upper.node);
  const two = numberOf(state, lower.node);
  const renumber = (text: string, at: number, from: string, to: string): string =>
    text.slice(0, at) + to + text.slice(at + from.length);
  // Both numbers of the same width: they trade places (a change of width would move the sub-items).
  const numbers = one !== undefined && two?.text.length === one.text.length ? { one, two } : undefined;
  const newTop =
    numbers === undefined
      ? bottom
      : renumber(bottom, numbers.two.from - lower.from, numbers.two.text, numbers.one.text);
  const newBottom =
    numbers === undefined
      ? top
      : renumber(top, numbers.one.from - upper.from, numbers.one.text, numbers.two.text);
  const blocks = [
    { from: upper.from, to: upper.to, by: newTop.length + between.length },
    { from: lower.from, to: lower.to, by: upper.from - lower.from },
  ];
  return listChange(
    [{ from: upper.from, to: lower.to, insert: newTop + between + newBottom }],
    LIST_EVENTS.move,
    EditorSelection.create(
      state.selection.ranges.map((range) => mapRange(range, blocks)),
      state.selection.mainIndex,
    ),
  );
};

/**
 * Alt+Up or Alt+Down: in a list item, the item with its sub-items moves one place past its neighbour at the same
 * level; at the end of its list it stays (the key is taken). Elsewhere the line (or the lines of the selection)
 * moves one line, as CodeMirror's own command does.
 */
export const moveListItemOrLine =
  (forward: boolean): Command =>
  (view) => {
    const { state } = view;
    if (state.readOnly) {
      return false;
    }
    const item = listItemAt(state, state.selection.main.head);
    if (item === undefined) {
      return forward ? moveLineDown(view) : moveLineUp(view);
    }
    const neighbour = sibling(item.node, forward);
    if (neighbour !== null) {
      const other = linesOf(state, neighbour);
      view.dispatch(forward ? swapItems(state, item, other) : swapItems(state, other, item));
    }
    return true;
  };

/** The list keys of the text (highest of the text's own keymaps after the slash menu, which takes Tab while open). */
export const listKeys = (): Extension =>
  Prec.high(
    keymap.of([
      { key: "Tab", run: indentListItem, shift: outdentListItem },
      { key: "Alt-ArrowUp", run: moveListItemOrLine(false), preventDefault: true },
      { key: "Alt-ArrowDown", run: moveListItemOrLine(true), preventDefault: true },
    ]),
  );
