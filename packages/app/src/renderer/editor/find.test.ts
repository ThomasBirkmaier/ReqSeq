// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside the call (ThomasBirkmaier/ReqSeq-archive#460).
import "../../../../../scripts/test-support/dom-selection.mjs";
// SR-189: find and replace in the text of the open element.
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  endSearch,
  findMarks,
  hitsOf,
  replaceAll,
  replaceHit,
  searchFor,
  searchOf,
  searchStatus,
  stepHit,
} from "./find.js";

const views: EditorView[] = [];
const viewOf = (doc: string, readOnly = false): EditorView => {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [history(), findMarks, EditorState.readOnly.of(readOnly)] }),
    parent: document.body,
  });
  views.push(view);
  return view;
};
afterEach(() => {
  views.splice(0).forEach((view) => {
    view.destroy();
  });
});

const selected = (view: EditorView): string =>
  view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
const marked = (view: EditorView): string[] =>
  [...view.contentDOM.querySelectorAll(".cm-lr-find")].map(
    (node) => `${node.textContent}${node.classList.contains("cm-lr-find-current") ? "*" : ""}`,
  );

describe("find in the element", () => {
  it("finds the typed text, ignoring case while it is lower case", () => {
    expect(hitsOf("Aa aa AA", "aa")).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 5 },
      { from: 6, to: 8 },
    ]);
    expect(hitsOf("Aa aa AA", "AA")).toEqual([{ from: 6, to: 8 }]);
    expect(hitsOf("aaaa", "aa")).toHaveLength(2);
    expect(hitsOf("x", "")).toEqual([]);
    // A text whose lower case is longer (İ): compared case by case.
    expect(hitsOf("İx ix", "ix")).toEqual([{ from: 3, to: 5 }]);
  });

  it("[SR-189/AK-ctc8] marks every hit, Enter goes to the next, Shift+Enter to the one before, Escape leaves the caret there", () => {
    const view = viewOf("one two one two one");
    view.dispatch({ selection: { anchor: 5 } });
    expect(searchFor(view, "one", 5)).toBe(3);
    expect(marked(view)).toEqual(["one", "one*", "one"]);
    expect(searchStatus(view.state)).toBe("2 of 3");
    expect(stepHit(view, false)).toBe(true);
    expect(searchStatus(view.state)).toBe("3 of 3");
    stepHit(view, false);
    expect(searchStatus(view.state)).toBe("1 of 3");
    stepHit(view, true);
    expect(searchStatus(view.state)).toBe("3 of 3");
    expect(selected(view)).toBe("one");
    endSearch(view);
    expect(marked(view)).toEqual([]);
    expect(view.state.selection.main.head).toBe(16);
    expect(view.state.selection.main.empty).toBe(true);
  });

  it("without a hit marks nothing and keeps the caret where the search began", () => {
    const view = viewOf("abc");
    expect(searchFor(view, "x", 2)).toBe(0);
    expect(searchStatus(view.state)).toBe("no match");
    expect(stepHit(view, false)).toBe(false);
    expect(view.state.selection.main.head).toBe(2);
    endSearch(view);
    expect(view.state.selection.main.head).toBe(2);
    // From after the last hit, the first one is current.
    expect(searchFor(view, "a", 3)).toBe(1);
    expect(searchStatus(view.state)).toBe("1 of 1");
    expect(searchOf(EditorState.create({ doc: "a" })).current).toBe(-1);
  });

  it("follows a change of the text while it searches", () => {
    const view = viewOf("a b a");
    searchFor(view, "a", 2);
    view.dispatch({ changes: { from: 0, insert: "a " } });
    expect(searchOf(view.state).hits).toHaveLength(3);
    expect(searchStatus(view.state)).toBe("3 of 3");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "none" } });
    expect(searchStatus(view.state)).toBe("no match");
  });

  it("[SR-189/AK-jm2n] Replace replaces the current hit and goes to the next one", () => {
    const view = viewOf("cat dog cat dog cat");
    searchFor(view, "cat", 1);
    expect(replaceHit(view, "cats")).toBe(true);
    expect(view.state.doc.toString()).toBe("cat dog cats dog cat");
    expect(searchStatus(view.state)).toBe("3 of 3");
    replaceHit(view, "cats");
    replaceHit(view, "cats");
    expect(view.state.doc.toString()).toBe("cats dog cats dog cats");
    // "cats" still holds "cat": the search goes on through them.
    expect(searchOf(view.state).hits).toHaveLength(3);
    const done = viewOf("a");
    searchFor(done, "a", 0);
    expect(replaceHit(done, "b")).toBe(true);
    expect(searchStatus(done.state)).toBe("no match");
    expect(replaceHit(done, "b")).toBe(false);
  });

  it("[SR-189/AK-byc1] Replace all replaces every hit and says how many", () => {
    const view = viewOf("Ab ab AB");
    expect(replaceAll(view, "ab", "x")).toBe(3);
    expect(view.state.doc.toString()).toBe("x x x");
    expect(view.state.selection.main.head).toBe(5);
    expect(replaceAll(view, "q", "x")).toBe(0);
  });

  it("[SR-189/AK-mt6q] one undo takes Replace all back, and one step each Replace", () => {
    const view = viewOf("a a a");
    view.dispatch({ changes: { from: 5, insert: " a" }, userEvent: "input.type" });
    replaceAll(view, "a", "bb");
    expect(view.state.doc.toString()).toBe("bb bb bb bb");
    undo(view);
    expect(view.state.doc.toString()).toBe("a a a a");
    searchFor(view, "a", 0);
    replaceHit(view, "c");
    replaceHit(view, "c");
    undo(view);
    expect(view.state.doc.toString()).toBe("c a a a");
  });

  it("changes nothing in a read-only text", () => {
    const view = viewOf("a", true);
    searchFor(view, "a", 0);
    expect(replaceHit(view, "b")).toBe(false);
    expect(replaceAll(view, "a", "b")).toBe(0);
    expect(view.state.doc.toString()).toBe("a");
  });
});
