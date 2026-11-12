// The explanation line of the command prompt on the built app (SR-210): under the hits, two text lines high, it
// explains the marked catalog command and, while an argument is asked, that argument and the keys of its step, with
// the texts of the catalog; an action of the app shows its description, an element none. Ctrl+H shows the command help in the card. Also the keys of an argument step (SR-108 AK6,
// SR-134 AK4). The light screenshots go to `test-results/electron/screenshots/` (or the folder in
// REQSEQ_SCREENSHOTS). Keys use ControlOrMeta, so the same tests run on Linux, macOS and Windows; Ctrl+H is the
// physical Ctrl key on every system (SR-145 AK4).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { userText } from "../../../scripts/contracts/user-text.mjs";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

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

test.describe("the command help (SR-210 AK3, AK4)", () => {
  let running: RunningApp;

  test.beforeEach(async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    await expect(running.window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  });

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-210/AK-wz9v] [SR-145/AK-tbrz] Ctrl+H shows the summary, the details, each argument with its description and whether it is required, and the call on the command line", async () => {
    const { window } = running;
    await fsp.mkdir(SHOTS, { recursive: true });
    await mark(window, "List hints", "List hints");
    // The physical Ctrl key, also on macOS.
    await window.keyboard.press("Control+H");
    const shown = help(window);
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
    // Each argument with the description the catalog gives it.
    for (const [at, field] of fields.entries()) {
      const description = hints.input.properties?.[field]?.description;
      if (description !== undefined) {
        // As users read it everywhere, without the references of this repository (SR-210 AK6).
        await expect(shown.locator("dt").nth(at).locator("+ dd")).toHaveText(userText(description));
      }
    }
    await expect(shown.locator(".help-cli")).toHaveText("reqseq hint list [options]");
    // The hits make room for it; the prompt stays open.
    await expect(window.locator(".candidates")).toHaveCount(0);
    await expect(label(window)).toHaveText("Command");
    // A required argument is named as such, and as a positional argument of the call.
    await window.keyboard.press("Control+H");
    await window.keyboard.press("Escape");
    await mark(window, "Show relation options", "Show relation options");
    await window.keyboard.press("Control+H");
    await expect(shown.locator("dt")).toHaveText(["ref required", "kind optional"]);
    await expect(shown.locator(".help-cli")).toHaveText("reqseq relation options <ref> [options]");
    await window.screenshot({ path: path.join(SHOTS, "sr-210-help-light.png") });
  });

  test("[SR-210/AK-pxr7] [SR-134/AK-ykbf] Ctrl+H and Escape show the hits again, the help follows the mark, Enter and Ctrl/Cmd+Enter act as without it, a click on help opens it, and it scrolls", async () => {
    const { window } = running;
    await mark(window, "Show relation options", "Show relation options");
    // A click on "help" in the explanation line acts as Ctrl+H.
    await explanation(window).getByRole("button", { name: /help/u }).click();
    await expect(help(window).locator("h2")).toHaveText("Show relation options");
    // Ctrl+H again, then Escape: only the help closes, the prompt stays open with its mark.
    await window.keyboard.press("Control+H");
    await expect(help(window)).toHaveCount(0);
    await expect(window.locator('.candidates [aria-selected="true"] .name')).toHaveText(
      "Show relation options",
    );
    await window.keyboard.press("Control+H");
    await expect(help(window)).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(help(window)).toHaveCount(0);
    await expect(label(window)).toHaveText("Command");
    await expect(window.locator('.candidates [aria-selected="true"] .name')).toHaveText(
      "Show relation options",
    );
    // The mark moves while the help is open: it shows the newly marked command.
    await window.locator("#prompt-input").fill("Show relat");
    await expect(names(window).nth(0)).toHaveText("Show relation options");
    await expect(names(window).nth(1)).toHaveText("Show related elements");
    await window.keyboard.press("Control+H");
    await expect(help(window).locator("h2")).toHaveText("Show relation options");
    await window.keyboard.press("ArrowDown");
    await expect(help(window).locator("h2")).toHaveText("Show related elements");
    await window.keyboard.press("ArrowUp");
    await expect(help(window).locator("h2")).toHaveText("Show relation options");
    // Ctrl/Cmd+Enter takes the marked command as without the help: it offers the optional arguments.
    await window.keyboard.press("Escape");
    await window.locator("#prompt-input").fill("List hints");
    await expect(window.locator('.candidates [aria-selected="true"] .name')).toHaveText("List hints");
    await window.keyboard.press("Control+H");
    await expect(help(window).locator("h2")).toHaveText("List hints");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label(window)).toHaveText("List hints · more arguments:");
    await expect(help(window)).toHaveCount(0);
    await window.keyboard.press("Escape");
    await expect(label(window)).toHaveText("Command");
    await window.keyboard.press("Escape");
    await expect(label(window)).toHaveCount(0);
    await mark(window, "Show relation options", "Show relation options");
    await window.keyboard.press("Control+H");
    // Enter takes the marked command as without the help: it asks its argument.
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Show relation options · ref:");
    await expect(help(window)).toHaveCount(0);
    await window.keyboard.press("Escape");
    await window.keyboard.press("Escape");
    // Higher than the card: Page Down, Page Up and the wheel scroll it.
    await window.setViewportSize({ width: 520, height: 420 });
    await mark(window, "List hints", "List hints");
    await window.keyboard.press("Control+H");
    const scroll = (): Promise<{ top: number; more: boolean }> =>
      help(window).evaluate((element) => ({
        top: element.scrollTop,
        more: element.scrollHeight > element.clientHeight,
      }));
    expect(await scroll()).toEqual({ top: 0, more: true });
    await window.keyboard.press("PageDown");
    await expect.poll(async () => (await scroll()).top).toBeGreaterThan(0);
    await window.keyboard.press("PageUp");
    await expect.poll(async () => (await scroll()).top).toBe(0);
    await help(window).hover();
    await window.mouse.wheel(0, 200);
    await expect.poll(async () => (await scroll()).top).toBeGreaterThan(0);
    await expect(label(window)).toHaveText("Command");
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
