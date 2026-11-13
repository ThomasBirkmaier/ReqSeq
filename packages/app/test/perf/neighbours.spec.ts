// The previous and the next buffer drawn in advance (SR-212 AK5) in the app's part of the performance suite
// (ADR-0011), on the generated workspace of N-036 with 50,000 elements and 200,000 relations (testkit, D-055). The
// rationale of SR-212: „Das Vorabzeichnen hat keine eigene Zeitgrenze und ändert keine Grenze eines anderen AK.“ So
// this spec asserts the limits of other criteria while buffers are drawn hidden beside the shown one, and records
// how soon a switch to one of them starts to slide:
//
// - SR-082 AK3, the hostile case: an element opened with Ctrl+P, the Enter sent just after the slowest read of a
//   neighbour started (the neighbourhood of a package with many elements, read again after a change from
//   outside), watched in the preload's world (`recordRequests`);
// - SR-082 AK4: the list of all elements, its first page, asked for while neighbours are drawn;
// - SR-116 AK1: the shown element changed outside, while its neighbours read again;
// - SR-212 AK2: a switch just after typing loses no input;
// - SR-082 AK5: a start with restored buffers, whose element neighbours read while the first element opens (the
//   start itself recorded for SR-082 AK1, which `start.spec.ts` asserts).
//
// Recorded for comparison: Alt+P or Alt+N until a buffer drawn in advance starts to slide, and the longest frame
// gap while typing with neighbours drawn.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { GeneratedElement, LargeFixtureWorkspace, PerfMeasurement } from "@reqseq/testkit";
import { generateLargeWorkspace, recordValue, thresholdMessage, writeLargeWorkspace } from "@reqseq/testkit";
import type { CoreRequests, RunningApp } from "../support/app.js";
import { launchApp, recordRequests } from "../support/app.js";
import { coreVersion } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-082 AK3: an open after the first. */
const OPEN_MS = 200;
/** SR-082 AK4: the first page of a list. */
const LIST_MS = 500;
/** SR-082 AK5: the first open after the start. */
const FIRST_OPEN_MS = 1_000;
/** SR-116 AK1: a change from outside shown. */
const OUTSIDE_MS = 2_000;
/** The pause after a switch, longer than the reads of the views drawn in advance. */
const SETTLE_SWITCH_MS = 1_000;
/** How often each measurement is taken; the slowest is recorded. */
const ROUNDS = 3;
/** The model cache trusts an entry only when its file is older than 2 s before the load (ADR-0008). */
const SETTLE_MS = 2_100;

const SHOWN = '[data-area][data-active] > [data-layer="main"]';

/** Wall-clock milliseconds since the epoch, comparable between this process and the window. */
const now = (): number => performance.timeOrigin + performance.now();

const shownTitle = (window: Page): Promise<string> =>
  window
    .locator(`${SHOWN} article h1`)
    .textContent({ timeout: 60_000 })
    .then((title) => title ?? "");

/** The names of the views drawn hidden beside the shown buffer of the active area. */
const hiddenViews = (window: Page): Promise<string[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll('[data-area][data-active] > [data-layer="neighbour"] .buffer')].map(
      (view) => view.getAttribute("aria-label") ?? "",
    ),
  );

const command = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(title, {
    timeout: 60_000,
  });
  await window.keyboard.press("Enter");
};

/** Opens Ctrl+P with `title` typed and its hit first; the Enter is the caller's. */
const goToTyped = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title, {
    timeout: 60_000,
  });
};

const open = async (window: Page, title: string): Promise<void> => {
  await goToTyped(window, title);
  await window.keyboard.press("Enter");
  await expect.poll(() => shownTitle(window), { timeout: 60_000 }).toBe(title);
};

/**
 * Presses Enter and gives the ms from its keydown until the shown element has `title` and a
 * text, in the frame after the paint (as `start.spec.ts` times an open).
 */
const timeOpen = async (window: Page, title: string): Promise<number> => {
  await window.evaluate(
    ({ title, shown }) => {
      const w = globalThis as unknown as { __open?: Promise<number> };
      let start: number | undefined;
      const listener = (event: KeyboardEvent): void => {
        if (event.key === "Enter") {
          start = event.timeStamp;
          removeEventListener("keydown", listener, { capture: true });
        }
      };
      addEventListener("keydown", listener, { capture: true });
      w.__open = new Promise((resolve) => {
        const check = (): void => {
          const heading = document.querySelector(`${shown} article h1`)?.textContent ?? "";
          const text = document.querySelector(`${shown} article .cm-content`)?.textContent ?? "";
          if (start !== undefined && heading === title && text.trim() !== "") {
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
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
      });
    },
    { title, shown: SHOWN },
  );
  await window.keyboard.press("Enter");
  return window.evaluate(() => (globalThis as unknown as { __open: Promise<number> }).__open);
};

/** Presses `key` and gives the ms from its keydown until the slide it starts makes its animations. */
const timeSlide = async (window: Page, key: "Alt+KeyP" | "Alt+KeyN"): Promise<number> => {
  await window.evaluate(() => {
    const w = globalThis as unknown as { __slide?: Promise<number> };
    w.__slide = new Promise((resolve) => {
      let start: number | undefined;
      const listener = (event: KeyboardEvent): void => {
        if (event.altKey && (event.code === "KeyP" || event.code === "KeyN")) {
          start = event.timeStamp;
          removeEventListener("keydown", listener, { capture: true });
        }
      };
      addEventListener("keydown", listener, { capture: true });
      const observer = new MutationObserver(() => {
        if (start !== undefined && document.getAnimations().some((one) => one.id === "buffer-slide")) {
          observer.disconnect();
          resolve(performance.now() - start);
        }
      });
      observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["style"] });
    });
  });
  await window.keyboard.press(key);
  const ms = await window.evaluate(() => (globalThis as unknown as { __slide: Promise<number> }).__slide);
  await window.waitForTimeout(SETTLE_SWITCH_MS);
  return ms;
};

/** Asserts a measurement's threshold after all were recorded (ADR-0011): soft, so one does not hide the others. */
const assertWithin = (measurement: PerfMeasurement): void => {
  expect
    .soft(measurement.ms, thresholdMessage(measurement))
    .toBeLessThanOrEqual(measurement.thresholdMs ?? 0);
};

test.describe("buffers drawn in advance with 50,000 elements and 200,000 relations (SR-212 AK5, N-036)", () => {
  let fixture: LargeFixtureWorkspace | undefined;
  let running: RunningApp | undefined;
  let home = "";
  let requirements: GeneratedElement[] = [];
  let pkg: GeneratedElement | undefined;

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    const generated = generateLargeWorkspace({
      version: await coreVersion(),
      elements: ELEMENTS,
      relations: RELATIONS,
    });
    fixture = await writeLargeWorkspace(generated, { git: true });
    home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-sr-212-ahead-")));
    // Elements with a title no other element has: Ctrl+P finds each of them by its title.
    const count = new Map<string, number>();
    for (const element of generated.elements) {
      count.set(element.title, (count.get(element.title) ?? 0) + 1);
    }
    const unique = generated.elements.filter((element) => count.get(element.title) === 1);
    requirements = unique.filter((element) => element.type === "system-requirement");
    pkg = unique.find((element) => element.type === "package");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  });

  test.afterAll(async () => {
    await running?.close({ discard: true });
    await fixture?.cleanup();
    if (home !== "") {
      await fs.rm(home, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  /** The file of `element` in the generated tree. */
  const fileOf = (element: GeneratedElement): string => {
    const folder =
      fixture?.generated.repositories.find((one) => one.name === element.repository)?.folder ?? "";
    return path.join(fixture?.root ?? "", folder, ...element.file.split("/"));
  };

  /** Gives `element` the title `title` outside the app, as another editor does. */
  const retitle = async (element: GeneratedElement, title: string): Promise<void> => {
    const file = fileOf(element);
    const text = await fs.readFile(file, "utf8");
    await fs.writeFile(file, text.replace(/^title: .*$/m, `title: ${title}`));
  };

  test("[SR-082/AK-tndr] [SR-082/AK-h27y] [SR-116/AK-w091] [SR-212/AK-kqvx] [SR-082/AK-csnf] the limits hold while the previous and next buffer are drawn in advance; the switch to one is recorded", async () => {
    test.setTimeout(900_000);
    const [a, second, ...others] = requirements;
    if (a === undefined || second === undefined || pkg === undefined || others.length < 2 * ROUNDS + 2) {
      throw new Error("the generated workspace has too few elements with a title of their own");
    }
    let b: GeneratedElement = second;
    const kept = {
      home,
      workspace: { root: fixture?.workspaceRoot ?? "", cleanup: () => Promise.resolve() },
    };
    running = await launchApp(undefined, { kept, validateOutput: false });
    let { window } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await expect(window.getByLabel("Modeline")).toContainText(`${String(ELEMENTS)} elements`, {
      timeout: 120_000,
    });
    // The buffers in their order of use: B, the neighbourhood of a package, the package page, A. B shows; its
    // previous buffer is the neighbourhood, its next one A: both drawn in advance.
    await open(window, a.title);
    await goToTyped(window, "Overview");
    await window.keyboard.press("Enter");
    await command(window, "Close buffer");
    await expect.poll(() => shownTitle(window)).toBe(a.title);
    await open(window, pkg.title);
    await window.keyboard.press("ControlOrMeta+J");
    await expect(window.locator(`${SHOWN} .neighbourhood .row`).first()).toBeVisible({ timeout: 60_000 });
    const neighbourhood = await window.locator(`${SHOWN} .neighbourhood`).getAttribute("aria-label");
    await open(window, b.title);
    await expect.poll(() => hiddenViews(window), { timeout: 60_000 }).toHaveLength(2);
    await window.waitForTimeout(SETTLE_SWITCH_MS);
    const requests: CoreRequests = await recordRequests(window);
    const recorded: PerfMeasurement[] = [];

    // Alt+P to the neighbourhood and Alt+N back to B, each drawn in advance by then: until the slide starts.
    const toNeighbourhood: number[] = [];
    const toElement: number[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      toNeighbourhood.push(await timeSlide(window, "Alt+KeyP"));
      expect(await window.locator(`${SHOWN} .neighbourhood`).getAttribute("aria-label")).toBe(neighbourhood);
      toElement.push(await timeSlide(window, "Alt+KeyN"));
      expect(await shownTitle(window)).toBe(b.title);
    }
    recorded.push(
      await recordValue(
        `app: Alt+P until a neighbourhood drawn in advance starts to slide (slowest of ${String(ROUNDS)})`,
        Math.max(...toNeighbourhood),
        { basis: "SR-212 AK5 (recorded; drawing in advance has no time limit of its own)" },
      ),
      await recordValue(
        `app: Alt+N until an element drawn in advance starts to slide (slowest of ${String(ROUNDS)})`,
        Math.max(...toElement),
        { basis: "SR-212 AK5 (recorded; drawing in advance has no time limit of its own)" },
      ),
    );

    // SR-082 AK3, hostile: Ctrl+P typed, a change from outside makes the neighbours read again (A named, so
    // mounted again; the neighbourhood of the package on every change), and the Enter goes just after the
    // neighbourhood's read started.
    const opens: number[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const target = others[round];
      if (target === undefined) {
        throw new Error("no element to open");
      }
      await goToTyped(window, target.title);
      await requests.clear();
      await retitle(a, `${a.title} ${String(round)}`);
      await expect
        .poll(
          async () =>
            (await requests.sent()).some(
              (request) =>
                request.name === "trace.neighbourhood" &&
                JSON.stringify(request.input).includes(pkg?.id ?? ""),
            ),
          { intervals: [5], timeout: 10_000 },
        )
        .toBe(true);
      opens.push(await timeOpen(window, target.title));
      await window.waitForTimeout(SETTLE_SWITCH_MS);
      // Back to B, so its neighbours are the neighbourhood and A again.
      await open(window, b.title);
      await window.waitForTimeout(SETTLE_SWITCH_MS);
    }
    recorded.push(
      await recordValue(
        `app: Ctrl+P Enter until an element shows, sent just after the read of a neighbourhood drawn in advance started (slowest of ${String(ROUNDS)})`,
        Math.max(...opens),
        { basis: "SR-082 AK3 (with buffers drawn in advance, SR-212 AK5; the app)", thresholdMs: OPEN_MS },
      ),
    );

    // SR-082 AK4: the first page of the list of all elements, asked for (Ctrl+K L) while neighbours are drawn.
    await window.evaluate(() => {
      const w = globalThis as unknown as { __list?: Promise<number> };
      w.__list = new Promise((resolve) => {
        let start: number | undefined;
        addEventListener(
          "keydown",
          (event) => {
            start ??= event.timeStamp;
          },
          { capture: true },
        );
        const check = (): void => {
          const row = document.querySelector('[data-area][data-active] > [data-layer="main"] .row .title');
          if (start !== undefined && row !== null && row.textContent !== "") {
            resolve(performance.now() - start);
          } else {
            requestAnimationFrame(check);
          }
        };
        requestAnimationFrame(check);
      });
    });
    await window.keyboard.press("ControlOrMeta+K");
    await window.keyboard.press("L");
    recorded.push(
      await recordValue(
        "app: Ctrl+K L until the list of all elements shows its first row, with buffers drawn in advance",
        await window.evaluate(() => (globalThis as unknown as { __list: Promise<number> }).__list),
        {
          basis: "SR-082 AK4 (with buffers drawn in advance, SR-212 AK5; the app, from the key)",
          thresholdMs: LIST_MS,
        },
      ),
    );
    await window.waitForTimeout(SETTLE_SWITCH_MS);
    await open(window, b.title);
    await window.waitForTimeout(SETTLE_SWITCH_MS);

    // SR-116 AK1: B changed outside while shown, its neighbours read again meanwhile.
    const outside: number[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const title = `${b.title} outside ${String(round)}`;
      const written = now();
      await retitle(b, title);
      const seenAt = await window.waitForFunction(
        ({ shown, title }) =>
          document.querySelector(`${shown} article h1`)?.textContent === title
            ? performance.timeOrigin + performance.now()
            : false,
        { shown: SHOWN, title },
        { polling: "raf", timeout: 10_000 },
      );
      outside.push(Number(await seenAt.jsonValue()) - written);
      b = { ...b, title };
      await window.waitForTimeout(SETTLE_SWITCH_MS);
    }
    recorded.push(
      await recordValue(
        `app: a change from outside of the shown element until it shows, with buffers drawn in advance (slowest of ${String(ROUNDS)})`,
        Math.max(...outside),
        { basis: "SR-116 AK1 (with buffers drawn in advance, SR-212 AK5; the app)", thresholdMs: OUTSIDE_MS },
      ),
    );

    // Typing in B with its neighbours drawn: the longest gap between two frames (recorded), then Alt+P at once
    // after the last key: the input is saved (SR-212 AK2, SR-105 AK1).
    await window.locator(`${SHOWN} .cm-content`).first().click();
    await window.keyboard.press("ControlOrMeta+End");
    await window.evaluate(() => {
      const w = globalThis as unknown as { __gap?: number; __gapOn?: boolean };
      w.__gap = 0;
      w.__gapOn = true;
      let last = performance.now();
      const frame = (at: number): void => {
        w.__gap = Math.max(w.__gap ?? 0, at - last);
        last = at;
        if (w.__gapOn === true) {
          requestAnimationFrame(frame);
        }
      };
      requestAnimationFrame(frame);
    });
    const typed = " typed while neighbours are drawn";
    await window.keyboard.type(typed, { delay: 50 });
    const gap = await window.evaluate(() => {
      const w = globalThis as unknown as { __gap?: number; __gapOn?: boolean };
      w.__gapOn = false;
      return w.__gap ?? 0;
    });
    recorded.push(
      await recordValue("app: the longest frame gap while typing, with buffers drawn in advance", gap, {
        basis: "SR-212 AK5 (recorded; typing has no limit of its own)",
      }),
    );
    await window.keyboard.press("Alt+KeyP");
    await expect.poll(() => fs.readFile(fileOf(b), "utf8"), { timeout: 10_000 }).toContain(typed.trim());

    // A start with these buffers restored: the overview, then B's neighbours drawn while the first element opens.
    await running.close({ keep: true });
    const launched = now();
    running = await launchApp(undefined, { kept, validateOutput: false });
    ({ window } = running);
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
    const started = Number(await overviewAt.jsonValue()) - launched;
    const first = others[ROUNDS];
    if (first === undefined) {
      throw new Error("no element to open first");
    }
    await goToTyped(window, first.title);
    const firstOpen = await timeOpen(window, first.title);
    recorded.push(
      await recordValue("app: a start with restored buffers until the overview shows all elements", started, {
        basis:
          "SR-082 AK1 (with buffers drawn in advance after the start, SR-212 AK5; part of the start, recorded)",
      }),
      await recordValue(
        "app: the first open after a start with restored buffers drawn in advance, Enter until it shows",
        firstOpen,
        {
          basis: "SR-082 AK5 (with buffers drawn in advance, SR-212 AK5; the app)",
          thresholdMs: FIRST_OPEN_MS,
        },
      ),
    );
    // eslint-disable-next-line no-console -- the numbers are the result of this test, the PR quotes them.
    console.log(
      `PERF neighbours ${JSON.stringify({ toNeighbourhood, toElement, opens, outside, gap, started, firstOpen })}`,
    );
    for (const measurement of recorded) {
      if (measurement.thresholdMs !== undefined) {
        assertWithin(measurement);
      }
    }
  });
});
