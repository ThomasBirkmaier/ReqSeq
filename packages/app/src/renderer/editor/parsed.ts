// The syntax tree as far as a key needs it. CodeMirror parses a document in slices: the first parse and the
// parse after a change stop after 20 ms, and the rest follows in idle time. On a busy machine a key can come
// before that rest, and a command that reads the tree then misses the list, link or code it is in (Enter did
// not continue a list, Ctrl/Cmd+Enter found no reference); and the formatting that came with the rest changed
// the height of the text under the pointer (#542).
// - A new editor parses for at most `FIRST_PAINT_MS` more before it is first painted (`parseAhead`), so an
//   ordinary text (some hundred lines) shows formatted from the start. A long one (thousands of lines) shows
//   the rest formatted when the idle parse gets there, as before.
// - The commands that act on a key read the tree through `parsedTree` and `parsedFirst`, which first finish
//   the parse past the top-level block around the caret (the whole list, table or paragraph: Enter renumbers
//   the items after the caret, a table row needs the line after it), however long that takes. Once the idle
//   parse is there this costs nothing; in a long text right after opening it is the parse of the text above
//   the caret and of its block.
import { ensureSyntaxTree, forceParsing, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";
import type { Tree } from "@lezer/common";

/** No time limit: the parse runs as far as asked, however long the machine needs for it. */
const WHOLE = Number.POSITIVE_INFINITY;

/** How long a new editor parses before its first paint, beyond CodeMirror's own 20 ms (about three frames). */
export const FIRST_PAINT_MS = 50;

/** The end of the line at `pos`: a command at the caret needs the tree at least that far. */
const lineEnd = (state: EditorState, pos: number): number => state.doc.lineAt(pos).to;

/**
 * The top-level block around `pos` (a child of the document) is closed in `tree`: the next block has begun,
 * so the parse went past its end. Between two blocks there is nothing to close.
 */
const closedAt = (tree: Tree, pos: number): boolean => {
  let block = tree.resolveInner(pos, -1);
  while (block.parent !== null && block.parent.parent !== null) {
    block = block.parent;
  }
  return block.parent === null || tree.topNode.childAfter(block.to) !== null;
};

/**
 * How far a command at `pos` needs the parse: past the end of the top-level block around it. From the end
 * of its line the reach doubles until the block is closed or the document ends. Parsed on the way.
 */
const reach = (state: EditorState, pos: number): number => {
  const { length } = state.doc;
  for (let upto = lineEnd(state, pos); ; upto = Math.min(length, upto * 2 + 1)) {
    const tree = ensureSyntaxTree(state, upto, WHOLE);
    if (tree === null || upto >= length || closedAt(tree, pos)) {
      return upto;
    }
  }
};

/** The syntax tree of `state`, parsed first past the block around `pos` (default: the whole document). */
export const parsedTree = (state: EditorState, pos = state.doc.length): Tree =>
  ensureSyntaxTree(state, reach(state, pos), WHOLE) ?? syntaxTree(state);

/**
 * Parses the document of a new editor for at most `FIRST_PAINT_MS` and gives the editor the tree, in steps
 * from the end of the viewport that each finish, so what was parsed in time is in the first paint.
 */
export const parseAhead = (view: EditorView): void => {
  const end = Date.now() + FIRST_PAINT_MS;
  const { length } = view.state.doc;
  for (let upto = Math.min(length, Math.max(view.viewport.to, 1)); ; upto = Math.min(length, upto * 2)) {
    const left = end - Date.now();
    if (left <= 0 || !forceParsing(view, upto, left) || upto >= length) {
      return;
    }
  }
};

/** `command`, run once the state holds the tree past the block of every caret (it reads `syntaxTree`). */
export const parsedFirst =
  (command: Command): Command =>
  (view) => {
    const { state } = view;
    forceParsing(view, Math.max(...state.selection.ranges.map((range) => reach(state, range.to))), WHOLE);
    return command(view);
  };
