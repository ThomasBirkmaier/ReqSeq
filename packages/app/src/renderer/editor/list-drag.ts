// The mouse on lists (SR-187 AK3, SR-185 AK1; plan and review on #1092): a list item is dragged by its drawn
// mark (the bullet, the number of an ordered item, the box of a task) to another place among its siblings, and
// lands there with its sub-items, as one undo step (AK4). A press and release on a mark without moving is a click:
// on a task box it ticks or unticks the task (`tasks.ts`), on a bullet or number it puts the caret there.
//
// No HTML drag and drop (it would move the DOM of the contenteditable and the selection): plain mouse events, with
// listeners on the window only while the button is held. The drag starts once the pointer moved 4 px. The target is
// the gap among the siblings nearest to the pointer, found from the line under it (`lineBlockAtHeight`), again on
// every move and scroll. While dragging the item's lines are muted and the gap shows a grey rule (D-062); Escape,
// the window losing the focus, and any change of the text that is not the drop cancel it. Same level only (spec
// question #1107): Tab and Shift+Tab change the level.
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, PluginValue, ViewUpdate } from "@codemirror/view";
import type { ListItemLines } from "./lists.js";
import { LIST_EVENTS, listItemAt, moveItemTo, siblingsOf } from "./lists.js";
import { toggleTaskAt } from "./tasks.js";

/** The class of a drawn list mark that takes a press: a bullet, an ordered number, a task box. */
export const HANDLE_CLASS = "cm-lr-handle";

/** How far the pointer moves with the button held before a press becomes a drag (CSS px). */
export const DRAG_DISTANCE = 4;

/** What the decorations show while an item is dragged. */
interface Shown {
  readonly item: { readonly from: number; readonly to: number };
  /** The line that shows the rule, and whether it is above it (`before`) or below it (the end of the list). */
  readonly rule?: { readonly line: number; readonly before: boolean };
}

const show = StateEffect.define<Shown | undefined>();

const DRAGGED = Decoration.line({ class: "cm-lr-dragging" });
const RULE_BEFORE = Decoration.line({ class: "cm-lr-drop-before" });
const RULE_AFTER = Decoration.line({ class: "cm-lr-drop-after" });

const decorationsOf = (state: EditorState, shown: Shown | undefined): DecorationSet => {
  if (shown === undefined) {
    return Decoration.none;
  }
  const ranges: Range<Decoration>[] = [];
  const { doc } = state;
  for (let n = doc.lineAt(shown.item.from).number; n <= doc.lineAt(shown.item.to).number; n += 1) {
    ranges.push(DRAGGED.range(doc.line(n).from));
  }
  if (shown.rule !== undefined) {
    ranges.push((shown.rule.before ? RULE_BEFORE : RULE_AFTER).range(doc.lineAt(shown.rule.line).from));
  }
  return Decoration.set(ranges, true);
};

/** The drag that is shown: its decorations, and whether a drag holds the input (autosave waits, `listDragging`). */
const dragField = StateField.define<{
  readonly shown: Shown | undefined;
  readonly decorations: DecorationSet;
}>({
  create: () => ({ shown: undefined, decorations: Decoration.none }),
  update: (value, tr) => {
    // A change of the text ends a drag (the drop too): its positions are gone.
    if (tr.docChanged) {
      return { shown: undefined, decorations: Decoration.none };
    }
    for (const effect of tr.effects) {
      if (effect.is(show)) {
        return { shown: effect.value, decorations: decorationsOf(tr.state, effect.value) };
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** A list item is being dragged in this state: input is going on, so nothing saves meanwhile (SR-105). */
export const listDragging = (state: EditorState): boolean =>
  state.field(dragField, false)?.shown !== undefined;

/**
 * The gap among `siblings` for a pointer over the line starting at `line`, `upper` when it is in the upper half of
 * the item it is over: 0 before the first, `siblings.length` after the last. Above or below the list it is the
 * nearest end.
 */
export const gapAt = (
  siblings: readonly ListItemLines[],
  line: number,
  upper: (entry: ListItemLines) => boolean,
): number => {
  const first = siblings[0];
  if (first === undefined || line < first.from) {
    return 0;
  }
  const index = siblings.findIndex((entry) => line >= entry.from && line <= entry.to);
  if (index < 0) {
    // A blank line between two items (a loose list): the gap before the next one.
    const next = siblings.findIndex((entry) => entry.from > line);
    return next < 0 ? siblings.length : next;
  }
  const entry = siblings[index];
  return entry !== undefined && upper(entry) ? index : index + 1;
};

interface Press {
  readonly handle: Element;
  /** The item to drag; undefined for a task box that can only be clicked. */
  readonly item: ListItemLines | undefined;
  readonly x: number;
  readonly y: number;
  dragging: boolean;
  gap: number | undefined;
  lastY: number;
}

class ListMouse implements PluginValue {
  private press: Press | undefined = undefined;
  private readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
  }

  /** A left press on a drawn mark: the start of a click or a drag. */
  start(event: MouseEvent): boolean {
    const { view } = this;
    const target = event.target instanceof Element ? event.target.closest(`.${HANDLE_CLASS}`) : null;
    if (event.button !== 0 || target === null || !view.contentDOM.contains(target)) {
      return false;
    }
    // A task box behind a quote or another mark has no item to drag, but its click still ticks it.
    const item = listItemAt(view.state, view.posAtDOM(target));
    if (item === undefined && !target.classList.contains("cm-lr-task")) {
      return false;
    }
    event.preventDefault();
    this.press = {
      handle: target,
      item,
      x: event.clientX,
      y: event.clientY,
      dragging: false,
      gap: undefined,
      lastY: event.clientY,
    };
    window.addEventListener("mousemove", this.move);
    window.addEventListener("mouseup", this.release);
    window.addEventListener("keydown", this.key, true);
    window.addEventListener("blur", this.cancel);
    // The page scrolls, not the editor (its scroller is not clipped): any scroll re-aims.
    window.addEventListener("scroll", this.scroll, true);
    return true;
  }

  /** The gap for the pointer at `y`, and the decorations for it. */
  private aim(y: number): void {
    const { view, press } = this;
    if (press?.item === undefined) {
      return;
    }
    const { item } = press;
    press.lastY = y;
    const height = y - view.documentTop;
    const line = view.lineBlockAtHeight(height).from;
    const siblings = siblingsOf(view.state, item.node);
    const gap = gapAt(siblings, line, (entry) => {
      const top = view.lineBlockAt(entry.from).top;
      const bottom = view.lineBlockAt(entry.to).bottom;
      return height < (top + bottom) / 2;
    });
    const index = siblings.findIndex((entry) => entry.from === item.from);
    const moves = gap !== index && gap !== index + 1;
    press.gap = moves ? gap : undefined;
    const at = siblings[gap];
    const last = siblings[siblings.length - 1];
    const rule = !moves
      ? undefined
      : at === undefined
        ? last === undefined
          ? undefined
          : { line: last.to, before: false }
        : { line: at.from, before: true };
    view.dispatch({
      effects: show.of({
        item: { from: item.from, to: item.to },
        ...(rule === undefined ? {} : { rule }),
      }),
    });
  }

  private readonly move = (event: MouseEvent): void => {
    const { press } = this;
    if (press === undefined) {
      return;
    }
    if (!press.dragging && Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_DISTANCE) {
      return;
    }
    if (!press.dragging) {
      if (this.view.state.readOnly || press.item === undefined) {
        return;
      }
      press.dragging = true;
      this.view.dom.classList.add("cm-lr-grabbing");
    }
    this.aim(event.clientY);
  };

  private readonly scroll = (): void => {
    if (this.press?.dragging === true) {
      this.aim(this.press.lastY);
    }
  };

  private readonly release = (event: MouseEvent): void => {
    const { press, view } = this;
    if (press === undefined) {
      return;
    }
    this.end();
    if (press.dragging) {
      // Released outside the window: no drop.
      const outside =
        event.clientX < 0 ||
        event.clientY < 0 ||
        event.clientX > window.innerWidth ||
        event.clientY > window.innerHeight;
      const change =
        press.gap === undefined || press.item === undefined || outside
          ? undefined
          : moveItemTo(view.state, press.item, press.gap, LIST_EVENTS.drag);
      if (change !== undefined && !view.state.readOnly) {
        view.dispatch(change);
      }
      return;
    }
    // A click: released on the mark it was pressed on.
    if (!(event.target instanceof Node) || !press.handle.contains(event.target)) {
      return;
    }
    const at = view.posAtDOM(press.handle);
    if (press.handle.classList.contains("cm-lr-task")) {
      toggleTaskAt(view, at);
    } else {
      view.dispatch({
        selection: { anchor: view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? at },
      });
      view.focus();
    }
  };

  private readonly key = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    }
  };

  /** Ends the press and the drag without a change. */
  readonly cancel = (): void => {
    this.end();
  };

  private end(): void {
    const { view } = this;
    if (this.press === undefined) {
      return;
    }
    const dragged = this.press.dragging;
    this.press = undefined;
    window.removeEventListener("mousemove", this.move);
    window.removeEventListener("mouseup", this.release);
    window.removeEventListener("keydown", this.key, true);
    window.removeEventListener("blur", this.cancel);
    window.removeEventListener("scroll", this.scroll, true);
    view.dom.classList.remove("cm-lr-grabbing");
    if (dragged) {
      // Not inside an update: `end` also runs from `update` (a change of the text cancels).
      queueMicrotask(() => {
        if (this.press === undefined && listDragging(view.state)) {
          view.dispatch({ effects: show.of(undefined) });
        }
      });
    }
  }

  update(update: ViewUpdate): void {
    // The positions of the press hold only for the text it was made on, and nothing is dragged in a read-only text.
    if (this.press !== undefined && (update.docChanged || update.state.readOnly)) {
      this.end();
    }
  }

  destroy(): void {
    this.end();
  }
}

const listMouse = ViewPlugin.fromClass(ListMouse, {
  eventHandlers: {
    mousedown(event) {
      return this.start(event);
    },
  },
});

const theme = EditorView.baseTheme({
  [`.${HANDLE_CLASS}`]: { cursor: "grab" },
  "&.cm-lr-grabbing, &.cm-lr-grabbing *": { cursor: "grabbing" },
  ".cm-lr-dragging": { opacity: "0.45" },
  ".cm-lr-drop-before, .cm-lr-drop-after": { position: "relative" },
  ".cm-lr-drop-before::before, .cm-lr-drop-after::after": {
    content: '""',
    position: "absolute",
    left: "0",
    right: "0",
    height: "2px",
    backgroundColor: "var(--rule)",
    pointerEvents: "none",
  },
  ".cm-lr-drop-before::before": { top: "-1px" },
  ".cm-lr-drop-after::after": { bottom: "-1px" },
});

/** The mouse on the list marks of the text: click and drag. */
export const listDrag = (): Extension => [dragField, listMouse, theme];
