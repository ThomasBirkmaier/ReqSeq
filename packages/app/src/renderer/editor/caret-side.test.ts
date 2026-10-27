// @vitest-environment happy-dom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { releaseCaretSide } from "./caret-side.js";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

const editor = (selection: EditorSelection): EditorView => {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "ab cd ef",
      selection,
      extensions: [EditorState.allowMultipleSelections.of(true), releaseCaretSide],
    }),
  });
  return view;
};

const blur = (target: EditorView): void => {
  target.contentDOM.dispatchEvent(new FocusEvent("blur"));
};

describe("releaseCaretSide", () => {
  it("lets go of the side of a caret when the editor loses the focus, the caret stays where it is", () => {
    const target = editor(EditorSelection.create([EditorSelection.cursor(3, 1)]));
    blur(target);
    expect(target.state.selection.main.head).toBe(3);
    expect(target.state.selection.main.assoc).toBe(0);
  });

  it("changes only the main caret and leaves other ranges as they are", () => {
    const target = editor(
      EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.cursor(6, -1)], 1),
    );
    blur(target);
    expect(target.state.selection.ranges.map(({ from, to }) => [from, to])).toEqual([
      [0, 2],
      [6, 6],
    ]);
    expect(target.state.selection.main.assoc).toBe(0);
  });

  it("leaves a caret without a side and a selection alone", () => {
    const plain = editor(EditorSelection.create([EditorSelection.cursor(3)]));
    const before = plain.state;
    blur(plain);
    expect(plain.state).toBe(before);
    plain.destroy();
    const range = editor(EditorSelection.create([EditorSelection.range(1, 4)]));
    const kept = range.state;
    blur(range);
    expect(range.state).toBe(kept);
  });
});
