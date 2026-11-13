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
// "bedienbar" (ThomasBirkmaier/ReqSeq-archive#112, #147, assumption of spec question #750): the main view (SR-100) shows the first page of
// the list and accepts input. The app starts with the overview (SR-118 AK4: no list of all elements), so a start
// runs from the launch of Electron until the overview shows its counts of all 50,000 elements, plus the answer to
// Ctrl+K L ("List all elements") from its keydown until the list shows its first row. Playwright's attach does not
// hold the app back: `launchApp` gives Electron's `executablePath`, so Playwright adds no loader that delays
// `ready`, and the times are taken in the window, not when Playwright has connected. Its attach (until
// `launchApp` gives the window) is recorded on its own.
// Perspectives (SR-118 AK6, AK8): the overview counts up to ten after it stands, so the start is measured once more
// with ten perspectives in the workspace, as a comparison value: the start until usable while they are counted, and
// the time until the overview shows all ten counts. Neither is tagged nor asserted.
// "sichtbar": the element's title and text are rendered, from the keydown of Enter to the frame after the paint.
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
import { MODEL_CACHE_FILE, cacheFolder } from "@reqseq/core";
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
/** SR-082 AK3: every later open. */
const OPEN_MS = 200;
/** Later opens, each of another element; the slowest is the measurement of AK3. */
const LATER_OPENS = 5;
/**
 * The model cache trusts an entry only when its file is older than 2 s before the load that wrote the cache
 * (`RACY_MS`, ADR-0008); the test waits that long after writing the files, as for a workspace checked out a while ago.
 */
const SETTLE_MS = 2_100;

/** Wall-clock milliseconds since the epoch, comparable between this process, the main process and the window. */
const now = (): number => performance.timeOrigin + performance.now();

/** Waits until `file` exists (core writes the model cache in the background after a load). */
const appeared = async (file: string, withinMs: number): Promise<void> => {
  const until = Date.now() + withinMs;
  while (!existsSync(file)) {
    if (Date.now() > until) {
      throw new Error(`${file} did not appear within ${String(withinMs)} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

/** Ten perspectives over the generated workspace (SR-118 AK6: the most the overview shows). */
const PERSPECTIVES: Readonly<Record<string, readonly string[]>> = {
  "all-requirements": ["name: All requirements", "where: { type: [system-requirement] }"],
  "draft-requirements": [
    "name: Draft requirements",
    "where: { type: [system-requirement], status: [draft] }",
  ],
  "approved-requirements": [
    "name: Approved requirements",
    "where: { type: [system-requirement], status: [approved] }",
  ],
  "requirements-by-status": [
    "name: Requirements by status",
    "where: { type: [system-requirement] }",
    "group: status",
  ],
  "requirements-by-title": [
    "name: Requirements by title",
    "where: { type: [system-requirement] }",
    "sort: [{ by: title }]",
  ],
  needs: ["name: Needs", "where: { type: [need] }"],
  "draft-needs": ["name: Draft needs", "where: { type: [need], status: [draft] }"],
  decisions: ["name: Decisions", "where: { type: [decision] }"],
  everything: ["name: Everything", "where: { all: [] }"],
  "everything-by-type": ["name: Everything by type", "where: { all: [] }", "group: type"],
};

/** Writes `PERSPECTIVES` into the `perspectives` folder of the main repository `root`. */
const writePerspectives = async (root: string): Promise<void> => {
  const folder = path.join(root, "perspectives");
  await fs.mkdir(folder, { recursive: true });
  for (const [file, lines] of Object.entries(PERSPECTIVES)) {
    await fs.writeFile(
      path.join(folder, `${file}.yaml`),
      ["reqseq-perspective: 1", ...lines, ""].join("\n"),
      "utf8",
    );
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
  /** From the launch until Playwright has attached and `launchApp` gives the window; runs beside the app's start. */
  readonly attach: number;
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
  const attach = now() - launched;
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
  const shown = await timeOf(overviewAt);
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
  const overview = shown - launched;
  return { running, start: { attach, overview, answer, usable: overview + answer } };
};

/**
 * Starts the app on `kept` and gives the ms from the launch until the overview shows a count (or a reason) on each
 * of its `count` perspective lines (SR-118 AK8).
 */
const timeCounts = async (
  kept: Kept,
  count: number,
): Promise<{ readonly running: RunningApp; readonly counted: number }> => {
  const launched = now();
  const running = await launchApp(undefined, { kept, validateOutput: false });
  const countedAt = await running.window.waitForFunction(
    (count) => {
      const lines = [...document.querySelectorAll('[aria-label="Overview"] .line.perspective')];
      return lines.length === count && lines.every((line) => line.querySelector(".count, .reason") !== null)
        ? performance.timeOrigin + performance.now()
        : false;
    },
    count,
    { polling: "raf", timeout: 0 },
  );
  return { running, counted: (await timeOf(countedAt)) - launched };
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

/**
 * Asserts a tagged measurement's threshold, after every measurement of the test was recorded (ADR-0011). Soft, so
 * that one time over its threshold does not hide the others.
 */
const assertWithin = (measurement: PerfMeasurement): void => {
  expect
    .soft(measurement.ms, thresholdMessage(measurement))
    .toBeLessThanOrEqual(measurement.thresholdMs ?? 0);
};

test.describe("start and open with 50,000 elements and 200,000 relations (SR-082, N-036)", () => {
  let fixture: LargeFixtureWorkspace | undefined;
  let home = "";
  let requirements: GeneratedElement[] = [];
  let running: RunningApp | undefined;

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
    await recordValue(
      `app: Playwright's launch and attach until it has the window (${cache})`,
      start.attach,
      {
        basis: `SR-082 ${criterion} (beside the start, not part of it; untagged, threshold for comparison only, #147)`,
        thresholdMs,
      },
    );
    await recordValue(`app: start until the overview shows all elements (${cache})`, start.overview, {
      basis: `SR-082 ${criterion} (part of the start; recorded)`,
    });
    await recordValue(
      `app: Ctrl+K L until the list of all elements shows its first page (${cache})`,
      start.answer,
      { basis: `SR-082 ${criterion} (part of the start; recorded)` },
    );
    return recordValue(
      `app: start until usable, the overview plus Ctrl+K L until the list shows its first page (${cache})`,
      start.usable,
      {
        basis: `SR-082 ${criterion} (start ${cache}; the app, #147)`,
        thresholdMs,
      },
    );
  };

  // One test for all four criteria: Playwright starts a new worker after a failed test, whose `beforeAll` would
  // generate the workspace again, and the second start needs the cache of the first. Every time is recorded
  // before the thresholds are asserted, softly.
  test("[SR-082/AK-r2jc] [SR-082/AK-m65x] [SR-082/AK-csnf] [SR-082/AK-tndr] the app is usable within 30 s without the cache and 3 s with it, shows the first element within 1 s and later ones within 200 ms", async () => {
    test.setTimeout(600_000);
    const root = fixture?.workspaceRoot ?? "";
    const modelCache = path.join(
      cacheFolder(root, {
        platform: process.platform,
        env: { XDG_CACHE_HOME: home, LOCALAPPDATA: home },
        home,
      }),
      MODEL_CACHE_FILE,
    );
    expect(existsSync(modelCache), `a model cache before the first start: ${modelCache}`).toBe(false);
    const { running: cold, start: coldStart } = await timeStart(kept());
    running = cold;
    const coldUsable = await recordStart(coldStart, "no cache", "AK2", COLD_MS);
    // The first start writes the model cache for the next one.
    await appeared(modelCache, 120_000);
    await cold.close({ keep: true });
    running = undefined;

    const written = (await fs.stat(modelCache)).mtimeMs;
    const { running: started, start } = await timeStart(kept());
    running = started;
    const { window } = running;
    const warm = await recordStart(start, "with cache", "AK1", WARM_MS);

    // AK5, then AK3: system requirements, each opened through Ctrl+P and timed from Enter. The first is the top
    // requirement of the generated tree, which has the longest parents line (ThomasBirkmaier/ReqSeq-archive#698); its text starts with
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
      `app: later element opened through Ctrl+P, Enter until title and text are shown (slowest of ${String(LATER_OPENS)})`,
      Math.max(...laterMs),
      { basis: "SR-082 AK3 (every open after the first; the app, #147)", thresholdMs: OPEN_MS },
    );
    await recordValue(
      `app: later element opened through Ctrl+P, Enter until title and text are shown (median of ${String(LATER_OPENS)})`,
      median(laterMs),
      { basis: "SR-082 AK3 (recorded)" },
    );
    // Every model cache entry was reused: the second start did not write the cache again.
    expect((await fs.stat(modelCache)).mtimeMs).toBe(written);

    // The comparison with ten perspectives on the overview (SR-118 AK6, AK8): the start until usable while the
    // overview counts them, and the start until it shows all ten counts.
    await running.close({ keep: true });
    running = undefined;
    await writePerspectives(root);
    const { running: withPerspectives, start: perspectiveStart } = await timeStart(kept());
    running = withPerspectives;
    await recordValue(
      "app: start until usable, the overview plus Ctrl+K L, with ten perspectives on the overview (with cache)",
      perspectiveStart.usable,
      {
        basis: "SR-082 AK1 with SR-118 AK6 (comparison; untagged, threshold for comparison only)",
        thresholdMs: WARM_MS,
      },
    );
    await running.close({ keep: true });
    running = undefined;
    const { running: counting, counted } = await timeCounts(kept(), Object.keys(PERSPECTIVES).length);
    running = counting;
    await recordValue(
      "app: start until the overview shows the counts of ten perspectives (with cache)",
      counted,
      {
        basis: "SR-118 AK8 (comparison; recorded)",
      },
    );
    // eslint-disable-next-line no-console -- the numbers are the result of this test, the PR quotes them.
    console.log(
      `PERF app start and open ${JSON.stringify({ cold: coldStart, warm: start, opens: times, perspectives: { start: perspectiveStart, counted } })}`,
    );
    assertWithin(coldUsable);
    assertWithin(warm);
    assertWithin(first);
    assertWithin(later);
  });
});
