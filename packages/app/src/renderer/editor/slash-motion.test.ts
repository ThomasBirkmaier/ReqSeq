// @vitest-environment happy-dom
// SR-129 AK5: the slash menu gets the seam and the backdrop of the command line's card when it appears, and
// a copy that runs back when it goes. The motion itself is CSS (styles.test.ts) and shown on the built app
// (test/slash-motion.spec.ts); here the menu is a stand-in for the tooltip of @codemirror/autocomplete.
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEAVING_CLASS, SLASH_CLASS, slashMotion } from "./slash-motion.js";

let view: EditorView;

beforeEach(() => {
  view = new EditorView({ doc: "", extensions: [slashMotion], parent: document.body });
});

afterEach(() => {
  view.destroy();
  view.dom.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Lets the MutationObserver answer. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A stand-in for the tooltip of the slash menu, with a scrolled list of options. */
const menu = (): HTMLElement => {
  const tooltip = document.createElement("div");
  tooltip.className = `cm-tooltip cm-tooltip-autocomplete ${SLASH_CLASS}`;
  const list = document.createElement("ul");
  list.id = "list";
  list.setAttribute("role", "listbox");
  const item = document.createElement("li");
  item.setAttribute("role", "option");
  item.setAttribute("aria-selected", "true");
  list.append(item);
  tooltip.append(list);
  return tooltip;
};

const leaving = (): HTMLElement[] => [...view.dom.querySelectorAll<HTMLElement>(`.${LEAVING_CLASS}`)];

/** Pretends the CSS gives the leaving copies an animation (motion on). */
const withMotion = (): void => {
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = original(element);
    return element instanceof HTMLElement && element.classList.contains(LEAVING_CLASS)
      ? new Proxy(style, {
          get: (target, key) =>
            key === "animationName" ? "card-show" : (Reflect.get(target, key) as unknown),
        })
      : style;
  });
};

describe("the slash menu in motion (SR-129 AK5)", () => {
  it("[SR-129/AK-pk82] puts a seam around the menu and a backdrop behind it, both starting the motion in", async () => {
    const shown = menu();
    view.dom.append(shown);
    await settle();
    expect(shown.dataset["motion"]).toBe("in");
    expect(shown.firstElementChild?.className).toBe("slash-seam");
    expect(shown.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    const backdrop = shown.previousElementSibling as HTMLElement;
    expect(backdrop.className).toBe("slash-backdrop");
    expect(backdrop.dataset["motion"]).toBe("in");
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
  });

  it("goes at once without motion: no copy and no backdrop stay", async () => {
    const shown = menu();
    view.dom.append(shown);
    await settle();
    shown.remove();
    await settle();
    expect(leaving()).toEqual([]);
    expect(view.dom.querySelector(".slash-backdrop")).toBeNull();
  });

  it("with motion, a mute copy of the menu runs back with the backdrop, and both go when it ends", async () => {
    withMotion();
    const shown = menu();
    view.dom.append(shown);
    await settle();
    const list = shown.querySelector("ul");
    if (list !== null) {
      list.scrollTop = 0;
    }
    shown.remove();
    await settle();
    const [backdrop, copy] = leaving();
    expect(backdrop?.className).toContain("slash-backdrop");
    expect(copy?.classList.contains(SLASH_CLASS)).toBe(true);
    for (const node of [backdrop, copy]) {
      expect(node?.dataset["motion"]).toBe("out");
    }
    // Says nothing to a screen reader, and is no option of a listbox.
    expect(copy?.getAttribute("aria-hidden")).toBe("true");
    expect(copy?.inert).toBe(true);
    expect(copy?.querySelector("[role], [id], [aria-selected]")).toBeNull();
    // The copy itself does not count as a menu that appears.
    expect(copy?.querySelectorAll(".slash-seam")).toHaveLength(1);
    // An animation of a child ending is not the copy's own.
    copy?.querySelector("li")?.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(copy?.isConnected).toBe(true);
    copy?.dispatchEvent(new Event("animationend"));
    backdrop?.dispatchEvent(new Event("animationend"));
    expect(leaving()).toEqual([]);
  });

  it("removes the copy after a while when no animation ends, as in a hidden window", async () => {
    withMotion();
    const shown = menu();
    view.dom.append(shown);
    await settle();
    vi.useFakeTimers();
    shown.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(leaving()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(leaving()).toEqual([]);
  });

  it("a menu that comes again at once takes the place of the copy still running back", async () => {
    withMotion();
    const first = menu();
    view.dom.append(first);
    await settle();
    first.remove();
    await settle();
    expect(leaving()).toHaveLength(2);
    const second = menu();
    view.dom.append(second);
    await settle();
    expect(leaving()).toEqual([]);
    expect(view.dom.querySelectorAll(".slash-backdrop")).toHaveLength(1);
  });

  it("leaves nothing behind when the editor goes", async () => {
    withMotion();
    const shown = menu();
    view.dom.append(shown);
    await settle();
    shown.remove();
    await settle();
    expect(leaving()).toHaveLength(2);
    view.destroy();
    expect(leaving()).toEqual([]);
    expect(view.dom.querySelector(".slash-backdrop")).toBeNull();
    const other = menu();
    view.dom.append(other);
    await settle();
    expect(other.dataset["motion"]).toBeUndefined();
  });

  it("keeps one seam when the same menu is shown again", async () => {
    const shown = menu();
    view.dom.append(shown);
    await settle();
    shown.remove();
    await settle();
    view.dom.append(shown);
    await settle();
    expect(shown.querySelectorAll(".slash-seam")).toHaveLength(1);
  });

  it("ignores what is not the slash menu", async () => {
    const other = document.createElement("div");
    other.className = "cm-tooltip";
    view.dom.append(other);
    view.dom.append(document.createTextNode("x"));
    await settle();
    expect(other.dataset["motion"]).toBeUndefined();
    expect(view.dom.querySelector(".slash-backdrop")).toBeNull();
  });
});
