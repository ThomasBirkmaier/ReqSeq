// The context menu in the window (D-075, SR-194): a right press in an area of the sheet, or on macOS a
// press with Ctrl held (AK7), opens the app's own menu at the pointer. The listeners are added once and
// read refs, like those of the prefix key (`use-prefix.ts`). The menu never takes the focus: while it is
// open, its keys are taken in the capture phase, so the editor, the list and the active area keep their
// focus and selection. A press of the left or middle button outside it closes it and then does what it
// does without the menu (AK4, as the command prompt in SR-134 AK3).
import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MenuHit } from "./context-menu.js";
import { isMacCtrlPress, menuKey, menuSelection, opensMenu, placeAt } from "./context-menu.js";

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
  readonly close: () => void;
  /** Selects the entry at `index` (the pointer is on it). */
  readonly select: (index: number) => void;
}

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

/** The menu itself: a press, a wheel or a right-click in it is its own. */
const inMenu = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(".context-menu") !== null;

/**
 * The right press sets the focus as a left one would, but keeps a selection it lands in: in a text editor
 * the caret goes to the pointer unless the press is inside the selection (SR-195 AK2); elsewhere the field
 * pressed takes the focus. The native handling is prevented, because it selects a word or starts a drag.
 */
export const focusPressed = (target: Element, point: { readonly x: number; readonly y: number }): void => {
  const editor = target.closest(".cm-editor");
  const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null;
  if (view !== null) {
    const at = view.posAtCoords(point);
    const inside =
      at !== null &&
      view.state.selection.ranges.some((range) => !range.empty && range.from <= at && at <= range.to);
    if (at !== null && !inside) {
      view.dispatch({ selection: { anchor: at } });
    }
    view.focus();
    return;
  }
  target
    .closest<HTMLElement>("input, textarea, select, [contenteditable='true'], [tabindex]")
    ?.focus({ preventScroll: true });
};

/** The caret or selection of the page as a box, when there is one with a place on the screen. */
const selectionBox = (): DOMRect | undefined => {
  const selection = document.getSelection();
  const box =
    selection !== null && selection.rangeCount > 0
      ? selection.getRangeAt(0).getBoundingClientRect()
      : undefined;
  return box === undefined || (box.left === 0 && box.top === 0 && box.height === 0) ? undefined : box;
};

/**
 * Where a menu asked for by a key (the Menu key, Shift+F10) opens: at the caret in a text editor, else at
 * the selected row or node of the area, else at the area's top left corner.
 */
export const keyboardHit = (focused: Element): Omit<MenuHit, "place"> => {
  const area = focused.closest("[data-area]");
  const caret = focused.closest(".cm-editor") === null ? undefined : selectionBox();
  if (caret !== undefined) {
    return { target: focused, point: { x: caret.left, y: caret.bottom } };
  }
  const selected = area?.querySelector('[aria-selected="true"]');
  if (selected !== null && selected !== undefined) {
    const box = selected.getBoundingClientRect();
    return { target: selected, point: { x: box.left, y: box.bottom } };
  }
  const box = area?.getBoundingClientRect();
  return { target: focused, point: { x: box?.left ?? 0, y: box?.top ?? 0 } };
};

export const useContextMenu = (options: ContextMenuOptions): ContextMenu => {
  const latest = useRef(options);
  latest.current = options;
  const [menu, setMenu] = useState<MenuState | undefined>(undefined);
  const menuNow = useRef<MenuState | undefined>(undefined);
  const show = useCallback((next: MenuState | undefined): void => {
    menuNow.current = next;
    setMenu(next);
  }, []);
  const close = useCallback((): void => {
    if (menuNow.current !== undefined) {
      show(undefined);
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
      if (step.kind === "pass") {
        close();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (step.kind === "close") {
        close();
      } else if (step.kind === "choose") {
        if (open.selected >= 0) {
          latest.current.choose(open.selected);
        }
      } else {
        show({ ...open, selected: menuSelection(step, open.selected, latest.current.count()) });
      }
    };

    const wheel = (event: WheelEvent): void => {
      if (!inMenu(event.target)) {
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
  return { menu, isOpen, close, select };
};
