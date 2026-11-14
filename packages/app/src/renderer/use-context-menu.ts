// The context menu in the window (D-075, SR-194): a right press in an area of the sheet, or on macOS a
// press with Ctrl held (AK7), opens the app's own menu at the pointer. The listeners are added once and
// read refs, like those of the prefix key (`use-prefix.ts`). The menu never takes the focus: while it is
// open, its keys are taken in the capture phase, so the editor, the list and the active area keep their
// focus and marked text. A press of the left or middle button outside it closes it and then does what it
// does without the menu (AK4, as the command prompt in SR-134 AK3).
import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { shownBuffer, shownLayer } from "./buffer-slide.js";
import type { MenuHit } from "./context-menu.js";
import { isMacCtrlPress, menuKey, menuSelection, opensMenu, placeAt } from "./context-menu.js";
import { pressedPosition } from "./text-menu.js";
import { MODIFIERS } from "./modifier-keys.js";

/** The open menu: where it was asked for, the selected entry (-1: none) and the buffer shown then. */
export interface MenuState {
  readonly hit: MenuHit;
  readonly selected: number;
  readonly shown: string | undefined;
}

export interface ContextMenuOptions {
  readonly mac: boolean;
  /** No menu opens now (another workspace opens, SR-131 AK3). */
  readonly blocked: () => boolean;
  /** The key of the shown buffer: the menu closes when another one is shown. */
  readonly shown: string | undefined;
  /** A prompt is open: the menu closes when one opens. */
  readonly prompting: boolean;
  /** The menu opens: an open prompt ends, as it does on any press outside it. */
  readonly onOpen: () => void;
  /** The number of entries of the open menu, the last one ("All commands…") included. */
  readonly count: () => number;
  /** Runs the entry at `index` (Enter or Space). */
  readonly choose: (index: number) => void;
}

export interface ContextMenu {
  readonly menu: MenuState | undefined;
  /** Whether the menu is open now, read by the window's listeners. */
  readonly isOpen: () => boolean;
  /** Whether the wheel event `event` closed the menu: a swipe it ends switches no buffer (SR-211 AK11). */
  readonly closedBy: (event: WheelEvent) => boolean;
  readonly close: () => void;
  /** Selects the entry at `index` (the pointer is on it). */
  readonly select: (index: number) => void;
}

/** The menu itself: a press, a wheel or a right-click in it is its own. */
const inMenu = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(".context-menu") !== null;

/** What takes the focus of a press. */
const FOCUSABLE = "input, textarea, select, [contenteditable='true'], [tabindex]";

/**
 * The right press sets the focus as a left one would, but keeps marked text it lands in: in a text editor
 * the caret goes to the pointer unless the press is inside the marked text (SR-195 AK2); elsewhere the field
 * pressed takes the focus. The native handling is prevented, because it selects a word or starts a drag.
 */
export const focusPressed = (target: Element, point: { readonly x: number; readonly y: number }): void => {
  const editor = target.closest(".cm-editor");
  const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null;
  if (view !== null) {
    const at = pressedPosition(view, target, point);
    const inside =
      at !== null &&
      view.state.selection.ranges.some((range) => !range.empty && range.from <= at && at <= range.to);
    if (at !== null && !inside) {
      view.dispatch({ selection: { anchor: at } });
    }
    view.focus();
    return;
  }
  // A field that takes no focus itself (a group of relations) gives it to its first control, so the cursor
  // is in the field pressed (SR-196 AK1).
  const own = target.closest<HTMLElement>(FOCUSABLE);
  const field = target.closest("[data-field]");
  const inField =
    field === null || (own !== null && field.contains(own))
      ? own
      : field.querySelector<HTMLElement>(FOCUSABLE);
  (inField ?? own)?.focus({ preventScroll: true });
};

/** A place of the menu outside the areas: a field of the modeline (SR-196). */
const inModeline = (target: Element): boolean =>
  target.closest("[data-area]") === null && placeAt(target) !== undefined;

/**
 * A menu of the modeline closed: the field it was opened on gives the focus back to `back`, else to the
 * buffer of the active area, so the keys act there again. A focus that moved elsewhere stays.
 */
export const giveFocusBack = (target: Element, back: Element | null): void => {
  const field = target.closest("[data-menu]");
  if (field?.contains(document.activeElement) !== true) {
    return;
  }
  const to = back instanceof HTMLElement && back.isConnected ? back : shownBuffer();
  to?.focus({ preventScroll: true });
};

/** The caret or marked text of the page as a box, when there is one with a place on the screen. */
const selectionBox = (): DOMRect | undefined => {
  const selection = document.getSelection();
  const box =
    selection !== null && selection.rangeCount > 0
      ? selection.getRangeAt(0).getBoundingClientRect()
      : undefined;
  return box === undefined || (box.left === 0 && box.top === 0 && box.height === 0) ? undefined : box;
};

/**
 * The place a focused buffer is as a whole: the mark of its content (the column of a list, SR-198), which
 * the mouse reaches only on the content, so the empty sheet around it keeps the buffer's menu (SR-194 AK6).
 */
const ownPlace = (focused: Element): Element | null =>
  focused.hasAttribute("data-buffer") ? focused.querySelector(":scope > [data-menu]") : null;

/**
 * Where a menu asked for by a key (the Menu key, Shift+F10) opens: at the caret in a text editor, else at
 * the selected row or node of the area, else at the area's top left corner, on the place of the focused
 * buffer's content where it has one (`ownPlace`).
 */
export const keyboardHit = (focused: Element): Omit<MenuHit, "place"> => {
  const area = focused.closest("[data-area]");
  const caret = focused.closest(".cm-editor") === null ? undefined : selectionBox();
  if (caret !== undefined) {
    return { target: focused, point: { x: caret.left, y: caret.bottom } };
  }
  // Only the shown buffer's row: a buffer drawn hidden beside it has its own (SR-212 AK5).
  const selected = shownLayer(area)?.querySelector('[aria-selected="true"]');
  if (selected !== null && selected !== undefined) {
    const box = selected.getBoundingClientRect();
    return { target: selected, point: { x: box.left, y: box.bottom } };
  }
  // Outside the areas (a field of the modeline, SR-196): at the field.
  const box = (area ?? focused).getBoundingClientRect();
  return { target: ownPlace(focused) ?? focused, point: { x: box.left, y: box.top } };
};

export const useContextMenu = (options: ContextMenuOptions): ContextMenu => {
  const latest = useRef(options);
  latest.current = options;
  const [menu, setMenu] = useState<MenuState | undefined>(undefined);
  const menuNow = useRef<MenuState | undefined>(undefined);
  // The wheel events that closed the menu (`closedBy`).
  const closing = useRef(new WeakSet<WheelEvent>());
  const show = useCallback((next: MenuState | undefined): void => {
    menuNow.current = next;
    setMenu(next);
  }, []);
  // Where the focus goes back to when a menu of the modeline closes (SR-196): what had it before the press.
  const returnTo = useRef<Element | null>(null);
  const close = useCallback((): void => {
    const open = menuNow.current;
    if (open === undefined) {
      return;
    }
    show(undefined);
    if (inModeline(open.hit.target)) {
      // After the entry ran (it reads the focused field), unless it moved the focus itself (a prompt).
      const back = returnTo.current;
      returnTo.current = null;
      window.setTimeout(() => {
        giveFocusBack(open.hit.target, back);
      }, 0);
    }
  }, [show]);
  const select = useCallback(
    (index: number): void => {
      const now = menuNow.current;
      if (now !== undefined && now.selected !== index) {
        show({ ...now, selected: index });
      }
    },
    [show],
  );

  useEffect(() => {
    // The press that the next `contextmenu` comes from; without one it was asked for by a key.
    let pressed = false;
    // A Ctrl+click on macOS opened the menu: its click goes nowhere else.
    let swallowClick = false;

    const press = (event: MouseEvent): void => {
      swallowClick = false;
      if (inMenu(event.target)) {
        return;
      }
      const now = latest.current;
      const target = event.target instanceof Element ? event.target : null;
      if (target !== null && opensMenu(event, now.mac) && placeAt(target) !== undefined && !now.blocked()) {
        event.preventDefault();
        pressed = true;
        if (isMacCtrlPress(event, now.mac)) {
          // Blink turns the press into a `contextmenu` itself; the press is not the list's, a link's or a
          // drag's, and the prompt, which no longer sees it, ends here.
          event.stopPropagation();
          swallowClick = true;
          now.onOpen();
        }
        // A press on a field of the modeline remembers where the focus was, unless it was in the modeline.
        if (inModeline(target)) {
          const before = document.activeElement;
          if (before === null || !inModeline(before)) {
            returnTo.current = before;
          }
        }
        focusPressed(target, { x: event.clientX, y: event.clientY });
        return;
      }
      // Left, middle and right: the menu closes, and the press goes on (the buttons Back and Forward do
      // nothing while it is open).
      if (event.button <= 2) {
        close();
      }
    };

    const click = (event: MouseEvent): void => {
      if (swallowClick && event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
      }
      swallowClick = false;
    };

    const contextMenu = (event: MouseEvent): void => {
      // No menu of the system, anywhere in the window (D-075).
      event.preventDefault();
      const fromPress = pressed;
      pressed = false;
      if (inMenu(event.target)) {
        return;
      }
      const now = latest.current;
      const target = event.target instanceof Element ? event.target : null;
      const at =
        target === null
          ? undefined
          : fromPress
            ? { target, point: { x: event.clientX, y: event.clientY } }
            : keyboardHit(target);
      const place = at === undefined ? undefined : placeAt(at.target);
      if (at === undefined || place === undefined || now.blocked()) {
        close();
        return;
      }
      now.onOpen();
      show({ hit: { place, ...at }, selected: fromPress ? -1 : 0, shown: now.shown });
    };

    const key = (event: KeyboardEvent): void => {
      const open = menuNow.current;
      if (open === undefined || MODIFIERS.has(event.key)) {
        return;
      }
      const step = menuKey(event);
      // Enter or Space with no entry selected (the menu the mouse opened) is any other key.
      if (step.kind === "pass" || (step.kind === "choose" && open.selected < 0)) {
        close();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (step.kind === "close") {
        close();
      } else if (step.kind === "choose") {
        latest.current.choose(open.selected);
      } else {
        show({ ...open, selected: menuSelection(step, open.selected, latest.current.count()) });
      }
    };

    const wheel = (event: WheelEvent): void => {
      if (!inMenu(event.target)) {
        if (menuNow.current !== undefined) {
          closing.current.add(event);
        }
        close();
      }
    };

    window.addEventListener("mousedown", press, true);
    window.addEventListener("click", click, true);
    window.addEventListener("contextmenu", contextMenu);
    window.addEventListener("keydown", key, true);
    window.addEventListener("wheel", wheel, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", press, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("contextmenu", contextMenu);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [close, show]);

  // Another buffer is shown (a command, a key, the mode „Agent folgen“), or a prompt opens: the menu goes.
  const { shown, prompting } = options;
  useEffect(() => {
    if (menuNow.current !== undefined && menuNow.current.shown !== shown) {
      close();
    }
  }, [shown, close]);
  useEffect(() => {
    if (prompting) {
      close();
    }
  }, [prompting, close]);

  const isOpen = useCallback((): boolean => menuNow.current !== undefined, []);
  const closedBy = useCallback((event: WheelEvent): boolean => closing.current.has(event), []);
  return { menu, isOpen, closedBy, close, select };
};
