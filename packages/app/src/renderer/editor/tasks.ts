// Ticking a task of a task list (SR-185): a click on its box in the live preview, or the action "Toggle task"
// with the caret on its line. Only the marker changes, `[ ]` to `[x]` and `[x]` or `[X]` to `[ ]`, in one
// change that is one undo step of its own (AK2): it never joins the typing before or after it.
import { isolateHistory } from "@codemirror/commands";
import type { ChangeSpec, EditorState, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { WidgetType } from "@codemirror/view";
import { parsedTree } from "./parsed.js";

/** The user event of a toggle: input, but not typing, so the history never joins it to a typed change. */
export const TOGGLE_TASK_EVENT = "input.task";

/** The change that toggles the task marker `[ ]`/`[x]` at `from`. */
const toggleAt = (state: EditorState, from: number): ChangeSpec => ({
  from: from + 1,
  to: from + 2,
  insert: state.doc.sliceString(from + 1, from + 2) === " " ? "x" : " ",
});

/** The transaction of `changes` as a toggle: its own undo step. */
const toggleTransaction = (changes: readonly ChangeSpec[]): TransactionSpec => ({
  changes: [...changes],
  userEvent: TOGGLE_TASK_EVENT,
  annotations: isolateHistory.of("full"),
});

/** The starts of the task markers on the lines the selection touches. */
export const tasksOnSelectedLines = (state: EditorState): readonly number[] => {
  const markers = new Set<number>();
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).from;
    // A selection that ends at the start of a line (Shift+Down, a triple click) does not take that line.
    const end = !range.empty && state.doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to;
    const to = state.doc.lineAt(end).to;
    parsedTree(state, to).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "TaskMarker" && node.from >= from && node.from <= to) {
          markers.add(node.from);
        }
      },
    });
  }
  return [...markers].sort((a, b) => a - b);
};

/**
 * The command of the action "Toggle task" (AK3): toggles the tasks on the lines of the selection, as a click
 * on their boxes does; false when there is none (the action says so) or the editor is read-only.
 */
export const toggleTask = (view: EditorView): boolean => {
  const { state } = view;
  const markers = tasksOnSelectedLines(state);
  if (markers.length === 0 || state.readOnly) {
    return false;
  }
  view.dispatch(toggleTransaction(markers.map((from) => toggleAt(state, from))));
  return true;
};

/**
 * Toggles the task marker that starts at `from`, as a click on its box (AK1); nothing when read-only. Like typing,
 * the click follows the editor's read-only state; while the file changed on disk the input is kept as any input.
 */
export const toggleTaskAt = (view: EditorView, from: number): boolean => {
  const { state } = view;
  if (state.readOnly || !/^\[[ xX]\]$/u.test(state.doc.sliceString(from, from + 3))) {
    return false;
  }
  view.dispatch(toggleTransaction([toggleAt(state, from)]));
  return true;
};

/**
 * The box of a task in place of its marker. A click on it toggles the marker and keeps the caret and the
 * focus where they are (the box is not the place of the caret); the editor itself ignores the press. The keyboard
 * reaches it through "Toggle task", so the box is no focusable control.
 */
export class TaskBoxWidget extends WidgetType {
  readonly checked: boolean;

  constructor(checked: boolean) {
    super();
    this.checked = checked;
  }

  override eq(other: TaskBoxWidget): boolean {
    return other.checked === this.checked;
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("span");
    box.className = "cm-lr-task";
    box.textContent = this.checked ? "☑" : "☐";
    // The press only keeps the caret and the focus where they are; the click (press and release on the box)
    // toggles, so a press that is dragged off the box changes nothing.
    box.addEventListener("mousedown", (event) => {
      if (event.button === 0) {
        event.preventDefault();
      }
    });
    box.addEventListener("click", (event) => {
      if (event.button === 0) {
        event.preventDefault();
        toggleTaskAt(view, view.posAtDOM(box));
      }
    });
    return box;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}
