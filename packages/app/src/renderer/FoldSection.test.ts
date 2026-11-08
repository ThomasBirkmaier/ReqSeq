// @vitest-environment happy-dom
// FoldSection (SR-032 AK3, SR-201): closed at first, opened and closed by a click on its head and by Enter,
// Space or Tab without a modifier (SR-193); its lines are rendered only while open.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoldSection } from "./FoldSection.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(
      createElement(FoldSection, {
        label: "Older records",
        count: 2,
        children: createElement("p", { className: "line" }, "x"),
      }),
    );
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const head = (): HTMLElement => {
  const found = container.querySelector<HTMLElement>(".fold-head");
  if (found === null) {
    throw new Error("no fold head");
  }
  return found;
};
const lines = (): number => container.querySelectorAll(".line").length;

const press = (key: string, more: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more });
  act(() => {
    head().dispatchEvent(event);
  });
  return event;
};

describe("FoldSection", () => {
  it("[SR-032/AK3] starts closed with its count and opens and closes by click and keys", () => {
    expect(head().textContent).toBe("▸Older records (2)");
    expect([head().getAttribute("aria-expanded"), lines()]).toEqual(["false", 0]);
    act(() => {
      head().click();
    });
    expect([head().textContent, head().getAttribute("aria-expanded"), lines()]).toEqual([
      "▾Older records (2)",
      "true",
      1,
    ]);
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(lines()).toBe(0);
    press(" ");
    expect(lines()).toBe(1);
  });

  it("toggles with Tab on its head (SR-193), and leaves Tab with a modifier and other keys alone", () => {
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(lines()).toBe(1);
    for (const [key, more] of [
      ["Tab", { shiftKey: true }],
      ["Enter", { ctrlKey: true }],
      ["Enter", { metaKey: true }],
      [" ", { altKey: true }],
      ["a", {}],
    ] as const) {
      expect(press(key, more).defaultPrevented).toBe(false);
    }
    expect(lines()).toBe(1);
  });
});
