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
import type { ChangeSpec, EditorState, Extension, TransactionSpec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { Command } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { parsedTree } from "./parsed.js";

/** The user events of the list changes: none of them is typing, so the history never joins them to typing. */
export const LIST_EVENTS = { indent: "input.indent.list", move: "move.list", drag: "move.drop" } as const;

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

/** The items of the list `item` is in, at its level, in order. */
export const siblingsOf = (state: EditorState, item: SyntaxNode): readonly ListItemLines[] => {
  const all: ListItemLines[] = [];
  for (let node = item.parent?.firstChild ?? null; node !== null; node = node.nextSibling) {
    if (node.name === "ListItem") {
      all.push(linesOf(state, node));
    }
  }
  return all;
};

/** The number of an ordered item's mark (`3.` gives `3`), as its offset in the item's block and its digits. */
const numberOf = (
  state: EditorState,
  item: ListItemLines,
): { readonly at: number; readonly digits: string } | undefined => {
  const mark = item.node.getChild("ListMark");
  if (mark === null || item.node.parent?.name !== "OrderedList") {
    return undefined;
  }
  return { at: mark.from - item.from, digits: state.doc.sliceString(mark.from, mark.to - 1) };
};

/**
 * The block of an item with the number `next` in place of its own; when the width of the number changes, its
 * continuation lines shift by as much (only as far as they have room, when it shrinks), so its sub-items stay its.
 */
const renumbered = (
  block: string,
  number: { readonly at: number; readonly digits: string },
  next: string,
): string => {
  const width = next.length - number.digits.length;
  const [first = "", ...rest] = block.split("\n");
  const head = first.slice(0, number.at) + next + first.slice(number.at + number.digits.length);
  const shifted = rest.map((line) => {
    if (width > 0) {
      return line.trim() === "" ? line : " ".repeat(width) + line;
    }
    const room = line.length - line.trimStart().length;
    return line.slice(Math.min(room, -width));
  });
  return [head, ...shifted].join("\n");
};

/**
 * Moves `item` (with its sub-items) into the gap `gap` among its siblings: 0 before the first, `siblings.length`
 * after the last. The text between the items (line breaks, the blank lines of a loose list) stays at its places,
 * so the file keeps its blank lines. An ordered list numbered in sequence before is numbered in sequence after,
 * from the same start; one numbered otherwise keeps its numbers as typed. A range of the selection in an item moves
 * with it. Undefined when the gap is next to the item (no move). One undo step of its own, with `userEvent`.
 */
export const moveItemTo = (
  state: EditorState,
  item: ListItemLines,
  gap: number,
  userEvent: string = LIST_EVENTS.move,
): TransactionSpec | undefined => {
  const siblings = siblingsOf(state, item.node);
  const from = siblings.findIndex((entry) => entry.from === item.from);
  const first = siblings[0];
  const last = siblings[siblings.length - 1];
  if (
    from < 0 ||
    first === undefined ||
    last === undefined ||
    gap === from ||
    gap === from + 1 ||
    gap < 0 ||
    gap > siblings.length
  ) {
    return undefined;
  }
  const blocks = siblings.map((entry) => state.doc.sliceString(entry.from, entry.to));
  const between = siblings
    .slice(1)
    .map((entry, index) => state.doc.sliceString(siblings[index]?.to ?? 0, entry.from));
  const order = siblings.map((_, index) => index).filter((index) => index !== from);
  order.splice(gap > from ? gap - 1 : gap, 0, from);
  const numbers = siblings.map((entry) => numberOf(state, entry));
  const start = Number(numbers[0]?.digits ?? Number.NaN);
  const inSequence = numbers.every(
    (number, index) => number !== undefined && Number(number.digits) === start + index,
  );
  let text = "";
  const starts = new Map<number, number>();
  order.forEach((old, place) => {
    const number = numbers[old];
    const block = blocks[old] ?? "";
    starts.set(old, first.from + text.length);
    text += inSequence && number !== undefined ? renumbered(block, number, String(start + place)) : block;
    text += between[place] ?? "";
  });
  const moved = (pos: number): number => {
    const index = siblings.findIndex((entry) => pos >= entry.from && pos <= entry.to);
    const entry = siblings[index];
    const to = starts.get(index);
    if (entry === undefined || to === undefined) {
      return pos;
    }
    return Math.min(to + (pos - entry.from), first.from + text.length);
  };
  return listChange(
    [{ from: first.from, to: last.to, insert: text }],
    userEvent,
    EditorSelection.create(
      state.selection.ranges.map((range) => EditorSelection.range(moved(range.anchor), moved(range.head))),
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
    const index = siblingsOf(state, item.node).findIndex((entry) => entry.from === item.from);
    const change = moveItemTo(state, item, forward ? index + 2 : index - 1);
    if (change !== undefined) {
      view.dispatch(change);
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
