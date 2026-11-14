// SR-211 AK1, AK2 and AK4 in the app's part of the performance suite (ADR-0011), on the generated workspace of N-036
// with 50,000 elements and 200,000 relations (testkit, D-055): past a third „… und der Wechsel ist nach höchstens
// 200 ms beendet“, at a third or less „… dann gleitet der Buffer in höchstens 200 ms an seinen Platz zurück“. The
// time counts from the swipe's last wheel event, the only sign of its end the app gets.
//
// Each kind of buffer is the target of a swipe toward Previous and toward Next several times, and so also the buffer
// that is left. Before each switch a swipe of a quarter of the width toward the same target springs back. The swipes
// go as wheel events dispatched in the window, one per frame as a trackpad sends them (CDP input from the runner came
// with gaps of 40 ms and more under load, longer than the pause that ends a swipe): small steps until the target
// joins the shown buffer at its edge (it is drawn), then steps of 40 px. In the window: each wheel event's
// `timeStamp`, the moment the target joins, the moment the slide or spring-back animations are made, and the moment
// they finished. Every run is kept; a run with a gap of 30 ms or more between two events (a stalled frame, so the
// swipe may have ended early) is counted in a row of its own. A swipe that split into two (its slide or spring-back
// started before its last event, or the rest of it ended that motion) has no time: the row of its kind names the
// splits (and fails when every swipe of it split), and the row of their count, with a threshold of 0 and the largest
// event gap of those swipes, fails the test.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { LargeFixtureWorkspace, PerfMeasurement } from "@reqseq/testkit";
import { generateLargeWorkspace, recordValue, thresholdMessage, writeLargeWorkspace } from "@reqseq/testkit";
import type { RunningApp } from "../support/app.js";
import { launchApp } from "../support/app.js";
import { coreVersion } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-211 AK1, AK2, AK4: from the end of the swipe. */
const LIMIT_MS = 200;
/** The pause after each swipe, longer than the reads a buffer asks after it is drawn. */
const SETTLE_SWITCH_MS = 500;
/** How often each buffer is the target, half toward Previous and half toward Next. */
const ROUNDS = 2;
/** The model cache trusts an entry only when its file is older than 2 s before the load (ADR-0008). */
const SETTLE_MS = 2_100;
/** A gap between two events of a swipe from which on the run may have split it. */
const STALL_MS = 30;
/** The step of a swipe once its target is drawn, and before (a slow start, as on a trackpad). */
const STEP_PX = 40;
const START_PX = 2;

type Kind =
  "overview" | "list" | "search" | "element" | "neighbourhood" | "graph" | "metamodel" | "result" | "matrix";

const KINDS: readonly Kind[] = [
  "overview",
  "list",
  "search",
  "element",
  "neighbourhood",
  "graph",
  "metamodel",
  "result",
  "matrix",
];

const COMPARE = "SR-211 (recorded for comparison)";

/** One swipe as the window saw it, in ms of the window's clock. */
interface Run {
  readonly target: string;
  readonly first: number;
  readonly joined: number;
  readonly last: number;
  readonly gap: number;
  /** The longest time between two frames from the first event to the release. */
  readonly frame: number;
  /** The longest time between two frames in the 400 ms before the swipe: the page's own work. */
  readonly idle: number;
  /** The longest time the app's wheel handler took for one event (with the style and layout it forced). */
  readonly handler: number;
  readonly motion?: number;
  readonly end?: number;
}

/** Records wheel events, the frames, and the slide's and spring-back's animations, in `window.swipeLog`. */
const record = (window: Page): Promise<void> =>
  window.evaluate(() => {
    const own = window as unknown as {
      swipeLog: {
        wheels: number[];
        prevented: number;
        frames: number[];
        made: { id: string; at: number; end?: number }[];
      };
    };
    own.swipeLog = { wheels: [], prevented: 0, frames: [], made: [] };
    // After the sheet's listener: whether the app took the event as a swipe.
    addEventListener("wheel", (event) => {
      if (event.defaultPrevented) {
        own.swipeLog.prevented += 1;
      }
    });
    addEventListener(
      "wheel",
      (event) => {
        own.swipeLog.wheels.push(event.timeStamp);
      },
      { capture: true, passive: true },
    );
    const frame = (at: number): void => {
      own.swipeLog.frames.push(at);
      if (own.swipeLog.frames.length > 4000) {
        own.swipeLog.frames.splice(0, 2000);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with its element below.
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      const made = animate.call(this, frames, options);
      const id = typeof options === "object" ? (options.id ?? "") : "";
      const layer = this instanceof HTMLElement ? this.dataset["layer"] : undefined;
      if ((id === "buffer-slide" && layer === "main") || (id === "buffer-spring" && layer === "main")) {
        const entry: { id: string; at: number; end?: number } = { id, at: performance.now() };
        own.swipeLog.made.push(entry);
        made.finished.then(
          () => {
            entry.end = performance.now();
          },
          () => {
            entry.end = Number.NaN;
          },
        );
      }
      return made;
    };
  });

interface Log {
  readonly wheels: number[];
  prevented: number;
  readonly frames: number[];
  readonly made: { readonly id: string; readonly at: number; readonly end?: number }[];
}

const log = (window: Page): Promise<Log> =>
  window.evaluate(() => (window as unknown as { swipeLog: Log }).swipeLog);

const clearLog = (window: Page): Promise<void> =>
  window.evaluate(() => {
    const { swipeLog } = window as unknown as { swipeLog: Log };
    swipeLog.wheels.length = 0;
    swipeLog.prevented = 0;
    swipeLog.made.length = 0;
  });

const shownName = (window: Page): Promise<string> =>
  window
    .locator('[aria-label="Sheet"] [data-area][data-active] [data-layer="main"] [data-buffer]')
    .getAttribute("aria-label")
    .then((name) => name ?? "");

const command = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(title, {
    timeout: 60_000,
  });
  await window.keyboard.press("Enter");
};

const opened = async (window: Page, before: string): Promise<string> => {
  await expect.poll(() => shownName(window), { timeout: 60_000 }).not.toBe(before);
  return shownName(window);
};

/**
 * One swipe of `fraction` of the area's width in `sign` (-1 toward Previous buffer), after its target is drawn;
 * waits until its slide or spring-back ended.
 */
/**
 * Waits until the page has drawn every frame in time for 300 ms (at most 10 s): the reads a buffer makes after it
 * is shown (the verification of a matrix's rows) end first, so the swipe is measured and not that work.
 */
const calmed = (window: Page): Promise<unknown> =>
  window.evaluate(
    (stall) =>
      new Promise((resolve) => {
        const since = performance.now();
        let calm = since;
        let last = since;
        const frame = (at: number): void => {
          if (at - last >= stall) {
            calm = at;
          }
          last = at;
          if (at - calm >= 300 || at - since >= 10_000) {
            resolve(undefined);
          } else {
            requestAnimationFrame(frame);
          }
        };
        requestAnimationFrame(frame);
      }),
    STALL_MS,
  );

const swipe = async (window: Page, sign: -1 | 1, fraction: number): Promise<Run | undefined> => {
  const box = await window.locator("[data-area][data-active]").boundingBox();
  if (box === null) {
    throw new Error("no area");
  }
  await calmed(window);
  await clearLog(window);
  const sent = await window.evaluate(
    ({ sign, distance, start, step, x, y }) =>
      new Promise<{
        readonly target?: string;
        readonly joined: number;
        readonly handler: number;
        readonly ignored: boolean;
      }>((resolve) => {
        const hit = document.elementFromPoint(x, y) ?? document.body;
        const fire = (dx: number): boolean => {
          const event = new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaX: dx,
            clientX: x,
            clientY: y,
          });
          const before = performance.now();
          hit.dispatchEvent(event);
          handler = Math.max(handler, performance.now() - before);
          return event.defaultPrevented;
        };
        let handler = 0;
        let count = 0;
        let prevented = 0;
        let gone = 0;
        let target: string | undefined;
        let joined = 0;
        const frame = (): void => {
          if (target === undefined) {
            target = document.querySelector<HTMLElement>("[data-area][data-active] > [data-peek]")?.dataset[
              "key"
            ];
            joined = performance.now();
          }
          if (target === undefined) {
            prevented += fire(sign * start) ? 1 : 0;
            count += 1;
            if ((count === 40 && prevented === 0) || count > 3000) {
              resolve({ joined, handler, ignored: prevented === 0 });
              return;
            }
          } else if (gone < distance) {
            fire(sign * step);
            gone += step;
          } else {
            resolve({ target, joined, handler, ignored: false });
            return;
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    {
      sign,
      distance: fraction * box.width,
      start: START_PX,
      step: STEP_PX,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    },
  );
  // Content under the pointer that scrolls sideways first takes the swipe (AK5): no run from this buffer.
  if (sent.ignored) {
    await window.waitForTimeout(SETTLE_SWITCH_MS);
    return undefined;
  }
  const { target, joined } = sent;
  if (target === undefined) {
    throw new Error(`the target of the swipe from ${await shownName(window)} was never drawn`);
  }
  await expect
    .poll(async () => (await log(window)).made.some((one) => one.end !== undefined), {
      timeout: 60_000,
      message: "no slide or spring-back after the swipe",
    })
    .toBe(true);
  const { wheels, frames, made } = await log(window);
  const first = wheels[0] ?? 0;
  const last = wheels.at(-1) ?? 0;
  const gaps = wheels.slice(1).map((time, index) => time - (wheels[index] ?? time));
  const during = frames.filter((time) => time >= first && time <= last);
  const quiet = frames.filter((time) => time >= first - 400 && time < first);
  const idleGaps = quiet.slice(1).map((time, index) => time - (quiet[index] ?? time));
  const frameGaps = during.slice(1).map((time, index) => time - (during[index] ?? time));
  const motion = made[0];
  await window.waitForTimeout(SETTLE_SWITCH_MS);
  return {
    target,
    first,
    joined,
    last,
    gap: Math.max(0, ...gaps),
    frame: Math.max(0, ...frameGaps),
    idle: Math.max(0, ...idleGaps),
    handler: sent.handler,
    ...(motion === undefined ? {} : { motion: motion.at, end: motion.end ?? Number.NaN }),
  };
};

/** Opens one buffer of each kind, as `buffer-slide.spec.ts` does; the name of each tells its kind. */
const openKinds = async (window: Page): Promise<{ kinds: Map<string, Kind>; element: string }> => {
  const kinds = new Map<string, Kind>();
  kinds.set(await shownName(window), "overview");
  let name = await shownName(window);
  await command(window, "List all elements");
  name = await opened(window, name);
  kinds.set(name, "list");
  await window.keyboard.press("ControlOrMeta+Shift+F");
  await window.keyboard.type("station");
  await window.keyboard.press("Enter");
  name = await opened(window, name);
  kinds.set(name, "search");
  await window.locator('[aria-label="Sheet"] .row').first().click({ timeout: 60_000 });
  name = await opened(window, name);
  kinds.set(name, "element");
  const element = name;
  await window.keyboard.press("ControlOrMeta+J");
  name = await opened(window, name);
  kinds.set(name, "neighbourhood");
  await window.keyboard.press("ControlOrMeta+J");
  name = await opened(window, name);
  expect(name).toBe(element);
  await window.keyboard.press("ControlOrMeta+Shift+G");
  name = await opened(window, name);
  kinds.set(name, "graph");
  await command(window, "Show metamodel");
  name = await opened(window, name);
  kinds.set(name, "metamodel");
  await command(window, "Show workspace status");
  name = await opened(window, name);
  kinds.set(name, "result");
  return { kinds, element };
};

/**
 * From the element `element` with unsaved input, swipes to Previous buffer: the target drawn from its record
 * slides at once, as the swipe showed it (SR-212 AK5).
 */
const fromUnsaved = async (window: Page, element: string): Promise<Run[]> => {
  while ((await shownName(window)) !== element) {
    await window.keyboard.press("Alt+KeyP");
    await window.waitForTimeout(SETTLE_SWITCH_MS);
  }
  const unsaved: Run[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    await window.locator('[aria-label="Sheet"] [data-layer="main"] .cm-content').first().click();
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.type(" Gusts");
    const run = await swipe(window, -1, 0.6);
    expect(run).toBeDefined();
    if (run !== undefined) {
      unsaved.push({ ...run, target: await shownName(window) });
    }
    await window.keyboard.press("Alt+KeyN");
    await window.waitForTimeout(SETTLE_SWITCH_MS * 2);
  }
  return unsaved;
};

/** Records the rows of the runs, and gives the summary the PR quotes. */
const report = async (
  kinds: ReadonlyMap<string, Kind>,
  switched: readonly (Run & { readonly way: -1 | 1 })[],
  sprung: readonly Run[],
  unsaved: readonly Run[],
): Promise<PerfMeasurement[]> => {
  const kindOf = (run: Run): Kind => kinds.get(run.target) ?? "result";
  const recorded: PerfMeasurement[] = [];
  const toEnd = (run: Run): number => (run.end ?? Number.NaN) - run.last;
  // A swipe that split: its slide or spring-back started before its last event, or was ended by the rest of it,
  // so it has no end of its motion. It is no time: the row names it, and a row of its own counts it, red.
  const split = (run: Run): boolean => !Number.isFinite(toEnd(run)) || (run.motion ?? run.last) < run.last;
  const slowest = (runs: readonly Run[], of: (run: Run) => number): number =>
    Math.max(0, ...runs.filter((run) => !split(run)).map(of));
  const timed = async (
    name: string,
    runs: readonly Run[],
    options: { readonly basis: string; readonly thresholdMs: number },
  ): Promise<void> => {
    const splits = runs.filter(split);
    const ended = runs.length - splits.length;
    recorded.push(
      await recordValue(
        `${name} (slowest of ${String(ended)}${splits.length > 0 ? `; ${String(splits.length)} split` : ""})`,
        slowest(runs, toEnd),
        ended > 0 ? options : { ...options, failed: "every swipe split" },
      ),
    );
    // The largest gap between the events of a swipe that split tells a stall of the page (over FRAME_WAIT_MS)
    // from a swipe that ended early.
    const gap = Math.round(Math.max(0, ...splits.map((run) => run.gap)));
    recorded.push(
      await recordValue(
        `${name}: swipes that split into two (of ${String(runs.length)}${splits.length > 0 ? `; largest event gap ${String(gap)} ms` : ""})`,
        splits.length,
        { basis: options.basis, thresholdMs: 0, unit: "count" },
      ),
    );
  };
  const summary: Record<string, unknown> = {};
  const all = [...switched, ...sprung, ...unsaved];
  recorded.push(
    await recordValue(
      `app: swipes whose events had a gap of ${String(STALL_MS)} ms or more (of ${String(all.length)}; kept)`,
      all.filter((run) => run.gap >= STALL_MS).length,
      { basis: COMPARE, unit: "count" },
    ),
  );
  for (const kind of KINDS) {
    const to = switched.filter((run) => kindOf(run) === kind);
    const back = sprung.filter((run) => kindOf(run) === kind);
    expect(to.length, `no swipe to the ${kind}`).toBeGreaterThan(0);
    summary[kind] = {
      switch: to.map(toEnd),
      commit: to.map((run) => (run.motion ?? Number.NaN) - run.last),
      spring: back.map(toEnd),
      drawn: back.map((run) => run.joined - run.first),
      frame: [...to, ...back].map((run) => run.frame),
      idle: [...to, ...back].map((run) => run.idle),
      handler: [...to, ...back].map((run) => run.handler),
    };
    for (const sign of [-1, 1] as const) {
      const of = to.filter((run) => run.way === sign);
      if (of.length > 0) {
        await timed(
          `app: swipe ${sign === -1 ? "to Previous" : "to Next"} buffer, last event to the end of the slide to the ${kind}`,
          of,
          { basis: sign === -1 ? "SR-211 AK1" : "SR-211 AK2", thresholdMs: LIMIT_MS },
        );
      }
    }
    recorded.push(
      await recordValue(
        `app: swipe, last event until the slide to the ${kind} starts: pause and commit (slowest of ${String(to.filter((run) => !split(run)).length)})`,
        slowest(to, (run) => (run.motion ?? run.last) - run.last),
        { basis: COMPARE },
      ),
    );
    if (back.length > 0) {
      await timed(
        `app: swipe of a quarter toward the ${kind}, last event to the end of the spring-back`,
        back,
        {
          basis: "SR-211 AK4",
          thresholdMs: LIMIT_MS,
        },
      );
      recorded.push(
        await recordValue(
          `app: swipe toward the ${kind}, first event until it joins at the edge (slowest of ${String(back.length)})`,
          Math.max(...back.map((run) => run.joined - run.first)),
          { basis: COMPARE },
        ),
      );
    }
    recorded.push(
      await recordValue(
        `app: swipe toward the ${kind}, longest frame gap while the buffer follows (slowest of ${String(to.length + back.length)})`,
        Math.max(...[...to, ...back].map((run) => run.frame)),
        { basis: COMPARE },
      ),
    );
  }
  await timed(
    `app: swipe to Previous buffer from an element with unsaved input, last event to the end of the slide`,
    unsaved,
    {
      basis: "SR-211 AK1",
      thresholdMs: LIMIT_MS,
    },
  );
  summary["unsaved"] = unsaved.map(toEnd);
  summary["gaps"] = all.map((run) => run.gap);
  // eslint-disable-next-line no-console -- the numbers are the result of this test, the PR quotes them.
  console.log(`PERF buffer swipe ${JSON.stringify(summary)}`);
  return recorded;
};

test.describe("the swipe that switches the buffer with 50,000 elements and 200,000 relations (SR-211, N-036)", () => {
  let fixture: LargeFixtureWorkspace | undefined;
  let running: RunningApp | undefined;
  let home = "";

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    const generated = generateLargeWorkspace({
      version: await coreVersion(),
      elements: ELEMENTS,
      relations: RELATIONS,
    });
    fixture = await writeLargeWorkspace(generated, { git: true });
    home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-sr-211-app-")));
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  });

  test.afterAll(async () => {
    await running?.close({ discard: true });
    await fixture?.cleanup();
    if (home !== "") {
      await fs.rm(home, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test("[SR-211/AK-tq4d] [SR-211/AK-b2z8] [SR-211/AK-cq0n] every kind of buffer: a swipe past a third has slid in, one of a quarter sprung back, at most 200 ms after the swipe's last event", async () => {
    test.setTimeout(900_000);
    running = await launchApp(undefined, {
      kept: { home, workspace: { root: fixture?.workspaceRoot ?? "", cleanup: () => Promise.resolve() } },
      validateOutput: false,
    });
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await expect(window.getByLabel("Modeline")).toContainText(`${String(ELEMENTS)} elements`, {
      timeout: 120_000,
    });
    const { kinds, element } = await openKinds(window);
    const count = kinds.size;
    expect(count).toBe(8);
    await window.waitForTimeout(1_000);
    await record(window);
    const switched: (Run & { readonly way: -1 | 1 })[] = [];
    const sprung: Run[] = [];
    // The buffers that scroll sideways first, from which the swipe switches with the key instead.
    const scrolling = new Set<string>();
    /** A spring-back toward the next buffer, then the switch to it. */
    const both = async (sign: -1 | 1): Promise<void> => {
      const from = await shownName(window);
      const back = await swipe(window, sign, 0.25);
      if (back === undefined) {
        scrolling.add(from);
        await window.keyboard.press(sign === -1 ? "Alt+KeyP" : "Alt+KeyN");
        await expect.poll(() => shownName(window), { timeout: 60_000 }).not.toBe(from);
        await window.waitForTimeout(SETTLE_SWITCH_MS);
        return;
      }
      expect(await shownName(window)).toBe(from);
      const run = await swipe(window, sign, 0.6);
      expect(run).toBeDefined();
      // Both are named by the buffer switched to, as it is shown now (the matrix is a mode of the list's buffer).
      const target = await shownName(window);
      expect(target).not.toBe(from);
      sprung.push({ ...back, target });
      if (run !== undefined) {
        switched.push({ ...run, target, way: sign });
      }
    };
    for (let round = 0; round < ROUNDS; round += 1) {
      for (const sign of [-1, 1] as const) {
        for (let step = 0; step < count; step += 1) {
          await both(sign);
        }
      }
    }
    // The matrix is a mode of the list: Ctrl+T on the list, then away from it and back.
    const list = [...kinds].find(([, kind]) => kind === "list")?.[0];
    while ((await shownName(window)) !== list) {
      await window.keyboard.press("Alt+KeyP");
      await window.waitForTimeout(SETTLE_SWITCH_MS);
    }
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator('[role="gridcell"]').first()).toBeVisible({ timeout: 60_000 });
    const matrix = await shownName(window);
    kinds.set(matrix, "matrix");
    for (let round = 0; round < ROUNDS; round += 1) {
      for (const sign of [-1, 1] as const) {
        await window.keyboard.press(sign === -1 ? "Alt+KeyP" : "Alt+KeyN");
        await expect.poll(() => shownName(window), { timeout: 60_000 }).not.toBe(matrix);
        await window.waitForTimeout(SETTLE_SWITCH_MS);
        await both(sign === -1 ? 1 : -1);
      }
    }
    const unsaved = await fromUnsaved(window, element);

    // eslint-disable-next-line no-console -- which buffers took the swipe as a sideways scroll (AK5).
    console.log(`PERF buffer swipe scrolls first: ${JSON.stringify([...scrolling])}`);
    const recorded = await report(kinds, switched, sprung, unsaved);
    for (const measurement of recorded.filter((one) => one.thresholdMs !== undefined)) {
      expect.soft(measurement.failed, thresholdMessage(measurement)).toBeUndefined();
      expect
        .soft(measurement.ms, thresholdMessage(measurement))
        .toBeLessThanOrEqual(measurement.thresholdMs ?? 0);
    }
  });
});
