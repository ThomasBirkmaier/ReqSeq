// The explanation line of the command prompt on the built app (SR-210): under the hits it explains the marked
// catalog command and, while an argument is asked, that argument and the keys of its step, with the texts of
// the catalog; an entry that is no catalog command has none. Ctrl+H shows the command help in the card. Also the keys of an argument step (SR-108 AK6,
// SR-134 AK4). The light screenshots go to `test-results/electron/screenshots/` (or the folder in
// REQSEQ_SCREENSHOTS). Keys use ControlOrMeta, so the same tests run on Linux, macOS and Windows; Ctrl+H is the
// physical Ctrl key on every system (SR-145 AK4).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
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

const names = (window: Page) => window.locator('.candidates [role="option"] .name');
const explanation = (window: Page) => window.getByRole("note", { name: "Explanation" });
const label = (window: Page) => window.locator("label.prompt-label");

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

  test("[SR-210/AK-gqgt] the marked catalog command shows its summary and arguments, and the line changes with the mark", async () => {
    const { window } = running;
    await fsp.mkdir(SHOTS, { recursive: true });
    await mark(window, "List hints", "List hints");
    const line = explanation(window);
    const hints = catalog("hint.list");
    await expect(line.locator(".explain-summary")).toHaveText(hints.summary);
    await expect(line.locator(".explain-arguments")).toHaveText(
      `no required arguments · 7 optional: kind, type, package, variant, ref, limit, offset ${MORE} to give them`,
    );
    await window.screenshot({ path: path.join(SHOTS, "sr-210-explanation-light.png") });
    // The mark moves: the line shows the newly marked command at once.
    await window.keyboard.press("ArrowDown");
    const marked = await window.locator('.candidates [aria-selected="true"] .name').textContent();
    const next = [...CATALOG.values()].find((entry) => entry.title === marked);
    expect(next).toBeDefined();
    await expect(line.locator(".explain-summary")).toHaveText(next?.summary ?? "");
    // A command with a required argument names it.
    await window.keyboard.press("Escape");
    await mark(window, "Show relation options", "Show relation options");
    await expect(line.locator(".explain-arguments")).toHaveText(
      `required: ref · 1 optional: kind ${MORE} to give them`,
    );
    // A command without arguments says so.
    await window.keyboard.press("Escape");
    await mark(window, "List baselines", "List baselines");
    await expect(line.locator(".explain-arguments")).toHaveText("no arguments");
    // Where the line is too narrow, the summary and the names end with "…"; the number and the key stay.
    await window.keyboard.press("Escape");
    await window.setViewportSize({ width: 520, height: 700 });
    await mark(window, "List hints", "List hints");
    const cut = async (selector: string): Promise<{ overflow: string; cut: boolean }> =>
      line.locator(selector).evaluate((element) => ({
        overflow: getComputedStyle(element).textOverflow,
        cut: element.scrollWidth > element.clientWidth,
      }));
    expect(await cut(".explain-summary")).toEqual({ overflow: "ellipsis", cut: true });
    expect(await cut(".explain-names")).toEqual({ overflow: "ellipsis", cut: true });
    await expect(line.getByText("7 optional:")).toBeInViewport({ ratio: 1 });
    await expect(line.locator(".explain-arguments kbd")).toBeInViewport({ ratio: 1 });
    await expect(line.locator(".explain-help")).toBeInViewport({ ratio: 1 });
  });

  test("[SR-210/AK-t8sc] an asked argument shows its catalog description and the keys of its step", async () => {
    const { window } = running;
    await mark(window, "List hints", "List hints");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label(window)).toHaveText("List hints · more arguments:");
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("List hints · kind:");
    const line = explanation(window);
    const kind = catalog("hint.list").input.properties?.["kind"]?.description ?? "";
    await expect(line.locator(".explain-description")).toHaveText(`kind · ${kind}`);
    await expect(line.locator(".explain-keys")).toHaveText(
      `${ENTER} adds a value · ${MORE} more arguments · Escape back`,
    );
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

  test("[SR-210/AK-r2d2] an entry that is no catalog command shows no explanation; an action that runs one shows that command's", async () => {
    const { window } = running;
    await mark(window, "Open documentation", "Open documentation");
    await expect(explanation(window)).toHaveCount(0);
    await window.keyboard.press("Escape");
    // "List all elements" is an action of the app that runs element.list.
    await mark(window, "List all elements", "List all elements");
    await expect(explanation(window).locator(".explain-summary")).toHaveText(catalog("element.list").summary);
    // The action asks the command's arguments its own way: the line names none of them.
    await expect(explanation(window).locator(".explain-arguments")).toHaveCount(0);
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
    await expect(shown.locator(".help-summary")).toHaveText(hints.summary);
    if (hints.details !== undefined) {
      await expect(shown.locator(".help-details")).toHaveText(hints.details);
    }
    const fields = Object.keys(hints.input.properties ?? {});
    const required = hints.input.required ?? [];
    await expect(shown.locator("dt")).toHaveText(
      fields.map((field) => `${field} ${required.includes(field) ? "required" : "optional"}`),
    );
    const kind = hints.input.properties?.["kind"]?.description ?? "";
    await expect(shown.locator("dt").first().locator("+ dd")).toHaveText(kind);
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

  test("[SR-210/AK-pxr7] [SR-134/AK-ykbf] Ctrl+H and Escape show the hits again, the help follows the mark, Enter acts as without it, a click on help opens it, and it scrolls", async () => {
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
