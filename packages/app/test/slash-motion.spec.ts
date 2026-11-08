// The slash menu as the card of the command line (SR-129 AK5) on the built app: a soft card with a shadow,
// the whole backdrop dimmed by the same amount as behind the card and blurred in the seam of its shadow,
// coming in at the caret within 200 ms by one progress and going back shorter, and standing at once
// without motion. The end state and a frame halfway are saved as screenshots in light and dark to
// `test-results/electron/screenshots/` (or REQSEQ_SCREENSHOTS).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILES, DEMO_TITLE } from "./support/demo.js";

const FIXTURE = { fixture: "SR-069/filter", files: DEMO_FILES };

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** The menu that is shown, not a copy running back. */
const MENU = ".cm-lr-slash:not(.cm-lr-slash-leaving)";

/** An animation of the menu, its list, its seam or the backdrop, as it started. */
interface Started {
  readonly part: "menu" | "list" | "seam" | "backdrop";
  readonly leaving: boolean;
  readonly name: string;
  readonly duration: number;
  readonly easing: string;
  readonly direction: string;
  readonly start: number | null;
}

/** Records every animation of the menu's parts from now on, in `window.started`. */
const record = (window: Page): Promise<void> =>
  window.evaluate(() => {
    const started: Started[] = [];
    (window as unknown as { started: Started[] }).started = started;
    document.addEventListener(
      "animationstart",
      (event) => {
        const target = event.target as HTMLElement;
        const part = target.classList.contains("slash-backdrop")
          ? "backdrop"
          : target.classList.contains("slash-seam")
            ? "seam"
            : target.classList.contains("cm-lr-slash")
              ? "menu"
              : target.parentElement?.classList.contains("cm-lr-slash") === true && target.tagName === "UL"
                ? "list"
                : undefined;
        const animation = target
          .getAnimations()
          .find((one) => (one as CSSAnimation).animationName === event.animationName);
        const effect = animation?.effect as KeyframeEffect | undefined;
        if (part === undefined || animation === undefined || effect === undefined) {
          return;
        }
        const timing = effect.getComputedTiming();
        const [first] = effect.getKeyframes();
        started.push({
          part,
          leaving:
            target.closest(".cm-lr-slash-leaving") !== null ||
            target.classList.contains("cm-lr-slash-leaving"),
          name: event.animationName,
          duration: Number(timing.duration),
          easing: String(first?.easing),
          direction: String(timing.direction),
          start: animation.startTime === null ? null : Number(animation.startTime),
        });
      },
      true,
    );
  });

const started = (window: Page): Promise<Started[]> =>
  window.evaluate(() => (window as unknown as { started: Started[] }).started);

/** No animation of the menu's parts runs any more. */
const settled = (window: Page): Promise<void> =>
  expect
    .poll(() =>
      window.evaluate(
        () =>
          document
            .getAnimations()
            .filter((one) => ["slash-come", "card-show"].includes((one as CSSAnimation).animationName))
            .filter((one) => one.playState === "running").length,
      ),
    )
    .toBe(0);

const box = (window: Page, selector: string): Promise<DOMRect> =>
  window.evaluate((at) => document.querySelector(at)?.getBoundingClientRect().toJSON() as DOMRect, selector);

const style = (window: Page, selector: string, property: string): Promise<string> =>
  window.evaluate(
    ([at, name]) => {
      const element = document.querySelector(at);
      return element === null ? "" : getComputedStyle(element).getPropertyValue(name);
    },
    [selector, property] as const,
  );

/** Opens the demo element and puts the cursor at the end of its text, on the empty last line. */
const editing = async (window: Page): Promise<void> => {
  await listAll(window);
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(DEMO_TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator(".cm-content")).toBeFocused();
  // The card of the command line is gone.
  await expect(window.locator(".card-leaving")).toHaveCount(0);
};

test.describe("the slash menu as the card of the command line", () => {
  let running: RunningApp;

  test.afterEach(async () => {
    await running.close();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`[SR-129/AK5] the menu is a soft card over the whole backdrop, dimmed as behind the command card and blurred in its seam, coming in at the caret within 200 ms (${scheme})`, async () => {
      running = await launchApp(FIXTURE, { colorScheme: scheme });
      const { window } = running;
      await window.emulateMedia({ reducedMotion: "no-preference" });
      await editing(window);
      await record(window);
      await window.keyboard.type("/");
      await expect(window.locator(MENU)).toBeVisible();
      await settled(window);
      const parts = (await started(window)).filter((one) => !one.leaving);
      const menu = parts.find((one) => one.part === "menu");
      expect(menu?.name).toBe("slash-come");
      expect(menu?.duration).toBeGreaterThan(0);
      expect(menu?.duration).toBeLessThanOrEqual(200);
      expect(menu?.easing).toMatch(/^cubic-bezier\([\d.]+, [\d.]+, [\d.]+, 1\)$/);
      for (const part of ["list", "seam", "backdrop"] as const) {
        const one = parts.find((each) => each.part === part);
        expect(one?.duration, part).toBe(menu?.duration);
        expect(one?.easing, part).toBe(menu?.easing);
        expect(one?.start, part).toBe(menu?.start);
      }
      // At the caret, in the last line right after the /: the menu is right under that line (above it when
      // the window has no room below), at its start.
      const line = (await window.locator(".cm-line").last().boundingBox()) ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };
      const list = await box(window, `${MENU} > ul`);
      const below = Math.abs(list.top - (line.y + line.height));
      const above = Math.abs(list.bottom - line.y);
      expect(Math.min(below, above)).toBeLessThanOrEqual(line.height);
      expect(Math.abs(list.left - line.x)).toBeLessThan(40);
      // A soft card: the raised ground, rounded, with a shadow.
      expect(await style(window, `${MENU} > ul`, "border-radius")).toBe("8px");
      expect(await style(window, `${MENU} > ul`, "transform")).toBe("none");
      expect(await style(window, `${MENU} > ul`, "opacity")).toBe("1");
      // The whole window dimmed as much as behind the card of the command line; no click is taken. The
      // modeline and the command line paint above it, as they stay clear of the card's backdrop too.
      const backdrop = await box(window, ".slash-backdrop");
      expect([backdrop.left, backdrop.top]).toEqual([0, 0]);
      expect(backdrop.width).toBe(await window.evaluate(() => innerWidth));
      expect(backdrop.height).toBe(await window.evaluate(() => innerHeight));
      expect(await style(window, ".slash-backdrop", "background-color")).toBe(
        scheme === "light" ? "rgba(0, 0, 0, 0.06)" : "rgba(0, 0, 0, 0.12)",
      );
      expect(await style(window, ".slash-backdrop", "pointer-events")).toBe("none");
      // The backdrop lies over the text and just under the menu: in the editor, right before the menu, one
      // layer below it (a hit test does not see it, since it takes no click).
      const layers = await window.evaluate(() => {
        const backdrop = document.querySelector(".slash-backdrop");
        const menu = document.querySelector(".cm-lr-slash:not(.cm-lr-slash-leaving)");
        return {
          next: backdrop?.nextElementSibling === menu,
          backdrop: backdrop === null ? NaN : Number(getComputedStyle(backdrop).zIndex),
          menu: menu === null ? NaN : Number(getComputedStyle(menu).zIndex),
        };
      });
      expect(layers.next).toBe(true);
      expect(layers.backdrop).toBe(layers.menu - 1);
      // The seam: as wide as the blur of the shadow on every side of the card, and blurred.
      const shadow = await style(window, `${MENU} > ul`, "box-shadow");
      const blur = Number(/\)\s*(-?\d+)px (-?\d+)px (\d+)px/.exec(shadow)?.[3]);
      expect(blur).toBe(18);
      const seam = await box(window, `${MENU} > .slash-seam`);
      expect(list.left - seam.left).toBeCloseTo(blur, 0);
      expect(seam.right - list.right).toBeCloseTo(blur, 0);
      expect(list.top - seam.top).toBeCloseTo(blur, 0);
      expect(seam.bottom - list.bottom).toBeCloseTo(blur, 0);
      expect(await style(window, `${MENU} > .slash-seam`, "backdrop-filter")).toMatch(
        /^blur\(\d+(\.\d+)?px\)$/,
      );
      await window.screenshot({ path: path.join(OUT, `sr-129-slash-card-${scheme}.png`) });
      // Halfway: the menu on its way in, the dim and the blur half there.
      await window.keyboard.press("Escape");
      await settled(window);
      await window.keyboard.press("Backspace");
      await window.keyboard.type("/");
      await window.evaluate(async () => {
        const halfway = (): boolean => {
          const animations = document
            .getAnimations()
            .filter((one) => ["slash-come", "card-show"].includes((one as CSSAnimation).animationName));
          if (animations.length === 0) {
            return false;
          }
          for (const one of animations) {
            one.pause();
            one.currentTime = 70;
          }
          return true;
        };
        // At most a second of frames: the animations start within a frame or two.
        for (let frame = 0; frame < 60 && !halfway(); frame += 1) {
          await new Promise((done) => requestAnimationFrame(done));
        }
      });
      await window.screenshot({ path: path.join(OUT, `sr-129-slash-card-halfway-${scheme}.png`) });
    });
  }

  test("[SR-129/AK5] on close the menu goes back faster than it came, and the dim and the blur go with it", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await editing(window);
    await record(window);
    await window.keyboard.type("/");
    await expect(window.locator(MENU)).toBeVisible();
    await settled(window);
    await window.keyboard.press("Escape");
    await expect(window.locator(MENU)).toHaveCount(0);
    await settled(window);
    const all = await started(window);
    const come = all.find((one) => one.part === "menu" && !one.leaving);
    const back = all.filter((one) => one.leaving);
    expect(back.map((one) => one.part).sort()).toEqual(["backdrop", "list", "menu", "seam"]);
    for (const one of back) {
      expect(one.direction, one.part).toBe("reverse");
      expect(one.duration, one.part).toBeLessThan(come?.duration ?? 0);
      expect(one.start, one.part).toBe(back[0]?.start);
    }
    // The copy that ran back is gone, and the / stays as typed (AK3).
    await expect(window.locator(".cm-lr-slash-leaving")).toHaveCount(0);
    await expect(window.locator(".slash-backdrop")).toHaveCount(0);
    await expect(window.locator(".cm-line").last()).toHaveText("/");
  });

  test("[SR-129/AK5] with reduced motion the menu stands at once, dimmed and blurred as at the end, and goes at once", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "reduce" });
    await editing(window);
    await record(window);
    await window.evaluate(() => {
      const seen = { leaving: false };
      (window as unknown as { seen: typeof seen }).seen = seen;
      new MutationObserver(() => {
        if (document.querySelector(".cm-lr-slash-leaving") !== null) {
          seen.leaving = true;
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await window.keyboard.type("/");
    await expect(window.locator(MENU)).toBeVisible();
    expect(await window.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(await style(window, MENU, "transform")).toBe("none");
    expect(await style(window, `${MENU} > ul`, "opacity")).toBe("1");
    expect(await style(window, ".slash-backdrop", "background-color")).toBe("rgba(0, 0, 0, 0.06)");
    expect(await style(window, ".slash-backdrop", "opacity")).toBe("1");
    expect(await style(window, `${MENU} > .slash-seam`, "backdrop-filter")).toMatch(/^blur\(/);
    await window.keyboard.press("Escape");
    await expect(window.locator(".cm-lr-slash")).toHaveCount(0);
    await expect(window.locator(".slash-backdrop")).toHaveCount(0);
    expect(
      await window.evaluate(() => (window as unknown as { seen: { leaving: boolean } }).seen.leaving),
    ).toBe(false);
    expect(await started(window)).toEqual([]);
  });
});
