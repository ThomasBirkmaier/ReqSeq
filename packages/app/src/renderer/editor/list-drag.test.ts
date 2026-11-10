// @vitest-environment happy-dom
import "../../../../../scripts/test-support/dom-selection.mjs";
import { history, undo } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { BlockInfo } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { listDrag, listDragging } from "./list-drag.js";
import { markdownSupport } from "./markdown.js";
import { BUILT_IN_RULES, livePreview } from "./preview.js";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
});

/** Lines are 20 px high, the first from 0 to 20: the layout happy-dom does not have. */
const LINE = 20;

const viewOf = (doc: string, readOnly = false): EditorView => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        markdownSupport({}),
        livePreview(BUILT_IN_RULES),
        listDrag(),
        EditorState.readOnly.of(readOnly),
      ],
    }),
  });
  const block = (line: number): BlockInfo => {
    const at = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
    return { from: at.from, to: at.to, top: (at.number - 1) * LINE, bottom: at.number * LINE } as BlockInfo;
  };
  Object.defineProperty(view, "documentTop", { get: () => 0 });
  view.lineBlockAtHeight = (height: number): BlockInfo => block(Math.floor(height / LINE) + 1);
  view.lineBlockAt = (pos: number): BlockInfo => block(view.state.doc.lineAt(pos).number);
  views.push(view);
  // The handles come from the syntax tree, and the first parse stops after 20 ms (CodeMirror's budget for a
  // new state); the rest follows in the background. On a slow runner the tree ends before the last item,
  // and so do the handles (#1296). The whole tree first, as the editor's `parseAhead` does.
  expect(forceParsing(view, view.state.doc.length, 5000)).toBe(true);
  return view;
};

const handles = (view: EditorView): HTMLElement[] => [
  ...view.contentDOM.querySelectorAll<HTMLElement>(".cm-lr-handle"),
];

const handle = (view: EditorView, index: number): HTMLElement => {
  const found = handles(view)[index];
  if (found === undefined) {
    throw new Error(`no handle ${String(index)}`);
  }
  return found;
};

const mouse = (target: EventTarget, type: string, y: number, x = 5): MouseEvent => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  target.dispatchEvent(event);
  return event;
};

/** Presses the handle of item `index` on line `line` and drags it to the height `to`, without releasing. */
const dragTo = (view: EditorView, index: number, line: number, to: number): void => {
  const y = (line - 1) * LINE + LINE / 2;
  expect(mouse(handle(view, index), "mousedown", y).defaultPrevented).toBe(true);
  mouse(window, "mousemove", y + 2);
  mouse(window, "mousemove", to);
};

const docOf = (view: EditorView): string => view.state.doc.toString();

describe("dragging list items (SR-187)", () => {
  it("[SR-187/AK3] an item dragged by its bullet to another place of its list lands there with its sub-items", () => {
    const view = viewOf("- a\n  - a1\n- b\n- c");
    // The bullet of b (line 3) into the gap before a: the upper half of line 1.
    dragTo(view, 2, 3, 5);
    expect(listDragging(view.state)).toBe(true);
    expect(view.dom.classList.contains("cm-lr-grabbing")).toBe(true);
    expect(view.contentDOM.querySelectorAll(".cm-lr-dragging")).toHaveLength(1);
    expect(view.contentDOM.querySelector(".cm-lr-drop-before")?.textContent).toContain("a");
    mouse(window, "mouseup", 5);
    expect(docOf(view)).toBe("- b\n- a\n  - a1\n- c");
    expect(listDragging(view.state)).toBe(false);
    // a with its sub-item a1 to the end of the list: below the middle of c.
    dragTo(view, 1, 2, 78);
    expect(view.contentDOM.querySelector(".cm-lr-drop-after")).not.toBeNull();
    mouse(window, "mouseup", 78);
    expect(docOf(view)).toBe("- b\n- c\n- a\n  - a1");
  });

  it("[SR-187/AK3] drags an ordered item by its number and a task by its box, and numbers the list in sequence", () => {
    const view = viewOf("1. one\n2. two\n3. three");
    dragTo(view, 2, 3, 2);
    mouse(window, "mouseup", 2);
    expect(docOf(view)).toBe("1. three\n2. one\n3. two");
    const tasks = viewOf("- [ ] a\n- [x] b");
    dragTo(tasks, 1, 2, 2);
    mouse(window, "mouseup", 2);
    expect(docOf(tasks)).toBe("- [x] b\n- [ ] a");
  });

  it("[SR-187/AK3] in a loose list a pointer on a blank line between two items drops into that gap", () => {
    const view = viewOf("- a\n\n- b\n\n- c");
    // Line 4 is the blank line between b and c.
    dragTo(view, 0, 1, 70);
    mouse(window, "mouseup", 70);
    expect(docOf(view)).toBe("- b\n\n- a\n\n- c");
  });

  it("drops nothing when the button is released outside the window", () => {
    const view = viewOf("- a\n- b");
    dragTo(view, 1, 2, 2);
    mouse(window, "mouseup", -5);
    expect(docOf(view)).toBe("- a\n- b");
  });

  it("[SR-187/AK4] a drop is taken back in one undo step", () => {
    const view = viewOf("- a\n- b\n- c");
    dragTo(view, 0, 1, 58);
    mouse(window, "mouseup", 58);
    expect(docOf(view)).toBe("- b\n- c\n- a");
    undo(view);
    expect(docOf(view)).toBe("- a\n- b\n- c");
  });

  it("changes nothing on a drop at its own place, on Escape, on leaving the window, and in a read-only text", () => {
    const view = viewOf("- a\n- b\n- c");
    dragTo(view, 1, 2, 25);
    expect(view.contentDOM.querySelector(".cm-lr-drop-before, .cm-lr-drop-after")).toBeNull();
    mouse(window, "mouseup", 25);
    expect(docOf(view)).toBe("- a\n- b\n- c");
    dragTo(view, 1, 2, 2);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    mouse(window, "mouseup", 2);
    expect(docOf(view)).toBe("- a\n- b\n- c");
    dragTo(view, 1, 2, 2);
    window.dispatchEvent(new Event("blur"));
    mouse(window, "mouseup", 2);
    expect(docOf(view)).toBe("- a\n- b\n- c");
    const locked = viewOf("- a\n- b", true);
    dragTo(locked, 1, 2, 2);
    mouse(window, "mouseup", 2);
    expect(docOf(locked)).toBe("- a\n- b");
  });

  it("cancels the drag when the text changes under it, and keeps a nested item among its siblings", () => {
    const view = viewOf("- a\n- b\n- c");
    dragTo(view, 2, 3, 2);
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(listDragging(view.state)).toBe(false);
    mouse(window, "mouseup", 2);
    expect(docOf(view)).toBe("x- a\n- b\n- c");
    const nested = viewOf("- a\n  - x\n  - y\n- b");
    // y above everything: the first gap of its own list, before x.
    dragTo(nested, 2, 3, 1);
    mouse(window, "mouseup", 1);
    expect(docOf(nested)).toBe("- a\n  - y\n  - x\n- b");
  });

  it("a press and release on a bullet without moving puts the caret on its line, a move under 4 px is no drag", () => {
    const view = viewOf("- a\n- b");
    const target = handle(view, 1);
    mouse(target, "mousedown", 30);
    mouse(window, "mousemove", 32);
    expect(listDragging(view.state)).toBe(false);
    mouse(target, "mouseup", 30);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2);
    expect(docOf(view)).toBe("- a\n- b");
  });

  it("takes no press with another button or off a mark", () => {
    const view = viewOf("- a\n- b");
    const right = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 });
    handle(view, 0).dispatchEvent(right);
    expect(right.defaultPrevented).toBe(false);
    mouse(view.contentDOM.querySelector(".cm-line") ?? view.contentDOM, "mousedown", 5);
    mouse(window, "mousemove", 40);
    expect(listDragging(view.state)).toBe(false);
  });
});
