// The previous and the next buffer drawn in advance (SR-212 AK5) on the built app: an element that is no package
// page and the neighbourhood of an element stand drawn hidden beside the shown buffer, so a switch to one of them
// slides without waiting for its draw and shows what a fresh view at the switch shows; any other buffer stays drawn,
// from what it read when shown, while it stays beside the shown one and nothing it shows changed, and is never read
// for it; nor is the buffer of the other area of a split window. The requests of the window to core are counted in the
// preload's world (`recordRequests`). Times at 50,000 elements are measured in `test/perf/neighbours.spec.ts`.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
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

/** The layers drawn hidden beside the shown buffer of the active area. */
const hiddenLayer = (window: Page): Locator =>
  window.locator('[data-area][data-active] > [data-layer="neighbour"]');

/** The title the hidden view of the area shows (its buffer is named anew only once it is shown). */
const hiddenTitle = (window: Page): Promise<string[]> =>
  window
    .locator('[data-area][data-active] > [data-layer="neighbour"] article h1')
    .evaluateAll((titles) => titles.map((title) => title.textContent));

/** The pause of the wheel that ends a swipe (`SEGMENT_GAP_MS` of `buffer-swipe.ts`). */
const SEGMENT_GAP_MS = 35;

/** The title the target of a swipe shows at the edge of the shown buffer (SR-211 AK3). */
const peekTitle = (window: Page): Locator =>
  window.locator("[data-area][data-active] > [data-peek] article h1");

/** Gives the element of `file` the title `title` outside the app. */
const retitleFile = async (running: RunningApp, file: string, title: string): Promise<void> => {
  const at = path.join(running.workspace?.root ?? "", ...file.split("/"));
  await fs.writeFile(at, (await fs.readFile(at, "utf8")).replace(/^title: .*$/m, `title: ${title}`));
};

/**
 * Starts a swipe toward Previous buffer while the window's clock stands still, and waits until its target, drawn
 * in advance, joins the shown buffer at its edge. Returns the width of the area.
 */
const swipeBack = async (window: Page): Promise<number> => {
  const box = await window.locator("[data-area][data-active]").boundingBox();
  const width = box?.width ?? 0;
  await window.mouse.move((box?.x ?? 0) + width / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
  await window.clock.install();
  await window.clock.pauseAt(Date.now() + 1000);
  await window.mouse.wheel(-20, 0);
  await expect(window.locator("[data-area][data-active] > [data-peek]")).toHaveCount(1);
  return width;
};

/**
 * Lets the window's clock run until the change of the workspace reached the window: `done` holds. The swipe goes
 * on meanwhile by a pixel within each pause shorter than the one that would end it.
 */
const untilSeen = async (window: Page, done: () => Promise<boolean>): Promise<void> => {
  await expect
    .poll(async () => {
      await window.clock.runFor(SEGMENT_GAP_MS - 15);
      await window.mouse.wheel(-1, 0);
      return done();
    })
    .toBe(true);
};

/** The reads of the element `id` itself. */
const gets = (sent: readonly CoreRequest[], id: string): CoreRequest[] =>
  naming(sent, id).filter(
    (request) => request.name === "element.get" && (request.input as { ref?: unknown } | null)?.ref === id,
  );

/** The motions of the shown layer the window made, by id, since `recordMotions`; those of `paused` stand still. */
interface Motions {
  readonly made: string[];
  readonly paused: Animation[];
}

/**
 * Records each slide and spring-back of the shown layer when it is made, and pauses those whose id is in `pause`
 * at once, so no check races the motion, which runs on real time while the window's clock stands still.
 */
const recordMotions = (window: Page, pause: readonly string[] = []): Promise<void> =>
  window.evaluate((ids) => {
    const own = window as unknown as { motions: Motions };
    own.motions = { made: [], paused: [] };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with its element below.
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      const made = animate.call(this, frames, options);
      const id = typeof options === "object" ? (options.id ?? "") : "";
      if (this instanceof HTMLElement && this.dataset["layer"] === "main" && id.startsWith("buffer-")) {
        own.motions.made.push(id);
        if (ids.includes(id)) {
          made.pause();
          own.motions.paused.push(made);
        }
      }
      return made;
    };
  }, pause);

/** The ids of the motions made since `recordMotions`. */
const motionsMade = (window: Page): Promise<string[]> =>
  window.evaluate(() => [...(window as unknown as { motions: Motions }).motions.made]);

/** Whether a slide stands in the window now, running or paused. */
const sliding = (window: Page): Promise<boolean> =>
  window.evaluate(() => document.getAnimations().some((animation) => animation.id === "buffer-slide"));

/** Lets the paused motions run on. */
const playMotions = (window: Page): Promise<void> =>
  window.evaluate(() => {
    for (const animation of (window as unknown as { motions: Motions }).motions.paused) {
      animation.play();
    }
  });

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
    const layer = window
      .locator('[data-area][data-active] > [data-layer="neighbour"]')
      .filter({ has: window.locator("article") });
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

  test("[SR-212/AK-tfck] the save of leaving an element belongs to the switch: the other neighbour stays drawn in advance, read once more", async () => {
    const { window } = running;
    // In the order of use SPEED, NEED, SECOND: from SPEED, Alt+P goes to NEED, whose other neighbour is SECOND,
    // drawn in advance already beside SPEED.
    await open(window, SECOND.title);
    // Without the overview of the start, so the walk is these three.
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await command(window, "Close buffer");
    await expect(shownLayer(window).locator("article h1")).toHaveText(SECOND.title);
    await open(window, NEED.title);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`SR-0000b2 ${SECOND.title}`);
    await quiet(requests);
    await shownLayer(window).locator(".cm-content").first().click();
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.type(" In knots.");
    await requests.clear();
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await expect(shownLayer(window).locator("article h1")).toHaveText(NEED.title);
    await expect
      .poll(async () => (await running.cli(["element", "get", SPEED.id])).stdout)
      .toContain("In knots.");
    await quiet(requests);
    // The save of leaving SPEED is a change, but of the switch: SECOND is read once more and stays drawn.
    expect(await hiddenViews(window)).toEqual(
      expect.arrayContaining([`SR-0000b1 ${SPEED.title}`, `SR-0000b2 ${SECOND.title}`]),
    );
    expect(naming(await requests.sent(), SECOND.id).map((request) => request.name)).toContain("element.get");
    await requests.clear();
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    await expect(shownLayer(window).locator("article h1")).toHaveText(SECOND.title);
    expect(naming(await requests.sent(), SECOND.id)).toEqual([]);
  });

  test("[SR-212/AK-tfck] after an own save in the shown element, a neighbour is no longer drawn in advance and not read until the next switch", async () => {
    const { window } = running;
    await open(window, NEED.title);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`N-0000a1 ${NEED.title}`);
    await quiet(requests);
    await shownLayer(window).locator(".cm-content").first().click();
    await window.keyboard.press("ControlOrMeta+End");
    await requests.clear();
    await window.keyboard.type(" In gusts.");
    // The autosave writes it: a change of the workspace, not of a switch.
    await expect
      .poll(async () => (await running.cli(["element", "get", SPEED.id])).stdout)
      .toContain("In gusts.");
    await expect.poll(() => hiddenViews(window)).not.toContain(`N-0000a1 ${NEED.title}`);
    await quiet(requests);
    expect(naming(await requests.sent(), NEED.id)).toEqual([]);
    // The switch reads and draws it, as a buffer not drawn in advance.
    await window.keyboard.press("Alt+KeyP");
    await expect(shownLayer(window).locator("article h1")).toHaveText(NEED.title);
    expect(naming(await requests.sent(), NEED.id).map((request) => request.name)).toContain("element.get");
    // Its own neighbours are drawn in advance again after this switch.
    await expect.poll(() => hiddenViews(window)).toContain(`SR-0000b1 ${SPEED.title}`);
  });

  test("[SR-212/AK-tfck] an element drawn in advance and changed outside is no longer drawn in advance, not read in the background, and read at the switch with the highlight of a fresh open", async () => {
    const { window } = running;
    await open(window, NEED.title);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`N-0000a1 ${NEED.title}`);
    await quiet(requests);
    await requests.clear();
    await retitle(running, "See the gusts");
    // Dropped from the buffers drawn in advance, and not read again until a switch.
    await expect.poll(() => hiddenViews(window)).not.toContain(`N-0000a1 ${NEED.title}`);
    await expect(window.locator(".outside-change")).toHaveCount(0);
    await quiet(requests);
    expect(naming(await requests.sent(), NEED.id)).toEqual([]);
    // The switch reads and draws it, as a buffer not drawn in advance.
    await window.keyboard.press("Alt+KeyP");
    await expect(shownLayer(window).locator("article h1")).toHaveText("See the gusts");
    expect(naming(await requests.sent(), NEED.id).map((request) => request.name)).toContain("element.get");
    const drawnAhead = await highlighted(window);
    expect(drawnAhead).toEqual(["Title"]);
    // Its own neighbours are drawn in advance again after this switch.
    await expect.poll(() => hiddenViews(window)).toContain(`SR-0000b1 ${SPEED.title}`);
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

  test("[SR-212/AK-tfck] a package page left drawn stays drawn with its elements, sends no request in the background, and slides in at once", async () => {
    const { window } = running;
    await open(window, SENSORS.title);
    await expect(shownLayer(window).locator(".members .row").first()).toBeVisible();
    await quiet(requests);
    await requests.clear();
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`PKG-0000d1 ${SENSORS.title}`);
    await expect(
      window.locator('[data-area][data-active] > [data-layer="neighbour"] .members .row').first(),
    ).toBeAttached();
    await quiet(requests);
    expect(naming(await requests.sent(), SENSORS.id)).toEqual([]);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    await expect(shownLayer(window).locator(".members .row").first()).toBeVisible();
    expect(naming(await requests.sent(), SENSORS.id)).toEqual([]);
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

  test("[SR-212/AK-tfck] a list left and returned without a change slides in at once, with no request for it from leaving to returning", async () => {
    const { window } = running;
    await listAll(window);
    await expect(shownLayer(window).locator(".package-summary")).toBeVisible();
    await quiet(requests);
    await open(window, NEED.title);
    await expect.poll(() => hiddenViews(window)).toContain("All elements");
    await requests.clear();
    await quiet(requests);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    await expect(shownLayer(window).locator('[aria-label="All elements"]')).toBeVisible();
    await expect(shownLayer(window).locator(".row")).toHaveCount(14);
    expect(listReads(await requests.sent())).toEqual([]);
    await expect(shownLayer(window).locator("[data-buffer]")).toBeFocused();
  });

  test("[SR-212/AK-tfck] after an own save a list is no longer drawn in advance and not read; after a change from outside it slides in once drawn, current", async () => {
    const { window } = running;
    await listAll(window);
    await quiet(requests);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain("All elements");
    await quiet(requests);
    await requests.clear();
    // An own save: the autosave of typed text.
    await shownLayer(window).locator(".cm-content").first().click();
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.type(" Gusts.");
    await expect
      .poll(async () => (await running.cli(["element", "get", SPEED.id])).stdout)
      .toContain("Gusts.");
    await expect.poll(() => hiddenViews(window)).not.toContain("All elements");
    await quiet(requests);
    expect(listReads(await requests.sent())).toEqual([]);
    // Shown again and left, then changed outside: dropped, not read until the switch, which waits for its draw.
    await window.keyboard.press("Alt+KeyP");
    await expect(shownLayer(window).locator(".row").first()).toBeVisible();
    await quiet(requests);
    await window.keyboard.press("Alt+KeyN");
    await expect(shownLayer(window).locator("article h1")).toHaveText(SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain("All elements");
    await quiet(requests);
    await requests.clear();
    await retitle(running, "See the gusts");
    await expect.poll(() => hiddenViews(window)).not.toContain("All elements");
    await quiet(requests);
    expect(listReads(await requests.sent())).toEqual([]);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(false);
    await expect(shownLayer(window).locator(".row .title").filter({ hasText: "See the gusts" })).toHaveCount(
      1,
    );
    expect(listReads(await requests.sent())).not.toEqual([]);
  });

  test("[SR-212/AK-tfck] a list left with input still to save is drawn at the switch: typed, then Alt+P at once", async () => {
    const { window } = running;
    await listAll(window);
    await quiet(requests);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain("All elements");
    await quiet(requests);
    await shownLayer(window).locator(".cm-content").first().click();
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.type(" At once.");
    await requests.clear();
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(false);
    await expect(shownLayer(window).locator('[aria-label="All elements"]')).toBeVisible();
    expect(listReads(await requests.sent())).not.toEqual([]);
    await expect
      .poll(async () => (await running.cli(["element", "get", SPEED.id])).stdout)
      .toContain("At once.");
  });

  test("[SR-212/AK-tfck] the overview, then an element opened from it: the overview is drawn at the switch back, with the element among the recent ones", async () => {
    const { window } = running;
    await quiet(requests);
    await requests.clear();
    await open(window, NEED.title);
    await quiet(requests);
    // Opening the element made it a recent one: what the overview shows changed, so it is not drawn in advance.
    expect(await hiddenViews(window)).not.toContain("Overview");
    // Its counts are not read in the background.
    expect(
      (await requests.sent()).filter(
        (request) => request.name === "element.facets" && JSON.stringify(request.input) === "{}",
      ),
    ).toEqual([]);
    // Drawn at the switch: the window keeps what it read for the overview, so its draw takes no read either.
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await expect(shownLayer(window).locator(".overview .line.recent")).toHaveText([new RegExp(NEED.title)]);
  });

  test("[SR-212/AK-tfck] the matrix left and returned without a change slides in at once, with no request for its rows or relation options", async () => {
    const { window } = running;
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+T");
    await expect(shownLayer(window).locator("tbody tr").first()).toBeVisible();
    const rows = await shownLayer(window).locator("tbody tr").count();
    await quiet(requests);
    await open(window, NEED.title);
    await expect(hiddenLayer(window).locator("tbody tr")).toHaveCount(rows);
    await requests.clear();
    await quiet(requests);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    await expect(shownLayer(window).locator("tbody tr")).toHaveCount(rows);
    expect(
      (await requests.sent()).filter(({ name }) => name === "trace.matrix" || name === "relation.options"),
    ).toEqual([]);
  });

  test("[SR-212/AK-tfck] a graph left and returned without a change slides in at once, with no request for it", async () => {
    const { window } = running;
    await open(window, NEED.title);
    await command(window, "Show graph");
    await expect(shownLayer(window).locator(".buffer.graph[data-laid-out]")).toBeVisible();
    await quiet(requests);
    await open(window, SPEED.title);
    await expect(hiddenLayer(window).locator(".buffer.graph[data-laid-out]")).toHaveCount(1);
    await requests.clear();
    await quiet(requests);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    await expect(shownLayer(window).locator(".buffer.graph[data-laid-out]")).toBeVisible();
    expect((await requests.sent()).filter(({ name }) => name === "trace.graph")).toEqual([]);
  });

  test("[SR-212/AK-tfck] the overview left for a list and returned slides in at once, with no request for its counts", async () => {
    const { window } = running;
    await quiet(requests);
    await listAll(window);
    await expect(hiddenLayer(window).locator(".overview .line").first()).toBeAttached();
    await requests.clear();
    await quiet(requests);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    await expect(shownLayer(window).locator(".overview .line").first()).toBeVisible();
    expect(
      (await requests.sent()).filter(
        (request) => request.name === "element.facets" && JSON.stringify(request.input) === "{}",
      ),
    ).toEqual([]);
  });

  test("[SR-212/AK-tfck] a list and a graph walked past and back are not read while away, and the switch to them waits for the draw", async () => {
    const { window } = running;
    await listAll(window);
    await open(window, NEED.title);
    await command(window, "Show graph");
    await expect(shownLayer(window).locator(".buffer.graph[data-laid-out]")).toBeVisible();
    await open(window, SPEED.title);
    await open(window, SECOND.title);
    await quiet(requests);
    await requests.clear();
    // Back through the walk: Measure wind speed, then the graph, which left the side of the shown buffer.
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await expect(shownLayer(window).locator("article h1")).toHaveText(SPEED.title);
    await quiet(requests);
    expect((await requests.sent()).filter((request) => request.name === "trace.graph")).toEqual([]);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(false);
    await expect(shownLayer(window).locator(".buffer.graph[data-laid-out]")).toBeVisible();
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await expect(shownLayer(window).locator("article h1")).toHaveText(NEED.title);
    await quiet(requests);
    expect(listReads(await requests.sent())).toEqual([]);
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(false);
    await expect(shownLayer(window).locator(".row").first()).toBeVisible();
  });

  test("[SR-212/AK-tfck] a list drawn in advance is dropped without a request when the view, the folded statuses or the size of the window change", async () => {
    const { window } = running;
    await listAll(window);
    await quiet(requests);
    await open(window, NEED.title);
    for (const change of [
      async () => {
        await command(window, "Choose view");
        await expect(window.locator("label.prompt-label")).toHaveText("View");
        await window.keyboard.type("Core");
        await expect(window.locator('.candidates [role="option"]').first()).toContainText("Core");
        await window.keyboard.press("Enter");
      },
      async () => {
        await command(window, "Fold status in lists");
        await window.keyboard.type("Draft");
        await expect(window.locator('.candidates [role="option"]').first()).toContainText("Draft");
        await window.keyboard.press("Enter");
      },
      async () => {
        const size = window.viewportSize() ?? { width: 1200, height: 800 };
        await window.setViewportSize({ width: size.width - 120, height: size.height });
      },
    ]) {
      await expect.poll(() => hiddenViews(window, "left")).toContain("All elements");
      await quiet(requests);
      await requests.clear();
      await change();
      await expect.poll(() => hiddenViews(window, "left")).not.toContain("All elements");
      await quiet(requests);
      expect(listReads(await requests.sent())).toEqual([]);
      // Shown and left again, it is drawn in advance again.
      await window.keyboard.press("Alt+KeyP");
      await expect(shownLayer(window, "left").locator(".row").first()).toBeVisible();
      await quiet(requests);
      await window.keyboard.press("Alt+KeyN");
      await expect(shownLayer(window, "left").locator("article h1")).toHaveText(NEED.title);
    }
  });

  test("[SR-212/AK-tfck] a neighbourhood drawn in advance is not read again after a change of the view", async () => {
    const { window } = running;
    await open(window, NEED.title);
    await command(window, "Show neighbourhood");
    await expect(shownLayer(window).locator(".neighbourhood .row").first()).toBeVisible();
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`Neighbourhood: N-0000a1 ${NEED.title}`);
    await quiet(requests);
    await requests.clear();
    await command(window, "Choose view");
    await window.keyboard.type("Core");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Core");
    await window.keyboard.press("Enter");
    await expect.poll(() => hiddenViews(window)).not.toContain(`Neighbourhood: N-0000a1 ${NEED.title}`);
    await quiet(requests);
    expect(
      naming(await requests.sent(), NEED.id).filter((request) => request.name === "trace.neighbourhood"),
    ).toEqual([]);
  });

  test("[SR-212/AK-tfck] a change while a swipe shows its target holds the target as drawn; the switch slides at once and draws it anew after the slide", async () => {
    const { window } = running;
    await open(window, NEED.title);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`N-0000a1 ${NEED.title}`);
    await quiet(requests);
    await recordMotions(window);
    const width = await swipeBack(window);
    await expect(peekTitle(window)).toHaveText(NEED.title);
    await requests.clear();
    await retitle(running, "See the gusts");
    // The change reached the window: the overview beside the element, drawn from its record, is dropped.
    await untilSeen(
      window,
      async () => !(await hiddenViews(window)).some((name) => name.startsWith("Overview")),
    );
    await expect(peekTitle(window)).toHaveText(NEED.title);
    await quiet(requests);
    expect(gets(await requests.sent(), NEED.id)).toEqual([]);
    // Past a third: the slide starts straight after the pause of the release, not after the deadline of 1 s.
    await window.mouse.wheel(-0.6 * width, 0);
    await window.clock.runFor(SEGMENT_GAP_MS);
    expect(await motionsMade(window)).toContain("buffer-slide");
    await window.clock.resume();
    await slideSettled(window);
    // After the slide it is drawn anew, as every shown buffer after a change: one read.
    await expect(shownLayer(window).locator("article h1")).toHaveText("See the gusts");
    await quiet(requests);
    expect(
      naming(await requests.sent(), NEED.id).filter((request) => request.name === "element.get"),
    ).toHaveLength(1);
  });

  test("[SR-212/AK-tfck] a change during a swipe that springs back: the target is no longer drawn in advance until the next switch, and read at it", async () => {
    const { window } = running;
    await open(window, NEED.title);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`N-0000a1 ${NEED.title}`);
    await quiet(requests);
    const width = await swipeBack(window);
    await requests.clear();
    await retitle(running, "See the gusts");
    await untilSeen(
      window,
      async () => !(await hiddenViews(window)).some((name) => name.startsWith("Overview")),
    );
    await quiet(requests);
    expect(gets(await requests.sent(), NEED.id)).toEqual([]);
    await window.mouse.wheel(-0.1 * width, 0);
    await expect(peekTitle(window)).toHaveText(NEED.title);
    await window.clock.runFor(SEGMENT_GAP_MS + 200);
    await window.clock.resume();
    await expect(window.locator("[data-area][data-active] > [data-peek]")).toHaveCount(0);
    await expect(shownLayer(window).locator("article h1")).toHaveText(SPEED.title);
    await expect.poll(() => hiddenViews(window)).not.toContain(`N-0000a1 ${NEED.title}`);
    await quiet(requests);
    expect(gets(await requests.sent(), NEED.id)).toEqual([]);
    await window.keyboard.press("Alt+KeyP");
    await expect(shownLayer(window).locator("article h1")).toHaveText("See the gusts");
    expect(naming(await requests.sent(), NEED.id).map((request) => request.name)).toContain("element.get");
  });

  test("[SR-212/AK-tfck] a change of the shown element during a swipe redraws it, while the target stays as drawn", async () => {
    const { window } = running;
    await open(window, NEED.title);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`N-0000a1 ${NEED.title}`);
    await quiet(requests);
    await swipeBack(window);
    await requests.clear();
    await retitleFile(running, "requirements/SR-0000000000b1.md", "Measure gusts");
    await untilSeen(
      window,
      async () => (await shownLayer(window).locator("article h1").textContent()) === "Measure gusts",
    );
    await expect(peekTitle(window)).toHaveText(NEED.title);
    await quiet(requests);
    expect(naming(await requests.sent(), NEED.id)).toEqual([]);
    await window.clock.runFor(SEGMENT_GAP_MS + 200);
    await window.clock.resume();
  });

  test("[SR-212/AK-tfck] a key during the slide of a switch after a change ends the hold: the target is read again once", async () => {
    const { window } = running;
    await open(window, NEED.title);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`N-0000a1 ${NEED.title}`);
    await quiet(requests);
    // The slide stands still where it starts until the key ends it (SR-212 AK2).
    await recordMotions(window, ["buffer-slide"]);
    const width = await swipeBack(window);
    await requests.clear();
    await retitle(running, "See the gusts");
    await untilSeen(
      window,
      async () => !(await hiddenViews(window)).some((name) => name.startsWith("Overview")),
    );
    await window.mouse.wheel(-0.6 * width, 0);
    await window.clock.runFor(SEGMENT_GAP_MS);
    expect(await sliding(window)).toBe(true);
    await expect(shownLayer(window).locator("article h1")).toHaveText(NEED.title);
    await window.keyboard.press("ArrowDown");
    await window.clock.resume();
    expect(await sliding(window)).toBe(false);
    await expect(shownLayer(window).locator("article h1")).toHaveText("See the gusts");
    await quiet(requests);
    expect(
      naming(await requests.sent(), NEED.id).filter((request) => request.name === "element.get"),
    ).toHaveLength(1);
  });

  test("[SR-212/AK-tfck] a swipe the other way during a spring-back ends the hold: the target shown later reads its changes", async () => {
    const { window } = running;
    await open(window, NEED.title);
    await open(window, SPEED.title);
    await expect.poll(() => hiddenViews(window)).toContain(`N-0000a1 ${NEED.title}`);
    await quiet(requests);
    // The spring-back stands still, so the next swipe comes during it.
    await recordMotions(window, ["buffer-spring"]);
    const width = await swipeBack(window);
    await retitle(running, "See the gusts");
    await untilSeen(
      window,
      async () => !(await hiddenViews(window)).some((name) => name.startsWith("Overview")),
    );
    await window.mouse.wheel(-0.1 * width, 0);
    await window.clock.runFor(SEGMENT_GAP_MS + 200);
    expect(await motionsMade(window)).toContain("buffer-spring");
    // A swipe toward Next buffer (the overview, dropped by the change) ends at once by a key, before its target
    // is drawn: the drag it starts ends the spring-back, whose end then calls nothing back.
    const springAtKey = await window.evaluate(() => {
      const area = document.querySelector<HTMLElement>("[data-area][data-active]");
      const box = area?.getBoundingClientRect();
      const x = (box?.left ?? 0) + (box?.width ?? 0) / 2;
      const y = (box?.top ?? 0) + (box?.height ?? 0) / 2;
      const under = document.elementFromPoint(x, y) ?? document.body;
      under.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 20, clientX: x, clientY: y }),
      );
      // The drag of the new swipe started: it ended the spring-back.
      const [spring] = (window as unknown as { motions: Motions }).motions.paused;
      const state = spring?.playState;
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
      return state;
    });
    expect(springAtKey).toBe("idle");
    await playMotions(window);
    await window.clock.resume();
    await expect(window.locator("[data-area][data-active] > [data-peek]")).toHaveCount(0);
    await expect(shownLayer(window).locator("article h1")).toHaveText(SPEED.title);
    // Shown without a slide, the need reads as every shown buffer: its change, and the next one. It is picked
    // among the open buffers by its ID, whose name still has the old title: core's search index is carried over
    // the change in the background (`search-state.ts` of core), which this test does not wait for.
    await goTo(window);
    await expect(window.locator("#prompt-input")).toBeFocused();
    await window.keyboard.type("N-0000a1");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("N-0000a1");
    await window.keyboard.press("Enter");
    await expect(shownLayer(window).locator("article h1")).toHaveText("See the gusts");
    await retitle(running, "See the storm");
    await expect(shownLayer(window).locator("article h1")).toHaveText("See the storm");
  });
});

/** The reads of a list: its rows, their verification and its coverage line (the elements of a package page aside). */
const listReads = (sent: readonly CoreRequest[]): CoreRequest[] =>
  sent.filter(
    (request) =>
      ["element.list", "evidence.coverage", "evidence.degree"].includes(request.name) &&
      // Not the reads of a prompt (the variants of "Choose view") or of one element.
      !/"ids"|packages|variant/u.test(JSON.stringify(request.input)),
  );

/** 300 needs more than the fixture has, so the list of all elements is longer than a page (200 rows). */
const MANY = Object.fromEntries(
  Array.from({ length: 300 }, (_, at) => {
    const hex = (0x100000000000 + at).toString(16);
    return [
      `needs/N-${hex}.md`,
      `---\nid: 69069069-0000-4000-8000-${hex}\ntype: need\nstatus: draft\ntitle: Need ${String(at)}\n---\n\nText.\n`,
    ];
  }),
);

test.describe("a long list drawn in advance", () => {
  let running: RunningApp;
  let requests: CoreRequests;

  test.beforeEach(async () => {
    running = await launchApp({ ...FIXTURE, files: MANY }, { colorScheme: "light" });
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await expect(shownLayer(window).locator(".overview .line").first()).toBeVisible();
    requests = await recordRequests(window);
  });

  test.afterEach(async () => {
    await running.close();
  });

  /** Moves the cursor of the shown list to its last row with the keys, past its first page (200 rows). */
  const toLast = async (window: Page): Promise<void> => {
    await shownLayer(window).locator('[role="listbox"]').focus();
    await window.keyboard.press("End");
    await expect.poll(() => shownLayer(window).locator(".row").count()).toBeGreaterThan(300);
    await window.keyboard.press("End");
    const row = async (): Promise<number> =>
      Number(
        /-(\d+)$/u.exec(
          (await shownLayer(window).locator('[role="listbox"]').getAttribute("aria-activedescendant")) ?? "",
        )?.[1] ?? -1,
      );
    await expect.poll(row).toBeGreaterThan(300);
  };

  test("[SR-212/AK-tfck] a list with its cursor past the first page, also after a change while shown, slides in at once with no request, at that row", async () => {
    const { window } = running;
    await listAll(window);
    await toLast(window);
    // A change while it is shown: it reads its rows again, up to its cursor.
    await retitle(running, "See the gusts");
    await expect(shownLayer(window).locator(".row .title").filter({ hasText: "See the gusts" })).toHaveCount(
      1,
    );
    await quiet(requests);
    // The last option may be the row of the folded statuses (SR-201): the row above it is an element.
    await window.keyboard.press("ArrowUp");
    const selected = await shownLayer(window).locator('[aria-selected="true"]').textContent();
    await window.keyboard.press("Enter");
    await expect(shownLayer(window).locator("article h1")).toBeVisible();
    await expect.poll(() => hiddenViews(window)).toContain("All elements");
    await quiet(requests);
    await requests.clear();
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    await expect(shownLayer(window).locator('[aria-selected="true"]')).toHaveText(selected ?? "");
    await expect(shownLayer(window).locator('[aria-selected="true"]')).toBeInViewport();
    expect(listReads(await requests.sent())).toEqual([]);
  });

  test("[SR-212/AK-tfck] a list scrolled away from its cursor, left and returned shows the position of a fresh draw", async () => {
    const { window } = running;
    await listAll(window);
    const scroller = shownLayer(window).locator(".buffer.list");
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await quiet(requests);
    await open(window, NEED.title);
    await expect.poll(() => hiddenViews(window)).toContain("All elements");
    await quiet(requests);
    await requests.clear();
    expect(await slidesAtOnce(window, "Alt+KeyP")).toBe(true);
    expect(
      await shownLayer(window)
        .locator(".buffer.list")
        .evaluate((element) => element.scrollTop),
    ).toBe(0);
    expect(listReads(await requests.sent())).toEqual([]);
  });
});
