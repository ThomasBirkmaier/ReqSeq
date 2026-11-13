// SR-212 AK1 in the app's part of the performance suite (ADR-0011), on the generated workspace of N-036 with 50,000
// elements and 200,000 relations (testkit, D-055): „… dann gleitet der gezeigte Buffer … und die Bewegung dauert
// höchstens 200 ms.“ The rationale of SR-212 says what the 200 ms bound: „Die 200 ms begrenzen nur die Bewegung. Sie
// beginnt, sobald der neue Buffer vollständig gezeichnet ist, ohne Platzhalter; die Zeit bis dahin begrenzt dieses SR
// nicht.“ So the time until the new buffer is drawn is recorded for comparison, with no limit.
//
// Each kind of buffer is the target of Alt+P and Alt+N several times, and so also the buffer that is left. For each
// switch, in the window: the keydown's `event.timeStamp`, the moment the slide animations are made (the new buffer
// was reported drawn two frames before; the motion's first frame), and the moment they finished. Recorded per kind:
// the slowest input-to-motion (drawn), and the slowest motion against 200 ms.
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
/** SR-212 AK1: the motion. */
const MOTION_MS = 200;
/** The pause after each switch, longer than the reads a buffer asks after it is drawn. */
const SETTLE_SWITCH_MS = 500;
/** How often each buffer is the target of a switch, half with Alt+P and half with Alt+N. */
const ROUNDS = 2;
/** The model cache trusts an entry only when its file is older than 2 s before the load (ADR-0008). */
const SETTLE_MS = 2_100;

type Kind =
  "overview" | "list" | "search" | "element" | "neighbourhood" | "graph" | "metamodel" | "result" | "matrix";

/** Every kind of buffer, each the target of switches. */
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

/** The time until the new buffer is drawn: recorded, for comparison. */
const DRAWN_BASIS = "SR-212 (recorded; the time until the new buffer is drawn has no limit of its own)";

/** One switch as the window saw it, in ms of the window's clock. */
interface Switch {
  readonly shown: string;
  readonly key: number;
  readonly motion: number;
  readonly end?: number;
  /** The longest time between two frames while it slid. */
  readonly gap: number;
}

/** Records every switch from now on, in `window.switches`. */
const record = (window: Page): Promise<void> =>
  window.evaluate(() => {
    const own = window as unknown as { switches: Switch[] };
    own.switches = [];
    let key: number | undefined;
    addEventListener(
      "keydown",
      (event) => {
        if (event.altKey && (event.code === "KeyP" || event.code === "KeyN")) {
          key = event.timeStamp;
        }
      },
      { capture: true },
    );
    const seen = new WeakSet<Animation>();
    new MutationObserver(() => {
      const made = document
        .getAnimations()
        .filter((one) => one.id === "buffer-slide" && !seen.has(one) && one.playState !== "idle");
      const main = made.find(
        (one) =>
          (one.effect as KeyframeEffect | null)?.target instanceof HTMLElement &&
          ((one.effect as KeyframeEffect).target as HTMLElement).dataset["layer"] === "main",
      );
      for (const one of made) {
        seen.add(one);
      }
      if (main === undefined || key === undefined) {
        return;
      }
      const target = (main.effect as KeyframeEffect).target as HTMLElement;
      const entry: { shown: string; key: number; motion: number; end?: number; gap: number } = {
        shown: target.querySelector("[data-buffer]")?.getAttribute("aria-label") ?? "",
        key,
        motion: performance.now(),
        gap: 0,
      };
      own.switches.push(entry);
      // The longest time between two frames of the window while it slides: work of the page during the motion.
      let last = entry.motion;
      const frame = (at: number): void => {
        entry.gap = Math.max(entry.gap, at - last);
        last = at;
        if (entry.end === undefined) {
          requestAnimationFrame(frame);
        }
      };
      requestAnimationFrame(frame);
      main.finished.then(
        () => {
          entry.end = performance.now();
        },
        () => {
          entry.end = Number.NaN;
        },
      );
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["style"] });
  });

const switches = (window: Page): Promise<Switch[]> =>
  window.evaluate(() => (window as unknown as { switches: Switch[] }).switches);

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

/** Waits until the shown buffer is no longer `before` and has drawn; gives its name. */
const opened = async (window: Page, before: string): Promise<string> => {
  await expect.poll(() => shownName(window), { timeout: 60_000 }).not.toBe(before);
  return shownName(window);
};

/** Presses `key` and waits until its switch ended; gives it. */
const switchOnce = async (window: Page, key: "Alt+KeyP" | "Alt+KeyN"): Promise<Switch> => {
  const count = (await switches(window)).length;
  await window.keyboard.press(key);
  await expect
    .poll(async () => (await switches(window))[count]?.end !== undefined, {
      timeout: 60_000,
      message: `no motion after ${key}`,
    })
    .toBe(true);
  const made = (await switches(window))[count];
  if (made === undefined) {
    throw new Error("no switch recorded");
  }
  // The reads the buffer asks after it is drawn (the line of coverage of a list, the verification of later rows)
  // end before the next key, so each switch is measured on its own and not behind the reads of the one before.
  await window.waitForTimeout(SETTLE_SWITCH_MS);
  return made;
};

/** The ms from a keydown until the first frame with a cell, and until two frames later, after its paint. */
interface Drawn {
  readonly cell: number;
  readonly painted: number;
}

/**
 * Presses `key` and times from its keydown until the first frame in which the active area's live layer shows
 * `name` with a cell of the matrix, and until two frames later: the point at which a slide starts.
 */
const timeDrawn = async (window: Page, key: "Alt+KeyP" | "Alt+KeyN", name: string): Promise<Drawn> => {
  await window.evaluate((shown) => {
    const own = window as unknown as { drawnIn?: Promise<Drawn> };
    own.drawnIn = new Promise((resolve) => {
      addEventListener(
        "keydown",
        (event) => {
          const from = event.timeStamp;
          const frame = (at: number): void => {
            const live = document.querySelector('[data-area][data-active] [data-layer="main"] [data-buffer]');
            if (
              live?.getAttribute("aria-label") === shown &&
              live.querySelector('[role="gridcell"]') !== null
            ) {
              requestAnimationFrame(() => {
                requestAnimationFrame((later) => {
                  resolve({ cell: at - from, painted: later - from });
                });
              });
            } else {
              requestAnimationFrame(frame);
            }
          };
          requestAnimationFrame(frame);
        },
        { capture: true, once: true },
      );
    });
  }, name);
  await window.keyboard.press(key);
  return window.evaluate(() => (window as unknown as { drawnIn: Promise<Drawn> }).drawnIn);
};

/** The switches to the matrix `name` and back without the slide (reduced motion): each until the first cell. */
const withoutSlide = async (window: Page, name: string): Promise<Drawn[]> => {
  await window.emulateMedia({ reducedMotion: "reduce" });
  const still: Drawn[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    for (const [away, back] of [
      ["Alt+KeyP", "Alt+KeyN"],
      ["Alt+KeyN", "Alt+KeyP"],
    ] as const) {
      await window.keyboard.press(away);
      await expect.poll(() => shownName(window), { timeout: 60_000 }).not.toBe(name);
      await window.waitForTimeout(SETTLE_SWITCH_MS);
      still.push(await timeDrawn(window, back, name));
    }
  }
  return still;
};

test.describe("the switch to the previous or next buffer with 50,000 elements and 200,000 relations (SR-212, N-036)", () => {
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
    home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-sr-212-app-")));
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  });

  test.afterAll(async () => {
    await running?.close({ discard: true });
    await fixture?.cleanup();
    if (home !== "") {
      await fs.rm(home, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test("[SR-212/AK-d25h] every kind of buffer slides in at most 200 ms once drawn; the time until it is drawn is recorded", async () => {
    test.setTimeout(600_000);
    running = await launchApp(undefined, {
      kept: { home, workspace: { root: fixture?.workspaceRoot ?? "", cleanup: () => Promise.resolve() } },
      validateOutput: false,
    });
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await expect(window.getByLabel("Modeline")).toContainText(`${String(ELEMENTS)} elements`, {
      timeout: 120_000,
    });
    // Open one buffer of each kind; the name of each tells its kind.
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
    const count = kinds.size;
    expect(count).toBe(8);
    // Each drew once, so a switch measures the switch and not the first drawing of the app.
    await window.waitForTimeout(1_000);
    await record(window);
    // Back through all of them and forward again, `ROUNDS` times: each is the target and the left buffer.
    const made: Switch[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      for (const key of ["Alt+KeyP", "Alt+KeyN"] as const) {
        for (let step = 0; step < count; step += 1) {
          made.push(await switchOnce(window, key));
        }
      }
    }
    // The matrix is a mode of the list: Ctrl+T on the list, then around it.
    while ((await shownName(window)) !== [...kinds].find(([, kind]) => kind === "list")?.[0]) {
      await switchOnce(window, "Alt+KeyP");
    }
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator('[role="gridcell"]').first()).toBeVisible({ timeout: 60_000 });
    const matrix = await shownName(window);
    for (let round = 0; round < ROUNDS; round += 1) {
      for (const [away, back] of [
        ["Alt+KeyP", "Alt+KeyN"],
        ["Alt+KeyN", "Alt+KeyP"],
      ] as const) {
        await switchOnce(window, away);
        const again = await switchOnce(window, back);
        expect(again.shown).toBe(matrix);
        made.push({ ...again, shown: `matrix:${again.shown}` });
      }
    }
    // The same switches to the matrix without the slide (reduced motion), for comparison: the time the matrix
    // takes to draw in the app at all, from the keydown to the first frame with a cell in the active area.
    const still = await withoutSlide(window, matrix);
    const kindOf = (one: Switch): Kind =>
      one.shown.startsWith("matrix:") ? "matrix" : (kinds.get(one.shown) ?? "result");
    const recorded: PerfMeasurement[] = [];
    const summary: Record<string, { drawn: number[]; motion: number[]; gap: number[] }> = {};
    for (const kind of KINDS) {
      const of = made.filter((one) => kindOf(one) === kind);
      expect(of.length, `no switch to the ${kind}`).toBeGreaterThan(0);
      const drawn = of.map((one) => one.motion - one.key);
      const motion = of.map((one) => (one.end ?? Number.NaN) - one.motion);
      summary[kind] = { drawn, motion, gap: of.map((one) => one.gap) };
      recorded.push(
        await recordValue(
          `app: Alt+P or Alt+N until the ${kind} is drawn and starts to slide (slowest of ${String(of.length)})`,
          Math.max(...drawn),
          { basis: DRAWN_BASIS },
        ),
      );
      recorded.push(
        await recordValue(
          `app: the slide of the switch to the ${kind}, first frame to end (slowest of ${String(of.length)})`,
          Math.max(...motion),
          { basis: "SR-212 AK1 (the motion; the app)", thresholdMs: MOTION_MS },
        ),
      );
    }
    recorded.push(
      await recordValue(
        `app: Alt+P or Alt+N until the matrix shows its first cell, without the slide (slowest of ${String(still.length)})`,
        Math.max(...still.map((one) => one.cell)),
        { basis: "SR-082 AK4 (the matrix in the app without motion; for comparison)" },
      ),
    );
    recorded.push(
      await recordValue(
        `app: Alt+P or Alt+N until two frames after the matrix shows its first cell, without the slide (slowest of ${String(still.length)})`,
        Math.max(...still.map((one) => one.painted)),
        {
          basis:
            "SR-082 AK4 (the matrix in the app without motion, to where a slide would start; for comparison)",
        },
      ),
    );
    // eslint-disable-next-line no-console -- the numbers are the result of this test, the PR quotes them.
    console.log(`PERF buffer slide ${JSON.stringify({ ...summary, matrixWithoutSlide: still })}`);
    for (const measurement of recorded) {
      if (measurement.thresholdMs !== undefined) {
        expect
          .soft(measurement.ms, thresholdMessage(measurement))
          .toBeLessThanOrEqual(measurement.thresholdMs);
      }
    }
  });
});
