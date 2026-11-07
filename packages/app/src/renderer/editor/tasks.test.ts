// @vitest-environment happy-dom
import "../../../../../scripts/test-support/dom-selection.mjs";
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown.js";
import { BUILT_IN_RULES, livePreview } from "./preview.js";
import { TaskBoxWidget, tasksOnSelectedLines, toggleTask, toggleTaskAt } from "./tasks.js";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
});

const viewOf = (doc: string, anchor = 0, readOnly = false, head = anchor): EditorView => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [
        history(),
        markdownSupport({}),
        livePreview(BUILT_IN_RULES),
        EditorState.readOnly.of(readOnly),
      ],
    }),
  });
  views.push(view);
  return view;
};

const press = (target: Element, button = 0): MouseEvent => {
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button });
  target.dispatchEvent(event);
  return event;
};

const box = (view: EditorView, index = 0): HTMLElement => {
  const found = view.contentDOM.querySelectorAll<HTMLElement>(".cm-lr-task")[index];
  if (found === undefined) {
    throw new Error(`no task box ${String(index)}`);
  }
  return found;
};

describe("tasks (SR-185)", () => {
  it("[SR-185/AK1] a click on the box of a task switches its marker in the file between [ ] and [x], and nothing else", () => {
    const doc = "Intro\n\n- [ ] one\n- [X] two\n";
    const view = viewOf(doc);
    expect(box(view).getAttribute("aria-checked")).toBe("false");
    const event = press(box(view));
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("Intro\n\n- [x] one\n- [X] two\n");
    press(box(view, 1));
    expect(view.state.doc.toString()).toBe("Intro\n\n- [x] one\n- [ ] two\n");
    // The caret stays where it was.
    expect(view.state.selection.main.head).toBe(0);
  });

  it("leaves a press with another button, and a read-only text, alone", () => {
    const view = viewOf("- [ ] one");
    press(box(view), 2);
    expect(view.state.doc.toString()).toBe("- [ ] one");
    const locked = viewOf("- [ ] one", 0, true);
    press(box(locked));
    expect(locked.state.doc.toString()).toBe("- [ ] one");
    expect(toggleTask(viewOf("- [ ] one", 3, true))).toBe(false);
  });

  it("toggles only at a task marker", () => {
    const view = viewOf("- [ ] one\n- plain");
    expect(toggleTaskAt(view, 12)).toBe(false);
    expect(toggleTaskAt(view, 2)).toBe(true);
    expect(view.state.doc.toString()).toBe("- [x] one\n- plain");
  });

  it("[SR-185/AK2] undo after a click brings the tick before back, in one step of its own", () => {
    const view = viewOf("- [ ] one", 9);
    view.dispatch({ changes: { from: 9, insert: "!" }, userEvent: "input.type" });
    press(box(view));
    expect(view.state.doc.toString()).toBe("- [x] one!");
    undo(view);
    expect(view.state.doc.toString()).toBe("- [ ] one!");
    undo(view);
    expect(view.state.doc.toString()).toBe("- [ ] one");
  });

  it("[SR-185/AK3] Toggle task with the caret on the line of a task switches it as a click does; false off a task", () => {
    const view = viewOf("- [ ] one\n  - [x] two\n\ntext", 4);
    expect(toggleTask(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- [x] one\n  - [x] two\n\ntext");
    view.dispatch({ selection: { anchor: 15 } });
    expect(toggleTask(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- [x] one\n  - [ ] two\n\ntext");
    undo(view);
    expect(view.state.doc.toString()).toBe("- [x] one\n  - [x] two\n\ntext");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(toggleTask(view)).toBe(false);
  });

  it("toggles every task on the lines a selection touches, in one change", () => {
    const view = viewOf("- [ ] one\n- [x] two\n- [ ] three", 3, false, 14);
    expect(tasksOnSelectedLines(view.state)).toEqual([2, 12]);
    toggleTask(view);
    expect(view.state.doc.toString()).toBe("- [x] one\n- [ ] two\n- [ ] three");
    undo(view);
    expect(view.state.doc.toString()).toBe("- [ ] one\n- [x] two\n- [ ] three");
  });

  it("compares task boxes by their tick", () => {
    expect(new TaskBoxWidget(true).eq(new TaskBoxWidget(true))).toBe(true);
    expect(new TaskBoxWidget(true).eq(new TaskBoxWidget(false))).toBe(false);
    expect(new TaskBoxWidget(false).ignoreEvent()).toBe(true);
  });
});
