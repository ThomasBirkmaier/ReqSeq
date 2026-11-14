// @vitest-environment happy-dom
// The drag of a swipe (SR-211 AK3, AK4, `swipe-drag.ts`): the shown layer and the target's layer follow the
// distance, the spring-back, the hand-off to the switch, and input that ends it. On the built app:
// `test/buffer-swipe.spec.ts`.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SPRING_ID, SPRING_MS, SwipeDrag, dragOffsets, springDuration } from "./swipe-drag.js";

let area: HTMLElement;
let main: HTMLElement;
let target: HTMLElement;

const layer = (kind: string, key: string): HTMLElement => {
  const element = document.createElement("div");
  element.dataset["layer"] = kind;
  element.dataset["key"] = key;
  return element;
};

interface FakeAnimation {
  readonly element: Element;
  readonly frames: Keyframe[];
  readonly options: KeyframeAnimationOptions;
  readonly cancel: () => void;
  readonly finish: () => void;
  id: string;
  readonly finished: Promise<unknown>;
}

let animations: FakeAnimation[];

const animate = function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions): Animation {
  let resolve: (value: unknown) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const finished = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const animation: FakeAnimation = {
    element: this,
    frames,
    options,
    id: "",
    finished,
    cancel: () => {
      reject(new Error("cancelled"));
    },
    finish: () => {
      resolve(undefined);
    },
  };
  animations.push(animation);
  return animation as unknown as Animation;
};

const host = (
  more: { busy?: (busy: boolean) => void; input?: () => void; cancelled?: (target: string) => void } = {},
) => ({
  view: window,
  root: () => document.body,
  ...more,
});

beforeEach(() => {
  animations = [];
  area = document.createElement("div");
  area.dataset["area"] = "left";
  Object.defineProperty(area, "clientWidth", { value: 600 });
  main = layer("main", "a");
  target = layer("neighbour", "b");
  area.append(main, layer("neighbour", "c"), target);
  document.body.append(area);
  HTMLElement.prototype.animate = animate;
});

afterEach(() => {
  area.remove();
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

it("moves the shown layer by the shift and the target joins it at its edge, either way", () => {
  expect(dragOffsets("back", 150, 600)).toEqual({ shown: 150, joining: -450 });
  expect(dragOffsets("forward", 150, 600)).toEqual({ shown: -150, joining: 450 });
  const drag = new SwipeDrag(host());
  drag.start("left", "a", "b", "back", true);
  drag.move(150);
  expect(main.style.transform).toBe("translateX(150px)");
  expect(target.style.transform).toBe("translateX(-450px)");
  expect(target.hasAttribute("data-peek")).toBe(true);
  expect(drag.progress).toBe(0.25);
  expect(drag.of).toEqual({ target: "b", from: "a", side: "left" });
});

it("clamps the shift to the width and to 0", () => {
  const drag = new SwipeDrag(host());
  drag.start("left", "a", "b", "forward", true);
  drag.move(900);
  expect(drag.progress).toBe(1);
  drag.move(-20);
  expect(drag.progress).toBe(0);
  expect(main.style.transform).toBe("translateX(0px)");
});

it("stands until the target is drawn, then follows the distance from there (AK3)", () => {
  const drag = new SwipeDrag(host());
  drag.start("left", "a", "b", "back", false);
  drag.move(100);
  expect(main.style.transform).toBe("");
  drag.drawn("c");
  drag.drawn("b");
  expect(main.style.transform).toBe("translateX(0px)");
  drag.move(160);
  expect(main.style.transform).toBe("translateX(60px)");
  drag.drawn("b");
  expect(drag.progress).toBe(0.1);
});

it("waits for the target's layer to mount", () => {
  target.remove();
  const drag = new SwipeDrag(host());
  drag.start("left", "a", "b", "back", true);
  drag.move(60);
  expect(main.style.transform).toBe("");
  area.append(target);
  drag.move(60);
  expect(target.style.transform).toBe("translateX(-540px)");
});

it("starts nothing without the area or its shown layer", () => {
  const busy = vi.fn();
  const drag = new SwipeDrag(host({ busy }));
  drag.start("right", "a", "b", "back", true);
  expect(drag.active).toBe(false);
  expect(drag.of).toBeUndefined();
  expect(drag.progress).toBe(0);
  drag.move(10);
  drag.drawn("b");
  expect(busy).not.toHaveBeenCalled();
});

it("springs back in at most SPRING_MS from a third, less from less, then ends (AK4)", async () => {
  expect(springDuration(1 / 3)).toBe(SPRING_MS);
  expect(springDuration(1)).toBe(SPRING_MS);
  expect(springDuration(0.1)).toBe(36);
  const busy = vi.fn();
  const drag = new SwipeDrag(host({ busy }));
  drag.start("left", "a", "b", "back", true);
  drag.move(150);
  const done = vi.fn();
  drag.springBack(done);
  drag.springBack(done);
  expect(animations.map((animation) => [animation.element, animation.options.duration])).toEqual([
    [main, 90],
    [target, 90],
  ]);
  expect(animations[0]?.frames).toEqual([
    { transform: "translateX(150px)" },
    { transform: "translateX(0px)" },
  ]);
  expect(animations[1]?.frames).toEqual([
    { transform: "translateX(-450px)" },
    { transform: "translateX(-600px)" },
  ]);
  expect(animations.every((animation) => animation.id === SPRING_ID)).toBe(true);
  expect(done).not.toHaveBeenCalled();
  animations[0]?.finish();
  await flush();
  expect(done).toHaveBeenCalledTimes(1);
  expect(drag.active).toBe(false);
  expect([main.style.transform, target.style.transform, target.hasAttribute("data-peek")]).toEqual([
    "",
    "",
    false,
  ]);
  expect(busy.mock.calls).toEqual([[true], [false]]);
});

it("ends at once where nothing moved, without a drag, or where nothing can animate", () => {
  const drag = new SwipeDrag(host());
  const done = vi.fn();
  drag.springBack(done);
  drag.start("left", "a", "b", "back", true);
  drag.springBack(done);
  expect(done).toHaveBeenCalledTimes(2);
  drag.start("left", "a", "b", "back", true);
  drag.move(100);
  // A window that cannot animate has no `animate`.
  main.animate = undefined as unknown as typeof main.animate;
  drag.springBack(done);
  expect(done).toHaveBeenCalledTimes(3);
  expect(animations).toEqual([]);
});

it("a swipe that goes on stops the spring-back, and its drag goes on", async () => {
  const drag = new SwipeDrag(host());
  drag.start("left", "a", "b", "back", true);
  drag.move(100);
  const done = vi.fn();
  drag.springBack(done);
  drag.move(120);
  await flush();
  expect(done).not.toHaveBeenCalled();
  expect(drag.active).toBe(true);
  expect(main.style.transform).toBe("translateX(120px)");
  drag.drawn("b");
  expect(drag.progress).toBe(0.2);
});

it("a spring-back of a drag that ended meanwhile calls nothing", async () => {
  const drag = new SwipeDrag(host());
  drag.start("left", "a", "c", "forward", true);
  drag.move(100);
  const done = vi.fn();
  drag.springBack(done);
  const [first] = animations;
  drag.start("left", "a", "b", "forward", true);
  first?.finish();
  await flush();
  expect(done).not.toHaveBeenCalled();
  expect(drag.of?.target).toBe("b");
});

it("a new drag tells which drag it ended, also one springing back, and also when it starts nothing itself", async () => {
  const cancelled = vi.fn<(target: string) => void>();
  const drag = new SwipeDrag(host({ cancelled }));
  drag.start("left", "a", "c", "forward", true);
  expect(cancelled).not.toHaveBeenCalled();
  drag.move(100);
  const done = vi.fn();
  drag.springBack(done);
  drag.start("left", "a", "b", "back", false);
  await flush();
  expect(done).not.toHaveBeenCalled();
  expect(cancelled.mock.calls).toEqual([["c"]]);
  // Without the area it starts nothing, but the drag before it ended all the same.
  drag.start("right", "a", "c", "forward", true);
  expect(drag.active).toBe(false);
  expect(cancelled.mock.calls).toEqual([["c"], ["b"]]);
  drag.start("right", "a", "c", "forward", true);
  expect(cancelled).toHaveBeenCalledTimes(2);
});

it("hands its part of the width to the switch and leaves nothing moved", () => {
  const drag = new SwipeDrag(host());
  drag.start("left", "a", "b", "back", true);
  drag.move(300);
  expect(drag.handOff()).toBe(0.5);
  expect([main.style.transform, target.style.transform, target.hasAttribute("data-peek")]).toEqual([
    "",
    "",
    false,
  ]);
  expect(drag.active).toBe(false);
  drag.cancel();
});

it("input during the drag is reported, and none after it", () => {
  const input = vi.fn();
  const drag = new SwipeDrag(host({ input }));
  drag.start("left", "a", "b", "back", true);
  for (const type of ["keydown", "pointerdown", "mousedown", "mouseup"]) {
    window.dispatchEvent(new Event(type));
  }
  expect(input).toHaveBeenCalledTimes(4);
  // A modifier pressed alone is no input; a key with one held is.
  for (const key of ["Shift", "Control", "Alt", "Meta"]) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  }
  expect(input).toHaveBeenCalledTimes(4);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", altKey: true }));
  expect(input).toHaveBeenCalledTimes(5);
  drag.cancel();
  window.dispatchEvent(new Event("keydown"));
  expect(input).toHaveBeenCalledTimes(5);
  // Without a handler for input the drag just listens.
  const quiet = new SwipeDrag(host());
  quiet.start("left", "a", "b", "back", true);
  window.dispatchEvent(new Event("keydown"));
  quiet.cancel();
});
