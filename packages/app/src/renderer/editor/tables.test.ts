// @vitest-environment happy-dom
import "../../../../../scripts/test-support/dom-selection.mjs";
import { autocompletion, completionStatus, startCompletion } from "@codemirror/autocomplete";
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { Command } from "@codemirror/view";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { TABLE_KEYS } from "./editor-keys.js";
import { markdownSupport } from "./markdown.js";
import {
  alignTable,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  nextCell,
  previousCell,
  tableEditing,
} from "./tables.js";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
});

const viewOf = (doc: string, anchor = 0, readOnly = false, extra: readonly Extension[] = []): EditorView => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        history(),
        markdownSupport({}),
        ...(tableEditing.extensions ?? []),
        EditorState.readOnly.of(readOnly),
        ...extra,
      ],
    }),
  });
  views.push(view);
  return view;
};

const text = (view: EditorView): string => view.state.doc.toString();
const selected = (view: EditorView): string =>
  view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
/** The position of the `n`-th `^` in `doc`, which is taken out. */
const at = (doc: string): [string, number] => [doc.replace("^", ""), doc.indexOf("^")];
const key = (view: EditorView, name: string, shift = false): boolean =>
  runScopeHandlers(view, new KeyboardEvent("keydown", { key: name, shiftKey: shift }), "editor");

/** Whether `doc` is read as one GFM table over all its lines (header and delimiter of the same width). */
const isTable = (doc: string): boolean => {
  const top = markdownLanguage.parser.parse(doc).topNode.firstChild;
  return top?.name === "Table" && top.from === 0 && top.to === doc.trimEnd().length;
};

const TABLE = "| a | b |\n|---|---|\n| 1 | 2 |";

describe("tables (SR-188)", () => {
  it("[SR-188/AK1] Tab and Shift+Tab go to the next and the cell before; Tab after the last cell adds a row", () => {
    const view = viewOf(`${TABLE}\n\nafter`, 2);
    expect(key(view, "Tab")).toBe(true);
    expect(selected(view)).toBe("b");
    // Over the delimiter row into the body.
    key(view, "Tab");
    expect(selected(view)).toBe("1");
    key(view, "Tab", true);
    expect(selected(view)).toBe("b");
    key(view, "Tab", true);
    expect(selected(view)).toBe("a");
    // In the first cell Shift+Tab stays there.
    expect(key(view, "Tab", true)).toBe(true);
    expect(selected(view)).toBe("a");
    view.dispatch({ selection: { anchor: TABLE.length } });
    key(view, "Tab");
    expect(text(view)).toBe(`${TABLE}\n|   |   |\n\nafter`);
    expect(view.state.selection.main.head).toBe(TABLE.length + 3);
    // Outside a table Tab is not taken.
    view.dispatch({ selection: { anchor: text(view).length } });
    expect(key(view, "Tab")).toBe(false);
    expect(key(view, "Tab", true)).toBe(false);
  });

  it("[SR-188/AK1] leaves Tab to a menu open at the caret", async () => {
    const menu = autocompletion({
      override: [() => ({ from: 2, options: [{ label: "entry" }] })],
      interactionDelay: 0,
    });
    const view = viewOf(TABLE, 2, false, [menu]);
    startCompletion(view);
    for (let wait = 0; wait < 50 && completionStatus(view.state) !== "active"; wait++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(completionStatus(view.state)).toBe("active");
    expect(nextCell(view)).toBe(false);
    // The key itself goes to the menu, not to the table.
    expect(key(view, "Tab")).toBe(false);
    expect(key(view, "Tab", true)).toBe(false);
    expect(view.state.selection.main.head).toBe(2);
    expect(text(view)).toBe(TABLE);
  });

  it("[SR-188/AK2] Align table lines the pipes up, keeps the alignment colons, escaped pipes and code", () => {
    const [doc, caret] = at(
      "x\n\n| a | long header |c\n|:--|:-:|--:\n| `x\\|y` | 2 |\n| é^ | \\| |\n\nafter",
    );
    const view = viewOf(doc, caret);
    expect(alignTable(view)).toBe(true);
    expect(text(view)).toBe(
      [
        "x",
        "",
        "| a      | long header |   c |",
        "| :----- | :---------: | --: |",
        "| `x\\|y` |      2      |     |",
        "| é      |     \\|      |     |",
        "",
        "after",
      ].join("\n"),
    );
    // The caret stays behind the "é".
    expect(view.state.sliceDoc(view.state.selection.main.head - 1, view.state.selection.main.head)).toBe("é");
    // Still a GFM table of three columns, its cells as before.
    const again = viewOf(text(view), text(view).indexOf("long") + 2);
    expect(alignTable(again)).toBe(true);
    expect(text(again)).toBe(text(view));
    expect(again.state.selection.main.head).toBe(text(view).indexOf("long") + 2);
    const wide = viewOf("| a |\n|---|\n| 1 | 2 |");
    alignTable(wide);
    expect(text(wide)).toBe("| a   |\n| --- |\n| 1   | 2   |");
    expect(alignTable(viewOf("no table"))).toBe(false);
    expect(isTable(text(view).slice(3, -7))).toBe(true);
  });

  it("[SR-188/AK2] aligns nothing without Align table: Insert row, Insert column and Tab's new row leave the other rows as they are", () => {
    const doc = "| a | long |\n|-|-|\n| 1 | 2 |";
    const rows = (view: EditorView): string[] => text(view).split("\n");
    const row = viewOf(doc, 2);
    insertRow(row);
    expect(rows(row)).toEqual(["| a | long |", "|-|-|", "|   |      |", "| 1 | 2 |"]);
    const column = viewOf(doc, 2);
    insertColumn(column);
    expect(rows(column)).toEqual(["| a |  | long |", "|-| --- |-|", "| 1 |  | 2 |"]);
    const tab = viewOf(doc, doc.length);
    key(tab, "Tab");
    expect(rows(tab).slice(0, 3)).toEqual(doc.split("\n"));
  });

  it("[SR-188/AK3] Insert row and column add empty ones below and right of the caret; Delete removes its row or column", () => {
    const [doc, caret] = at("| a | b |\n|---|--:|\n| 1^ | 2 |\n| 3 | 4 |");
    const view = viewOf(doc, caret);
    expect(insertRow(view)).toBe(true);
    expect(text(view)).toBe("| a | b |\n|---|--:|\n| 1 | 2 |\n|   |   |\n| 3 | 4 |");
    view.dispatch({ selection: { anchor: 4 } });
    expect(insertColumn(view)).toBe(true);
    expect(text(view)).toBe("| a |  | b |\n|---| --- |--:|\n| 1 |  | 2 |\n|   |  |   |\n| 3 |  | 4 |");
    expect(view.state.selection.main.head).toBe(6);
    expect(deleteColumn(view)).toBe(true);
    expect(text(view)).toBe("| a | b |\n|---|--:|\n| 1 | 2 |\n|   |   |\n| 3 | 4 |");
    view.dispatch({ selection: { anchor: text(view).indexOf("|   |   |") + 2 } });
    expect(deleteRow(view)).toBe(true);
    expect(text(view)).toBe("| a | b |\n|---|--:|\n| 1 | 2 |\n| 3 | 4 |");
    expect(view.state.sliceDoc(view.state.selection.main.head, view.state.selection.main.head + 1)).toBe("3");
  });

  it("[SR-188/AK4] undo takes each table change back in one step", () => {
    const view = viewOf(`${TABLE}\n`, 2);
    view.dispatch({ changes: { from: 2, insert: "!" }, userEvent: "input.type" });
    const commands: readonly Command[] = [alignTable, insertRow, insertColumn, deleteColumn];
    for (const command of commands) {
      const before = text(view);
      expect(command(view)).toBe(true);
      expect(text(view)).not.toBe(before);
      undo(view);
      expect(text(view)).toBe(before);
    }
    view.dispatch({ selection: { anchor: TABLE.length } });
    deleteRow(view);
    undo(view);
    expect(text(view)).toBe(`| !a | b |\n|---|---|\n| 1 | 2 |\n`);
    key(view, "Tab");
    undo(view);
    expect(text(view)).toBe(`| !a | b |\n|---|---|\n| 1 | 2 |\n`);
    undo(view);
    expect(text(view)).toBe(`${TABLE}\n`);
  });

  it("refuses what a table cannot lose, and changes nothing in a read-only text", () => {
    expect(deleteRow(viewOf(TABLE, 2))).toBe(false);
    expect(deleteRow(viewOf(TABLE, 12))).toBe(false);
    expect(deleteRow(viewOf("text", 2))).toBe(false);
    expect(deleteColumn(viewOf("| a |\n|---|\n| 1 |", 2))).toBe(false);
    for (const command of [alignTable, insertRow, insertColumn, deleteRow, deleteColumn]) {
      expect(command(viewOf(TABLE, 22, true))).toBe(false);
    }
    const locked = viewOf(TABLE, TABLE.length, true);
    expect(nextCell(locked)).toBe(true);
    expect(text(locked)).toBe(TABLE);
  });

  it("works on tables without outer pipes, in quotes, with short rows and on the delimiter row", () => {
    const view = viewOf("a | b\n--|--\n1 |", 0);
    expect(deleteColumn(view)).toBe(true);
    expect(text(view)).toBe(" b |\n-- |\n |");
    const last = viewOf("a | b\n--|--\n1 | 2", 4);
    expect(deleteColumn(last)).toBe(true);
    expect(text(last)).toBe("a  |\n-- |\n1  |");
    const open = viewOf("a | b\n--|--\n1", 4);
    expect(insertColumn(open)).toBe(true);
    expect(text(open)).toBe("a | b |  |\n--|-- | --- |\n1");
    expect(isTable(text(open))).toBe(true);
    expect(insertRow(viewOf("a | b\n--|--", 7))).toBe(true);
    const plain = viewOf("a | b\n--|--", 7);
    insertRow(plain);
    expect(text(plain)).toBe("a | b\n--|--\n|  |  |");
    const quoted = viewOf("> | a | b |\n> |---|---|\n> | 1 |", 3);
    insertRow(quoted);
    expect(text(quoted)).toBe("> | a | b |\n> |---|---|\n> |   |   |\n> | 1 |");
    expect(alignTable(quoted)).toBe(true);
    expect(text(quoted)).toBe("> | a   | b   |\n> | --- | --- |\n> |     |     |\n> | 1   |     |");
    // On the delimiter row Tab goes into the body and Shift+Tab into the last header cell.
    const delimiter = viewOf(TABLE, 12);
    nextCell(delimiter);
    expect(selected(delimiter)).toBe("1");
    delimiter.dispatch({ selection: { anchor: 12 } });
    previousCell(delimiter);
    expect(selected(delimiter)).toBe("b");
    // Shift+Tab from the first body cell goes to the last header cell; into an empty cell after one space.
    const empty = viewOf("| a |  |\n|---|---|\n| 1 | 2 |", 22);
    previousCell(empty);
    expect(empty.state.selection.main.head).toBe(6);
    // Delete column with the caret's row short of the column, and of the last body row.
    const short = viewOf("| a | b | c |\n|---|---|---|\n| 1 |", 10);
    expect(deleteColumn(short)).toBe(true);
    expect(text(short)).toBe("| a | b |\n|---|---|\n| 1 |");
    const two = viewOf(`${TABLE}\n| 3 | 4 |`, TABLE.length + 6);
    deleteRow(two);
    expect(selected(two)).toBe("");
    expect(two.state.sliceDoc(two.state.selection.main.head, two.state.selection.main.head + 1)).toBe("2");
    const tail = viewOf(TABLE, TABLE.length);
    deleteRow(tail);
    expect(text(tail)).toBe("| a | b |\n|---|---|");
    expect(selected(tail)).toBe("");
    // Insert column right of a short row leaves the row alone.
    const gap = viewOf("| a | b |\n|---|---|\n| 1 |", 6);
    expect(insertColumn(gap)).toBe(true);
    expect(text(gap)).toBe("| a | b |  |\n|---|---| --- |\n| 1 |");
  });

  it("[SR-188/AK1] Tab goes into the cell a short row lacks, giving it empty cells up to there", () => {
    const view = viewOf("| a | b | c |\n|---|---|---|\n| 1 |\n| 4 | 5 | 6 |", 28);
    key(view, "Tab");
    expect(text(view)).toBe("| a | b | c |\n|---|---|---|\n| 1 |  |\n| 4 | 5 | 6 |");
    expect(view.state.selection.main.head).toBe(34);
    expect(isTable(text(view))).toBe(true);
    undo(view);
    expect(text(view)).toBe("| a | b | c |\n|---|---|---|\n| 1 |\n| 4 | 5 | 6 |");
    // Shift+Tab from the row below goes to the last column, and a row without its closing pipe gets one.
    const back = viewOf("a | b | c\n--|--|--\n1\n4 | 5 | 6", 21);
    key(back, "Tab", true);
    expect(text(back)).toBe("a | b | c\n--|--|--\n1 |  |  |\n4 | 5 | 6");
    expect(back.state.selection.main.head).toBe(26);
    // Read-only, the caret goes to the end of the short row.
    const locked = viewOf("| a | b |\n|---|---|\n| 1 |", 21, true);
    key(locked, "Tab");
    expect(text(locked)).toBe("| a | b |\n|---|---|\n| 1 |");
    expect(locked.state.selection.main.head).toBe(25);
  });

  it("are in the keyboard reference, each bound in a table", () => {
    expect(
      TABLE_KEYS.map((row) => row.keys.map((spec) => ("press" in spec ? spec.press.shiftKey : null))),
    ).toEqual([[false], [true]]);
    for (const row of TABLE_KEYS) {
      for (const spec of row.keys) {
        const view = viewOf(TABLE, 8);
        const shift = "press" in spec && spec.press.shiftKey;
        expect(key(view, "press" in spec ? spec.press.key : "", shift)).toBe(true);
      }
    }
  });
});
