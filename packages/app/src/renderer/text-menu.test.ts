// @vitest-environment happy-dom
// The context menu in the text (SR-195): which entries its place shows at the editor's caret, where a press
// on a drawn table puts the caret, and the commands Cut, Copy and Paste.
import "../../../../scripts/test-support/dom-selection.mjs";
import { codeFolding, foldEffect } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Choice } from "./actions.js";
import type { MenuHit } from "./context-menu.js";
import { MENU_PLACES, menuEntries, openEntries } from "./context-menu.js";
import { copyText, cutText, hasSelection, pasteText } from "./editor/clipboard.js";
import { markdownSupport } from "./editor/markdown.js";
import { TEXT_MENU, pressedPosition } from "./text-menu.js";

const DOC = [
  "# Wind",
  "",
  "Siehe [Böe](reqseq:0b8a88c3-09a8-43fc-862b-de601345b8e1) und mehr.",
  "",
  "| Größe | Wert |",
  "| ----- | ---- |",
  "| Böe   | 25   |",
  "| Sturm |",
  "",
  "# Leer",
].join("\n");

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
  document.body.replaceChildren();
});

/** The text of an element in its place `text`, with the caret or selection at `anchor`..`head`. */
const textAt = (anchor: number, head = anchor, readOnly = false): EditorView => {
  const host = document.createElement("div");
  host.setAttribute("data-menu", "text");
  document.body.append(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: DOC,
      selection: { anchor, head },
      extensions: [markdownSupport({}), codeFolding(), EditorState.readOnly.of(readOnly)],
    }),
  });
  views.push(view);
  return view;
};

const hitIn = (view: EditorView, target: Element = view.contentDOM): MenuHit => ({
  place: "text",
  target,
  point: { x: 0, y: 0 },
});

/** Every entry of the place offered by the prompt, so the menu shows what its tests let through. */
const ALL_ITEMS: readonly Choice[] = MENU_PLACES.text.map((entry) => ({
  id: entry.id,
  name: entry.id,
  run: () => undefined,
}));
const shown = (view: EditorView, target?: Element): string[] =>
  menuEntries(hitIn(view, target), ALL_ITEMS).map((item) => item.id);

const AK1 = ["paste", "format-bold", "format-italic", "format-code", "format-link", "insert-image"];
const TABLE = [
  "insert-table-row",
  "delete-table-row",
  "insert-table-column",
  "delete-table-column",
  "align-table",
];
const pos = (text: string): number => DOC.indexOf(text);

describe("the place text of the context menu", () => {
  it("[SR-195/AK-y58z] has the editing and formatting entries, Cut and Copy only with text selected", () => {
    const plain = textAt(pos("und"));
    expect(shown(plain)).toEqual(AK1);
    const selected = textAt(pos("und"), pos("und") + 3);
    expect(shown(selected)).toEqual(["cut", "copy", ...AK1]);
    expect(TEXT_MENU.selected(hitIn(selected))).toBe(true);
  });

  it("[SR-195/AK-cqgh] puts Follow reference first on a reference to an element", () => {
    expect(shown(textAt(pos("Böe]")))).toEqual(["follow-reference", ...AK1]);
    expect(shown(textAt(pos("Siehe")))).toEqual(AK1);
  });

  it("[SR-195/AK-s8c5] adds the table actions in a cell of a table", () => {
    expect(shown(textAt(pos("25")))).toEqual([...AK1, ...TABLE]);
    expect(shown(textAt(pos("Größe")))).toEqual([...AK1, ...TABLE]);
  });

  it("keeps the table actions while the menu is open, when the cell pressed is gone", () => {
    const view = textAt(pos("25"));
    // The cell of the drawing, which the preview replaces by the table's source once the editor has the focus.
    const cell = document.createElement("td");
    view.dom.append(cell);
    const open = { hit: hitIn(view, cell) };
    const first = openEntries(open, () => ALL_ITEMS, undefined);
    expect(first.entries.map((item) => item.id)).toEqual([...AK1, ...TABLE]);
    cell.remove();
    expect(shown(view, cell)).toEqual(AK1);
    const later = ALL_ITEMS.map((item) => ({ ...item, name: `${item.name} now` }));
    const again = openEntries(open, () => later, first.opened);
    expect(again.opened).toBe(first.opened);
    expect(again.entries.map((item) => item.name)).toEqual([...AK1, ...TABLE].map((id) => `${id} now`));
    // An entry that can no longer run goes; a menu opened again works its entries out again.
    const withoutPaste = later.filter((item) => item.id !== "paste");
    expect(openEntries(open, () => withoutPaste, first.opened).entries).toHaveLength(
      AK1.length - 1 + TABLE.length,
    );
    expect(openEntries({ hit: { ...open.hit } }, () => later, first.opened).entries).toHaveLength(AK1.length);
  });

  it("[SR-195/AK-z4cg] adds Fold section on a heading with a section, Unfold section when it is folded", () => {
    const heading = textAt(pos("Wind"));
    expect(shown(heading)).toEqual([...AK1, "fold-section"]);
    heading.dispatch({ effects: foldEffect.of({ from: pos("Wind") + 4, to: pos("| Sturm |") + 9 }) });
    expect(shown(heading)).toEqual([...AK1, "unfold-section"]);
    // Not below the heading, and not on a heading with nothing under it.
    expect(shown(textAt(pos("Siehe")))).toEqual(AK1);
    expect(shown(textAt(DOC.length))).toEqual(AK1);
  });

  it("reads the text editor of the place also for a press beside it, and shows no conditional entry without one", () => {
    const view = textAt(pos("und"), pos("und") + 3);
    const host = view.dom.parentElement ?? view.dom;
    expect(shown(view, host)).toEqual(["cut", "copy", ...AK1]);
    const alone = document.createElement("div");
    document.body.append(alone);
    expect(menuEntries(hitIn(view, alone), ALL_ITEMS).map((item) => item.id)).toEqual(AK1);
  });
});

/** A drawn table as the preview draws it, inside the editor, with the row `row` and its cell `column`. */
const drawnCell = (view: EditorView, head: boolean, row: number, column: number): Element => {
  const table = document.createElement("table");
  table.className = "cm-lr-table";
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  const rows = [0, 1, 2].map((at) => {
    const each = document.createElement("tr");
    each.append(
      document.createElement(at === 0 ? "th" : "td"),
      document.createElement(at === 0 ? "th" : "td"),
    );
    (at === 0 ? thead : tbody).append(each);
    return each;
  });
  view.contentDOM.append(table);
  vi.spyOn(view, "posAtDOM").mockReturnValue(pos("| Größe"));
  const found = rows[head ? row : row + 1]?.children[column];
  if (found === undefined) {
    throw new Error("no such cell");
  }
  return found;
};

describe("pressedPosition", () => {
  it("[SR-195/AK-s8c5] puts the caret in the cell of a drawn table that was pressed", () => {
    const view = textAt(0);
    expect(pressedPosition(view, drawnCell(view, true, 0, 1), { x: 0, y: 0 })).toBe(pos("Wert"));
    expect(pressedPosition(view, drawnCell(view, false, 0, 1), { x: 0, y: 0 })).toBe(pos("25"));
    // A row with fewer cells gives its last one.
    expect(pressedPosition(view, drawnCell(view, false, 1, 1), { x: 0, y: 0 })).toBe(pos("Sturm"));
  });

  it("takes the position at the point elsewhere, and where the drawn table is not found", () => {
    const view = textAt(0);
    const at = vi.spyOn(view, "posAtCoords").mockReturnValue(7);
    expect(pressedPosition(view, view.contentDOM, { x: 1, y: 2 })).toBe(7);
    expect(at).toHaveBeenCalledWith({ x: 1, y: 2 });
    const cell = drawnCell(view, false, 0, 0);
    vi.spyOn(view, "posAtDOM").mockReturnValue(0);
    expect(pressedPosition(view, cell, { x: 1, y: 2 })).toBe(7);
  });
});

describe("Cut, Copy and Paste", () => {
  const execCommand = () => {
    const spy = vi.fn<(kind: string) => boolean>(() => true);
    Object.defineProperty(document, "execCommand", { value: spy, configurable: true });
    return spy;
  };

  it("[SR-195/AK-qn9f] Cut and Copy ask the browser for its own cut and copy in the focused editor", () => {
    const spy = execCommand();
    const view = textAt(pos("und"), pos("und") + 3);
    const focus = vi.spyOn(view, "focus");
    expect(cutText(view)).toBe(true);
    expect(copyText(view)).toBe(true);
    expect(spy.mock.calls).toEqual([["cut"], ["copy"]]);
    expect(focus).toHaveBeenCalledTimes(2);
    spy.mockReturnValueOnce(false);
    expect(copyText(view)).toBe(false);
  });

  it("[SR-195/AK-qn9f] Paste gives the editor the focus and has main paste, not in an editor without input", () => {
    const paste = vi.fn();
    const view = textAt(0);
    const focus = vi.spyOn(view, "focus");
    expect(pasteText(paste)(view)).toBe(true);
    expect(focus).toHaveBeenCalledBefore(paste);
    expect(pasteText(paste)(textAt(0, 0, true))).toBe(false);
    expect(paste).toHaveBeenCalledOnce();
  });

  it("knows a selection", () => {
    expect(hasSelection(EditorState.create({ doc: "ab", selection: { anchor: 0, head: 1 } }))).toBe(true);
    expect(hasSelection(EditorState.create({ doc: "ab" }))).toBe(false);
  });
});
