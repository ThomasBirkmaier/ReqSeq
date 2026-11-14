// The swipe that switches the buffer (SR-211) on the built app, sent as wheel events through Chromium's input
// (Playwright's `mouse.wheel`, CDP `Input.dispatchMouseEvent`), so they scroll, can be prevented and carry their
// modifiers as a trackpad's do. The shown buffer follows the swipe with the target at its edge (AK3); a swipe
// past a third of its area switches at its end with the slide of SR-212 on from there, one of a third or less
// springs back (AK4).
//
// One whole swipe: a single wheel event is one swipe by itself. A swipe of several events is sent while the
// window's clock stands still (`clock.install` and `pauseAt`, as `autosave.spec.ts` does), so no pause of the
// gesture (`SEGMENT_GAP_MS`, `GESTURE_GAP_MS` in `buffer-swipe.ts`) ends between two of them however slow the
// runner is; `clock.runFor` then ends it, and `clock.resume` lets the slide run. A listener on the window, after
// the app's on the sheet, records whether each wheel event could be and was prevented.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { goTo, launchApp, listAll, recordRequests, shownLayer, slideSettled } from "./support/app.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** 14 elements with a derivation tree (fixtures/README.md). */
const FIXTURE = { fixture: "SR-069/filter" };
const ELEMENT = "See the wind";
const LIST = "All elements";

/** The pauses of `buffer-swipe.ts`. */
const SEGMENT_GAP_MS = 35;
const GESTURE_GAP_MS = 150;

const shownBuffer = (window: Page, side?: string): Locator =>
  shownLayer(window, side).locator("[data-buffer]");

/** Opens `title` with Ctrl/Cmd+P. */
const open = async (window: Page, title: string): Promise<void> => {
  await goTo(window);
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(shownLayer(window).locator("article h1")).toHaveText(title);
};

const command = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(title);
  await window.keyboard.press("Enter");
};

/** The box of the area on `side`, or of the active one. */
const areaBox = async (window: Page, side?: string): Promise<{ x: number; y: number; width: number }> => {
  const box = await window
    .locator(side === undefined ? "[data-area][data-active]" : `[data-area="${side}"]`)
    .boundingBox();
  if (box === null) {
    throw new Error("no area");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width };
};

/** Puts the pointer in the middle of the area on `side` (the active one by default) and gives its width. */
const pointAt = async (window: Page, side?: string): Promise<number> => {
  const box = await areaBox(window, side);
  await window.mouse.move(box.x, box.y);
  return box.width;
};

interface Wheel {
  readonly cancelable: boolean;
  readonly prevented: boolean;
}

/**
 * Records every wheel event from now on, in `window.wheels`, and every slide animation made, in `window.slides`
 * (its layer and its first and last keyframe) with its time in `window.durations`; every spring-back's time in
 * `window.springs`.
 * While `window.hold` is set, each slide animation is paused where it starts and kept in `window.held`, so a
 * test can tell whether an input ended it (as `buffer-slide.spec.ts` does).
 */
const record = (window: Page): Promise<void> =>
  window.evaluate(() => {
    const own = window as unknown as {
      wheels: Wheel[];
      slides: string[];
      durations: number[];
      springs: number[];
      hold: boolean;
      held: Animation[];
    };
    own.wheels = [];
    own.slides = [];
    own.durations = [];
    own.springs = [];
    own.hold = false;
    own.held = [];
    addEventListener("wheel", (event: WheelEvent) => {
      own.wheels.push({ cancelable: event.cancelable, prevented: event.defaultPrevented });
    });
    // A spring-back changes no attribute: its animations are seen where they are made.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with its element below.
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      if (typeof options === "object" && options.id === "buffer-spring") {
        own.springs.push(Number(options.duration));
      }
      return animate.call(this, frames, options);
    };
    const seen = new WeakSet<Animation>();
    new MutationObserver(() => {
      for (const animation of document.getAnimations()) {
        const { effect } = animation;
        if (seen.has(animation) || !(effect instanceof KeyframeEffect)) {
          continue;
        }
        if (animation.id !== "buffer-slide") {
          continue;
        }
        seen.add(animation);
        own.durations.push(Number(effect.getTiming().duration));
        if (own.hold) {
          animation.pause();
          own.held.push(animation);
        }
        const target = effect.target as HTMLElement | null;
        const [first, last] = effect.getKeyframes();
        own.slides.push(
          `${target?.dataset["layer"] ?? ""} ${String(first?.["transform"])} ${String(last?.["transform"])}`,
        );
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style"],
    });
  });

const wheels = (window: Page): Promise<Wheel[]> =>
  window.evaluate(() => (window as unknown as { wheels: Wheel[] }).wheels);

const slides = (window: Page): Promise<string[]> =>
  window.evaluate(() => (window as unknown as { slides: string[] }).slides);

const durations = (window: Page): Promise<number[]> =>
  window.evaluate(() => (window as unknown as { durations: number[] }).durations);

const springs = (window: Page): Promise<number[]> =>
  window.evaluate(() => (window as unknown as { springs: number[] }).springs);

/** Forgets the slides recorded so far. */
const forgetSlides = (window: Page): Promise<void> =>
  window.evaluate(() => {
    (window as unknown as { slides: string[] }).slides.length = 0;
  });

/** Two frames, so a motion or a scroll would have shown itself. */
const frames = (window: Page): Promise<unknown> =>
  window.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

/** The window's clock stands still: a swipe of several events stays one. */
const holdClock = async (window: Page): Promise<void> => {
  await window.clock.install();
  await window.clock.pauseAt(Date.now() + 1000);
};

/** The scroll position of the shown buffer of the active area. */
const scrolled = (window: Page): Promise<{ top: number; left: number }> =>
  shownLayer(window)
    .locator(".buffer")
    .first()
    .evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft }));

/** The slides recorded, each offset rounded to a whole %. */
const rounded = async (window: Page): Promise<string[]> =>
  (await slides(window)).map((line) =>
    line.replace(
      /(-?\d+(?:\.\d+)?(?:e-?\d+)?)%/g,
      (_match, value: string) => `${String(Math.round(Number(value)) || 0)}%`,
    ),
  );

const percent = (value: number): string => `${String(Math.round(value) || 0)}%`;

/** The slide of Previous buffer and of Next buffer on from `p` of the width (a swipe released there). */
const back = (p: number): string[] => [
  `side translateX(${percent(100 * p)}) translateX(100%)`,
  `main translateX(${percent(100 * p - 100)}) translateX(0%)`,
];
const forward = (p: number): string[] => [
  `side translateX(${percent(-100 * p)}) translateX(-100%)`,
  `main translateX(${percent(100 - 100 * p)}) translateX(0%)`,
];

/** The layers of the area on `side` (all areas by default) that a swipe moved: their layer, key and offset. */
const moved = (window: Page, side?: string): Promise<string[]> =>
  window.evaluate(
    (side) =>
      [
        ...document.querySelectorAll<HTMLElement>(
          `${side === undefined ? "[data-area]" : `[data-area="${side}"]`} > .slide-layer`,
        ),
      ]
        .filter(
          (layer) =>
            layer.style.transform !== "" || layer.style.willChange !== "" || layer.hasAttribute("data-peek"),
        )
        .map(
          (layer) => `${layer.dataset["layer"] ?? ""} ${layer.dataset["key"] ?? ""} ${layer.style.transform}`,
        ),
    side,
  );

/** The target that joins the shown buffer of the active area at its edge (AK3). */
const peeking = (window: Page): Locator => window.locator("[data-area][data-active] > [data-peek]");

/**
 * The first event of a swipe in `sign` (-1 toward Previous buffer), while the clock stands still: the target is
 * drawn, and joins the shown buffer at its edge.
 */
const startSwipe = async (window: Page, sign: -1 | 1): Promise<void> => {
  await window.mouse.wheel(sign * 20, 0);
  await expect(peeking(window)).toHaveCount(1);
};

test.describe("the swipe that switches the buffer", () => {
  let running: RunningApp;
  let element: string;

  test.beforeEach(async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await expect(shownLayer(window).locator(".overview .line").first()).toBeVisible();
    // The overview, the list of all elements, an element: Previous buffer is the list, Next buffer the overview.
    await listAll(window);
    await open(window, ELEMENT);
    element = (await shownBuffer(window).getAttribute("aria-label")) ?? "";
    await record(window);
  });

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-211/AK-tq4d] a swipe as it pushes content to the right, past a third, does what Alt+P does, with the slide of Previous buffer on from where it was released", async () => {
    const { window } = running;
    const width = await pointAt(window);
    // The list is drawn in advance: the element follows from the first event.
    await window.mouse.wheel(-0.6 * width, 0);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", LIST);
    await slideSettled(window);
    expect(await rounded(window)).toEqual(back(0.6));
    expect((await durations(window)).every((ms) => ms <= 0.4 * 160 + 1)).toBe(true);
    expect((await wheels(window)).every((one) => one.cancelable && one.prevented)).toBe(true);
    expect(await moved(window)).toEqual([]);
    // Alt+N back, then Alt+P from the same state shows the same buffer.
    await window.keyboard.press("Alt+KeyN");
    await slideSettled(window);
    await window.keyboard.press("Alt+KeyP");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", LIST);
    // A fast swipe past the whole width stops at it: the switch has no rest to slide.
    await window.keyboard.press("Alt+KeyN");
    await slideSettled(window);
    await forgetSlides(window);
    await window.mouse.wheel(-1.5 * width, 0);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", LIST);
    await slideSettled(window);
    expect((await rounded(window))[0]).toBe("side translateX(100%) translateX(100%)");
    expect((await durations(window)).at(-1)).toBe(0);
  });

  test("[SR-211/AK-b2z8] a swipe as it pushes content to the left, past a third, does what Alt+N does, with the slide of Next buffer", async () => {
    const { window } = running;
    const width = await pointAt(window);
    // The overview is not drawn in advance: the element stands until the overview is drawn for the swipe, and
    // follows from there.
    await holdClock(window);
    await startSwipe(window, 1);
    await window.mouse.wheel(0.6 * width, 0);
    await window.clock.runFor(SEGMENT_GAP_MS);
    await window.clock.resume();
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
    await slideSettled(window);
    expect(await rounded(window)).toEqual(forward(0.6));
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await window.keyboard.press("Alt+KeyN");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
  });

  test("[SR-211/AK-tq4d] [SR-211/AK-b2z8] a third or less switches nothing, and a diagonal swipe does not scroll the buffer", async () => {
    const { window } = running;
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    // A short window: the list scrolls vertically.
    await window.setViewportSize({ width: await window.evaluate(() => innerWidth), height: 260 });
    const width = await pointAt(window);
    await window.mouse.wheel(-0.3 * width, 0);
    await window.waitForTimeout(GESTURE_GAP_MS * 2);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", LIST);
    // Diagonal, 50 % vertical: it switches, and the list it leaves did not scroll.
    await window.mouse.wheel(0.6 * width, 0.3 * width);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", element);
    await slideSettled(window);
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    expect((await scrolled(window)).top).toBe(0);
    expect((await wheels(window)).every((one) => one.cancelable && one.prevented)).toBe(true);
  });

  test("[SR-211/AK-nhhs] content that scrolls sideways scrolls first; only a swipe that starts at its edge switches", async () => {
    const { window } = running;
    // The matrix of the list in a narrow window: wider than its area.
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await window.setViewportSize({ width: 420, height: 600 });
    await window.keyboard.press("ControlOrMeta+T");
    await expect(shownLayer(window).locator("table")).toBeVisible();
    const matrix = (await shownBuffer(window).getAttribute("aria-label")) ?? "";
    const scroller = shownLayer(window).locator(".buffer").first();
    await forgetSlides(window);
    const room = await scroller.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(room).toBeGreaterThan(50);
    const width = await pointAt(window);
    // At the left edge, a swipe toward the end scrolls and switches nothing.
    await window.mouse.wheel(0.6 * width, 0);
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await window.waitForTimeout(GESTURE_GAP_MS * 2);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", matrix);
    // A swipe that reaches the edge on its way switches nothing either.
    await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth - element.clientWidth - 5;
    });
    await holdClock(window);
    for (let step = 0; step < 6; step += 1) {
      await window.mouse.wheel(0.2 * width, 0);
    }
    await window.clock.runFor(GESTURE_GAP_MS);
    await window.clock.resume();
    await expect
      .poll(() =>
        scroller.evaluate((element) => element.scrollWidth - element.clientWidth - element.scrollLeft),
      )
      .toBeLessThanOrEqual(1);
    await window.waitForTimeout(GESTURE_GAP_MS * 2);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", matrix);
    expect(await slides(window)).toEqual([]);
    // The next swipe starts at the edge: it switches.
    await window.mouse.wheel(0.6 * width, 0);
    await expect(shownBuffer(window)).not.toHaveAttribute("aria-label", matrix);
  });

  test("[SR-211/AK-khr4] a swipe that starts more vertical than horizontal only scrolls, also when it turns horizontal", async () => {
    const { window } = running;
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await window.setViewportSize({ width: await window.evaluate(() => innerWidth), height: 260 });
    await forgetSlides(window);
    const width = await pointAt(window);
    await holdClock(window);
    await window.mouse.wheel(1, 4);
    await window.mouse.wheel(1, 30);
    for (let step = 0; step < 4; step += 1) {
      await window.mouse.wheel(0.2 * width, 0);
    }
    await window.clock.runFor(GESTURE_GAP_MS);
    await window.clock.resume();
    // The whole vertical distance scrolled, the one held back first included.
    await expect.poll(async () => (await scrolled(window)).top).toBeGreaterThanOrEqual(30);
    await window.waitForTimeout(GESTURE_GAP_MS);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", LIST);
    expect(await slides(window)).toEqual([]);
    const sent = await wheels(window);
    expect(sent.every((one) => one.cancelable)).toBe(true);
    expect(sent.slice(1).some((one) => one.prevented)).toBe(false);
  });

  for (const reduced of [false, true]) {
    test(`[SR-211/AK-zvkh] after a switch, the rest of the swipe and its momentum switch nothing more and do not scroll the new buffer${reduced ? ", with reduced motion" : ""}`, async () => {
      const { window } = running;
      if (reduced) {
        await window.emulateMedia({ reducedMotion: "reduce" });
      }
      // The list, which the swipe switches to, scrolls vertically and stands at its top. Its slide is held.
      await window.setViewportSize({ width: await window.evaluate(() => innerWidth), height: 260 });
      await window.evaluate(() => {
        (window as unknown as { hold: boolean }).hold = true;
      });
      const held = (): Promise<string[]> =>
        window.evaluate(() => (window as unknown as { held: Animation[] }).held.map((one) => one.playState));
      const width = await pointAt(window);
      await holdClock(window);
      // With motion the list, drawn again for the new height, joins first.
      if (!reduced) {
        await startSwipe(window, -1);
      }
      await window.mouse.wheel(-0.6 * width, 0);
      await window.mouse.wheel(-0.2 * width, -0.1 * width);
      await window.clock.runFor(SEGMENT_GAP_MS);
      await expect(shownBuffer(window)).toHaveAttribute("aria-label", LIST);
      // The momentum after a pause of 40 ms: small, diagonal steps.
      await window.clock.runFor(5);
      for (const step of [5, 4, 3]) {
        await window.mouse.wheel(-step, step / 2);
      }
      await window.clock.runFor(GESTURE_GAP_MS);
      await window.clock.resume();
      // The slide of the switch was not ended by the momentum: it is still held where it started.
      if (!reduced) {
        await expect.poll(held).toEqual(["paused", "paused"]);
        await frames(window);
        expect(await held()).toEqual(["paused", "paused"]);
      }
      await window.evaluate(() => {
        for (const animation of (window as unknown as { held: Animation[] }).held) {
          animation.finish();
        }
      });
      await slideSettled(window);
      await frames(window);
      await expect(shownBuffer(window)).toHaveAttribute("aria-label", LIST);
      expect(await scrolled(window)).toEqual({ top: 0, left: 0 });
      const sent = await wheels(window);
      expect(sent.length).toBe(reduced ? 5 : 6);
      expect(sent.every((one) => one.cancelable && one.prevented)).toBe(true);
      expect((await rounded(window)).map((line) => line.replace(/\(-?\d+%\) /, "(p) "))).toEqual(
        reduced ? [] : ["side translateX(p) translateX(100%)", "main translateX(p) translateX(0%)"],
      );
    });
  }

  test("[SR-211/AK-kb1k] with one buffer open a swipe moves nothing and switches nothing", async () => {
    const { window } = running;
    await command(window, "Close all buffers");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
    const width = await pointAt(window);
    await window.mouse.wheel(-0.6 * width, 0);
    await window.mouse.wheel(0.6 * width, 0);
    await window.waitForTimeout(GESTURE_GAP_MS * 2);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
    expect(await slides(window)).toEqual([]);
    expect(await moved(window)).toEqual([]);
    expect((await wheels(window)).some((one) => one.prevented)).toBe(false);
  });

  test("[SR-211/AK-kpxs] in a split window only a swipe over the active area switches, by a third of its width; one to the other area's buffer makes that area active", async () => {
    const { window } = running;
    await command(window, "Split window");
    const left = window.locator('[data-area="left"]');
    const right = window.locator('[data-area="right"]');
    await expect(shownBuffer(window, "right")).toHaveAttribute("aria-label", LIST);
    await expect(left).toHaveAttribute("data-active", "");
    // Over the inactive area: nothing switches, and it does not become active.
    const pane = await pointAt(window, "right");
    await window.mouse.wheel(0.4 * pane, 0);
    await window.waitForTimeout(GESTURE_GAP_MS * 2);
    await expect(left).toHaveAttribute("data-active", "");
    await expect(shownBuffer(window, "right")).toHaveAttribute("aria-label", LIST);
    await expect(shownBuffer(window, "left")).toHaveAttribute("aria-label", element);
    // Over the active area, 0.4 of its width: less than a third of the window, more than a third of the area.
    expect(0.4 * pane * 3).toBeLessThan(await window.evaluate(() => innerWidth));
    await pointAt(window, "left");
    await holdClock(window);
    await startSwipe(window, 1);
    await window.mouse.wheel(0.4 * pane, 0);
    // Only the left area's buffer moves, by the distance in px of its own width.
    expect(await moved(window, "right")).toEqual([]);
    const shift = await shownLayer(window, "left").evaluate((layer) => layer.style.transform);
    expect(Math.abs(parseFloat(shift.replace("translateX(", "")) + 0.4 * pane)).toBeLessThanOrEqual(1);
    await window.clock.runFor(GESTURE_GAP_MS);
    await window.clock.resume();
    await expect(shownBuffer(window, "left")).toHaveAttribute("aria-label", "Overview");
    await slideSettled(window);
    // Only the left area moved.
    expect((await slides(window)).length).toBe(2);
    expect(await moved(window)).toEqual([]);
    // Back to the element, then a swipe to the buffer the right area shows: nothing moves, the right area is
    // active, as with Alt+P.
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await expect(shownBuffer(window, "left")).toHaveAttribute("aria-label", element);
    const before = (await slides(window)).length;
    await pointAt(window, "left");
    await window.mouse.wheel(-0.4 * pane, 0);
    await expect(right).toHaveAttribute("data-active", "");
    await frames(window);
    expect((await slides(window)).length).toBe(before);
    await expect(shownBuffer(window, "left")).toHaveAttribute("aria-label", element);
  });

  test("[SR-211/AK-vyg8] Shift with the wheel switches nothing and moves nothing", async () => {
    const { window } = running;
    const width = await pointAt(window);
    await window.keyboard.down("Shift");
    await window.mouse.wheel(-0.6 * width, 0);
    await window.mouse.wheel(0, -0.6 * width);
    await window.keyboard.up("Shift");
    await window.waitForTimeout(GESTURE_GAP_MS * 2);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", element);
    expect(await slides(window)).toEqual([]);
    expect(await moved(window)).toEqual([]);
    expect((await wheels(window)).some((one) => one.prevented)).toBe(false);
  });

  test("[SR-211/AK-h5qw] with the command prompt, a context menu, the slash menu, the calendar, the next keys or About open, a swipe switches nothing", async () => {
    const { window } = running;
    const width = await pointAt(window);
    const swipeStays = async (): Promise<void> => {
      await window.mouse.wheel(-0.6 * width, 0);
      await window.waitForTimeout(GESTURE_GAP_MS * 2);
      await expect(shownBuffer(window)).toHaveAttribute("aria-label", element);
      expect(await slides(window)).toEqual([]);
      expect(await moved(window)).toEqual([]);
      expect(await springs(window)).toEqual([]);
    };
    // The command prompt stays open.
    await window.keyboard.press("ControlOrMeta+Shift+P");
    const candidates = window.locator('.candidates [role="option"]');
    await expect(candidates.first()).toBeVisible();
    await swipeStays();
    await expect(candidates.first()).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(candidates.first()).toBeHidden();
    // A context menu: the swipe outside it closes it and switches nothing.
    const middle = await areaBox(window);
    await window.mouse.click(middle.x, middle.y, { button: "right" });
    const menu = window.locator(".context-menu");
    await expect(menu).toBeVisible();
    await window.mouse.move(middle.x - 150, middle.y - 100);
    await swipeStays();
    await expect(menu).toBeHidden();
    // The next keys after the prefix key.
    await window.keyboard.press("ControlOrMeta+K");
    await expect(window.locator(".next-keys")).toBeVisible();
    await pointAt(window);
    await swipeStays();
    await window.keyboard.press("Escape");
    await expect(window.locator(".next-keys")).toBeHidden();
    // "About ReqSeq".
    await command(window, "About ReqSeq");
    const about = window.getByRole("dialog", { name: "About ReqSeq" });
    await expect(about).toBeVisible();
    await swipeStays();
    await window.keyboard.press("Escape");
    await expect(about).toBeHidden();
    // In the text editor: the slash menu, then the calendar.
    await window.keyboard.press("Enter");
    await expect(shownLayer(window).locator(".cm-content")).toBeFocused();
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.type(" /dat");
    await expect(window.locator(".cm-tooltip-autocomplete")).toBeVisible();
    await swipeStays();
    await window.keyboard.type("e");
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-lr-calendar")).toBeVisible();
    await swipeStays();
    await window.keyboard.press("Escape");
  });

  test("[SR-211/AK-wfd3] the shown buffer follows the swipe and the target joins it at its edge; the modeline and the command prompt stay", async () => {
    const { window } = running;
    const modeline = window.locator('[aria-label="Modeline"]');
    const prompt = window.locator('[aria-label="Minibuffer"]');
    const boxes = async (): Promise<unknown> => [await modeline.boundingBox(), await prompt.boundingBox()];
    const still = await boxes();
    const area = await window.locator("[data-area][data-active]").boundingBox();
    const width = await pointAt(window);
    await holdClock(window);
    // The list is drawn in advance: the element follows from the first event, by the distance swiped.
    await window.mouse.wheel(-0.25 * width, 0);
    await expect(peeking(window).locator(".buffer").first()).toHaveAttribute("aria-label", LIST);
    const main = await shownLayer(window).boundingBox();
    const target = await peeking(window).boundingBox();
    expect(Math.abs((main?.x ?? 0) - (area?.x ?? 0) - 0.25 * width)).toBeLessThanOrEqual(1);
    expect(Math.abs((target?.x ?? 0) + (target?.width ?? 0) - (main?.x ?? 0))).toBeLessThanOrEqual(1);
    await expect(modeline).toContainText("N-0000a1");
    expect(await boxes()).toEqual(still);
    await window.screenshot({ path: path.join(OUT, "buffer-swipe-halfway.png") });
    // Back toward the start: the element follows back to its place, never past it.
    await window.mouse.wheel(0.4 * width, 0);
    expect(await shownLayer(window).evaluate((layer) => layer.style.transform)).toBe("translateX(0px)");
    await window.clock.runFor(GESTURE_GAP_MS);
    await expect.poll(() => moved(window)).toEqual([]);
    // Toward the overview, which is not drawn in advance: the element stands until it is drawn, then follows
    // the distance from there.
    await window.mouse.wheel(0.1 * width, 0);
    await expect(peeking(window)).toHaveCount(1);
    expect(await shownLayer(window).evaluate((layer) => layer.style.transform)).toBe("translateX(0px)");
    await window.mouse.wheel(0.1 * width, 0);
    expect(await shownLayer(window).evaluate((layer) => layer.style.transform)).toBe(
      `translateX(${String(-0.1 * width)}px)`,
    );
    await window.clock.runFor(GESTURE_GAP_MS);
    await window.clock.resume();
    await expect.poll(() => moved(window)).toEqual([]);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", element);
    expect(await slides(window)).toEqual([]);
  });

  test("[SR-211/AK-cq0n] a swipe of a third or less springs back within 200 ms; the editor keeps its focus and selection, and nothing is saved", async () => {
    const { window } = running;
    const saved = async (): Promise<string> => (await running.cli(["element", "get", "N-0000a1"])).stdout;
    const before = await saved();
    await window.keyboard.press("Enter");
    const editor = shownLayer(window).locator(".cm-content").first();
    await expect(editor).toBeFocused();
    await window.keyboard.press("ControlOrMeta+End");
    for (let step = 0; step < 4; step += 1) {
      await window.keyboard.press("Shift+ArrowLeft");
    }
    const selection = (): Promise<string> => window.evaluate(() => getSelection()?.toString() ?? "");
    const selected = await selection();
    expect(selected.length).toBe(4);
    await window.evaluate(() => {
      const own = window as unknown as { left: number };
      own.left = 0;
      addEventListener("focusout", () => {
        own.left += 1;
      });
    });
    const width = await pointAt(window);
    await holdClock(window);
    await window.mouse.wheel(-0.25 * width, 0);
    await expect.poll(() => moved(window)).not.toEqual([]);
    await window.clock.runFor(SEGMENT_GAP_MS);
    // The pause of the end and the spring-back: within the 200 ms of AK4.
    expect(await springs(window)).toEqual([90, 90]);
    expect(SEGMENT_GAP_MS + Math.max(...(await springs(window)))).toBeLessThanOrEqual(200);
    await window.clock.runFor(GESTURE_GAP_MS);
    await window.clock.resume();
    await expect.poll(() => moved(window)).toEqual([]);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", element);
    await expect(editor).toBeFocused();
    expect(await selection()).toBe(selected);
    expect(await window.evaluate(() => (window as unknown as { left: number }).left)).toBe(0);
    expect(await slides(window)).toEqual([]);
    expect(await saved()).toBe(before);
  });

  test("[SR-211/AK-ck1v] another element shown by Follow agent during a swipe ends it at once without a switch; the rest of the swipe does nothing", async () => {
    const { window } = running;
    const agent = await running.mcp();
    try {
      await window.keyboard.press("ControlOrMeta+Shift+O");
      await expect(window.locator('[aria-label="Modeline"]')).toContainText("following agent");
      const width = await pointAt(window);
      await holdClock(window);
      await window.mouse.wheel(-0.4 * width, 0);
      await expect.poll(() => moved(window)).not.toEqual([]);
      await agent.call("element_get", { ref: "69069069-0000-4000-8000-0000000000a2" });
      await expect(shownLayer(window).locator("article h1")).toHaveText("Warn of storms");
      expect(await moved(window)).toEqual([]);
      const shown = (await shownBuffer(window).getAttribute("aria-label")) ?? "";
      await window.mouse.wheel(-0.2 * width, 0);
      await window.clock.runFor(GESTURE_GAP_MS);
      await window.clock.resume();
      await frames(window);
      await expect(shownBuffer(window)).toHaveAttribute("aria-label", shown);
      expect(await moved(window)).toEqual([]);
      expect(await slides(window)).toEqual([]);
      expect(await springs(window)).toEqual([]);
    } finally {
      await agent.close();
    }
  });

  test("[SR-211/AK-ck1v] Alt+P during a swipe past a third ends it and switches once, by the key", async () => {
    const { window } = running;
    const width = await pointAt(window);
    await holdClock(window);
    await window.mouse.wheel(-0.5 * width, 0);
    await expect.poll(() => moved(window)).not.toEqual([]);
    await window.keyboard.press("Alt+KeyP");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", LIST);
    await window.mouse.wheel(-0.1 * width, 0);
    await window.clock.runFor(GESTURE_GAP_MS);
    await window.clock.resume();
    await slideSettled(window);
    await frames(window);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", LIST);
    // One slide, the one of the key, from the start.
    expect(await rounded(window)).toEqual(back(0));
    expect(await moved(window)).toEqual([]);
  });

  test("[SR-211/AK-ck1v] [SR-212/AK-kqvx] a key during a swipe ends it at once without a switch and acts on the buffer shown: a letter lands in the element", async () => {
    const { window } = running;
    await window.keyboard.press("Enter");
    const editor = shownLayer(window).locator(".cm-content").first();
    await expect(editor).toBeFocused();
    await window.keyboard.press("ControlOrMeta+End");
    const width = await pointAt(window);
    await holdClock(window);
    await window.mouse.wheel(-0.5 * width, 0);
    await expect.poll(() => moved(window)).not.toEqual([]);
    await window.keyboard.type("x");
    expect(await moved(window)).toEqual([]);
    await window.mouse.wheel(-0.1 * width, 0);
    await window.clock.runFor(GESTURE_GAP_MS);
    await window.clock.resume();
    await frames(window);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", element);
    await expect(editor).toBeFocused();
    await expect(editor).toContainText(/x$/);
    expect(await slides(window)).toEqual([]);
    expect(await springs(window)).toEqual([]);
  });

  test("[SR-211/AK-tq4d] from an element with unsaved input, a swipe released past a third slides the list in from there at once", async () => {
    const { window } = running;
    await window.evaluate(() => {
      (window as unknown as { hold: boolean }).hold = true;
    });
    const held = (): Promise<string[]> =>
      window.evaluate(() => (window as unknown as { held: Animation[] }).held.map((one) => one.playState));
    await window.keyboard.press("Enter");
    await expect(shownLayer(window).locator(".cm-content").first()).toBeFocused();
    const width = await pointAt(window);
    // Typed while the clock stands: not saved yet when the swipe ends.
    await holdClock(window);
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.type(" Gusts.");
    await window.mouse.wheel(-0.6 * width, 0);
    await expect.poll(() => moved(window)).not.toEqual([]);
    await window.clock.runFor(SEGMENT_GAP_MS);
    // The slide started in the commit of the switch: no frame of the held clock has run since.
    expect(await held()).toEqual(["paused", "paused"]);
    expect(await rounded(window)).toEqual(back(0.6));
    await window.clock.resume();
    await window.evaluate(() => {
      for (const animation of (window as unknown as { held: Animation[] }).held) {
        animation.finish();
      }
    });
    await slideSettled(window);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", LIST);
    await expect
      .poll(async () => (await running.cli(["element", "get", "N-0000a1"])).stdout)
      .toContain("Gusts.");
  });

  test("[SR-212/AK-tfck] a swipe toward a list no longer drawn in advance after an own save draws it when it starts, and the switch slides once it is drawn", async () => {
    const { window } = running;
    const requests = await recordRequests(window);
    const hidden = (): Promise<string[]> =>
      window
        .locator('[data-area][data-active] > [data-layer="neighbour"] .buffer')
        .evaluateAll((views) => views.map((view) => view.getAttribute("aria-label") ?? ""));
    await expect.poll(hidden).toContain(LIST);
    // An own save: the autosave of typed text.
    await shownLayer(window).locator(".cm-content").first().click();
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.type(" Gusts.");
    await expect
      .poll(async () => (await running.cli(["element", "get", "N-0000a1"])).stdout)
      .toContain("Gusts.");
    await expect.poll(hidden).not.toContain(LIST);
    await window.keyboard.press("Escape");
    const width = await pointAt(window);
    await requests.clear();
    await holdClock(window);
    // The start of the swipe decides it: the list is drawn beside the element.
    await window.mouse.wheel(-20, 0);
    await expect.poll(hidden).toContain(LIST);
    expect((await requests.sent()).some((request) => request.name === "element.list")).toBe(true);
    // The element stood until the list was drawn, and follows from there (SR-211 AK3).
    expect(await shownLayer(window).evaluate((layer) => layer.style.transform)).not.toMatch(/[1-9]/);
    await expect(peeking(window)).toHaveCount(1);
    await window.mouse.wheel(-0.1 * width, 0);
    await window.clock.runFor(GESTURE_GAP_MS);
    await expect.poll(() => moved(window)).toEqual([]);
    // A second swipe does not wait again: the list stays drawn beside the element, from its record.
    await window.mouse.wheel(-0.6 * width, 0);
    expect(await shownLayer(window).evaluate((layer) => layer.style.transform)).toBe(
      `translateX(${String(0.6 * width)}px)`,
    );
    await window.clock.runFor(SEGMENT_GAP_MS);
    await window.clock.resume();
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", LIST);
    await slideSettled(window);
    expect(await rounded(window)).toEqual(back(0.6));
  });
});

test("[SR-211/AK-dg17] with reduced motion a swipe switches once it passes a third, without motion, and below a third nothing happens", async () => {
  const running = await launchApp(FIXTURE, { colorScheme: "light" });
  try {
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "reduce" });
    await expect(shownLayer(window).locator(".overview .line").first()).toBeVisible();
    await listAll(window);
    await open(window, ELEMENT);
    const element = (await shownBuffer(window).getAttribute("aria-label")) ?? "";
    await record(window);
    const width = await pointAt(window);
    await holdClock(window);
    // A third or less, in a whole swipe: nothing.
    await window.mouse.wheel(-0.15 * width, 0);
    await window.mouse.wheel(-0.15 * width, 0);
    await window.clock.runFor(GESTURE_GAP_MS);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", element);
    // Past a third the switch comes while the swipe still runs, before its end.
    await window.mouse.wheel(-0.2 * width, 0);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", element);
    expect(await moved(window)).toEqual([]);
    await window.mouse.wheel(-0.2 * width, 0);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", LIST);
    await window.clock.runFor(GESTURE_GAP_MS);
    await window.clock.resume();
    await frames(window);
    expect(await slides(window)).toEqual([]);
    expect(await window.locator(".slide-picture").count()).toBe(0);
  } finally {
    await running.close();
  }
});

test("[SR-211/AK-nhhs] an element, a list and the overview are no wider than their area, so a swipe over them switches", async () => {
  const running = await launchApp(FIXTURE, { colorScheme: "light" });
  try {
    const { window } = running;
    await expect(shownLayer(window).locator(".overview .line").first()).toBeVisible();
    const wide = (): Promise<number> =>
      shownLayer(window)
        .locator(".buffer")
        .first()
        .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(await wide()).toBeLessThanOrEqual(1);
    await listAll(window);
    expect(await wide()).toBeLessThanOrEqual(1);
    await open(window, ELEMENT);
    expect(await wide()).toBeLessThanOrEqual(1);
  } finally {
    await running.close();
  }
});
