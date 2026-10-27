// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atEdge, boxNavigation } from "./box-navigation.js";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

const editor = (doc: string, anchor: number, navigation = {}, head = anchor): EditorView => {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [boxNavigation(navigation)],
    }),
  });
  return view;
};

const press = (target: EditorView, key: string, init: KeyboardEventInit = {}): boolean =>
  runScopeHandlers(target, new KeyboardEvent("keydown", { key, ...init }), "editor");

describe("atEdge", () => {
  it("is true on the last line going down and on the first going up, with no selection", () => {
    const two = editor("ab\ncd", 4);
    expect(atEdge(two, true)).toBe(true);
    expect(atEdge(two, false)).toBe(false);
    two.dispatch({ selection: { anchor: 1 } });
    expect(atEdge(two, true)).toBe(false);
    expect(atEdge(two, false)).toBe(true);
  });

  it("is false with a selection", () => {
    expect(atEdge(editor("ab\ncd", 3, {}, 5), true)).toBe(false);
  });
});

describe("boxNavigation", () => {
  it("runs down at the last line and up at the first, and leaves other lines to the editor", () => {
    const down = vi.fn(() => true);
    const up = vi.fn(() => true);
    const v = editor("ab\ncd", 1, { down, up });
    expect(press(v, "ArrowDown")).toBe(false);
    expect(down).not.toHaveBeenCalled();
    expect(press(v, "ArrowUp")).toBe(true);
    expect(up).toHaveBeenCalledTimes(1);
    v.dispatch({ selection: { anchor: 4 } });
    expect(press(v, "ArrowUp")).toBe(false);
    expect(press(v, "ArrowDown")).toBe(true);
    expect(down).toHaveBeenCalledTimes(1);
  });

  it("leaves the key to the editor when there is nowhere to go", () => {
    const v = editor("ab", 1, { down: () => false, up: () => false });
    expect(press(v, "ArrowDown")).toBe(false);
    expect(press(v, "ArrowUp")).toBe(false);
  });

  it("binds only the directions it is given", () => {
    const v = editor("ab", 1, { down: () => true });
    expect(press(v, "ArrowDown")).toBe(true);
    expect(press(v, "ArrowUp")).toBe(false);
  });
});
