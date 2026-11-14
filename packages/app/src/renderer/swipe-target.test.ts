// @vitest-environment happy-dom
// What is under the pointer for a swipe (SR-211 AK5, `swipe-target.ts`).
import { describe, expect, it } from "vitest";
import { LINE_PX, scrollsFirst, verticalScroller, wheelPixels } from "./swipe-target.js";

/** An element with the given scroll box and overflow. */
const box = (
  parent: Element,
  size: { readonly width: number; readonly scrollWidth: number; readonly left?: number },
  overflow = "auto",
  height = { client: 100, scroll: 100 },
): HTMLElement => {
  const element = document.createElement("div");
  element.style.overflowX = overflow;
  element.style.overflowY = overflow;
  Object.defineProperty(element, "clientWidth", { value: size.width });
  Object.defineProperty(element, "scrollWidth", { value: size.scrollWidth });
  Object.defineProperty(element, "clientHeight", { value: height.client });
  Object.defineProperty(element, "scrollHeight", { value: height.scroll });
  Object.defineProperty(element, "scrollLeft", { value: size.left ?? 0 });
  parent.append(element);
  return element;
};

describe("scrollsFirst", () => {
  it("is true while wide content under the pointer can scroll in the swipe's direction, false at its edge", () => {
    const layer = document.createElement("div");
    document.body.append(layer);
    const table = box(layer, { width: 100, scrollWidth: 300, left: 0 });
    const cell = document.createElement("span");
    table.append(cell);
    // At its left edge: dX < 0 (toward the start) switches, dX > 0 scrolls.
    expect(scrollsFirst(cell, layer, -1)).toBe(false);
    expect(scrollsFirst(cell, layer, 1)).toBe(true);
    const end = box(layer, { width: 100, scrollWidth: 300, left: 200 });
    expect(scrollsFirst(end, layer, 1)).toBe(false);
    expect(scrollsFirst(end, layer, -1)).toBe(true);
    layer.remove();
  });

  it("ignores content that does not overflow or does not scroll, and stops at the layer", () => {
    const outer = box(document.body, { width: 100, scrollWidth: 300, left: 50 });
    const layer = document.createElement("div");
    outer.append(layer);
    const narrow = box(layer, { width: 100, scrollWidth: 100 });
    const hidden = box(layer, { width: 100, scrollWidth: 300, left: 50 }, "hidden");
    expect(scrollsFirst(narrow, layer, 1)).toBe(false);
    expect(scrollsFirst(hidden, layer, 1)).toBe(false);
    // `outer` lies beyond the layer.
    expect(scrollsFirst(layer, layer, -1)).toBe(false);
    outer.remove();
  });
});

describe("verticalScroller", () => {
  it("finds the nearest element that scrolls vertically, up to the layer", () => {
    const layer = box(document.body, { width: 100, scrollWidth: 100 }, "auto", { client: 100, scroll: 500 });
    const inner = box(layer, { width: 100, scrollWidth: 100 });
    expect(verticalScroller(inner, layer)).toBe(layer);
    const flat = box(document.body, { width: 100, scrollWidth: 100 });
    expect(verticalScroller(flat, flat)).toBeUndefined();
    layer.remove();
    flat.remove();
  });
});

describe("wheelPixels", () => {
  it("turns lines and pages into px", () => {
    expect(wheelPixels({ deltaX: -3, deltaY: 2, deltaMode: 0 }, 800)).toEqual({ dx: -3, dy: 2 });
    expect(wheelPixels({ deltaX: 1, deltaY: 0, deltaMode: 1 }, 800)).toEqual({ dx: LINE_PX, dy: 0 });
    expect(wheelPixels({ deltaX: 1, deltaY: 0, deltaMode: 2 }, 800)).toEqual({ dx: 800, dy: 0 });
  });
});
