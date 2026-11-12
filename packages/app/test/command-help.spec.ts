// The explanation line of the command prompt on the built app (SR-210): under the hits, two text lines high, it
// explains the marked catalog command and, while an argument is asked, that argument and the keys of its step, with
// the texts of the catalog; an action of the app shows its description, an element none. Ctrl+H slides the command
// help in over the hits, and the keys of the list scroll it while it is open. Also the keys of an argument step
// (SR-108 AK6, SR-134 AK4). The light screenshots go to `test-results/electron/screenshots/` (or the folder in
// REQSEQ_SCREENSHOTS). Keys use ControlOrMeta, so the same tests run on Linux, macOS and Windows; Ctrl+H is the
// physical Ctrl key on every system (SR-145 AK4).
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { userText } from "../../../scripts/contracts/user-text.mjs";
import type { RunningApp } from "./support/app.js";
import { cardSettled, launchApp, listAll, transitionsSettled } from "./support/app.js";

const FIXTURE = { fixture: "SR-069/filter" };

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

interface CatalogFile {
  readonly name: string;
  readonly title: string;
  readonly summary: string;
  readonly details?: string;
  readonly input: {
    readonly properties?: Readonly<Record<string, { readonly description?: string }>>;
    readonly required?: readonly string[];
  };
}

/** The command files of the catalog, by name. */
const CATALOG: ReadonlyMap<string, CatalogFile> = new Map(
  ((): CatalogFile[] => {
    const folder = fileURLToPath(new URL("../../../schemas/commands/", import.meta.url));
    return fs
      .readdirSync(folder)
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(fs.readFileSync(path.join(folder, file), "utf8")) as CatalogFile)
      .filter((entry) => typeof entry.summary === "string");
  })().map((entry) => [entry.name, entry]),
);

const catalog = (name: string): CatalogFile => {
  const entry = CATALOG.get(name);
  if (entry === undefined) {
    throw new Error(`no command ${name}`);
  }
  return entry;
};

const mac = process.platform === "darwin";
/** Ctrl/Cmd+Enter and Enter as the line names them. */
const MORE = mac ? "⌘↩" : "Ctrl+Enter";
const ENTER = mac ? "↩" : "Enter";
/** Ctrl+H, the physical Ctrl key on every system. */
const HELP = mac ? "⌃H" : "Ctrl+H";

const names = (window: Page) => window.locator('.candidates [role="option"] .name');
const explanation = (window: Page) => window.getByRole("note", { name: "Explanation" });
const label = (window: Page) => window.locator("label.prompt-label");

/**
 * The explanation line: how many text lines high it is, its height, and whether its text wraps and is cut where it
 * does not fit (with "…", `-webkit-line-clamp`).
 */
const geometry = (window: Page): Promise<{ lines: number; height: number; cut: boolean; wraps: boolean }> =>
  explanation(window).evaluate((element) => {
    // Whether the text is higher without the clamp than with it: then the clamp cuts it with "…".
    const clamped = (shown: Element): boolean => {
      const whole = shown.cloneNode(true) as HTMLElement;
      whole.style.setProperty("-webkit-line-clamp", "unset");
      whole.style.position = "absolute";
      whole.style.width = `${String(shown.clientWidth)}px`;
      shown.parentElement?.append(whole);
      const higher = whole.clientHeight > shown.clientHeight;
      whole.remove();
      return higher;
    };
    const text = element.querySelector(".explain-text");
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const inner =
      element.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
    return {
      lines: Math.round(inner / lineHeight),
      // Without the edge: alone, without hits above it, the line closes the card at the top too.
      height: element.clientHeight,
      cut: text !== null && getComputedStyle(text).webkitLineClamp === "2" && clamped(text),
      wraps: text !== null && text.getClientRects().length > 0 && text.clientHeight > lineHeight * 1.5,
    };
  });

/** The command prompt with `typed`, its first hit `title` marked. */
const mark = async (window: Page, typed: string, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(typed);
  await expect(window.locator('.candidates [aria-selected="true"] .name')).toHaveText(title);
};

/** The element "Measure wind speed" open, so an element argument offers it first. */
const openElement = async (window: Page): Promise<void> => {
  await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type("Measure wind speed");
  await expect(window.locator('.candidates [role="option"]').first()).toContainText("Measure wind speed");
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toContainText("Measure wind speed");
};

test.describe("the explanation line of the command prompt (SR-210)", () => {
  let running: RunningApp;

  test.beforeEach(async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    await expect(running.window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  });

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-210/AK-gqgt] the marked catalog command shows its summary in a line two text lines high, its optional arguments and help at the right, and the line changes with the mark", async () => {
    const { window } = running;
    await fsp.mkdir(SHOTS, { recursive: true });
    await mark(window, "List hints", "List hints");
    const line = explanation(window);
    const hints = catalog("hint.list");
    await expect(line.locator(".explain-text")).toHaveText(userText(hints.summary));
    await expect(line.locator(".explain-side")).toHaveText(`7 optional · ${MORE} · ${HELP} help`);
    const { lines, height } = await geometry(window);
    expect(lines).toBe(2);
    await window.screenshot({ path: path.join(SHOTS, "sr-210-explanation-light.png") });
    // The mark moves: the line shows the newly marked command at once, as high.
    await window.keyboard.press("ArrowDown");
    const marked = await window.locator('.candidates [aria-selected="true"] .name').textContent();
    const next = [...CATALOG.values()].find((entry) => entry.title === marked);
    expect(next).toBeDefined();
    await expect(line.locator(".explain-text")).toHaveText(userText(next?.summary ?? ""));
    expect((await geometry(window)).height).toBe(height);
    // A command with one optional argument; one without any shows only the help.
    await window.keyboard.press("Escape");
    await mark(window, "Show relation options", "Show relation options");
    await expect(line.locator(".explain-side")).toHaveText(`1 optional · ${MORE} · ${HELP} help`);
    await window.keyboard.press("Escape");
    await mark(window, "List baselines", "List baselines");
    await expect(line.locator(".explain-side")).toHaveText(`${HELP} help`);
    expect((await geometry(window)).height).toBe(height);
    // Without a hit the line stays, empty and as high.
    await window.keyboard.type("qqxzqq");
    await expect(names(window)).toHaveCount(0);
    await expect(line.locator(".explain-text")).toHaveText("");
    expect((await geometry(window)).height).toBe(height);
    // Where the summary does not fit in two lines, it wraps and ends with "…"; the count and help stay.
    await window.keyboard.press("Escape");
    await window.setViewportSize({ width: 520, height: 700 });
    await mark(window, "List hints", "List hints");
    await window.screenshot({ path: path.join(SHOTS, "sr-210-explanation-narrow-light.png") });
    expect(await geometry(window)).toEqual({ lines: 2, height, cut: true, wraps: true });
    await expect(line.locator(".explain-side")).toBeInViewport({ ratio: 1 });
  });

  test("[SR-210/AK-t8sc] an asked argument shows its catalog description in the first line and the keys of its step in the second, as high", async () => {
    const { window } = running;
    await mark(window, "List hints", "List hints");
    const { height } = await geometry(window);
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label(window)).toHaveText("List hints · more arguments:");
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("List hints · kind:");
    const line = explanation(window);
    const kind = catalog("hint.list").input.properties?.["kind"]?.description ?? "";
    await expect(line.locator(".explain-text")).toHaveText(`kind · ${userText(kind)}`);
    await expect(line.locator(".explain-keys")).toHaveText(
      `${ENTER} adds a value · ${MORE} more arguments · Escape back`,
    );
    expect((await geometry(window)).height).toBe(height);
    // The description stays in the first line, the keys in the second.
    const top = async (selector: string): Promise<number> =>
      line.locator(selector).evaluate((element) => element.getBoundingClientRect().top);
    expect(await top(".explain-keys")).toBeGreaterThan(await top(".explain-text"));
    // Once a value is given, Enter on an empty input ends the values.
    await window.keyboard.type("outdated");
    await expect(names(window).first()).toHaveText("relation.outdated");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("List hints relation.outdated · kind:");
    await expect(line.locator(".explain-keys")).toHaveText(
      `${ENTER} adds a value · ${ENTER} on an empty input ends the values · ${MORE} more arguments · Escape back`,
    );
    await window.screenshot({ path: path.join(SHOTS, "sr-210-argument-light.png") });
    // A write command's optional argument, asked after the required one, is skipped with Enter on an empty input.
    await window.keyboard.press("Escape");
    await window.keyboard.press("Escape");
    await window.keyboard.press("Escape");
    await expect(label(window)).toHaveCount(0);
    await openElement(window);
    await mark(window, "Confirm hints", "Confirm hints");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Confirm hints · ref:");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText(/· hintIds:$/u);
    await expect(line.locator(".explain-keys")).toContainText(`${ENTER} on an empty input skips it`);
  });

  test("[SR-210/AK-r2d2] an action of the app shows its description; one that runs a catalog command that command's summary alone; an element none", async () => {
    const { window } = running;
    await mark(window, "Open documentation", "Open documentation");
    const line = explanation(window);
    // As the keyboard reference has it (SR-139 AK6).
    await expect(line.locator(".explain-text")).toHaveText(
      "Open the documentation of ReqSeq in the browser.",
    );
    await expect(line.locator(".explain-side")).toHaveText(`${HELP} help`);
    await window.keyboard.press("Escape");
    // "List all elements" is an action of the app that runs element.list: its summary, no count of arguments.
    await mark(window, "List all elements", "List all elements");
    await expect(line.locator(".explain-text")).toHaveText(userText(catalog("element.list").summary));
    await expect(line.locator(".explain-side")).toHaveText(`${HELP} help`);
    await window.keyboard.press("Escape");
    // An element among the hits of Go to.
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Measure wind speed");
    await expect(window.locator('.candidates [aria-selected="true"]')).toContainText("Measure wind speed");
    await expect(explanation(window)).toHaveCount(0);
  });
});

const help = (window: Page) => window.getByRole("region", { name: "Command help" });
/** The panel of the command help, open or closed. */
const drawer = (window: Page) => window.locator("#command-help");
const markedName = (window: Page) => window.locator('.candidates [aria-selected="true"] .name');

/** The transitions of the panel that move it, with their times (ms): the slide in or out. */
const slides = (window: Page): Promise<{ duration: number; delay: number }[]> =>
  drawer(window).evaluate((element) =>
    element
      .getAnimations()
      .filter(
        (one): one is CSSTransition => one instanceof CSSTransition && one.transitionProperty === "transform",
      )
      .map((one) => {
        const timing = one.effect?.getComputedTiming();
        return { duration: Number(timing?.duration ?? 0), delay: timing?.delay ?? 0 };
      }),
  );

/** The panel and the hits once they stand: their boxes, the font sizes and how the hits are shown. */
const layout = (window: Page) =>
  window.evaluate(() => {
    const panel = document.querySelector("#command-help");
    const hits = document.querySelector(".card-hits");
    const hit = document.querySelector(".candidates li");
    const name = document.querySelector(".candidates li .name");
    const body = document.querySelector("#command-help .help-summary");
    if (panel === null || hits === null || hit === null || name === null || body === null) {
      throw new Error("no command help");
    }
    // 72 characters of the help's text, in its font.
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;width:72ch";
    body.append(probe);
    const chars = probe.getBoundingClientRect().width;
    probe.remove();
    const panelBox = panel.getBoundingClientRect();
    const hitsBox = hits.getBoundingClientRect();
    return {
      panel: { left: panelBox.left, right: panelBox.right, width: panelBox.width },
      hits: { right: hitsBox.right, width: hitsBox.width },
      text: body.getBoundingClientRect().width,
      chars,
      ratio:
        Number.parseFloat(getComputedStyle(body).fontSize) /
        Number.parseFloat(getComputedStyle(name).fontSize),
      opacity: Number(getComputedStyle(hit).opacity),
      filter: getComputedStyle(hit).filter,
    };
  });

/** A small documentation site for F1 and the link of the help, and a browser that records what it is given. */
const docsSite = async (): Promise<string> => {
  const top = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "reqseq-help-docs-")));
  for (const file of [
    "index.html",
    "reference/commands/hint-list/index.html",
    "reference/keyboard-shortcuts/index.html",
  ]) {
    await fsp.mkdir(path.dirname(path.join(top, file)), { recursive: true });
    await fsp.writeFile(path.join(top, file), "<!doctype html><title>ReqSeq</title>");
  }
  return top;
};

const stubBrowser = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ shell }) => {
    const opened: string[] = [];
    Object.assign(globalThis, { reqseqOpened: opened });
    shell.openExternal = (url: string) => {
      opened.push(url);
      return Promise.resolve();
    };
  });

const opened = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => [...((globalThis as { reqseqOpened?: string[] }).reqseqOpened ?? [])]);

test.describe("the command help (SR-210 AK3, AK4, AK5, AK7)", () => {
  let running: RunningApp;
  let site: string;

  test.beforeEach(async () => {
    site = await docsSite();
    running = await launchApp(FIXTURE, { colorScheme: "light", docsFolder: site });
    await stubBrowser(running.app);
    await expect(running.window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  });

  test.afterEach(async () => {
    await running.close();
    await fsp.rm(site, { recursive: true, force: true });
  });

  test("[SR-210/AK-wz9v] [SR-145/AK-tbrz] Ctrl+H slides the help in from the right within 200 ms, 70 % of the card wide but at most 72 characters, over the dimmed and blurred hits, with the summary, details, arguments and the call on the command line", async () => {
    const { window, app } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await fsp.mkdir(SHOTS, { recursive: true });
    await mark(window, "List hints", "List hints");
    await cardSettled(window);
    // The physical Ctrl key, also on macOS.
    await window.keyboard.press("Control+H");
    const shown = help(window);
    await expect(shown).toBeVisible();
    // It slides in, done within 200 ms.
    const slideIn = await slides(window);
    expect(slideIn.length).toBe(1);
    expect((slideIn[0]?.duration ?? 0) + (slideIn[0]?.delay ?? 0)).toBeLessThanOrEqual(200);
    expect(slideIn[0]?.duration ?? 0).toBeGreaterThan(0);
    await transitionsSettled(window);
    const wide = await layout(window);
    // At the right edge of the card; at this width the 72 characters are the limit, under 70 % of the card.
    expect(Math.abs(wide.panel.right - wide.hits.right)).toBeLessThan(2);
    expect(wide.panel.width).toBeLessThan(wide.hits.width * 0.7);
    expect(wide.text).toBeLessThanOrEqual(wide.chars + 1);
    expect(wide.text).toBeGreaterThan(wide.chars - 2);
    // Its body text is 85 to 90 % of the font of the hits; the hits are dimmed and slightly blurred.
    expect(wide.ratio).toBeGreaterThanOrEqual(0.85);
    expect(wide.ratio).toBeLessThanOrEqual(0.9);
    expect(wide.opacity).toBeLessThan(0.6);
    expect(wide.filter).toMatch(/^blur\(/u);
    await expect(markedName(window)).toHaveText("List hints");
    // The content, as plain text from the catalog.
    const hints = catalog("hint.list");
    await expect(shown.locator("h2")).toHaveText(hints.title);
    await expect(shown.locator(".help-summary")).toHaveText(userText(hints.summary));
    if (hints.details !== undefined) {
      await expect(shown.locator(".help-details")).toHaveText(userText(hints.details));
    }
    const fields = Object.keys(hints.input.properties ?? {});
    const required = hints.input.required ?? [];
    await expect(shown.locator("dt")).toHaveText(
      fields.map((field) => `${field} ${required.includes(field) ? "required" : "optional"}`),
    );
    for (const [at, field] of fields.entries()) {
      const description = hints.input.properties?.[field]?.description;
      if (description !== undefined) {
        // As users read it everywhere, without the references of this repository (SR-210 AK6).
        await expect(shown.locator("dt").nth(at).locator("+ dd")).toHaveText(userText(description));
      }
    }
    await expect(shown.locator(".help-cli")).toHaveText("reqseq hint list [options]");
    await window.screenshot({ path: path.join(SHOTS, "sr-210-help-light.png") });
    // F1 and the link in the help open the reference page; the help stays.
    await window.keyboard.press("F1");
    await expect
      .poll(async () => (await opened(app)).at(-1) ?? "")
      .toContain("/reference/commands/hint-list/");
    await shown.getByRole("link", { name: "Reference page" }).click();
    await expect.poll(async () => (await opened(app)).length).toBe(2);
    expect((await opened(app)).at(-1)).toContain("/reference/commands/hint-list/");
    await expect(shown).toBeVisible();
    await expect(window.locator("#prompt-input")).toBeFocused();
    // A required argument is named as such, and as a positional argument of the call.
    await window.keyboard.press("Control+H");
    await window.keyboard.press("Escape");
    await mark(window, "Show relation options", "Show relation options");
    await window.keyboard.press("Control+H");
    await expect(shown.locator("dt")).toHaveText(["ref required", "kind optional"]);
    await expect(shown.locator(".help-cli")).toHaveText("reqseq relation options <ref> [options]");
    // In a narrow window it is 70 % of the card wide.
    await window.keyboard.press("Escape");
    await window.setViewportSize({ width: 520, height: 700 });
    await window.keyboard.press("Control+H");
    await transitionsSettled(window);
    const narrow = await layout(window);
    expect(Math.abs(narrow.panel.width - narrow.hits.width * 0.7)).toBeLessThan(2);
  });

  test("[SR-210/AK-r2d2] an action that sets what a shown list shows: its description, key and the catalog commands it runs by display; F1 and the link open its entry in the keyboard reference", async () => {
    const { window, app } = running;
    await listAll(window);
    await mark(window, "Sort list", "Sort list");
    await window.keyboard.press("Control+H");
    const shown = help(window);
    await expect(shown.locator("h2")).toHaveText("Sort list");
    await expect(shown.locator(".help-summary")).toHaveText("Sort the shown list by a chosen key.");
    await expect(shown.locator(".help-runs dt")).toHaveText(["element.list", "trace.matrix", "element.list"]);
    await expect(shown.locator(".help-runs dd")).toHaveText([
      "in the list",
      "in the traceability matrix",
      "in the package page",
    ]);
    await expect(shown.locator(".help-cli")).toHaveCount(0);
    await expect(shown.locator(".help-arguments")).toHaveCount(0);
    await shown.getByRole("link", { name: "Entry in the keyboard reference" }).click();
    await expect.poll(async () => (await opened(app)).at(-1) ?? "").toContain("#action-sort");
    // An action with a key names it: on the matrix, "Show as list".
    await window.keyboard.press("Escape");
    await window.keyboard.press("Escape");
    await expect(label(window)).toHaveCount(0);
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator(".matrix td.cell").first()).toBeVisible();
    await mark(window, "Show as list", "Show as list");
    await window.keyboard.press("Control+H");
    await expect(shown.locator(".help-key")).toHaveText(mac ? "⌘T" : "Ctrl+T");
    await expect(shown.locator(".help-runs dt")).toHaveText(["element.list"]);
    await window.keyboard.press("F1");
    await expect.poll(async () => (await opened(app)).at(-1) ?? "").toContain("#action-matrix-list");
  });

  test("[SR-210/AK-pxr7] [SR-122/AK-kjhn] [SR-122/AK-h65p] [SR-122/AK-n8p6] [SR-145/AK-mk0f] [SR-134/AK-fmf6] [SR-202/AK-dcyp] [SR-202/AK-fgd8] with the help open the list keys and the wheel scroll it and keep the mark; Escape, Ctrl+H, Backspace and a click on a hit close it shorter, running nothing; Enter, Ctrl+Enter and Tab do nothing; typing closes it and acts; its text can be copied", async () => {
    const { window, app } = running;
    await window.emulateMedia({ reducedMotion: "no-preference" });
    await window.setViewportSize({ width: 900, height: 520 });
    await mark(window, "List hints", "List hints");
    // A click on "help" in the explanation line acts as Ctrl+H.
    await explanation(window).getByRole("button", { name: /help/u }).click();
    await expect(help(window).locator("h2")).toHaveText("List hints");
    await expect(window.locator("#prompt-input")).toBeFocused();
    await transitionsSettled(window);
    const top = (): Promise<number> => drawer(window).evaluate((element) => element.scrollTop);
    const more = await drawer(window).evaluate((element) => element.scrollHeight > element.clientHeight);
    expect(more).toBe(true);
    // Down, Ctrl+N (the physical Ctrl key on every system) and Page Down scroll it down, Up, Ctrl+P and Page Up
    // back; the mark stays.
    for (const [down, up] of [
      ["ArrowDown", "ArrowUp"],
      ["Control+N", "Control+P"],
      ["PageDown", "PageUp"],
    ] as const) {
      await window.keyboard.press(down);
      await expect.poll(top).toBeGreaterThan(0);
      await window.keyboard.press(up);
      await expect.poll(top).toBe(0);
      await expect(markedName(window)).toHaveText("List hints");
    }
    // The wheel over the dimmed hits scrolls the help too.
    const hits = await window.locator(".card-hits").boundingBox();
    await window.mouse.move((hits?.x ?? 0) + 40, (hits?.y ?? 0) + 40);
    await window.mouse.wheel(0, 200);
    await expect.poll(top).toBeGreaterThan(0);
    await expect(markedName(window)).toHaveText("List hints");
    // Enter, Ctrl/Cmd+Enter and Tab do nothing.
    for (const key of ["Enter", "ControlOrMeta+Enter", "Tab"]) {
      await window.keyboard.press(key);
      await expect(help(window)).toBeVisible();
      await expect(label(window)).toHaveText("Command");
      await expect(markedName(window)).toHaveText("List hints");
    }
    await expect(window.locator(".result")).toHaveCount(0);
    // Its text can be selected and copied.
    await help(window).locator(".help-summary").click({ clickCount: 3 });
    await window.keyboard.press("ControlOrMeta+C");
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain(userText(catalog("hint.list").summary).slice(0, 30));
    // Escape slides it out, shorter than it came in, and only it: the prompt stays open with its mark.
    const slideIn = 180;
    await window.keyboard.press("Escape");
    const slideOut = await slides(window);
    expect(slideOut.length).toBe(1);
    expect(slideOut[0]?.duration ?? slideIn).toBeLessThan(slideIn);
    await expect(help(window)).toHaveCount(0);
    await expect(label(window)).toHaveText("Command");
    await expect(markedName(window)).toHaveText("List hints");
    await expect(window.locator("#prompt-input")).toBeFocused();
    // Ctrl+H closes it.
    await window.keyboard.press("Control+H");
    await expect(help(window)).toBeVisible();
    await window.keyboard.press("Control+H");
    await expect(help(window)).toHaveCount(0);
    await expect(markedName(window)).toHaveText("List hints");
    // A click on a dimmed hit closes only the help (SR-202 AK3).
    await window.keyboard.press("Control+H");
    await expect(help(window)).toBeVisible();
    // At its left, beside the help.
    await window.locator('.candidates [aria-selected="true"]').click({ position: { x: 20, y: 5 } });
    await expect(help(window)).toHaveCount(0);
    await expect(label(window)).toHaveText("Command");
    await expect(markedName(window)).toHaveText("List hints");
    // A key that changes the input closes it and then acts as without it.
    await window.keyboard.press("Control+H");
    await expect(help(window)).toBeVisible();
    await window.keyboard.press("Backspace");
    await expect(help(window)).toHaveCount(0);
    await expect(window.locator("#prompt-input")).toHaveValue("List hint");
    // Backspace on an empty input closes only the help (SR-134 AK4); the prompt stays open with its mark.
    await window.locator("#prompt-input").fill("");
    await expect(markedName(window)).not.toHaveText("");
    const first = await markedName(window).textContent();
    let tries = 0;
    while ((await help(window).count()) === 0 && tries < 10) {
      await window.keyboard.press("ArrowDown");
      await window.keyboard.press("Control+H");
      tries += 1;
    }
    await expect(help(window)).toBeVisible();
    const withHelp = await markedName(window).textContent();
    expect(withHelp).not.toBeNull();
    await window.keyboard.press("Backspace");
    await expect(help(window)).toHaveCount(0);
    await expect(label(window)).toHaveText("Command");
    await expect(markedName(window)).toHaveText(withHelp ?? "");
    expect(first).not.toBeNull();
    // Without the help the wheel scrolls the hits of the empty input again (SR-202 AK2).
    const list = window.locator(".candidates");
    await list.hover();
    await window.mouse.wheel(0, 400);
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });

  test("[SR-210/AK-b1r5] with reduced motion the help comes and goes without motion, and the hits stand dimmed and blurred at once", async () => {
    const { window } = running;
    await window.emulateMedia({ reducedMotion: "reduce" });
    await mark(window, "List hints", "List hints");
    await cardSettled(window);
    await window.keyboard.press("Control+H");
    await expect(help(window)).toBeVisible();
    // At once in its place: no transition runs, and the hits are dimmed and blurred already.
    expect(await window.evaluate(() => document.getAnimations().length)).toBe(0);
    const at = await layout(window);
    expect(Math.abs(at.panel.right - at.hits.right)).toBeLessThan(2);
    expect(at.opacity).toBeLessThan(0.6);
    expect(at.filter).toMatch(/^blur\(/u);
    // And it goes at once.
    await window.keyboard.press("Escape");
    expect(await window.evaluate(() => document.getAnimations().length)).toBe(0);
    await expect(help(window)).toHaveCount(0);
    await expect(drawer(window)).toBeHidden();
    const after = await window.evaluate(
      () => getComputedStyle(document.querySelector(".candidates li") ?? document.body).opacity,
    );
    expect(after).toBe("1");
  });
});

test.describe("the keys of an argument step", () => {
  let running: RunningApp;

  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await openElement(running.window);
  });

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-108/AK-ch3r] Ctrl/Cmd+Enter takes the answer and offers the optional arguments; a list takes a value per Enter, and Enter on an empty input ends it", async () => {
    const { window } = running;
    await mark(window, "Show relation options", "Show relation options");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Show relation options · ref:");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label(window)).toHaveText("Show relation options SR-0000b1 · more arguments:");
    await expect(names(window)).toHaveText(["Run", "kind"]);
    await window.keyboard.press("Escape");
    await window.keyboard.press("Escape");
    await window.keyboard.press("Escape");
    // A list: one value per Enter, Enter on an empty input ends the values.
    await mark(window, "Show related elements", "Show related elements");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Show related elements · refs:");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Show related elements SR-0000b1 · refs:");
    await window.keyboard.type("SR-0000b2");
    await expect(names(window).first()).toContainText("SR-0000b2");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText(/^Show related elements SR-0000b1 SR-0000b2 .*· refs:$/u);
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText(/· direction:$/u);
  });

  test("[SR-134/AK-fmf6] Backspace in an empty input shows the previous step, as Escape does", async () => {
    const { window } = running;
    await mark(window, "Show relation options", "Show relation options");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Show relation options · ref:");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label(window)).toHaveText("Show relation options SR-0000b1 · more arguments:");
    await window.keyboard.press("Backspace");
    await expect(label(window)).toHaveText("Show relation options · ref:");
    await expect(window.locator("#prompt-input")).toHaveValue("");
    // Before the first argument: the command prompt, still open, with nothing run.
    await window.keyboard.press("Backspace");
    await expect(label(window)).toHaveText("Command");
    await expect(window.locator(".result")).toHaveCount(0);
    // Escape takes the same steps back.
    await mark(window, "Show relation options", "Show relation options");
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label(window)).toHaveText("Show relation options SR-0000b1 · more arguments:");
    await window.keyboard.press("Escape");
    await expect(label(window)).toHaveText("Show relation options · ref:");
  });
});
