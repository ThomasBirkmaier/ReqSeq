// The card of the command line in motion (SR-182) on the built app: it rises from the command line over a
// dimmed backdrop that blurs in a seam around it, by one progress, only when it appears; the next keys
// card the same; it runs back shorter on close; and stands at once without motion. The contrast of the
// dimmed backdrop is checked on the tokens (styles.test.ts). The end state and a frame halfway are saved
// as screenshots in light and dark to `test-results/electron/screenshots/` (or REQSEQ_SCREENSHOTS).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { cardSettled, launchApp, listAll, modifier } from "./support/app.js";
import { DEMO_FILES } from "./support/demo.js";

const FIXTURE = { fixture: "SR-069/filter", files: DEMO_FILES };

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** An animation of the card, the seam or the backdrop, as it started. */
interface Started {
  readonly part: "card" | "list" | "seam" | "backdrop";
  readonly leaving: boolean;
  readonly nextKeys: boolean;
  readonly name: string;
  readonly duration: number;
  readonly easing: string;
  readonly direction: string;
  readonly start: number | null;
  readonly from: string;
}

/**
 * Records every animation of the card's parts from now on, in `window.started`. Each one is taken when it
 * is made, in the task that shows the card or its copy running back, not at its `animationstart`: on a
 * slow runner that event comes after a frame in which the rise already ended, and an ended rise (fill
 * `backwards`) is no longer among the element's animations (#1349). Each counts once it started (its
 * `ready`), so a card gone before its first frame did not rise.
 */
const record = (window: Page): Promise<void> =>
  window.evaluate(() => {
    const started: Started[] = [];
    (window as unknown as { started: Started[] }).started = started;
    const PARTS = [
      ["card-backdrop", "backdrop"],
      ["card-seam", "seam"],
      ["card-list", "list"],
      ["card", "card"],
    ] as const;
    const made = new WeakSet<Animation>();
    const take = (): void => {
      for (const animation of document.getAnimations()) {
        const { effect } = animation;
        if (made.has(animation) || !(effect instanceof KeyframeEffect)) {
          continue;
        }
        const { target } = effect;
        const part = PARTS.find(([name]) => target?.classList.contains(name) === true)?.[1];
        if (target === null || part === undefined) {
          continue;
        }
        made.add(animation);
        const card = target.closest(".card") ?? target.nextElementSibling;
        const leaving = target.closest(".card-leaving") !== null;
        const nextKeys = (card?.querySelector(".next-keys") ?? null) !== null;
        animation.ready.then(
          () => {
            const timing = effect.getComputedTiming();
            const [first] = effect.getKeyframes();
            started.push({
              part,
              leaving,
              nextKeys,
              name: (animation as CSSAnimation).animationName,
              duration: Number(timing.duration),
              easing: String(first?.easing),
              direction: String(timing.direction),
              start: animation.startTime === null ? null : Number(animation.startTime),
              from: String(first?.["transform"] ?? first?.["opacity"]),
            });
          },
          // Cancelled before it started: it never ran.
          () => undefined,
        );
      }
    };
    // The card gets its `data-motion`, and the copy that runs back is added, before their first frame;
    // `getAnimations` makes their animations then.
    new MutationObserver(take).observe(document.body, {
      subtree: true,
      childList: true,
      attributeFilter: ["data-motion"],
    });
  });

const started = (window: Page): Promise<Started[]> =>
  window.evaluate(() => (window as unknown as { started: Started[] }).started);

/** The rising (not leaving) card animations seen so far. */
const rises = async (window: Page): Promise<Started[]> =>
  (await started(window)).filter((one) => one.part === "card" && !one.leaving);

const commands = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await expect(window.locator('.candidates [role="option"]').first()).toBeVisible();
};

/** The box of the first element of `selector`. */
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

/**
 * Longer than a card that comes after one that closed counts as taking its place and stands at once
 * (`TAKES_PLACE_MS` in Minibuffer.tsx).
 */
const APART_MS = 400;

/** The list of all elements is shown, and the prompt that opened it is long gone. */
const listed = async (window: Page): Promise<void> => {
  await listAll(window);
  await expect(window.locator(".card-leaving")).toHaveCount(0);
  await window.waitForTimeout(APART_MS);
};

test.describe("the card of the command line in motion", () => {
  let running: RunningApp;

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-182/AK1] the card rises from the command line into its place within 200 ms, easing out", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await listed(window);
    await record(window);
    await commands(window);
    await cardSettled(window);
    const [rise] = await rises(window);
    expect(rise?.name).toBe("card-rise");
    expect(rise?.duration).toBeGreaterThan(0);
    expect(rise?.duration).toBeLessThanOrEqual(200);
    expect(rise?.easing).toMatch(/^cubic-bezier\([\d.]+, [\d.]+, [\d.]+, 1\)$/);
    // From below: it starts as far down as the command line, and ends in its place, fully seen.
    expect(rise?.from).toMatch(/translateY\(/);
    expect(await style(window, ".card", "transform")).toBe("none");
    expect(await style(window, ".candidates", "opacity")).toBe("1");
    const card = await box(window, ".card");
    const line = await box(window, ".minibuffer");
    // The way up, in px: from the card's bottom in its place down to the top of the command line.
    const way = await window.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.height = "var(--card-rise)";
      document.body.append(probe);
      const height = probe.getBoundingClientRect().height;
      probe.remove();
      return height;
    });
    expect(card.bottom + way).toBeCloseTo(line.top, 0);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`[SR-182/AK2] the whole backdrop dims and a seam as wide as the shadow blurs, by the same progress (${scheme})`, async () => {
      running = await launchApp(FIXTURE, { colorScheme: scheme });
      const { window } = running;
      await window.emulateMedia({ reducedMotion: "no-preference" });
      await listed(window);
      await record(window);
      await commands(window);
      await cardSettled(window);
      const parts = (await started(window)).filter((one) => !one.leaving);
      const card = parts.find((one) => one.part === "card");
      for (const part of ["list", "seam", "backdrop"] as const) {
        const one = parts.find((each) => each.part === part);
        expect(one?.duration, part).toBe(card?.duration);
        expect(one?.easing, part).toBe(card?.easing);
        expect(one?.start, part).toBe(card?.start);
      }
      // The whole backdrop but the command line itself, dimmed; it takes no click.
      const backdrop = await box(window, ".card-backdrop");
      const line = await box(window, ".minibuffer");
      expect([backdrop.left, backdrop.top]).toEqual([0, 0]);
      expect(backdrop.width).toBe(await window.evaluate(() => innerWidth));
      expect(backdrop.bottom).toBeCloseTo(line.top, 0);
      expect(await style(window, ".card-backdrop", "background-color")).toBe(
        scheme === "light" ? "rgba(0, 0, 0, 0.06)" : "rgba(0, 0, 0, 0.12)",
      );
      expect(await style(window, ".card-backdrop", "pointer-events")).toBe("none");
      // The seam: as wide as the blur of the shadow on every side of the card, and blurred.
      const shadow = await style(window, ".candidates", "box-shadow");
      // "rgba(…) 0px -6px 18px 0px": x, y, blur, spread.
      const blur = Number(/\)\s*(-?\d+)px (-?\d+)px (\d+)px/.exec(shadow)?.[3]);
      expect(blur).toBe(18);
      const list = await box(window, ".candidates");
      const seam = await box(window, ".card-seam");
      expect(list.left - seam.left).toBeCloseTo(blur, 0);
      expect(seam.right - list.right).toBeCloseTo(blur, 0);
      expect(list.top - seam.top).toBeCloseTo(blur, 0);
      expect(seam.bottom - list.bottom).toBeCloseTo(blur, 0);
      expect(await style(window, ".card-seam", "backdrop-filter")).toMatch(/^blur\(\d+(\.\d+)?px\)$/);
      // The seam reaches past the window's edge, and the window does not scroll for it.
      expect(
        await window.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await window.screenshot({ path: path.join(OUT, `sr-182-card-${scheme}.png`) });
      // Halfway: the card on its way up, the dim and the blur half there.
      await window.keyboard.press("Escape");
      await cardSettled(window);
      await window.waitForTimeout(APART_MS);
      await window.keyboard.press("ControlOrMeta+Shift+P");
      await window.evaluate(async () => {
        const halfway = (): boolean => {
          const animations = document
            .getAnimations()
            .filter((one) => ["card-rise", "card-show"].includes((one as CSSAnimation).animationName));
          if (animations.length === 0) {
            return false;
          }
          for (const one of animations) {
            one.pause();
            one.currentTime = 70;
          }
          return true;
        };
        while (!halfway()) {
          await new Promise((done) => requestAnimationFrame(done));
        }
      });
      await window.screenshot({ path: path.join(OUT, `sr-182-card-halfway-${scheme}.png`) });
    });
  }

  test("[SR-182/AK3] keys typed while the card rises are all in the input", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await listed(window);
    // At once after the key that opens it, before the motion ends.
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("filter list by", { delay: 5 });
    await expect(window.locator("#prompt-input")).toHaveValue("filter list by");
    await expect(window.locator('.candidates [role="option"] .name').first()).toContainText("Filter list by");
  });

  test("[SR-182/AK4] the card does not rise again when the hits change or the prompt changes between elements and commands", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await listed(window);
    await record(window);
    // Elements (Go to), then commands over it, then other hits.
    await window.keyboard.press("ControlOrMeta+P");
    await expect(window.locator('.candidates [role="option"]').first()).toBeVisible();
    await cardSettled(window);
    await window.keyboard.type("wind");
    await expect(window.locator('.candidates [role="option"]').first()).toBeVisible();
    await cardSettled(window);
    // Go to drops its card for a moment between a key and its hits: the card of the hits stands.
    const shown = (await rises(window)).length;
    expect(shown).toBe(1);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await expect(window.locator("label.prompt-label")).not.toHaveText("Go to");
    await expect(window.locator('.candidates [role="option"]').first()).toBeVisible();
    await window.keyboard.type("filter");
    await expect(window.locator('.candidates [role="option"] .name').first()).toContainText("Filter");
    await window.keyboard.press("Backspace");
    await window.keyboard.type("r list by s");
    await expect(window.locator('.candidates [role="option"] .name').first()).toContainText("status");
    await cardSettled(window);
    expect(await rises(window)).toHaveLength(shown);
    // The next argument of a command takes the card's place: it does not rise either.
    await window.keyboard.press("Enter");
    await expect(window.locator("label.prompt-label")).toHaveText("Status");
    await expect(window.locator('.candidates [role="option"]').first()).toBeVisible();
    await cardSettled(window);
    expect(await rises(window)).toHaveLength(shown);
    // Closed, it rises again the next time.
    await window.keyboard.press("Escape");
    await cardSettled(window);
    await window.waitForTimeout(APART_MS);
    await commands(window);
    await cardSettled(window);
    expect(await rises(window)).toHaveLength(shown + 1);
  });

  test("[SR-182/AK5] the card of the next keys after the prefix key rises as the card of the hits", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    const mod = await modifier(window);
    await listed(window);
    await record(window);
    await commands(window);
    await cardSettled(window);
    await window.keyboard.press("Escape");
    await cardSettled(window);
    await window.keyboard.press(`${mod}+K`);
    await expect(window.getByRole("list", { name: "Next keys" })).toBeVisible();
    await cardSettled(window);
    const [hits, keys] = await rises(window);
    expect(hits?.nextKeys).toBe(false);
    expect(keys?.nextKeys).toBe(true);
    expect([keys?.name, keys?.duration, keys?.easing, keys?.from]).toEqual([
      hits?.name,
      hits?.duration,
      hits?.easing,
      hits?.from,
    ]);
    const parts = (await started(window)).filter((one) => !one.leaving && one.start === keys?.start);
    expect(parts.map((one) => one.part).sort()).toEqual(["backdrop", "card", "list", "seam"]);
  });

  test("[SR-182/AK6] on close the motion runs back in less time, and the dim and the blur go with it", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await listed(window);
    await record(window);
    await commands(window);
    await cardSettled(window);
    await window.keyboard.press("Escape");
    await cardSettled(window);
    const all = await started(window);
    const rise = all.find((one) => one.part === "card" && !one.leaving);
    const back = all.filter((one) => one.leaving);
    expect(back.map((one) => one.part).sort()).toEqual(["backdrop", "card", "list", "seam"]);
    for (const one of back) {
      expect(one.direction, one.part).toBe("reverse");
      expect(one.duration, one.part).toBeLessThan(rise?.duration ?? 0);
      expect(one.start, one.part).toBe(back[0]?.start);
    }
    // The copy that ran back is gone, and was never a hit of the prompt.
    await expect(window.locator(".card-leaving")).toHaveCount(0);
    await expect(window.locator(".candidates")).toHaveCount(0);
    await expect(window.locator(".card-backdrop")).toHaveCount(0);
  });

  test("[SR-182/AK7] without motion the card stands at once, dimmed and blurred as at the end, and goes at once", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "reduce" });
    await listed(window);
    await record(window);
    await window.evaluate(() => {
      const seen = { leaving: false };
      (window as unknown as { seen: typeof seen }).seen = seen;
      new MutationObserver(() => {
        if (document.querySelector(".card-leaving") !== null) {
          seen.leaving = true;
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await commands(window);
    expect(await window.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(await style(window, ".card", "transform")).toBe("none");
    expect(await style(window, ".candidates", "opacity")).toBe("1");
    expect(await style(window, ".card-backdrop", "background-color")).toBe("rgba(0, 0, 0, 0.06)");
    expect(await style(window, ".card-backdrop", "opacity")).toBe("1");
    expect(await style(window, ".card-seam", "opacity")).toBe("1");
    expect(await style(window, ".card-seam", "backdrop-filter")).toMatch(/^blur\(/);
    await window.keyboard.press("Escape");
    await expect(window.locator(".card")).toHaveCount(0);
    expect(
      await window.evaluate(() => (window as unknown as { seen: { leaving: boolean } }).seen.leaving),
    ).toBe(false);
    expect(await started(window)).toEqual([]);
  });
});
