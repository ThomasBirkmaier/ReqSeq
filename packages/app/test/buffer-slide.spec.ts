// The switch to the previous or next buffer in motion (SR-212) on the built app: the left buffer slides out and
// the new one in, Previous buffer to the right, Next buffer to the left, by Alt+P and Alt+N, the mouse buttons
// Back and Forward, a swipe macOS reports to the window (SR-163 AK4) and the commands (AK1); a new input ends a running slide at once and acts on the new buffer
// (AK2); any other way of showing a buffer has no motion (AK3); with reduced motion nothing moves (AK4).
//
// Each slide animation is recorded when it is made, as `card-motion.spec.ts` does for the card (#1349): its layer,
// keyframes and time, read from the animation, not sampled from frames. No wall-clock time is asserted here; the
// time from the input to the drawn buffer and the motion at 50,000 elements are measured in
// `test/perf/buffer-slide.spec.ts`. A frame halfway through a slide is saved as a light-theme screenshot to
// `test-results/electron/screenshots/` (or REQSEQ_SCREENSHOTS).
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { goTo, launchApp, listAll, slideSettled, shownLayer, swipe } from "./support/app.js";

/** 14 elements with a derivation tree (fixtures/README.md). */
const FIXTURE = { fixture: "SR-069/filter" };

/** An element whose text is one plain line. */
const ELEMENT = "See the wind";
const ELEMENT_ID = "N-0000a1";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** A slide animation as it was made. */
interface Made {
  /** The layer it moves: `side` holds the picture of the left buffer, `main` the live new one. */
  readonly layer: string;
  readonly from: string;
  readonly to: string;
  readonly duration: number;
  readonly easing: string;
  /** The name of the live buffer when the motion started. */
  readonly shown: string;
  /** The live buffer was drawn when the motion started: its title, rows or cells (AK1 rationale). */
  readonly drawn: boolean;
}

/**
 * Records every slide animation from now on, in `window.slides`, when it is made: the controller removes the
 * inline transform of both layers in the task that makes the animations, so a `MutationObserver` on `style`
 * sees them at once. With `hold`, each is paused where it starts, so a test can act while it runs. Also counts
 * every picture that was ever put into the page (`window.pictures`).
 */
const record = (window: Page, hold = false): Promise<void> =>
  window.evaluate((pause) => {
    const made: Made[] = [];
    const seen = new WeakSet<Animation>();
    const own = window as unknown as { slides: Made[]; pictures: number; held: Animation[] };
    own.slides = made;
    own.pictures = 0;
    own.held = [];
    /** What a slide animation does, as it was made. */
    const madeOf = (effect: KeyframeEffect): Made => {
      const target = effect.target as HTMLElement | null;
      const [first, last] = effect.getKeyframes();
      const live = target?.closest("[data-area]")?.querySelector('[data-layer="main"] [data-buffer]') ?? null;
      return {
        layer: target?.dataset["layer"] ?? "",
        from: String(first?.["transform"]),
        to: String(last?.["transform"]),
        duration: Number(effect.getComputedTiming().duration),
        easing: String(effect.getTiming().easing),
        shown: live?.getAttribute("aria-label") ?? "",
        // Drawn: an element with its title, a list with its rows, a matrix with its cells.
        drawn:
          live !== null &&
          (live.matches("article")
            ? (live.querySelector("h1")?.textContent ?? "") !== ""
            : live.querySelector('.row, [role="gridcell"]') !== null),
      };
    };
    const countPictures = (records: MutationRecord[]): void => {
      for (const one of records) {
        for (const node of one.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains("slide-picture")) {
            own.pictures += 1;
          }
        }
      }
    };
    const take = (records: MutationRecord[]): void => {
      countPictures(records);
      for (const animation of document.getAnimations()) {
        const { effect } = animation;
        if (seen.has(animation) || animation.id !== "buffer-slide" || !(effect instanceof KeyframeEffect)) {
          continue;
        }
        seen.add(animation);
        if (pause) {
          animation.pause();
          own.held.push(animation);
        }
        made.push(madeOf(effect));
      }
    };
    new MutationObserver(take).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style"],
    });
  }, hold);

const slides = (window: Page): Promise<Made[]> =>
  window.evaluate(() => (window as unknown as { slides: Made[] }).slides);

const pictures = (window: Page): Promise<number> =>
  window.evaluate(() => (window as unknown as { pictures: number }).pictures);

/** Forgets what was recorded so far. */
const clear = (window: Page): Promise<void> =>
  window.evaluate(() => {
    const own = window as unknown as { slides: Made[]; pictures: number };
    own.slides.length = 0;
    own.pictures = 0;
  });

/** The slide of one switch, once both its animations are made. */
const slideOf = async (window: Page, shown: string): Promise<{ side: Made; main: Made }> => {
  await expect
    .poll(async () => (await slides(window)).filter((one) => one.shown === shown).length, {
      message: `the switch to ${shown} made no motion`,
    })
    .toBe(2);
  const made = (await slides(window)).filter((one) => one.shown === shown);
  const side = made.find((one) => one.layer === "side");
  const main = made.find((one) => one.layer === "main");
  if (side === undefined || main === undefined) {
    throw new Error(`no slide of both layers: ${JSON.stringify(made)}`);
  }
  expect(side.drawn && main.drawn, `${shown} moved before it was drawn`).toBe(true);
  await clear(window);
  return { side, main };
};

const BACK = { side: ["translateX(0%)", "translateX(100%)"], main: ["translateX(-100%)", "translateX(0%)"] };
const FORWARD = {
  side: ["translateX(0%)", "translateX(-100%)"],
  main: ["translateX(100%)", "translateX(0%)"],
};

/** The slide of the switch to `shown` went the way of Previous buffer (`BACK`) or Next buffer, in at most 200 ms. */
const expectSlide = async (window: Page, shown: string, way: typeof BACK): Promise<void> => {
  const { side, main } = await slideOf(window, shown);
  expect([side.from, side.to]).toEqual(way.side);
  expect([main.from, main.to]).toEqual(way.main);
  for (const one of [side, main]) {
    expect(one.duration).toBeGreaterThan(0);
    expect(one.duration).toBeLessThanOrEqual(200);
    // The curve of the card of the command line (SR-182).
    expect(one.easing).toBe("cubic-bezier(0.2, 0, 0, 1)");
  }
  await slideSettled(window);
};

const shownBuffer = (window: Page): Locator => shownLayer(window).locator("[data-buffer]");

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

/** The text of the element in its file, read with the CLI. */
const savedText = async (running: RunningApp): Promise<string> => {
  const got = await running.cli(["element", "get", ELEMENT_ID]);
  return (JSON.parse(got.stdout) as { element: { text: string } }).element.text;
};

test.describe("the switch to the previous or next buffer in motion", () => {
  let running: RunningApp;
  let element: string;

  test.beforeEach(async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await expect(shownLayer(window).locator(".overview .line").first()).toBeVisible();
    // The overview, the list of all elements, an element: three small buffers, each drawn once.
    await listAll(window);
    await open(window, ELEMENT);
    element = (await shownBuffer(window).getAttribute("aria-label")) ?? "";
    // Warm up: one switch there and back, so the first measured one does not pay for the first drawing.
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await window.keyboard.press("Alt+KeyN");
    await slideSettled(window);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", element);
  });

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-212/AK-d25h] Previous buffer slides the left buffer out to the right and the new one in from the left, Next buffer the other way, in at most 200 ms, by key, mouse button, swipe and command", async () => {
    const { window } = running;
    await record(window);
    // Alt+P and Alt+N.
    await window.keyboard.press("Alt+KeyP");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "All elements");
    await expectSlide(window, "All elements", BACK);
    await window.keyboard.press("Alt+KeyN");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", element);
    await expectSlide(window, element, FORWARD);
    // The mouse buttons Back and Forward, through Chromium's own input path.
    await clear(window);
    const session = await window.context().newCDPSession(window);
    const click = async (button: "back" | "forward"): Promise<void> => {
      for (const type of ["mousePressed", "mouseReleased"] as const) {
        await session.send("Input.dispatchMouseEvent", { type, button, x: 200, y: 200, clickCount: 1 });
      }
    };
    await click("back");
    await expectSlide(window, "All elements", BACK);
    await click("forward");
    await expectSlide(window, element, FORWARD);
    // A swipe macOS reports to the window (SR-163 AK4); elsewhere there is none, and nothing moves.
    await clear(window);
    await swipe(running, "left");
    if (process.platform === "darwin") {
      await expectSlide(window, "All elements", BACK);
      await swipe(running, "right");
      await expectSlide(window, element, FORWARD);
    } else {
      await slideSettled(window);
      await expect(shownBuffer(window)).toHaveAttribute("aria-label", element);
      expect(await slides(window)).toEqual([]);
    }
    // The commands of the prompt.
    await clear(window);
    await command(window, "Previous buffer");
    await expectSlide(window, "All elements", BACK);
    await command(window, "Next buffer");
    await expectSlide(window, element, FORWARD);
    // A frame halfway, in the light theme, as the evidence of the look.
    await record(window, true);
    await window.keyboard.press("Alt+KeyP");
    await slideOf(window, "All elements");
    await window.evaluate(() => {
      for (const animation of (window as unknown as { held: Animation[] }).held) {
        // Half of the way: the easing has covered it after a fifth of the time.
        animation.currentTime = 32;
      }
    });
    await fs.mkdir(OUT, { recursive: true });
    await window.screenshot({ path: path.join(OUT, "buffer-slide-halfway.png") });
    await window.keyboard.press("Escape");
    await slideSettled(window);
  });

  test("[SR-212/AK-d25h] in a split window the switch to the buffer of the other area moves nothing and makes that area active", async () => {
    const { window } = running;
    await command(window, "Split window");
    const right = window.locator('[data-area="right"]');
    await expect(right.locator("[data-buffer]")).toHaveAttribute("aria-label", "All elements");
    await record(window);
    // The buffer before the element is the one beside it.
    await window.keyboard.press("Alt+KeyP");
    await expect(right).toHaveAttribute("data-active", "");
    await expect(window.locator('[data-area="left"]')).not.toHaveAttribute("data-active", "");
    // Give a motion the time to show itself, if one were made.
    await window.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(await slides(window)).toEqual([]);
    expect(await pictures(window)).toBe(0);
  });

  test("[SR-212/AK-kqvx] a key, a mouse button or a swipe during a slide ends it at once and acts on the new buffer; nothing is typed into the left buffer", async () => {
    const { window } = running;
    // The slides stand still halfway, so each input below surely comes while one runs.
    await record(window, true);
    const held = (): Promise<string[]> =>
      window.evaluate(() => (window as unknown as { held: Animation[] }).held.map((one) => one.playState));
    // From the text editor of the element: Alt+P, then letters at once.
    const before = await savedText(running);
    await window.keyboard.press("Enter");
    await expect(shownLayer(window).locator(".cm-content")).toBeFocused();
    await window.keyboard.press("Alt+KeyP");
    await slideOf(window, "All elements");
    expect(await held()).toEqual(["paused", "paused"]);
    await window.keyboard.type("zz");
    // Ended in the end state at the first key; the keys went to the list, none into the element.
    expect(await held()).toEqual(["idle", "idle"]);
    await slideSettled(window);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "All elements");
    await expect(shownBuffer(window)).toBeFocused();
    // A key that is no shortcut acts on the new buffer: Down moves the list's mark.
    // No row is marked yet (a fresh list), so the first Down marks the first row.
    await expect(shownLayer(window).locator('.row[aria-selected="true"]')).toHaveCount(0);
    await window.keyboard.press("Alt+KeyN");
    await slideOf(window, element);
    await window.keyboard.press("Alt+KeyP");
    await slideOf(window, "All elements");
    await window.keyboard.press("ArrowDown");
    await slideSettled(window);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "All elements");
    await expect(shownLayer(window).locator('.row[aria-selected="true"]')).toHaveCount(1);
    // Alt+P twice: the second ends the first and walks on from the new buffer.
    await window.evaluate(() => {
      (window as unknown as { held: Animation[] }).held.length = 0;
    });
    await window.keyboard.press("Alt+KeyN");
    await slideOf(window, element);
    await window.keyboard.press("Alt+KeyP");
    await window.keyboard.press("Alt+KeyP");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
    // The slide of Alt+N ended at the first Alt+P, in its end state.
    expect((await held()).slice(0, 2)).toEqual(["idle", "idle"]);
    await window.keyboard.press("Escape");
    await slideSettled(window);
    // The mouse button Back during a slide does the same.
    await window.keyboard.press("Alt+KeyN");
    await slideOf(window, "All elements");
    const session = await window.context().newCDPSession(window);
    for (const type of ["mousePressed", "mouseReleased"] as const) {
      await session.send("Input.dispatchMouseEvent", { type, button: "back", x: 200, y: 200, clickCount: 1 });
    }
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
    await window.keyboard.press("Escape");
    await slideSettled(window);
    // A swipe macOS reports (SR-163 AK4) during a slide does the same; elsewhere there is none.
    await window.keyboard.press("Alt+KeyN");
    await slideOf(window, "All elements");
    await swipe(running, "left");
    await expect(shownBuffer(window)).toHaveAttribute(
      "aria-label",
      process.platform === "darwin" ? "Overview" : "All elements",
    );
    await window.keyboard.press("Escape");
    await slideSettled(window);
    // Nothing was typed into the element: its text in the app and on disk is as before.
    await open(window, ELEMENT);
    await expect(shownLayer(window).locator(".cm-content")).not.toContainText("zz");
    expect(await savedText(running)).toBe(before);
  });

  test("[SR-212/AK-hmwp] Ctrl+P, opening an element or a reference and closing a buffer show the other buffer without motion", async () => {
    const { window } = running;
    await record(window);
    // Ctrl+P to the list.
    await goTo(window);
    await window.keyboard.type("All elements");
    await window.keyboard.press("Enter");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "All elements");
    // A click on a row opens its element.
    await shownLayer(window).locator(".row", { hasText: "Send data to the cloud" }).click();
    await expect(shownLayer(window).locator("article h1")).toHaveText("Send data to the cloud");
    // A reference of the element opens its target.
    await shownLayer(window)
      .locator('[role="link"][data-target-id]', { hasText: "Warn of storms" })
      .first()
      .click();
    await expect(shownLayer(window).locator("article h1")).toHaveText("Warn of storms");
    // Closing the buffer shows the one before.
    await command(window, "Close buffer");
    await expect(shownBuffer(window)).toBeVisible();
    await window.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(await slides(window)).toEqual([]);
    expect(await pictures(window)).toBe(0);
  });

  test("[SR-212/AK-kzb2] with reduced motion the new buffer stands at once, without motion", async () => {
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "reduce" });
    await record(window);
    await window.keyboard.press("Alt+KeyP");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "All elements");
    // In its place in the next frame: the live layer stands over the area.
    const place = await window.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          requestAnimationFrame(() => {
            const area = document.querySelector('[data-area="left"]')?.getBoundingClientRect();
            const live = document
              .querySelector('[data-area="left"] [data-layer="main"]')
              ?.getBoundingClientRect();
            resolve([area?.x ?? -1, live?.x ?? -2, area?.width ?? -1, live?.width ?? -2]);
          });
        }),
    );
    expect(place[1]).toBe(place[0]);
    expect(place[3]).toBe(place[2]);
    await window.keyboard.press("Alt+KeyN");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", element);
    expect(await slides(window)).toEqual([]);
    expect(await pictures(window)).toBe(0);
  });
});
