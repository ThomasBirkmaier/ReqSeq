// @vitest-environment happy-dom
// The listeners of the context menu (SR-194): which press and which `contextmenu` open it, its keys, and what
// closes it.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextMenu, ContextMenuOptions } from "./use-context-menu.js";
import { focusPressed, keyboardHit, useContextMenu } from "./use-context-menu.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let menu: ContextMenu;

const Harness = (props: ContextMenuOptions): null => {
  menu = useContextMenu(props);
  return null;
};

const options = (more: Partial<ContextMenuOptions> = {}): ContextMenuOptions => ({
  mac: false,
  blocked: () => false,
  shown: "list",
  prompting: false,
  onOpen: vi.fn(),
  count: () => 3,
  choose: vi.fn(),
  ...more,
});

const render = (props: ContextMenuOptions): void => {
  act(() => {
    root.render(createElement(Harness, props));
  });
};

/** Sends `event` to `target` inside `act`; returns it, to read `defaultPrevented`. */
const send = <E extends Event>(target: EventTarget, event: E): E => {
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

const mouse = (type: string, init: MouseEventInit = {}): MouseEvent =>
  new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 30, clientY: 40, ...init });

const key = (name: string, init: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });

/** A right press and its `contextmenu` on `target`, as Chromium sends them. */
const rightClick = (target: Element): { press: MouseEvent; menu: MouseEvent } => ({
  press: send(target, mouse("mousedown", { button: 2 })),
  menu: send(target, mouse("contextmenu", { button: 2 })),
});

beforeEach(() => {
  document.body.innerHTML = `
    <main><div data-area="left" data-active="">
      <div class="list" tabindex="0">
        <div id="row" role="option" aria-selected="true" data-menu="element-entry">row</div>
        <p id="empty">empty</p>
      </div>
    </div></main>
    <div class="minibuffer"><span id="echo">echo</span></div>
    <div class="context-menu"><div id="item">item</div></div>`;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
});

const element = (id: string): Element => document.getElementById(id) as Element;

describe("useContextMenu", () => {
  it("[SR-194/AK-dhq2] opens at the pointer on a right-click in an area, with no menu of the system", () => {
    const props = options();
    render(props);
    const sent = rightClick(element("row"));
    expect(sent.press.defaultPrevented).toBe(true);
    expect(sent.menu.defaultPrevented).toBe(true);
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    expect(menu.menu?.hit.place).toBe("element-entry");
    expect(menu.menu?.hit.point).toEqual({ x: 30, y: 40 });
    expect(menu.menu?.selected).toBe(-1);
    expect(menu.isOpen()).toBe(true);
    // The press focused the list it landed in.
    expect(document.activeElement).toBe(document.querySelector(".list"));
  });

  it("opens no menu outside the areas, in the menu itself or while blocked", () => {
    render(options());
    expect(rightClick(element("echo")).menu.defaultPrevented).toBe(true);
    expect(menu.menu).toBeUndefined();
    send(element("item"), mouse("contextmenu", { button: 2 }));
    expect(menu.menu).toBeUndefined();
    render(options({ blocked: () => true }));
    rightClick(element("empty"));
    expect(menu.menu).toBeUndefined();
  });

  it("opens at the selected row when a key asked for it, with the first entry selected", () => {
    render(options());
    send(element("empty"), mouse("contextmenu", { button: 0 }));
    expect(menu.menu?.hit.target).toBe(element("row"));
    expect(menu.menu?.hit.place).toBe("element-entry");
    expect(menu.menu?.selected).toBe(0);
  });

  it("moves through the entries and runs the selected one by its keys, which go nowhere else", () => {
    const props = options();
    render(props);
    rightClick(element("empty"));
    expect(send(window, key("Shift")).defaultPrevented).toBe(false);
    // Enter with no entry selected closes the menu and goes on.
    expect(send(window, key("Enter")).defaultPrevented).toBe(false);
    expect(props.choose).not.toHaveBeenCalled();
    expect(menu.menu).toBeUndefined();
    rightClick(element("empty"));
    expect(send(window, key("ArrowUp")).defaultPrevented).toBe(true);
    expect(menu.menu?.selected).toBe(2);
    send(window, key("ArrowDown"));
    expect(menu.menu?.selected).toBe(0);
    act(() => {
      menu.select(1);
    });
    expect(menu.menu?.selected).toBe(1);
    send(window, key("Enter"));
    expect(props.choose).toHaveBeenCalledWith(1);
  });

  it("[SR-194/AK-kvdd] closes on Escape and on another key, which then goes on", () => {
    render(options());
    rightClick(element("empty"));
    expect(send(window, key("Escape")).defaultPrevented).toBe(true);
    expect(menu.menu).toBeUndefined();
    rightClick(element("empty"));
    expect(send(window, key("a")).defaultPrevented).toBe(false);
    expect(menu.menu).toBeUndefined();
  });

  it("[SR-194/AK-kvdd] closes on a left press outside, which goes on, and not on a press in the menu", () => {
    render(options());
    rightClick(element("empty"));
    send(element("item"), mouse("mousedown", { button: 0 }));
    expect(menu.isOpen()).toBe(true);
    send(element("item"), new WheelEvent("wheel", { bubbles: true }));
    expect(menu.isOpen()).toBe(true);
    const press = send(element("row"), mouse("mousedown", { button: 0 }));
    expect(press.defaultPrevented).toBe(false);
    expect(menu.menu).toBeUndefined();
    // The buttons Back and Forward leave it open.
    rightClick(element("empty"));
    send(element("row"), mouse("mousedown", { button: 3 }));
    expect(menu.isOpen()).toBe(true);
  });

  it("closes on a wheel outside, a blur, a resize, another buffer and a prompt", () => {
    render(options());
    const closes = (event: () => void): void => {
      rightClick(element("empty"));
      act(event);
      expect(menu.menu).toBeUndefined();
    };
    closes(() => {
      element("row").dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    });
    closes(() => {
      window.dispatchEvent(new Event("blur"));
    });
    closes(() => {
      window.dispatchEvent(new Event("resize"));
    });
    closes(() => {
      root.render(createElement(Harness, options({ shown: "element" })));
    });
    closes(() => {
      root.render(createElement(Harness, options({ shown: "element", prompting: true })));
    });
  });

  it("[SR-194/AK-hkgb] takes Ctrl+click on macOS as a right-click: the press and its click go nowhere else", () => {
    const props = options({ mac: true });
    render(props);
    const below = vi.fn();
    document.addEventListener("mousedown", below);
    document.addEventListener("click", below);
    const press = send(element("row"), mouse("mousedown", { button: 0, ctrlKey: true }));
    expect(press.defaultPrevented).toBe(true);
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    send(element("row"), mouse("contextmenu", { button: 0, ctrlKey: true }));
    expect(menu.menu?.selected).toBe(-1);
    const click = send(element("row"), mouse("click", { button: 0, ctrlKey: true }));
    expect(click.defaultPrevented).toBe(true);
    expect(below).not.toHaveBeenCalled();
    // A later click is a click again.
    send(element("row"), mouse("click", { button: 0 }));
    expect(below).toHaveBeenCalledTimes(1);
    document.removeEventListener("mousedown", below);
    document.removeEventListener("click", below);
  });
});

describe("focusPressed", () => {
  it("puts the caret of an editor at the pointer, unless the press is inside the selection", () => {
    const parent = element("empty");
    const view = new EditorView({
      state: EditorState.create({ doc: "hello world", selection: { anchor: 0, head: 5 } }),
      parent,
    });
    const at = vi.spyOn(view, "posAtCoords");
    at.mockReturnValueOnce(3);
    focusPressed(view.contentDOM, { x: 1, y: 1 });
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(5);
    at.mockReturnValueOnce(8);
    focusPressed(view.contentDOM, { x: 1, y: 1 });
    expect(view.state.selection.main.head).toBe(8);
    expect(view.state.selection.main.empty).toBe(true);
    at.mockReturnValueOnce(null);
    focusPressed(view.contentDOM, { x: 1, y: 1 });
    expect(view.state.selection.main.head).toBe(8);
    view.destroy();
  });
});

describe("a menu of the modeline (SR-196)", () => {
  it("gives the focus back to where it was when it closes, unless it moved on", () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `
        <main><div data-area="left" data-active=""><article data-buffer tabindex="0">
          <div data-field="topic" tabindex="0" id="topic">topic</div>
        </article></div></main>
        <footer class="modeline"><span data-field="Status" data-menu="field-status" tabindex="-1" id="status">draft</span></footer>
        <input id="prompt-input">`;
      render(options());
      (element("topic") as HTMLElement).focus();
      rightClick(element("status"));
      expect(menu.menu?.hit.place).toBe("field-status");
      expect(document.activeElement).toBe(element("status"));
      send(window, key("Escape"));
      act(() => {
        vi.runAllTimers();
      });
      expect(document.activeElement).toBe(element("topic"));
      // Opened by a key on the field: back to the buffer. An entry that opens a prompt keeps it.
      (element("status") as HTMLElement).focus();
      send(element("status"), mouse("contextmenu", { button: 0 }));
      act(() => {
        menu.close();
        vi.runAllTimers();
      });
      expect(document.activeElement?.hasAttribute("data-buffer")).toBe(true);
      rightClick(element("status"));
      act(() => {
        menu.close();
        (element("prompt-input") as HTMLElement).focus();
        vi.runAllTimers();
      });
      expect(document.activeElement).toBe(element("prompt-input"));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("focusPressed on a field", () => {
  it("focuses the field pressed, or the first control of a field that takes no focus itself (SR-196)", () => {
    document.body.innerHTML = `
      <article data-buffer tabindex="0">
        <div data-field="Title" tabindex="0"><h1 id="title">Title</h1></div>
        <div data-field="refines"><h2 id="group">refines</h2><span id="link" role="link" tabindex="0">N-1</span></div>
        <div data-field="empty"><h2 id="bare">empty</h2></div>
        <p id="page">page</p>
      </article>`;
    focusPressed(element("title"), { x: 0, y: 0 });
    expect(document.activeElement?.getAttribute("data-field")).toBe("Title");
    focusPressed(element("group"), { x: 0, y: 0 });
    expect(document.activeElement).toBe(element("link"));
    focusPressed(element("bare"), { x: 0, y: 0 });
    expect(document.activeElement?.hasAttribute("data-buffer")).toBe(true);
    focusPressed(element("page"), { x: 0, y: 0 });
    expect(document.activeElement?.hasAttribute("data-buffer")).toBe(true);
  });
});

describe("keyboardHit", () => {
  it("opens at the selected row, else at the area's corner", () => {
    expect(keyboardHit(element("empty")).target).toBe(element("row"));
    element("row").setAttribute("aria-selected", "false");
    expect(keyboardHit(element("empty"))).toEqual({ target: element("empty"), point: { x: 0, y: 0 } });
  });

  it("[SR-198/AK-qc75] opens on the place of a focused buffer's content, such as the column of a list", () => {
    document.body.innerHTML = `
      <div data-area="left">
        <div id="buffer" data-buffer="" tabindex="0"><div id="column" data-menu="list"><h1 id="heading">All</h1></div></div>
        <div id="other" data-buffer="" tabindex="0"><p>empty</p></div>
      </div>`;
    expect(keyboardHit(element("buffer"))).toEqual({ target: element("column"), point: { x: 0, y: 0 } });
    // A buffer without such a mark, and an element inside the buffer, keep themselves as the target.
    expect(keyboardHit(element("other")).target).toBe(element("other"));
    expect(keyboardHit(element("heading")).target).toBe(element("heading"));
  });

  it("opens at the focused element outside the areas, such as a field of the modeline", () => {
    expect(keyboardHit(element("echo"))).toEqual({ target: element("echo"), point: { x: 0, y: 0 } });
  });
});
