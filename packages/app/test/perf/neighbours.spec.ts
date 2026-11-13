// The previous and the next buffer drawn in advance (SR-212 AK5) in the app's part of the performance suite
// (ADR-0011), on the generated workspace of N-036 with 50,000 elements and 200,000 relations (testkit, D-055). The
// rationale of SR-212: „Das Vorabzeichnen hat keine eigene Zeitgrenze und ändert keine Grenze eines anderen AK.“ So
// this spec asserts the limits of other criteria while buffers are drawn hidden beside the shown one, and records
// how soon a switch to one of them starts to slide:
//
// - SR-082 AK3, the hostile case: an element opened without a prompt (Enter on a relation of the shown element)
//   right after the slowest read of a neighbour was sent, in the same task, set off in the preload's world
//   (`recordRequests`). A change drops the buffers drawn in advance, which read nothing in the background; the
//   next switch draws them again, so the slowest read is the first after a change (found first, its time
//   recorded, also warm), sent when the reader is back on the shown element;
// - SR-082 AK3 with Ctrl+P: the prompt opened at once after that read was sent; the read may be done by the
//   Enter, and no read drawn in advance starts while the prompt is open;
// - SR-082 AK3 after a held Alt+P over more buffers than the walk draws in advance, lists among them: the open
//   at once after the release;
// - SR-082 AK4: the list of all elements, its first page, asked for while neighbours are drawn;
// - SR-116 AK1: the shown element changed outside, its neighbours dropped;
// - SR-212 AK2: a switch just after typing loses no input;
// - SR-082 AK5: the first open with Ctrl+P after a start with restored buffers, whose neighbours are drawn once
//   the restored buffer is (the start itself recorded for SR-082 AK1, which `start.spec.ts` asserts).
//
// Recorded for comparison: the reads drawn in advance, Alt+P or Alt+N until a buffer drawn in advance starts to
// slide, and the longest frame gap while typing with neighbours drawn.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { GeneratedElement, LargeFixtureWorkspace, PerfMeasurement } from "@reqseq/testkit";
import { generateLargeWorkspace, recordValue, thresholdMessage, writeLargeWorkspace } from "@reqseq/testkit";
import type { CoreRequest, CoreRequests, RunningApp } from "../support/app.js";
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
/** The most ms from sending the slowest read until the Enter it sets off (SR-082 AK3, the hostile case). */
const ARMED_LAG_MS = 5;
/** Alt+P presses while Alt is held, and the ms between two: the key repeat of a held key. */
const HELD_PRESSES = 6;
const REPEAT_MS = 33;
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
 * Watches for the next Enter (with `synthetic`, the next one not typed): gives the ms from its keydown until the shown element has `title` and a text, in
 * the frame after the paint (as `start.spec.ts` times an open), once the returned function is awaited.
 */
const watchOpen = async (window: Page, title: string, synthetic = false): Promise<() => Promise<number>> => {
  await window.evaluate(
    ({ title, shown, synthetic }) => {
      const w = globalThis as unknown as { __open?: Promise<number> };
      let start: number | undefined;
      const listener = (event: KeyboardEvent): void => {
        // `synthetic`: only the Enter `recordRequests` sets off, not one typed before it.
        if (event.key === "Enter" && (!synthetic || !event.isTrusted)) {
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
    { title, shown: SHOWN, synthetic },
  );
  return () => window.evaluate(() => (globalThis as unknown as { __open: Promise<number> }).__open);
};

/** Presses Enter and gives the ms until the shown element has `title` (`watchOpen`). */
const timeOpen = async (window: Page, title: string): Promise<number> => {
  const opened = await watchOpen(window, title);
  await window.keyboard.press("Enter");
  return opened();
};

/** The ms each answered request took, slowest first, labelled by command, element and depth. */
const readTimes = (
  sent: readonly CoreRequest[],
  ids: ReadonlyMap<string, string>,
): { readonly label: string; readonly ms: number; readonly request: CoreRequest }[] =>
  sent
    .flatMap((request) => {
      const input = request.input as { ref?: string; direction?: string; maxDepth?: number };
      const of = ids.get(input.ref ?? "");
      if (of === undefined || request.answeredAt === undefined) {
        return [];
      }
      const depth =
        input.direction === undefined ? "" : ` ${input.direction} ${String(input.maxDepth ?? "all")}`;
      return [
        { label: `${request.name} ${of}${depth}`, ms: Math.round(request.answeredAt - request.at), request },
      ];
    })
    .sort((one, other) => other.ms - one.ms);

/** Waits until every recorded request was answered and none was sent for 500 ms. */
const quiet = async (requests: CoreRequests): Promise<readonly CoreRequest[]> => {
  let last = "";
  let stable = 0;
  for (;;) {
    const sent = await requests.sent();
    const now = `${String(sent.length)} ${String(sent.filter((one) => one.answeredAt !== undefined).length)}`;
    stable = now === last && sent.every((one) => one.answeredAt !== undefined) ? stable + 1 : 0;
    last = now;
    if (stable >= 5) {
      return sent;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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
  let byId = new Map<string, GeneratedElement>();

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
    byId = new Map(generated.elements.map((element) => [element.id, element]));
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
    if (a === undefined || second === undefined || pkg === undefined || others.length < ROUNDS + 6) {
      throw new Error("the generated workspace has too few elements with a title of their own");
    }
    let b: GeneratedElement = second;
    const thePackage: GeneratedElement = pkg;
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

    // The reads drawn in advance and how long each takes: first after a change from outside (A named, so mounted
    // again; the neighbourhood of the package reads again on every change), and warm (a switch away and back
    // mounts both again with nothing changed).
    // A change from outside drops the buffers drawn in advance: nothing reads in the background. The next switch
    // draws the neighbours of the buffer it shows: back to B, A reads for the first time after the change (and
    // the neighbourhood again); a switch away and back without a change reads them warm.
    const ids = new Map([
      [a.id, "A"],
      [thePackage.id, "package"],
    ]);
    const measureReads = async () => {
      await quiet(requests);
      await requests.clear();
      await retitle(a, `${a.title} read`);
      await expect.poll(() => hiddenViews(window), { timeout: 10_000 }).toEqual([]);
      expect(readTimes(await quiet(requests), ids)).toEqual([]);
      await window.keyboard.press("Alt+KeyP");
      await window.waitForTimeout(SETTLE_SWITCH_MS);
      await quiet(requests);
      await requests.clear();
      await window.keyboard.press("Alt+KeyN");
      await expect.poll(() => shownTitle(window)).toBe(b.title);
      await expect.poll(() => hiddenViews(window), { timeout: 60_000 }).toHaveLength(2);
      const afterWrite = readTimes(await quiet(requests), ids);
      await window.keyboard.press("Alt+KeyP");
      await window.waitForTimeout(SETTLE_SWITCH_MS);
      await quiet(requests);
      await requests.clear();
      await window.keyboard.press("Alt+KeyN");
      await expect.poll(() => shownTitle(window)).toBe(b.title);
      const warm = readTimes(await quiet(requests), ids);
      // A change of another element: are the first reads of the unchanged neighbours slow too?
      const elsewhere = others[ROUNDS + 4];
      if (elsewhere === undefined) {
        throw new Error("no other element to change");
      }
      await retitle(elsewhere, `${elsewhere.title} elsewhere`);
      await expect.poll(() => hiddenViews(window), { timeout: 10_000 }).toEqual([]);
      await window.keyboard.press("Alt+KeyP");
      await window.waitForTimeout(SETTLE_SWITCH_MS);
      await quiet(requests);
      await requests.clear();
      await window.keyboard.press("Alt+KeyN");
      await expect.poll(() => shownTitle(window)).toBe(b.title);
      const afterOther = readTimes(await quiet(requests), ids);
      const slowest = afterWrite[0];
      if (slowest === undefined || warm[0] === undefined) {
        throw new Error("no read drawn in advance was answered");
      }
      recorded.push(
        await recordValue(
          `app: the slowest read drawn in advance, first after a change from outside (${slowest.label})`,
          slowest.ms,
          { basis: "SR-212 AK5 (recorded; finds the read the hostile case of SR-082 AK3 sets off on)" },
        ),
        await recordValue(`app: the slowest read drawn in advance, warm (${warm[0].label})`, warm[0].ms, {
          basis: "SR-212 AK5 (recorded)",
        }),
        await recordValue(
          `app: the slowest read drawn in advance, first after a change of another element (${afterOther[0]?.label ?? "none"})`,
          afterOther[0]?.ms ?? 0,
          { basis: "SR-212 AK5 (recorded)" },
        ),
      );
      return { afterWrite, warm, afterOther, slowest };
    };
    const { afterWrite, warm, afterOther, slowest } = await measureReads();

    /** A relation of the shown element B to an element neither drawn in advance nor A: its title and selector. */
    const relation = async (): Promise<{ readonly title: string; readonly selector: string }> => {
      const links = window.locator(`${SHOWN} [role="link"][data-target-id]`);
      await expect(links.first()).toBeVisible({ timeout: 60_000 });
      for (const link of await links.all()) {
        const target = byId.get((await link.getAttribute("data-target-id")) ?? "");
        if (target !== undefined && target.id !== a.id && target.id !== thePackage.id && target.id !== b.id) {
          return { title: target.title, selector: `${SHOWN} [role="link"][data-target-id="${target.id}"]` };
        }
      }
      throw new Error("the shown element has no relation to open");
    };
    /** Focuses a relation of B (`relation`) and gives its title. */
    const focusRelation = async (): Promise<string> => {
      const { title, selector } = await relation();
      await window.locator(selector).first().focus();
      return title;
    };
    /** Back to B with the opened element closed, so its neighbours are the neighbourhood and A again. */
    const backToB = async (): Promise<void> => {
      await window.waitForTimeout(SETTLE_SWITCH_MS);
      await command(window, "Close buffer");
      await expect.poll(() => shownTitle(window)).toBe(b.title);
      await expect.poll(() => hiddenViews(window), { timeout: 60_000 }).toHaveLength(2);
      await window.waitForTimeout(SETTLE_SWITCH_MS);
    };
    /**
     * Away from B to `away`, A changed outside meanwhile (so its next read is the first after the change), and
     * back to B with `away` closed: B draws, then its neighbours read.
     */
    const changedAndBack = async (
      away: GeneratedElement,
      title: string,
      arm: () => Promise<void> = () => Promise.resolve(),
    ): Promise<void> => {
      await open(window, away.title);
      await expect.poll(() => hiddenViews(window), { timeout: 60_000 }).not.toEqual([]);
      await window.waitForTimeout(SETTLE_SWITCH_MS);
      await retitle(a, title);
      // The change drops what is drawn beside `away`.
      await expect.poll(() => hiddenViews(window), { timeout: 10_000 }).toEqual([]);
      await quiet(requests);
      await requests.clear();
      await arm();
      await command(window, "Close buffer");
    };

    // SR-082 AK3, hostile: back on B after a change from outside, Enter on a relation of B goes right
    // after the slowest read drawn in advance was sent.
    const hostileOpens = async () => {
      const hostile: number[] = [];
      const lags: number[] = [];
      for (let round = 0; round < ROUNDS; round += 1) {
        const away = others[round];
        if (away === undefined) {
          throw new Error("no element to open");
        }
        const target = await relation();
        const opened = await watchOpen(window, target.title, true);
        await changedAndBack(away, `${a.title} ${String(round)}`, () =>
          requests.enterOn(slowest.request.name, slowest.request.input, target.selector),
        );
        hostile.push(await opened());
        const fired = await requests.fired();
        expect(fired?.target).toBe("SPAN");
        lags.push((fired?.firedAt ?? Infinity) - (fired?.sentAt ?? 0));
        await backToB();
      }
      expect(Math.max(...lags)).toBeLessThanOrEqual(ARMED_LAG_MS);
      recorded.push(
        await recordValue(
          `app: Enter on a relation until the element shows, sent with the slowest read drawn in advance (slowest of ${String(ROUNDS)})`,
          Math.max(...hostile),
          { basis: "SR-082 AK3 (with buffers drawn in advance, SR-212 AK5; the app)", thresholdMs: OPEN_MS },
        ),
      );
      return { hostile, lags };
    };
    const { hostile, lags } = await hostileOpens();

    // SR-082 AK3 with Ctrl+P: back on B after a change from outside, the prompt opens at once after the slowest
    // read drawn in advance was sent; no read drawn in advance starts while it is open, and the one sent may be
    // done by the Enter.
    const promptOpens = async () => {
      const opens: number[] = [];
      for (let round = 0; round < ROUNDS; round += 1) {
        const target = others[round];
        if (target === undefined) {
          throw new Error("no element to open");
        }
        await changedAndBack(target, `${a.title} prompt ${String(round)}`);
        await expect
          .poll(
            async () =>
              (await requests.sent()).some(
                (request) =>
                  request.name === slowest.request.name &&
                  JSON.stringify(request.input) === JSON.stringify(slowest.request.input),
              ),
            { intervals: [5], timeout: 10_000 },
          )
          .toBe(true);
        await goToTyped(window, target.title);
        opens.push(await timeOpen(window, target.title));
        await backToB();
      }
      recorded.push(
        await recordValue(
          `app: Ctrl+P Enter until an element shows, the prompt opened at once after the slowest read drawn in advance was sent (slowest of ${String(ROUNDS)})`,
          Math.max(...opens),
          { basis: "SR-082 AK3 (with buffers drawn in advance, SR-212 AK5; the app)", thresholdMs: OPEN_MS },
        ),
      );
      return opens;
    };
    const opens = await promptOpens();

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
    const list = await window.evaluate(() => (globalThis as unknown as { __list: Promise<number> }).__list);
    recorded.push(
      await recordValue(
        "app: Ctrl+K L until the list of all elements shows its first row, with buffers drawn in advance",
        list,
        {
          basis: "SR-082 AK4 (with buffers drawn in advance, SR-212 AK5; the app, from the key)",
          thresholdMs: LIST_MS,
        },
      ),
    );
    await window.waitForTimeout(SETTLE_SWITCH_MS);
    await command(window, "Close buffer");
    await expect.poll(() => shownTitle(window)).toBe(b.title);
    await expect.poll(() => hiddenViews(window), { timeout: 60_000 }).toHaveLength(2);
    await window.waitForTimeout(SETTLE_SWITCH_MS);

    // SR-116 AK1: B changed outside while shown; the change drops its neighbours, which read nothing meanwhile.
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
    await window.waitForTimeout(SETTLE_SWITCH_MS);

    // SR-082 AK3 with the save of leaving (SR-105 AK1): typed in B, then Alt+P to another element C at once. B
    // is saved, then drawn hidden beside C, its first read after its own save; Enter on a relation of C goes right
    // after that read was sent.
    const focusing: number[] = [];
    const leavingOpens = async () => {
      const c = others[ROUNDS + 5];
      if (c === undefined) {
        throw new Error("no element to switch to");
      }
      await open(window, c.title);
      const target = await relation();
      const timed: number[] = [];
      for (let round = 0; round < ROUNDS; round += 1) {
        await open(window, b.title);
        await window.waitForTimeout(SETTLE_SWITCH_MS);
        const opened = await watchOpen(window, target.title, true);
        await quiet(requests);
        await requests.clear();
        await requests.enterOn("element.get", { ref: b.id, repository: b.repository }, target.selector);
        // Typed and left at once, before the autosave: the save of leaving writes it. B was opened after C, so
        // Alt+P goes back to C.
        await window.locator(`${SHOWN} .cm-content`).first().click();
        await window.keyboard.press("ControlOrMeta+End");
        await window.keyboard.type(` left ${String(round)}`);
        await window.keyboard.press("Alt+KeyP");
        timed.push(await opened());
        const fired = await requests.fired();
        expect(fired?.target).toBe("SPAN");
        expect((fired?.firedAt ?? Infinity) - (fired?.sentAt ?? 0)).toBeLessThanOrEqual(ARMED_LAG_MS);
        focusing.push(fired?.focusMs ?? 0);
        await expect.poll(() => fs.readFile(fileOf(b), "utf8")).toContain(`left ${String(round)}`);
        // Back to C with the opened element closed, so B, opened next, has C as its previous buffer.
        await window.waitForTimeout(SETTLE_SWITCH_MS);
        await command(window, "Close buffer");
        await expect.poll(() => shownTitle(window)).toBe(c.title);
      }
      recorded.push(
        await recordValue(
          `app: Enter on a relation until the element shows, sent with the first read of the element left with a save (slowest of ${String(ROUNDS)})`,
          Math.max(...timed),
          {
            basis:
              "SR-082 AK3 (with the save of leaving, SR-105 AK1, and buffers drawn in advance, SR-212 AK5; the app)",
            thresholdMs: OPEN_MS,
          },
        ),
      );
      return timed;
    };
    const leaving = await leavingOpens();

    // SR-082 AK3 after a held Alt+P: B, then two lists and the overview between three elements; Alt held over
    // the key repeat back to B, through buffers drawn in advance and not, then Enter on a relation of B at once.
    const heldOpen = async () => {
      const [x1, x2, x3] = others.slice(ROUNDS + 1);
      if (x1 === undefined || x2 === undefined || x3 === undefined) {
        throw new Error("no elements for the held Alt+P");
      }
      const listShown = async (): Promise<void> => {
        await expect(window.locator(`${SHOWN} .row`).first()).toBeVisible({ timeout: 60_000 });
      };
      await open(window, b.title);
      await command(window, "List all elements");
      await listShown();
      await open(window, x1.title);
      await window.keyboard.press("ControlOrMeta+Shift+F");
      await window.keyboard.type("station");
      await window.keyboard.press("Enter");
      await listShown();
      await open(window, x2.title);
      await command(window, "Show overview");
      await expect(window.locator(`${SHOWN} [role="listbox"][aria-label="Overview"]`)).toBeVisible({
        timeout: 60_000,
      });
      await open(window, x3.title);
      await window.waitForTimeout(SETTLE_SWITCH_MS);
      await window.keyboard.down("Alt");
      for (let press = 0; press < HELD_PRESSES; press += 1) {
        await window.keyboard.press("KeyP");
        await window.waitForTimeout(REPEAT_MS);
      }
      await window.keyboard.up("Alt");
      await expect.poll(() => shownTitle(window)).toBe(b.title);
      const held = await timeOpen(window, await focusRelation());
      recorded.push(
        await recordValue(
          `app: Enter on a relation until the element shows, at once after a held Alt+P over ${String(HELD_PRESSES)} buffers`,
          held,
          { basis: "SR-082 AK3 (with buffers drawn in advance, SR-212 AK5; the app)", thresholdMs: OPEN_MS },
        ),
      );
      // Back to B; its neighbours are other buffers now.
      await window.waitForTimeout(SETTLE_SWITCH_MS);
      await command(window, "Close buffer");
      await expect.poll(() => shownTitle(window)).toBe(b.title);
      return held;
    };
    const held = await heldOpen();

    // A start with these buffers restored: the overview, then the first open with Ctrl+P; B's neighbours are
    // drawn once B is.
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
      `PERF neighbours ${JSON.stringify({ toNeighbourhood, toElement, afterWrite: afterWrite.map(({ label, ms }) => ({ label, ms })), warm: warm.map(({ label, ms }) => ({ label, ms })), hostile, lags, leaving, focusing, afterOther: afterOther.map(({ label, ms }) => ({ label, ms })), opens, list, outside, gap, held, started, firstOpen })}`,
    );
    for (const measurement of recorded) {
      if (measurement.thresholdMs !== undefined) {
        assertWithin(measurement);
      }
    }
  });
});
