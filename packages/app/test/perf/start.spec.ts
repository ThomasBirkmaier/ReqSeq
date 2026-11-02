// SR-082 in the app's part of the performance suite (ADR-0011, #147), on the generated workspace of N-036 with
// 50,000 elements and 200,000 relations (testkit, D-055), each repository a Git repository:
// - AK2 „Gegeben derselbe Arbeitsbereich ohne Zwischenspeicher, wenn die App startet, dann ist sie nach höchstens
//   30 Sekunden bedienbar.“ The first start, with an empty cache folder.
// - AK1 „Gegeben ein Arbeitsbereich mit 50.000 Elementen und 200.000 Beziehungen und vorhandenem
//   Zwischenspeicher, wenn die App startet, dann ist sie nach höchstens 3 Sekunden bedienbar.“ The second start,
//   with the model cache the first one wrote (ADR-0008).
// - AK5 „Gegeben derselbe Arbeitsbereich, wenn nach dem Start das erste Element geöffnet wird, dann ist es nach
//   höchstens 1 Sekunde sichtbar.“ and AK3 „Gegeben derselbe Arbeitsbereich, in dem seit dem Start bereits ein
//   Element geöffnet wurde, wenn ein Element geöffnet wird, dann ist es nach höchstens 200 ms sichtbar.“ After the
//   second start.
// "bedienbar" (#112, #147): the main view (SR-100) shows the first page of the list and accepts input. The app
// starts with the overview (SR-118 AK4: no list of all elements), so a start runs from the launch of Electron
// until the overview shows its counts of all 50,000 elements, its key Ctrl+K L ("List all elements") was taken
// and the list shows its first row: the time of the person's keystroke included, nothing left out. "sichtbar":
// the element's title and text are rendered, from the keydown of Enter to the frame after the paint.
// Times are taken in the window (`requestAnimationFrame` polling and the keydown's `event.timeStamp`), so
// Playwright's own polling adds nothing. Core runs without the output check of tests (`validateOutput: false`),
// as a user's app does. The core-level measurements of the same criteria stay in
// packages/cli/test/perf/start.test.ts (start over the API, recorded) and packages/core/test/perf/open-filter-chain.test.ts.
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { JSHandle, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { MODEL_CACHE_FILE } from "@reqseq/core";
import type { GeneratedElement, LargeFixtureWorkspace, PerfMeasurement } from "@reqseq/testkit";
import { generateLargeWorkspace, recordValue, thresholdMessage, writeLargeWorkspace } from "@reqseq/testkit";
import type { Kept, RunningApp } from "../support/app.js";
import { launchApp } from "../support/app.js";
import { coreVersion } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-082 AK1: start with the cache. */
const WARM_MS = 3_000;
/** SR-082 AK2: start without the cache. */
const COLD_MS = 30_000;
/** SR-082 AK5: the first open after the start. */
const FIRST_OPEN_MS = 1_000;
/** SR-082 AK3: a later open. */
const OPEN_MS = 200;
/** Later opens, each of another element; their median is the measurement (ADR-0011, `measureMedian`). */
const LATER_OPENS = 5;
/**
 * The model cache trusts an entry only when its file is older than 2 s before the load that wrote the cache
 * (`RACY_MS`, ADR-0008); the test waits that long after writing the files, as for a workspace checked out a while ago.
 */
const SETTLE_MS = 2_100;

/** Wall-clock milliseconds since the epoch, comparable between this process and the window. */
const now = (): number => performance.timeOrigin + performance.now();

/** Every file named `name` below `folder`. */
const findFiles = async (folder: string, name: string): Promise<string[]> => {
  const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name === name).map((e) => path.join(e.parentPath, e.name));
};

/** Waits until a model cache appears below `home` (core writes it in the background after a load). */
const modelCacheBelow = async (home: string, withinMs: number): Promise<string> => {
  const until = Date.now() + withinMs;
  for (;;) {
    const [file] = await findFiles(home, MODEL_CACHE_FILE);
    if (file !== undefined) {
      return file;
    }
    if (Date.now() > until) {
      throw new Error(`no ${MODEL_CACHE_FILE} below ${home} within ${String(withinMs)} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

/** The time a `waitForFunction` below gave when its condition held. */
const timeOf = async (handle: JSHandle<number | false>): Promise<number> => {
  const value = await handle.jsonValue();
  if (value === false) {
    throw new Error("the condition did not hold");
  }
  return value;
};

/** The parts of a start, in ms. */
interface Start {
  /** From the launch until the overview shows its counts of all elements. */
  readonly overview: number;
  /** From the keydown of Ctrl+K until the list of all elements shows its first row. */
  readonly answer: number;
  /** The start: `overview` plus `answer`. */
  readonly usable: number;
}

/**
 * Starts the app on `kept` and times it until it is usable: from the launch until the overview shows the count
 * of every element, plus the answer to Ctrl+K L until the list of all elements shows its first row. Left out is
 * only the time in which the overview stood ready and Playwright had not yet sent the key.
 */
const timeStart = async (kept: Kept): Promise<{ readonly running: RunningApp; readonly start: Start }> => {
  const launched = now();
  const running = await launchApp(undefined, { kept, validateOutput: false });
  const { window } = running;
  // Polled in the window on every frame, so the time is the frame in which the condition first held.
  const overviewAt = await window.waitForFunction(
    (total) => {
      const modeline = document.querySelector('[aria-label="Modeline"]')?.textContent ?? "";
      const overview = document.querySelector('[role="listbox"][aria-label="Overview"] [role="option"]');
      return overview !== null && modeline.includes(`${total} elements`)
        ? performance.timeOrigin + performance.now()
        : false;
    },
    String(ELEMENTS),
    { polling: "raf", timeout: 0 },
  );
  const overview = (await timeOf(overviewAt)) - launched;
  await window.evaluate(() => {
    const w = globalThis as unknown as { __keyAt?: number };
    addEventListener(
      "keydown",
      (event) => {
        w.__keyAt ??= event.timeStamp;
      },
      { capture: true },
    );
  });
  await window.keyboard.press("ControlOrMeta+K");
  await window.keyboard.press("L");
  const answeredIn = await window.waitForFunction(
    (total) => {
      const w = globalThis as unknown as { __keyAt?: number };
      const modeline = document.querySelector('[aria-label="Modeline"]')?.textContent ?? "";
      const row = document.querySelector('[aria-label="Sheet"] .row .title');
      return w.__keyAt !== undefined &&
        row !== null &&
        row.textContent !== "" &&
        !modeline.includes("Overview") &&
        modeline.includes(`${total} elements`)
        ? performance.now() - w.__keyAt
        : false;
    },
    String(ELEMENTS),
    { polling: "raf", timeout: 0 },
  );
  const answer = await timeOf(answeredIn);
  return { running, start: { overview, answer, usable: overview + answer } };
};

/**
 * Presses Enter (which opens an element: the selected row of a list, or the first hit of Ctrl+P) and gives the
 * ms from its keydown until the element shows `title` as its title and a text that contains `text`, in the frame
 * after the paint.
 */
const timeOpen = async (window: Page, title: string, text: string): Promise<number> => {
  await window.evaluate(
    ({ title, text }) => {
      const w = globalThis as unknown as { __open?: Promise<number> };
      let start: number | undefined;
      addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Enter" && start === undefined) {
            start = event.timeStamp;
          }
        },
        { capture: true, once: true },
      );
      w.__open = new Promise((resolve) => {
        const check = (): void => {
          const heading = document.querySelector("article h1")?.textContent ?? "";
          const shown = document.querySelector("article .cm-content")?.textContent ?? "";
          if (start !== undefined && heading === title && shown.trim() !== "" && shown.includes(text)) {
            observer.disconnect();
            const from = start;
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve(performance.now() - from);
              });
            });
          }
        };
        const observer = new MutationObserver(check);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      });
    },
    { title, text },
  );
  await window.keyboard.press("Enter");
  return window.evaluate(() => (globalThis as unknown as { __open: Promise<number> }).__open);
};

/** The median of `values`; of an even number the upper of the two middle ones, as `measureMedian` takes it. */
const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

/** Asserts a tagged measurement's threshold, after every measurement of the test was recorded (ADR-0011). */
const assertWithin = (measurement: PerfMeasurement): void => {
  expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(measurement.thresholdMs ?? 0);
};

test.describe("start and open with 50,000 elements and 200,000 relations (SR-082, N-036)", () => {
  let fixture: LargeFixtureWorkspace | undefined;
  let home = "";
  let requirements: GeneratedElement[] = [];
  let running: RunningApp | undefined;
  /** The model cache the first start wrote. */
  let modelCache = "";

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    const generated = generateLargeWorkspace({
      version: await coreVersion(),
      elements: ELEMENTS,
      relations: RELATIONS,
    });
    fixture = await writeLargeWorkspace(generated, { git: true });
    home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-sr-082-app-")));
    // System requirements with a title no other element has: Ctrl+P finds each of them by its title.
    const count = new Map<string, number>();
    for (const element of generated.elements) {
      count.set(element.title, (count.get(element.title) ?? 0) + 1);
    }
    requirements = generated.elements.filter(
      (e) => e.type === "system-requirement" && count.get(e.title) === 1,
    );
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  });

  test.afterAll(async () => {
    await running?.close({ discard: true });
    await fixture?.cleanup();
    if (home !== "") {
      await fs.rm(home, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  const kept = (): Kept => ({
    home,
    workspace: { root: fixture?.workspaceRoot ?? "", cleanup: () => Promise.resolve() },
  });

  /** Records the parts of a start; gives the measurement of the whole start. */
  const recordStart = async (start: Start, cache: string, criterion: string, thresholdMs: number) => {
    await recordValue(`app: start until the overview shows all elements (${cache})`, start.overview, {
      basis: `SR-082 ${criterion} (part of the start; recorded)`,
    });
    await recordValue(
      `app: Ctrl+K L until the list of all elements shows its first page (${cache})`,
      start.answer,
      {
        basis: `SR-082 ${criterion} (part of the start; recorded)`,
      },
    );
    return recordValue(
      `app: start until usable, the overview plus Ctrl+K L until the list shows its first page (${cache})`,
      start.usable,
      { basis: `SR-082 ${criterion} (start ${cache}; the app, #147)`, thresholdMs },
    );
  };

  test("[SR-082/AK2] the app is usable within 30 s without the cache", async () => {
    test.setTimeout(300_000);
    const { running: started, start } = await timeStart(kept());
    running = started;
    const measurement = await recordStart(start, "no cache", "AK2", COLD_MS);
    // The first start writes the model cache for the next one.
    modelCache = await modelCacheBelow(home, 120_000);
    await running.close({ keep: true });
    running = undefined;
    assertWithin(measurement);
  });

  test("[SR-082/AK1] [SR-082/AK5] [SR-082/AK3] the app is usable within 3 s with the cache, shows the first element within 1 s and later ones within 200 ms", async () => {
    test.setTimeout(300_000);
    // Run alone (`-g AK1`), the test starts once without the cache first, as the AK2 test does.
    if (modelCache === "") {
      const { running: first } = await timeStart(kept());
      modelCache = await modelCacheBelow(home, 120_000);
      await first.close({ keep: true });
    }
    expect(existsSync(modelCache), `no model cache at ${modelCache}`).toBe(true);
    const written = (await fs.stat(modelCache)).mtimeMs;
    const { running: started, start } = await timeStart(kept());
    running = started;
    const { window } = running;
    const warm = await recordStart(start, "with cache", "AK1", WARM_MS);

    // AK5, then AK3: system requirements, each opened through Ctrl+P and timed from Enter. The first is the top
    // requirement of the generated tree, which has the longest parents line (#698); its text starts with
    // "The station shall <title>" (testkit), so the text of the element before does not count.
    const targets = requirements.slice(0, 1 + LATER_OPENS);
    expect(targets).toHaveLength(1 + LATER_OPENS);
    const times: number[] = [];
    for (const target of targets) {
      await window.keyboard.press("ControlOrMeta+P");
      await window.keyboard.type(target.title);
      // Until the hits are there: not part of the timed span.
      await expect(window.locator('.candidates [role="option"]').first()).toContainText(target.title, {
        timeout: 60_000,
      });
      times.push(await timeOpen(window, target.title, `The station shall ${target.title.toLowerCase()}`));
    }
    const [firstMs = Number.NaN, ...laterMs] = times;
    const first = await recordValue(
      "app: first element opened after the start through Ctrl+P, Enter until title and text are shown",
      firstMs,
      { basis: "SR-082 AK5 (the first open after the start; the app, #147)", thresholdMs: FIRST_OPEN_MS },
    );
    const later = await recordValue(
      `app: later element opened through Ctrl+P, Enter until title and text are shown (median of ${String(LATER_OPENS)})`,
      median(laterMs),
      { basis: "SR-082 AK3 (an open after the first; the app, #147)", thresholdMs: OPEN_MS },
    );
    await recordValue(
      `app: later element opened through Ctrl+P, Enter until title and text are shown (slowest of ${String(LATER_OPENS)})`,
      Math.max(...laterMs),
      { basis: "SR-082 AK3 (recorded)" },
    );
    // Every model cache entry was reused: the second start did not write the cache again.
    expect((await fs.stat(modelCache)).mtimeMs).toBe(written);
    // eslint-disable-next-line no-console -- the numbers are the result of this test, the PR quotes them.
    console.log(`PERF app start and open ${JSON.stringify({ start, opens: times })}`);
    assertWithin(warm);
    assertWithin(first);
    assertWithin(later);
  });
});
