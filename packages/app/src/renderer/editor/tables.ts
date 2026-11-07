// Editing tables (SR-188): Tab and Shift+Tab go from cell to cell (AK1), "Align table" lines the pipes up in the
// file (AK2), and "Insert row", "Insert column", "Delete row" and "Delete column" change the table at the caret
// (AK3). Each change is one transaction that is one undo step of its own (AK4). Nothing here runs by itself:
// the tool never aligns a table unless "Align table" is asked for.
//
// The tree (`parsed.ts`) finds the table and its rows (`Table` with `TableHeader`, the delimiter row as a
// `TableDelimiter` child and `TableRow`); the cells of a row are split here the way @lezer/markdown splits them,
// at each `|` that no `\` escapes. As in GFM, a `|` in inline code ends the cell too, unless it is escaped.
// Widths count characters as a reader does (grapheme clusters): a wide character (CJK, emoji) counts one, so
// its column lines up in the file by characters, not by its width on screen.
import { completionStatus } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { Prec } from "@codemirror/state";
import type { ChangeSpec, EditorState, TransactionSpec } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { nth } from "../lists.js";
import { parsedTree } from "./parsed.js";
import type { EditorPlugins } from "./plugins.js";

/** The user event of a table change: input, but not typing, so the history never joins it to a typed change. */
export const TABLE_EVENT = "input.table";

/** One line of a table, split into cells. */
interface Row {
  /** Where the row starts (after a quote or list indentation, which is `prefix`). */
  readonly from: number;
  /** The end of its line. */
  readonly to: number;
  readonly prefix: string;
  readonly delimiter: boolean;
  /**
   * The cell borders, as positions in the document: a pipe, or the start or end of the row where it has none
   * (then one before `from`, or `to`). Cell `i` lies between `edges[i]` and `edges[i + 1]`.
   */
  readonly edges: readonly number[];
  readonly leading: boolean;
  readonly trailing: boolean;
}

interface Table {
  /** The header first, then the delimiter row, then the body rows. */
  readonly rows: readonly Row[];
  /** The number of cells of the header. */
  readonly columns: number;
}

/** A cell's content without its white space, as positions in the document. */
interface Span {
  readonly from: number;
  readonly to: number;
}

const cellCount = (row: Row): number => row.edges.length - 1;

/** The row starting at `from` on the line that ends at `to`. */
const rowAt = (state: EditorState, from: number, to: number, delimiter: boolean): Row => {
  const text = state.doc.sliceString(from, to);
  const pipes: number[] = [];
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "|" && !escaped) {
      pipes.push(from + i);
    }
    escaped = !escaped && char === "\\";
  }
  const first = from + text.length - text.trimStart().length;
  const last = from + text.trimEnd().length - 1;
  const leading = pipes[0] === first;
  const trailing = pipes.at(-1) === last && (!leading || pipes.length > 1);
  const inner = pipes.slice(leading ? 1 : 0, trailing ? -1 : undefined);
  const edges = [leading ? nth(pipes, 0) : from - 1, ...inner, trailing ? nth(pipes, -1) : to];
  const line = state.doc.lineAt(from);
  return { from, to, prefix: state.doc.sliceString(line.from, from), delimiter, edges, leading, trailing };
};

/** The table whose lines hold `pos`, read from the tree, or null. */
const tableAt = (state: EditorState, pos: number): Table | null => {
  const line = state.doc.lineAt(pos);
  let found: Table | null = null;
  parsedTree(state, pos).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.name !== "Table") {
        return undefined;
      }
      const rows: Row[] = [];
      for (let child = node.node.firstChild; child !== null; child = child.nextSibling) {
        if (child.name === "TableHeader" || child.name === "TableRow" || child.name === "TableDelimiter") {
          rows.push(
            rowAt(state, child.from, state.doc.lineAt(child.from).to, child.name === "TableDelimiter"),
          );
        }
      }
      found = { rows, columns: cellCount(nth(rows, 0)) };
      return false;
    },
  });
  return found;
};

/** The index of the row on the line of `pos`. */
const rowIndex = (state: EditorState, table: Table, pos: number): number => {
  const { number } = state.doc.lineAt(pos);
  return table.rows.findIndex((row) => state.doc.lineAt(row.from).number === number);
};

/** The cell of `row` that holds `pos`: a caret right after a pipe is in the cell after it. */
const cellIndex = (row: Row, pos: number): number => {
  const index = row.edges.findIndex((edge, i) => i > 0 && pos <= edge);
  return index < 1 ? cellCount(row) - 1 : index - 1;
};

/** The content of cell `index` of `row` without its white space. */
const contentOf = (state: EditorState, row: Row, index: number): Span => {
  const start = nth(row.edges, index) + 1;
  const end = nth(row.edges, index + 1);
  const text = state.doc.sliceString(start, end);
  const from = start + (text.length - text.trimStart().length);
  return { from, to: Math.max(from, start + text.trimEnd().length) };
};

/** Where the caret goes in a cell: its content selected, or in an empty cell after one space. */
const cellSelection = (state: EditorState, row: Row, index: number): { anchor: number; head: number } => {
  const content = contentOf(state, row, index);
  if (content.from < content.to) {
    return { anchor: content.from, head: content.to };
  }
  const start = nth(row.edges, index) + 1;
  const end = nth(row.edges, index + 1);
  const caret = Math.min(start + 1, end);
  return { anchor: caret, head: caret };
};

/** The transaction of `changes` as a table change: its own undo step. */
const tableTransaction = (
  changes: readonly ChangeSpec[],
  selection: { anchor: number },
): TransactionSpec => ({
  changes: [...changes],
  selection,
  userEvent: TABLE_EVENT,
  annotations: isolateHistory.of("full"),
  scrollIntoView: true,
});

/** The caret's place in a table: the table, the row and the cell. */
interface Place {
  readonly table: Table;
  readonly row: number;
  readonly cell: number;
}

const placeOf = (state: EditorState): Place | null => {
  const { head } = state.selection.main;
  const table = tableAt(state, head);
  if (table === null) {
    return null;
  }
  const row = rowIndex(state, table, head);
  return { table, row, cell: cellIndex(nth(table.rows, row), head) };
};

/**
 * An empty row for `table`, after the prefix of `after`: as wide per cell as the header where the header has
 * pipes on both sides (so an aligned table stays aligned), otherwise `|  |  |`. With the start of each cell.
 */
const emptyRow = (table: Table, after: Row): { text: string; cells: readonly number[] } => {
  const header = nth(table.rows, 0);
  const framed = header.leading && header.trailing;
  let text = `${after.prefix}|`;
  const cells: number[] = [];
  for (let i = 0; i < table.columns; i++) {
    const width = framed ? Math.max(2, nth(header.edges, i + 1) - nth(header.edges, i) - 1) : 2;
    cells.push(text.length + 1);
    text += `${" ".repeat(width)}|`;
  }
  return { text, cells };
};

/** Inserts an empty row after row `index` of `table` and puts the caret into its cell `cell`. */
const insertRowAfter = (view: EditorView, table: Table, index: number, cell: number): void => {
  const after = nth(table.rows, index);
  const row = emptyRow(table, after);
  const at = after.to + 1;
  view.dispatch(
    tableTransaction([{ from: after.to, insert: `\n${row.text}` }], {
      anchor: at + nth(row.cells, Math.min(cell, row.cells.length - 1)),
    }),
  );
};

/** The rows the caret goes through with Tab: the header and the body, not the delimiter row. */
const cellRows = (table: Table): readonly number[] =>
  table.rows.flatMap((row, index) => (row.delimiter ? [] : [index]));

/**
 * Tab or Shift+Tab in a table (AK1): the next or the previous cell, its content selected; Tab after the last
 * cell adds an empty row and puts the caret into its first cell. False outside a table and while a menu at the
 * caret is open (the slash menu, a completion), so Tab keeps its meaning there. Shift+Tab in the first cell
 * stays in it, so it does not leave the editor from inside a table.
 */
const moveCell =
  (by: 1 | -1): Command =>
  (view) => {
    const { state } = view;
    if (completionStatus(state) === "active") {
      return false;
    }
    const place = placeOf(state);
    if (place === null) {
      return false;
    }
    const { table } = place;
    const order = cellRows(table);
    // On the delimiter row, Tab goes to the first body cell and Shift+Tab to the last header cell.
    const rowAtCaret = nth(table.rows, place.row);
    let at = rowAtCaret.delimiter ? order.indexOf(place.row - 1) : order.indexOf(place.row);
    let cell = rowAtCaret.delimiter ? (by === 1 ? table.columns : table.columns - 1) : place.cell + by;
    for (;;) {
      const row = nth(table.rows, nth(order, at));
      if (cell >= 0 && cell < cellCount(row)) {
        view.dispatch({
          selection: cellSelection(state, row, cell),
          scrollIntoView: true,
          userEvent: "select",
        });
        return true;
      }
      if (by === 1 && at === order.length - 1) {
        if (state.readOnly) {
          return true;
        }
        insertRowAfter(view, table, nth(order, at), 0);
        return true;
      }
      if (by === -1 && at === 0) {
        view.dispatch({ selection: cellSelection(state, row, 0), userEvent: "select" });
        return true;
      }
      at += by;
      cell = by === 1 ? 0 : cellCount(nth(table.rows, nth(order, at))) - 1;
    }
  };

/** Tab: the next cell (AK1). */
export const nextCell: Command = moveCell(1);

/** Shift+Tab: the cell before (AK1). */
export const previousCell: Command = moveCell(-1);

/** The keys of the table, before Tab's other meanings in the text (`Prec.high`). */
export const tableEditing: EditorPlugins = {
  extensions: [
    Prec.high(
      keymap.of([
        { key: "Tab", run: nextCell },
        { key: "Shift-Tab", run: previousCell },
      ]),
    ),
  ],
};

/** The place at the caret of an editable text, or null. */
const editablePlace = (view: EditorView): Place | null => (view.state.readOnly ? null : placeOf(view.state));

type Align = "left" | "center" | "right";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The width of `text` in characters as a reader counts them (`é` as one, also when it is `e` and an accent). */
const characters = (text: string): number => Array.from(graphemes.segment(text)).length;

/** `text` padded to `width` the way its column is aligned (`:---:` centred, `---:` right, else left). */
const pad = (text: string, width: number, align: Align): string => {
  const space = width - characters(text);
  const before = align === "right" ? space : align === "center" ? Math.floor(space / 2) : 0;
  return `${" ".repeat(before)}${text}${" ".repeat(space - before)}`;
};

/**
 * "Align table" (AK2): every row as `| a | b |`, each column as wide as its widest cell, the delimiter row
 * widened with its colons kept, so the pipes line up in the file. A row with fewer cells than the header gets
 * empty ones (GFM reads missing cells as empty). The caret stays in its cell.
 */
export const alignTable: Command = (view) => {
  const place = editablePlace(view);
  if (place === null) {
    return false;
  }
  const { state } = view;
  const { table } = place;
  const cells = table.rows.map((row) => {
    const texts = Array.from({ length: cellCount(row) }, (_, i) => {
      const span = contentOf(state, row, i);
      return state.doc.sliceString(span.from, span.to);
    });
    return [...texts, ...Array.from({ length: Math.max(0, table.columns - texts.length) }, () => "")];
  });
  const delimiterIndex = table.rows.findIndex((row) => row.delimiter);
  const delimiters = nth(cells, delimiterIndex);
  const colons = delimiters.map((cell) => ({
    left: cell.startsWith(":") ? ":" : "",
    right: cell.length > 1 && cell.endsWith(":") ? ":" : "",
  }));
  const aligns = colons.map(({ left, right }): Align =>
    right === "" ? "left" : left === "" ? "right" : "center",
  );
  // At least three wide, so `:-:` keeps a dash; the delimiter row's own dashes do not count.
  const widths: number[] = [];
  cells.forEach((row, index) => {
    row.forEach((cell, column) => {
      widths[column] = Math.max(widths[column] ?? 3, index === delimiterIndex ? 3 : characters(cell));
    });
  });
  const lines = cells.map((row, index) =>
    row.map((cell, column) => {
      const width = nth(widths, column);
      const colon = colons[column];
      if (index !== delimiterIndex || colon === undefined) {
        return pad(cell, width, aligns[column] ?? "left");
      }
      return `${colon.left}${"-".repeat(width - colon.left.length - colon.right.length)}${colon.right}`;
    }),
  );
  const changes = table.rows.map((row, index) => ({
    from: row.from,
    to: row.to,
    insert: `| ${nth(lines, index).join(" | ")} |`,
  }));
  // The caret keeps its place in its cell's content.
  const row = nth(table.rows, place.row);
  const line = nth(lines, place.row);
  const cell = Math.min(place.cell, line.length - 1);
  const text = nth(line, cell);
  const content = contentOf(state, row, Math.min(cell, cellCount(row) - 1));
  const into = Math.min(Math.max(0, state.selection.main.head - content.from), text.trim().length);
  const offset =
    2 +
    line.slice(0, cell).reduce((sum, before) => sum + before.length + 3, 0) +
    (text.length - text.trimStart().length) +
    into;
  view.dispatch(tableTransaction(changes, { anchor: state.changes(changes).mapPos(row.from, -1) + offset }));
  return true;
};

/**
 * "Insert row" (AK3): an empty row below the caret's row, with the caret in it in the caret's column; on the
 * header or the delimiter row it becomes the first body row.
 */
export const insertRow: Command = (view) => {
  const place = editablePlace(view);
  if (place === null) {
    return false;
  }
  const { table } = place;
  const after = place.row === 0 ? 1 : place.row;
  insertRowAfter(view, table, after, nth(table.rows, place.row).delimiter ? 0 : place.cell);
  return true;
};

/** "Insert column" (AK3): an empty column right of the caret's column (`---` in the delimiter row), the caret in it. */
export const insertColumn: Command = (view) => {
  const place = editablePlace(view);
  if (place === null) {
    return false;
  }
  const { state } = view;
  const { table } = place;
  const column = Math.min(place.cell, table.columns - 1);
  let caret = { at: state.selection.main.head, by: 0 };
  const changes: ChangeSpec[] = [];
  table.rows.forEach((row, index) => {
    if (cellCount(row) <= column) {
      // A missing cell is empty already, and so is the one right of it.
      return;
    }
    const content = row.delimiter ? "---" : "";
    const edge = nth(row.edges, column + 1);
    const open = column + 1 < cellCount(row) || row.trailing;
    const change = open
      ? { from: edge + 1, insert: ` ${content} |`, by: 1 }
      : { from: edge, insert: ` | ${content}`, by: 3 };
    changes.push({ from: change.from, insert: change.insert });
    if (index === place.row) {
      caret = { at: change.from, by: change.by };
    }
  });
  const set = state.changes(changes);
  view.dispatch(tableTransaction(changes, { anchor: set.mapPos(caret.at, -1) + caret.by }));
  return true;
};

/**
 * "Delete row" (AK3): the caret's row, with the caret in the same column of the row after it, or of the row
 * before when it was the last. False on the header and the delimiter row, which a table cannot lose.
 */
export const deleteRow: Command = (view) => {
  const place = editablePlace(view);
  const row = place?.table.rows[place.row];
  if (place === null || row === undefined || place.row < 2) {
    return false;
  }
  const { state } = view;
  const { table } = place;
  const line = state.doc.lineAt(row.from);
  const change =
    line.to < state.doc.length ? { from: line.from, to: line.to + 1 } : { from: line.from - 1, to: line.to };
  // The row after it, or before it when it was the last; the delimiter row stands for the header.
  const target = nth(
    table.rows,
    place.row + 1 < table.rows.length ? place.row + 1 : place.row - 1 === 1 ? 0 : place.row - 1,
  );
  const cell = Math.min(place.cell, cellCount(target) - 1);
  const anchor = state.changes([change]).mapPos(contentOf(state, target, cell).from);
  view.dispatch(tableTransaction([change], { anchor }));
  return true;
};

/**
 * "Delete column" (AK3): the caret's column in every row, with its pipe, and the caret in the column that takes
 * its place. False when the table has one column left.
 */
export const deleteColumn: Command = (view) => {
  const place = editablePlace(view);
  if (place === null || place.table.columns < 2) {
    return false;
  }
  const { state } = view;
  const { table } = place;
  const column = Math.min(place.cell, table.columns - 1);
  const changes: ChangeSpec[] = [];
  for (const row of table.rows) {
    const count = cellCount(row);
    if (count <= column) {
      continue;
    }
    const left = nth(row.edges, column);
    const right = nth(row.edges, column + 1);
    // The cell goes with the pipe after it; the last cell with the pipe before it.
    // A row of one cell keeps its pipe: then only the content goes.
    const removed =
      column + 1 < count
        ? { from: left + 1, to: right + 1 }
        : count === 1
          ? contentOf(state, row, 0)
          : { from: left, to: right };
    changes.push(removed);
    if (count === 2 && !row.leading && !row.trailing) {
      // One cell without a pipe is no table row: it keeps a pipe at its end.
      changes.push({ from: row.to, insert: " |" });
    }
  }
  const caretRow = nth(table.rows, place.row);
  const set = state.changes(changes);
  const count = cellCount(caretRow);
  const target = column + 1 < count ? column + 1 : Math.min(column, count) - 1;
  const anchor = set.mapPos(contentOf(state, caretRow, Math.max(0, target)).from);
  view.dispatch(tableTransaction(changes, { anchor }));
  return true;
};
