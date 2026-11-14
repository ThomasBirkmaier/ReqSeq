// @vitest-environment happy-dom
// The window's side of the swipe (SR-211, `use-wheel-swipe.ts`): the wheel listener on the sheet, the pointer
// over the active area, content that scrolls first, and the calls to the window. The gesture itself is
// `buffer-swipe.test.ts`; the swipe on the built app is `test/buffer-swipe.spec.ts`.
import { act, createElement, useRef } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SEGMENT_GAP_MS } from "./buffer-swipe.js";
import type { WheelSwipeOptions } from "./use-wheel-swipe.js";
import { useWheelSwipe } from "./use-wheel-swipe.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

const Sheet = (props: WheelSwipeOptions): React.JSX.Element => {
  const sheet = useRef<HTMLElement>(null);
  useWheelSwipe(sheet, props);
  return createElement(
    "main",
    { ref: sheet },
    createElement(
      "div",
      { "data-area": "left", "data-active": "", id: "area" },
      createElement(
        "div",
        { "data-layer": "main", id: "main" },
        createElement("div", { id: "wide", style: { overflowX: "auto", overflowY: "auto" } }, "wide"),
      ),
    ),
    createElement("div", { "data-area": "right", id: "other" }),
  );
};

const options = (more: Partial<WheelSwipeOptions> = {}): WheelSwipeOptions => ({
  blocked: () => false,
  closedMenu: () => false,
  begin: vi.fn(),
  switch: vi.fn(),
  end: vi.fn(),
  ...more,
});

const render = (props: WheelSwipeOptions): void => {
  act(() => {
    root.render(createElement(Sheet, props));
  });
};

const byId = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(id);
  }
  return found;
};

/** A wheel event over `target`, by default at x = 50 (inside the area, 0..600) with no button held. */
const wheel = (
  target: Element,
  init: WheelEventInit & { readonly clientX?: number; readonly buttons?: number } = {},
): WheelEvent => {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  // happy-dom's WheelEvent has no pointer position and no buttons.
  Object.defineProperty(event, "clientX", { value: init.clientX ?? 50 });
  Object.defineProperty(event, "clientY", { value: 50 });
  Object.defineProperty(event, "buttons", { value: init.buttons ?? 0 });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

beforeEach(() => {
  vi.useFakeTimers();
  // The window can animate: with motion, a swipe switches at its end.
  document.documentElement.animate = vi.fn() as typeof document.documentElement.animate;
  window.matchMedia = ((query: string) => ({ matches: false, media: query })) as typeof window.matchMedia;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.useRealTimers();
});

/** Gives the area a box of 600 x 400 and puts `#wide` under the pointer. */
const layout = (
  wide: { scrollWidth: number; scrollLeft: number } = { scrollWidth: 100, scrollLeft: 0 },
): void => {
  const area = byId("area");
  area.getBoundingClientRect = () => ({ left: 0, right: 600, top: 0, bottom: 400 }) as DOMRect;
  Object.defineProperty(area, "clientWidth", { value: 600 });
  const element = byId("wide");
  Object.defineProperty(element, "clientWidth", { value: 100 });
  Object.defineProperty(element, "scrollWidth", { value: wide.scrollWidth });
  Object.defineProperty(element, "scrollLeft", { value: wide.scrollLeft });
  Object.defineProperty(element, "clientHeight", { value: 100 });
  Object.defineProperty(element, "scrollHeight", { value: 500 });
  document.elementsFromPoint = () => [element, byId("main"), area];
};

it("a swipe over the active area past a third prevents its events, begins, switches and ends", () => {
  const props = options();
  render(props);
  layout();
  const event = wheel(byId("wide"), { deltaX: -300 });
  expect(event.defaultPrevented).toBe(true);
  expect(props.begin).toHaveBeenCalledWith("back");
  vi.advanceTimersByTime(SEGMENT_GAP_MS);
  expect(props.switch).toHaveBeenCalledWith("back");
  expect(props.end).toHaveBeenCalled();
});

it("switches nothing when the window blocks it at the end", () => {
  let blocked = false;
  const props = options({ blocked: () => blocked });
  render(props);
  layout();
  wheel(byId("wide"), { deltaX: 300 });
  blocked = true;
  vi.advanceTimersByTime(SEGMENT_GAP_MS);
  expect(props.begin).toHaveBeenCalledWith("forward");
  expect(props.switch).not.toHaveBeenCalled();
});

it("ignores a swipe outside the active area, with a button held, blocked, or that closed a menu", () => {
  const props = options();
  render(props);
  layout();
  const outside = wheel(byId("other"), { deltaX: -300, clientX: 700 });
  vi.advanceTimersByTime(200);
  const held = wheel(byId("wide"), { deltaX: -300, buttons: 1 });
  vi.advanceTimersByTime(200);
  expect([outside.defaultPrevented, held.defaultPrevented]).toEqual([false, false]);
  render(options({ ...props, closedMenu: () => true }));
  expect(wheel(byId("wide"), { deltaX: -300 }).defaultPrevented).toBe(false);
  vi.advanceTimersByTime(200);
  render(options({ ...props, blocked: () => true }));
  expect(wheel(byId("wide"), { deltaX: -300 }).defaultPrevented).toBe(false);
  expect(props.begin).not.toHaveBeenCalled();
});

it("content under the pointer that scrolls that way first takes the swipe (AK5)", () => {
  const props = options();
  render(props);
  layout({ scrollWidth: 400, scrollLeft: 0 });
  // At its left edge: toward the end it scrolls, toward the start it switches.
  expect(wheel(byId("wide"), { deltaX: 300 }).defaultPrevented).toBe(false);
  vi.advanceTimersByTime(200);
  expect(wheel(byId("wide"), { deltaX: -300 }).defaultPrevented).toBe(true);
  expect(props.begin).toHaveBeenCalledTimes(1);
});

it("scrolls a vertical distance held back, and lines count as px", () => {
  const props = options();
  render(props);
  layout();
  const element = byId("wide");
  const scrollBy = vi.fn();
  element.scrollBy = scrollBy as typeof element.scrollBy;
  wheel(element, { deltaY: 3 });
  // A line is 16 px: vertical at once, left to the browser.
  expect(wheel(element, { deltaY: 1, deltaMode: 1 }).defaultPrevented).toBe(false);
  expect(scrollBy).toHaveBeenCalledWith({ top: 3 });
});

it("removes its listener when the window goes", () => {
  const props = options();
  render(props);
  layout();
  const main = document.querySelector("main");
  act(() => {
    root.unmount();
  });
  root = createRoot(host);
  if (main !== null) {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: -300 });
    main.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
});
