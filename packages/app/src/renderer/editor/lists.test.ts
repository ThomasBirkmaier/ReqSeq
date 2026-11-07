// @vitest-environment happy-dom
import "../../../../../scripts/test-support/dom-selection.mjs";
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { indentListItem, listItemAt, listKeys, moveListItemOrLine, outdentListItem } from "./lists.js";
import { markdownSupport } from "./markdown.js";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
});

/** An editor on `doc` with the caret at the `|` (removed), or a selection between two `|`. */
const viewOf = (marked: string, readOnly = false): EditorView => {
  const anchor = marked.indexOf("|");
  const second = marked.indexOf("|", anchor + 1);
  const doc = marked.replaceAll("|", "");
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor, head: second === -1 ? anchor : second - 1 },
      extensions: [history(), markdownSupport({}), listKeys(), EditorState.readOnly.of(readOnly)],
    }),
  });
  views.push(view);
  return view;
};

const key = (view: EditorView, name: string, init: KeyboardEventInit = {}): boolean => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
};

const docOf = (view: EditorView): string => view.state.doc.toString();

/** The document with the caret marked by `|`. */
const withCaret = (view: EditorView): string => {
  const head = view.state.selection.main.head;
  return `${docOf(view).slice(0, head)}|${docOf(view).slice(head)}`;
};

describe("list keys (SR-187)", () => {
  it("[SR-187/AK1] Tab indents the item at the caret with its sub-items one level, Shift+Tab outdents it", () => {
    const view = viewOf("- a\n- b|\n  - c\n- d");
    expect(key(view, "Tab")).toBe(true);
    expect(withCaret(view)).toBe("- a\n  - b|\n    - c\n- d");
    expect(key(view, "Tab", { shiftKey: true })).toBe(true);
    expect(withCaret(view)).toBe("- a\n- b|\n  - c\n- d");
  });

  it("[SR-187/AK1] Tab and Shift+Tab outside lists are left to the window, so they go on to the next or previous field", () => {
    const view = viewOf("A paragraph|.\n\n- a");
    expect(key(view, "Tab")).toBe(false);
    expect(key(view, "Tab", { shiftKey: true })).toBe(false);
    expect(docOf(view)).toBe("A paragraph.\n\n- a");
  });

  it("indents to the content of the item before: ordered marks and wider gaps", () => {
    const view = viewOf("1. a\n2. b|");
    indentListItem(view);
    expect(docOf(view)).toBe("1. a\n   2. b");
    const wide = viewOf("-   a\n- b|");
    indentListItem(wide);
    expect(docOf(wide)).toBe("-   a\n    - b");
  });

  it("takes Tab on the first item and Shift+Tab at the top level without a change, so the key stays in the text", () => {
    const view = viewOf("- a|\n- b");
    expect(indentListItem(view)).toBe(true);
    expect(outdentListItem(view)).toBe(true);
    expect(docOf(view)).toBe("- a\n- b");
  });

  it("indents and outdents every sibling the selection reaches, and leaves blank lines alone", () => {
    const view = viewOf("- a\n- |b\n\n- c|\n- d");
    indentListItem(view);
    expect(docOf(view)).toBe("- a\n  - b\n\n  - c\n- d");
    outdentListItem(view);
    expect(docOf(view)).toBe("- a\n- b\n\n- c\n- d");
  });

  it("outdents an item indented with a tab", () => {
    const view = viewOf("- a\n\t- b|");
    outdentListItem(view);
    expect(docOf(view)).toBe("- a\n- b");
  });

  it("changes nothing in a read-only text", () => {
    const locked = viewOf("- a\n- b|", true);
    expect(indentListItem(locked)).toBe(true);
    expect(docOf(locked)).toBe("- a\n- b");
    expect(moveListItemOrLine(true)(locked)).toBe(false);
  });

  it("[SR-187/AK2] Alt+Up and Alt+Down move a list item with its sub-items one place, the caret with it", () => {
    const view = viewOf("- a\n- b|\n  - c\n- d");
    expect(key(view, "ArrowDown", { altKey: true })).toBe(true);
    expect(withCaret(view)).toBe("- a\n- d\n- b|\n  - c");
    key(view, "ArrowUp", { altKey: true });
    key(view, "ArrowUp", { altKey: true });
    expect(withCaret(view)).toBe("- b|\n  - c\n- a\n- d");
    // At the end of its list it stays.
    key(view, "ArrowUp", { altKey: true });
    expect(docOf(view)).toBe("- b\n  - c\n- a\n- d");
  });

  it("[SR-187/AK2] Alt+Up and Alt+Down move a line outside lists", () => {
    const view = viewOf("one\ntwo|\nthree");
    key(view, "ArrowUp", { altKey: true });
    expect(withCaret(view)).toBe("two|\none\nthree");
    key(view, "ArrowDown", { altKey: true });
    key(view, "ArrowDown", { altKey: true });
    expect(withCaret(view)).toBe("one\nthree\ntwo|");
  });

  it("numbers an ordered list in sequence as before, keeps blank lines at their places, and shifts sub-items with a wider number", () => {
    const view = viewOf("1. a|\n\n2. b\n");
    moveListItemOrLine(true)(view);
    expect(withCaret(view)).toBe("1. b\n\n2. a|\n");
    const wide = viewOf("9. a|\n   - x\n10. b\n    - y");
    moveListItemOrLine(true)(wide);
    expect(docOf(wide)).toBe("9. b\n   - y\n10. a\n    - x");
    const typed = viewOf("1. a|\n1. b");
    moveListItemOrLine(true)(typed);
    expect(docOf(typed)).toBe("1. b\n1. a");
  });

  it("moves a nested item among its siblings only", () => {
    const view = viewOf("- a\n  - x|\n  - y\n- b");
    moveListItemOrLine(true)(view);
    expect(docOf(view)).toBe("- a\n  - y\n  - x\n- b");
    moveListItemOrLine(true)(view);
    expect(docOf(view)).toBe("- a\n  - y\n  - x\n- b");
  });

  it("[SR-187/AK4] each of these changes is taken back in one undo step", () => {
    const view = viewOf("- a\n- b|\n  - c\n- d");
    view.dispatch({ changes: { from: 7, insert: "!" }, userEvent: "input.type" });
    moveListItemOrLine(false)(view);
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    indentListItem(view);
    expect(docOf(view)).toBe("- b!\n  - c\n- a\n  - d");
    undo(view);
    expect(docOf(view)).toBe("- b!\n  - c\n- a\n- d");
    undo(view);
    expect(docOf(view)).toBe("- a\n- b!\n  - c\n- d");
    const lines = viewOf("one\ntwo|");
    moveListItemOrLine(false)(lines);
    undo(lines);
    expect(docOf(lines)).toBe("one\ntwo");
  });

  it("finds no item in a quote or behind another mark on the line", () => {
    expect(listItemAt(viewOf("> - a|").state, 4)).toBeUndefined();
    expect(listItemAt(viewOf("text|").state, 2)).toBeUndefined();
  });
});
