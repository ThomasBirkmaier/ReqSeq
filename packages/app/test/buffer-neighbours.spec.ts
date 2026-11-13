// The previous and the next buffer drawn in advance (SR-212 AK5) on the built app: an element that is no package
// page and the neighbourhood of an element stand drawn hidden beside the shown buffer, so a switch to one of them
// slides without waiting for its draw and shows what a fresh view at the switch shows; no other buffer is read for
// it, nor the buffer of the other area of a split window. The requests of the window to core are counted in the
// preload's world (`recordRequests`). Times at 50,000 elements are measured in `test/perf/neighbours.spec.ts`.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { CoreRequest, CoreRequests, RunningApp } from "./support/app.js";
import { goTo, launchApp, listAll, recordRequests, shownLayer, slideSettled } from "./support/app.js";

/** 14 elements with a derivation tree and two packages (fixtures/README.md). */
const FIXTURE = { fixture: "SR-069/filter" };

const NEED = {
  title: "See the wind",
  id: "69069069-0000-4000-8000-0000000000a1",
  file: "needs/N-0000000000a1.md",
};
const SPEED = { title: "Measure wind speed", id: "69069069-0000-4000-8000-0000000000b1" };
const SECOND = { title: "Measure every second", id: "69069069-0000-4000-8000-0000000000b2" };
const SENSORS = { title: "Sensors", id: "69069069-0000-4000-8000-0000000000d1" };

/** The views drawn hidden beside the shown buffer of the area (the active one by default), by their names. */
const hiddenViews = (window: Page, side?: string): Promise<string[]> =>
  window.evaluate((area) => {
    const root = document.querySelector(
      area === undefined ? "[data-area][data-active]" : `[data-area="${area}"]`,
    );
    return [...(root?.querySelectorAll(':scope > [data-layer="neighbour"]') ?? [])].map(
      (layer) => layer.querySelector(".buffer")?.getAttribute("aria-label") ?? "",
    );
  }, side);

/** The requests that name the element `id` (by `ref`, `id` or a selection of it). */
const naming = (sent: readonly CoreRequest[], id: string): CoreRequest[] =>
  sent.filter((request) => JSON.stringify(request.input).includes(id));

/** Waits until no request was sent for 400 ms: the views drawn in advance have read. */
const quiet = async (requests: CoreRequests): Promise<void> => {
  let count = -1;
  await expect
    .poll(
      async () => {
        const now = (await requests.sent()).length;
        const still = now === count;
        count = now;
        return still;
      },
      { intervals: [400] },
    )
    .toBe(true);
};

/**
 * Presses `key` and tells whether the slide it started was running in the first task after the key: a buffer
 * drawn in advance slides at once, one drawn at the switch only after its read and two frames.
 */
const slidesAtOnce = async (window: Page, key: string): Promise<boolean> => {
  await window.evaluate(() => {
    const own = window as unknown as { atOnce?: Promise<boolean> };
    own.atOnce = new Promise((resolve) => {
      // The key itself, not the modifier pressed before it.
      const listener = (event: KeyboardEvent): void => {
        if (event.key === "Alt" || event.key === "Control" || event.key === "Meta") {
          return;
        }
        removeEventListener("keydown", listener);
        setTimeout(() => {
          resolve(document.getAnimations().some((animation) => animation.id === "buffer-slide"));
        }, 0);
      };
      addEventListener("keydown", listener);
    });
  });
  await window.keyboard.press(key);
  const atOnce = await window.evaluate(() => (window as unknown as { atOnce: Promise<boolean> }).atOnce);
  await slideSettled(window);
  return atOnce;
};

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

/** The fields of the shown element highlighted as changed outside (SR-116). */
const highlighted = (window: Page): Promise<string[]> =>
  shownLayer(window)
    .locator(".field.outside-change")
    .evaluateAll((fields) => fields.map((field) => (field as HTMLElement).dataset["field"] ?? ""));

/** Changes the need's file, as another editor does. */
const rewrite = async (running: RunningApp, change: (text: string) => string): Promise<void> => {
  const file = path.join(running.workspace?.root ?? "", ...NEED.file.split("/"));
  await fs.writeFile(file, change(await fs.readFile(file, "utf8")));
};

/** Gives the need the title `title` outside the app. */
const retitle = (running: RunningApp, title: string): Promise<void> =>
  rewrite(running, (text) => text.replace(/^title: .*$/m, `title: ${title}`));

/** The title the hidden view of the area shows (its buffer is named anew only once it is shown). */
const hiddenTitle = (window: Page): Promise<string[]> =>
  window
    .locator('[data-area][data-active] > [data-layer="neighbour"] article h1')
    .evaluateAll((titles) => titles.map((title) => title.textContent));

test.describe("the previous and the next buffer drawn in advance", () => {
  let running: RunningApp;
  let requests: CoreRequests;

  test.beforeEach(async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await expect(shownLayer(window).locator(".overview .line").first()).toBeVisible();
    requests = await recordRequests(window);
  });

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-212/AK-tfck] an element neighbour is drawn hidden and slides in without waiting, with no read at the switch", async () => {
    const { window } = running;
    await open(window, NEED.title);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`N-0000a1 ${NEED.title}`);
    await quiet(requests);
    // Hidden: inert, out of the accessibility tree, without the focus, not found as a buffer.
    const layer = window.locator('[data-area][data-active] > [data-layer="neighbour"]');
    await expect(layer).toHaveAttribute("inert", "");
    await expect(layer).toHaveAttribute("aria-hidden", "true");
    await expect(layer.locator("[data-buffer]")).toHaveCount(0);
    expect(
      await window.evaluate(() => document.activeElement?.closest('[data-layer="neighbour"]') ?? null),
    ).toBeNull();
    await expect(window.getByRole("heading", { name: NEED.title })).toHaveCount(0);
    // The modeline names the shown buffer only.
    await expect(window.getByLabel("Modeline")).toContainText("SR-0000b1");
    await expect(window.getByLabel("Modeline")).not.toContainText("N-0000a1");
    await requests.clear();
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    await expect(shownLayer(window).locator("article h1")).toHaveText(NEED.title);
    expect(naming(await requests.sent(), NEED.id)).toEqual([]);
    await expect(shownLayer(window).locator("[data-buffer]")).toBeFocused();
    await expect(window.getByLabel("Modeline")).toContainText("N-0000a1");
  });

  test("[SR-212/AK-tfck] a neighbourhood neighbour is drawn hidden and slides in without waiting, with no read at the switch", async () => {
    const { window } = running;
    await open(window, NEED.title);
    await command(window, "Show neighbourhood");
    await expect(shownLayer(window).locator(".neighbourhood .row").first()).toBeVisible();
    await quiet(requests);
    await requests.clear();
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`Neighbourhood: N-0000a1 ${NEED.title}`);
    await quiet(requests);
    // The neighbourhood's two reads, its tree (two levels down) and its incoming relations (one level down):
    // made by the view drawn hidden after the switch away, and none at the switch back.
    const reads = async (): Promise<string[]> =>
      naming(await requests.sent(), NEED.id)
        .filter(
          (request) =>
            request.name === "trace.neighbourhood" && JSON.stringify(request.input).includes('"down"'),
        )
        .map((request) => `maxDepth ${String((request.input as { maxDepth?: number }).maxDepth)}`)
        .sort();
    expect(await reads()).toEqual(["maxDepth 1", "maxDepth 2"]);
    await requests.clear();
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    await expect(shownLayer(window).locator(".neighbourhood .row").first()).toBeVisible();
    // The need's element, now its previous buffer, is drawn in advance (its parents line reads upwards).
    expect(await reads()).toEqual([]);
  });

  test("[SR-212/AK-tfck] an element left with a change is read again after its save, then slides in without waiting with the change", async () => {
    const { window } = running;
    await open(window, NEED.title);
    await open(window, SPEED.title);
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await expect(shownLayer(window).locator("article h1")).toHaveText(NEED.title);
    // Typed in the need, then left: the save of leaving writes the file (SR-105 AK1), and the need, now
    // drawn in advance, is read again after that save.
    await shownLayer(window).locator(".cm-content").first().click();
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.type(" Gusts too.");
    await window.keyboard.press("Alt+KeyN");
    await slideSettled(window);
    await expect
      .poll(async () => (await running.cli(["element", "get", NEED.id])).stdout)
      .toContain("Gusts too.");
    await quiet(requests);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    await expect(shownLayer(window).locator(".cm-content").first()).toContainText("Gusts too.");
    await expect(window.getByLabel("Modeline")).not.toContainText("modified");
  });

  test("[SR-212/AK-tfck] an element drawn in advance and changed outside shows the content and highlight of a fresh open", async () => {
    const { window } = running;
    await open(window, NEED.title);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`N-0000a1 ${NEED.title}`);
    await quiet(requests);
    await requests.clear();
    await retitle(running, "See the gusts");
    // Read again hidden, highlighted only when shown.
    await expect.poll(() => hiddenTitle(window)).toEqual(["See the gusts"]);
    await expect(window.locator(".outside-change")).toHaveCount(0);
    await quiet(requests);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    await expect(shownLayer(window).locator("article h1")).toHaveText("See the gusts");
    const drawnAhead = await highlighted(window);
    expect(drawnAhead).toEqual(["Title"]);
    // The same as a fresh open: closed, changed outside again, opened with Ctrl+P.
    await command(window, "Close buffer");
    await expect(shownLayer(window).locator("article h1")).toHaveText(SPEED.title);
    await retitle(running, "See the storm");
    await expect
      .poll(async () => (await running.cli(["element", "get", NEED.id])).stdout)
      .toContain("See the storm");
    await expect.poll(() => hiddenTitle(window)).toEqual([]);
    await open(window, "See the storm");
    expect(await highlighted(window)).toEqual(drawnAhead);
  });

  test("[SR-212/AK-tfck] an element scrolled, left and returned shows the position of a fresh open", async () => {
    const { window } = running;
    const long = Array.from({ length: 120 }, (_, line) => `Line ${String(line + 1)} of a long text.`).join(
      "\n\n",
    );
    await rewrite(running, (text) => `${text.trimEnd()}\n\n${long}\n`);
    await open(window, NEED.title);
    const scroller = shownLayer(window).locator(".buffer.element");
    await expect(shownLayer(window).locator(".cm-content").first()).toContainText("Line 1 of a long text.");
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`N-0000a1 ${NEED.title}`);
    await quiet(requests);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    await expect(shownLayer(window).locator("article h1")).toHaveText(NEED.title);
    expect(
      await shownLayer(window)
        .locator(".buffer.element")
        .evaluate((element) => element.scrollTop),
    ).toBe(0);
  });

  test("[SR-212/AK-tfck] a package page neighbour sends no request in the background, and the switch to it waits for its draw", async () => {
    const { window } = running;
    await open(window, SENSORS.title);
    await expect(shownLayer(window).locator(".members .row").first()).toBeVisible();
    await requests.clear();
    await open(window, SPEED.title);
    await quiet(requests);
    expect(await hiddenViews(window)).toEqual([]);
    expect(naming(await requests.sent(), SENSORS.id)).toEqual([]);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(false);
    await expect(shownLayer(window).locator(".members .row").first()).toBeVisible();
  });

  test("[SR-212/AK-tfck] in a split window only the active area draws in advance, never the other area's buffer", async () => {
    const { window } = running;
    await open(window, SECOND.title);
    await open(window, NEED.title);
    await goTo(window);
    await window.keyboard.type("Overview");
    await window.keyboard.press("Enter");
    await expect(shownLayer(window).locator(".overview .line").first()).toBeVisible();
    await command(window, "Close buffer");
    await open(window, SPEED.title);
    // The buffers in their order of use: Measure wind speed, See the wind, Measure every second.
    await command(window, "Split window");
    await expect(shownLayer(window, "right").locator("article h1")).toHaveText(NEED.title);
    await expect.poll(() => hiddenViews(window, "left")).toEqual([`SR-0000b2 ${SECOND.title}`]);
    expect(await hiddenViews(window, "right")).toEqual([]);
    // The previous buffer is shown in the other area: it is not drawn a second time.
    await expect(window.locator(`[aria-label="N-0000a1 ${NEED.title}"]`)).toHaveCount(1);
  });

  test("[SR-212/AK-tfck] at a start with restored buffers the element neighbours are drawn, a list neighbour is not read", async () => {
    let { window } = running;
    await listAll(window);
    await open(window, NEED.title);
    await open(window, SPEED.title);
    await running.close({ keep: true });
    running = await launchApp(undefined, { kept: running.kept, colorScheme: "light" });
    ({ window } = running);
    await window.emulateMedia({ reducedMotion: "no-preference" });
    requests = await recordRequests(window);
    await expect(shownLayer(window).locator(".overview .line").first()).toBeVisible();
    // The overview, then in their order of use: Measure wind speed, See the wind, All elements. Previous is
    // the element, next the list.
    await expect.poll(() => hiddenViews(window)).toEqual([`SR-0000b1 ${SPEED.title}`]);
    await quiet(requests);
    expect(
      (await requests.sent()).filter(
        (request) => request.name === "element.list" && !JSON.stringify(request.input).includes("ids"),
      ),
    ).toEqual([]);
    await expect(window.locator('[data-layer] [aria-label="All elements"]')).toHaveCount(0);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    await expect(shownLayer(window).locator("article h1")).toHaveText(SPEED.title);
  });

  test("hidden buffers change neither the session, the order of Previous and Next, nor the recent elements; reduced motion still draws them", async () => {
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "reduce" });
    await open(window, NEED.title);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`N-0000a1 ${NEED.title}`);
    // Reduced motion: drawn all the same, no motion.
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(false);
    await expect(shownLayer(window).locator("article h1")).toHaveText(NEED.title);
    await window.keyboard.press("Alt+KeyN");
    await expect(shownLayer(window).locator("article h1")).toHaveText(SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`N-0000a1 ${NEED.title}`);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(false);
    await expect(shownLayer(window).locator("article h1")).toHaveText(NEED.title);
    // The overview's recent elements: the two that were shown, the newest first, none only drawn hidden.
    await goTo(window);
    await window.keyboard.type("Overview");
    await window.keyboard.press("Enter");
    await expect(shownLayer(window).locator(".overview .line.recent")).toHaveText([
      new RegExp(NEED.title),
      new RegExp(SPEED.title),
    ]);
  });
});
