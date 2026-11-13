// @vitest-environment happy-dom
// The switch to the previous or next buffer in motion (SR-212): the picture of the view that is left, the way
// and time of the motion, its start once the new view is drawn, and its end at once on input or another change.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlideSpec } from "./buffer-slide.js";
import {
  DRAW_DEADLINE_MS,
  SLIDE_EASE,
  SLIDE_ID,
  SLIDE_MS,
  SlideController,
  directionOf,
  motionAllowed,
  offsets,
  slideDuration,
  slideEase,
  slideKeyframes,
  takePicture,
  trackOf,
} from "./buffer-slide.js";

const device = (): { prefersReducedMotion: string } =>
  (window as unknown as { happyDOM: { settings: { device: { prefersReducedMotion: string } } } }).happyDOM
    .settings.device;

/** An area as `BufferArea.tsx` draws it, with `html` as its live view. */
const area = (side: string, html: string): HTMLElement => {
  const element = document.createElement("div");
  element.dataset["area"] = side;
  element.innerHTML = `<div class="slide-layer" data-layer="main">${html}</div><div class="slide-layer" data-layer="side" hidden></div>`;
  return element;
};

const VIEW =
  '<article data-buffer tabindex="-1" aria-label="SR-1 One" role="document" id="head"><h1>One</h1>' +
  '<svg><marker id="arrow"></marker><path marker-end="url(#arrow)"></path><use href="#arrow"></use><a href="https://x"></a></svg>' +
  '<div class="cm-editor"><div contenteditable="true" class="cm-content">Text</div><div class="cm-tooltip">tip</div></div>' +
  '<input name="filter"><label for="head">L</label><div class="scroll" style="overflow:auto;height:10px"><p>a</p></div></article>';

describe("the picture of the view that is left", () => {
  it("[SR-212/AK-kqvx] takes no focus, input or locator of the live view: no data-buffer, label, role, tab stop, editable text or id of it", () => {
    const root = area("left", VIEW);
    document.body.append(root);
    const main = root.querySelector<HTMLElement>('[data-layer="main"]');
    if (main === null) {
      throw new Error("no layer");
    }
    main.querySelector("input")?.setAttribute("value", "");
    const input = main.querySelector("input");
    if (input !== null) {
      input.value = "typed";
    }
    const picture = takePicture(main);
    const { node } = picture;
    expect(node.className).toBe("slide-picture");
    expect(node.inert).toBe(true);
    expect(node.getAttribute("aria-hidden")).toBe("true");
    for (const name of ["data-buffer", "aria-label", "role", "tabindex", "contenteditable", "for", "name"]) {
      expect(node.querySelector(`[${name}]`)).toBeNull();
    }
    // Ids and their references are prefixed, so the arrowheads of a graph still draw.
    expect([...node.querySelectorAll("[id]")].map((element) => element.id)).toEqual([
      "slide-head",
      "slide-arrow",
    ]);
    expect(node.querySelector("path")?.getAttribute("marker-end")).toBe("url(#slide-arrow)");
    expect(node.querySelector("use")?.getAttribute("href")).toBe("#slide-arrow");
    expect(node.querySelector("a")?.getAttribute("href")).toBe("https://x");
    // No popup of the editor, the text and a field as typed.
    expect(node.querySelector(".cm-tooltip")).toBeNull();
    expect(node.querySelector(".cm-content")?.textContent).toBe("Text");
    expect(node.querySelector("input")?.value).toBe("typed");
    // The live view is untouched.
    expect(main.querySelector("[data-buffer]")?.id).toBe("head");
    root.remove();
  });

  it("scrolls its copies of scroll containers where the view stood, once it is in the page", () => {
    const root = area("left", VIEW);
    document.body.append(root);
    const scroll = root.querySelector<HTMLElement>(".scroll");
    if (scroll === null) {
      throw new Error("no scroll");
    }
    scroll.scrollTop = 7;
    scroll.scrollLeft = 3;
    const main = root.querySelector('[data-layer="main"]');
    const picture = takePicture(main ?? root);
    document.body.append(picture.node);
    picture.placed();
    const copy = picture.node.querySelector<HTMLElement>(".scroll");
    expect([copy?.scrollTop, copy?.scrollLeft]).toEqual([7, 3]);
    picture.node.remove();
    root.remove();
  });

  it("finds the track of an area by its side, and none without its layers", () => {
    const root = document.createElement("div");
    root.append(area("left", "<p></p>"));
    expect(trackOf(root, "left")?.main.dataset["layer"]).toBe("main");
    expect(trackOf(root, "right")).toBeUndefined();
    expect(trackOf(undefined, "left")).toBeUndefined();
    const bare = document.createElement("div");
    bare.innerHTML = '<div data-area="left"><div data-layer="main"></div></div>';
    expect(trackOf(bare, "left")).toBeUndefined();
  });
});

describe("the way and time of a slide", () => {
  it("[SR-212/AK-d25h] Previous buffer moves the left view out to the right and the new one in from the left, Next buffer the other way, in at most 200 ms", () => {
    expect(directionOf(1)).toBe("back");
    expect(directionOf(-1)).toBe("forward");
    expect(offsets("back", 0)).toEqual({ leaving: 0, coming: -100 });
    expect(offsets("back", 1)).toEqual({ leaving: 100, coming: 0 });
    expect(offsets("forward", 0)).toEqual({ leaving: -0, coming: 100 });
    expect(offsets("forward", 1)).toEqual({ leaving: -100, coming: -0 });
    expect(slideKeyframes("back")).toEqual({
      leaving: [{ transform: "translateX(0%)" }, { transform: "translateX(100%)" }],
      coming: [{ transform: "translateX(-100%)" }, { transform: "translateX(0%)" }],
    });
    expect(slideDuration()).toBe(SLIDE_MS);
    expect(SLIDE_MS).toBeLessThanOrEqual(200);
  });

  it("runs from any offset, as a swipe released part of the way, for the rest of the time", () => {
    expect(slideKeyframes("forward", 0.4)).toEqual({
      leaving: [{ transform: "translateX(-40%)" }, { transform: "translateX(-100%)" }],
      coming: [{ transform: "translateX(60%)" }, { transform: "translateX(0%)" }],
    });
    expect(slideDuration(0.4)).toBe(96);
    expect(slideDuration(2)).toBe(0);
    expect(slideDuration(-1)).toBe(SLIDE_MS);
  });

  it("takes the curve of the card of the command line, or its own without the token", () => {
    expect(slideEase(window)).toBe(SLIDE_EASE);
    document.documentElement.style.setProperty("--card-ease", "linear");
    expect(slideEase(window)).toBe("linear");
    document.documentElement.style.removeProperty("--card-ease");
  });

  it("[SR-212/AK-kzb2] moves nothing when the system reduces motion or the window cannot animate", () => {
    device().prefersReducedMotion = "no-preference";
    expect(motionAllowed(window)).toBe(true);
    device().prefersReducedMotion = "reduce";
    expect(motionAllowed(window)).toBe(false);
    device().prefersReducedMotion = "no-preference";
    const animate = vi.spyOn(document.documentElement, "animate").mockImplementation(undefined as never);
    Object.defineProperty(document.documentElement, "animate", { value: undefined, configurable: true });
    expect(motionAllowed(window)).toBe(false);
    Reflect.deleteProperty(document.documentElement, "animate");
    animate.mockRestore();
    device().prefersReducedMotion = "reduce";
  });
});

describe("a slide in a window", () => {
  let root: HTMLElement;
  let frames: FrameRequestCallback[];
  let slides: SlideController;
  const BACK: SlideSpec = { side: "left", from: "one", to: "two", direction: "back" };

  /** Runs the frames asked for so far (each `requestAnimationFrame` once). */
  const frame = (): void => {
    const now = frames;
    frames = [];
    for (const callback of now) {
      callback(0);
    }
  };
  const side = (): HTMLElement => {
    const found = root.querySelector<HTMLElement>('[data-layer="side"]');
    if (found === null) {
      throw new Error("no side layer");
    }
    return found;
  };
  const main = (): HTMLElement => {
    const found = root.querySelector<HTMLElement>('[data-layer="main"]');
    if (found === null) {
      throw new Error("no main layer");
    }
    return found;
  };
  /** The running animations of slides. */
  const running = (): Animation[] =>
    [side(), main()].flatMap((layer) => layer.getAnimations()).filter((one) => one.id === SLIDE_ID);
  /** The live view becomes `html`, as React's commit of the switch does. */
  const commit = (html: string): void => {
    main().innerHTML = html;
  };

  beforeEach(() => {
    device().prefersReducedMotion = "no-preference";
    root = document.createElement("main");
    root.append(area("left", "<article data-buffer>One</article>"));
    document.body.append(root);
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    slides = new SlideController({ view: window, root: () => root });
  });

  afterEach(() => {
    slides.finish();
    vi.restoreAllMocks();
    vi.useRealTimers();
    root.remove();
    device().prefersReducedMotion = "reduce";
  });

  it("[SR-212/AK-d25h] covers the area with the picture after the live view, and moves both once the new view is drawn, frames after its paint", () => {
    slides.prepare(BACK);
    expect(slides.busy).toBe(true);
    commit("<article data-buffer>Two</article>");
    slides.settle("left", "two");
    // The picture stands where the view stood, after the live view, which waits beside it.
    expect(side().hidden).toBe(false);
    expect(side().textContent).toBe("One");
    expect(root.querySelector("[data-buffer]")?.textContent).toBe("Two");
    expect(side().style.transform).toBe("translateX(0%)");
    expect(main().style.transform).toBe("translateX(-100%)");
    expect(running()).toEqual([]);
    slides.drawn("other");
    slides.drawn("two");
    frame();
    expect(running()).toEqual([]);
    frame();
    const [leaving, coming] = running();
    expect(leaving?.effect?.getComputedTiming().duration).toBe(SLIDE_MS);
    expect((leaving?.effect as KeyframeEffect).getKeyframes().map((one) => one["transform"])).toEqual([
      "translateX(0%)",
      "translateX(100%)",
    ]);
    expect((coming?.effect as KeyframeEffect).getKeyframes().map((one) => one["transform"])).toEqual([
      "translateX(-100%)",
      "translateX(0%)",
    ]);
    expect(main().style.transform).toBe("");
    // A second report of the same view starts nothing more.
    slides.drawn("two");
    expect(running()).toHaveLength(2);
  });

  it("[SR-212/AK-d25h] ends by itself in the end state: no picture, nothing moved", async () => {
    slides.prepare(BACK);
    commit("<article data-buffer>Two</article>");
    slides.drawn("two");
    slides.settle("left", "two");
    frame();
    frame();
    const animations = running();
    for (const animation of animations) {
      animation.finish();
    }
    await animations[0]?.finished;
    await Promise.resolve();
    expect(slides.busy).toBe(false);
    expect(side().hidden).toBe(true);
    expect(side().childElementCount).toBe(0);
    expect(running()).toEqual([]);
  });

  it("[SR-212/AK-d25h] slides anyway when the new view never says it is drawn", () => {
    vi.useFakeTimers();
    slides.prepare(BACK);
    commit("<article data-buffer>Two</article>");
    slides.settle("left", "two");
    vi.advanceTimersByTime(DRAW_DEADLINE_MS - 1);
    expect(running()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(running()).toHaveLength(2);
  });

  it("[SR-212/AK-kqvx] a key, a press of a mouse button or the buttons Back and Forward end a running slide at once in its end state", () => {
    for (const input of [
      new KeyboardEvent("keydown", { key: "x", bubbles: true }),
      new PointerEvent("pointerdown", { bubbles: true }),
      new MouseEvent("mouseup", { button: 3, bubbles: true }),
    ]) {
      slides.prepare(BACK);
      commit("<article data-buffer>Two</article>");
      slides.settle("left", "two");
      slides.drawn("two");
      frame();
      frame();
      const animations = running();
      expect(animations).toHaveLength(2);
      document.body.dispatchEvent(input);
      expect(animations.map((one) => one.playState)).toEqual(["idle", "idle"]);
      expect(running()).toEqual([]);
      expect(side().hidden).toBe(true);
      expect(main().style.transform).toBe("");
      expect(slides.busy).toBe(false);
      main().innerHTML = "<article data-buffer>One</article>";
    }
    // Ended, it listens no more.
    const listening = vi.spyOn(window, "removeEventListener");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "y", bubbles: true }));
    expect(listening).not.toHaveBeenCalled();
  });

  it("[SR-212/AK-kqvx] a second switch before the first one moved slides from the view the reader still sees", () => {
    slides.prepare(BACK);
    commit("<article data-buffer>Two</article>");
    slides.settle("left", "two");
    // The key of the second switch ends the first one, which had not drawn: its picture stays the one to take.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", altKey: true }));
    slides.prepare({ side: "left", from: "two", to: "three", direction: "back" });
    commit("<article data-buffer>Three</article>");
    slides.settle("left", "three");
    expect(side().textContent).toBe("One");
    // Without the key in between (the command prompt), too.
    slides.prepare({ side: "left", from: "three", to: "four", direction: "back" });
    commit("<article data-buffer>Four</article>");
    slides.settle("left", "four");
    expect(side().textContent).toBe("One");
    // Once the new view drew, the next switch takes a new picture.
    slides.drawn("four");
    frame();
    frame();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", altKey: true }));
    slides.prepare({ side: "left", from: "four", to: "five", direction: "back" });
    commit("<article data-buffer>Five</article>");
    slides.settle("left", "five");
    expect(side().textContent).toBe("Four");
  });

  it("[SR-212/AK-kqvx] a spare picture goes once its view drew, or with a switch from elsewhere", () => {
    slides.prepare(BACK);
    commit("<article data-buffer>Two</article>");
    slides.settle("left", "two");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    slides.drawn("two");
    slides.prepare({ side: "left", from: "two", to: "three", direction: "back" });
    commit("<article data-buffer>Three</article>");
    slides.settle("left", "three");
    expect(side().textContent).toBe("Two");
  });

  it("[SR-212/AK-hmwp] [SR-212/AK-d25h] ends at once when the area shows another buffer or the other area becomes active, and a commit that does not show its buffer drops it", () => {
    // Another buffer while it waits (Follow agent, an open).
    slides.prepare(BACK);
    commit("<article data-buffer>Two</article>");
    slides.settle("left", "two");
    commit("<article data-buffer>Agent</article>");
    slides.settle("left", "agent");
    expect(slides.busy).toBe(false);
    expect(side().hidden).toBe(true);
    // Another buffer while it runs.
    slides.prepare(BACK);
    commit("<article data-buffer>Two</article>");
    slides.settle("left", "two");
    slides.drawn("two");
    frame();
    frame();
    slides.settle("left", "two");
    expect(running()).toHaveLength(2);
    slides.settle("left", "closed");
    expect(running()).toEqual([]);
    expect(main().style.transform).toBe("");
    // The target is the other area's buffer: that area becomes active, nothing moves.
    slides.prepare(BACK);
    slides.settle("right", "two");
    expect(slides.busy).toBe(false);
    expect(side().childElementCount).toBe(0);
    // Without its area, nothing is placed.
    slides.prepare({ ...BACK, side: "right" });
    expect(slides.busy).toBe(false);
    slides.settle("left", "two");
    expect(side().hidden).toBe(true);
  });

  it("[SR-212/AK-hmwp] ends when the area it was taken for is gone at the commit", () => {
    slides.prepare(BACK);
    root.replaceChildren();
    slides.settle("left", "two");
    expect(slides.busy).toBe(false);
  });

  it("[SR-212/AK-kzb2] takes no picture and moves nothing when the system reduces motion", () => {
    device().prefersReducedMotion = "reduce";
    slides.prepare(BACK);
    expect(slides.busy).toBe(false);
    commit("<article data-buffer>Two</article>");
    slides.settle("left", "two");
    slides.drawn("two");
    frame();
    frame();
    expect(running()).toEqual([]);
    expect(side().hidden).toBe(true);
    expect(main().style.transform).toBe("");
  });
});
