// The calm start (SR-118) and the quick jump (SR-119 AK1), on the built app and a fixture workspace. What the
// overview shows is compared with what the CLI gives for the same workspace (SR-080). Keys use ControlOrMeta,
// so the same tests run on Linux and macOS.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { DEFAULT_SORT, launchApp, listAll } from "./support/app.js";

/** 14 elements: 6 types, 5 of them system requirements (fixtures/README.md). */
const FIXTURE = { fixture: "SR-069/filter" };

interface Facets {
  readonly total: number;
  readonly types: readonly { readonly key: string; readonly name: string; readonly count: number }[];
}
interface Listed {
  readonly elements: readonly { readonly title: string; readonly shortId: string; readonly id: string }[];
  readonly total: number;
}

const cliJson = async <T>(running: RunningApp, argv: readonly string[]): Promise<T> => {
  const result = await running.cli(argv);
  expect([argv.join(" "), result.code]).toEqual([argv.join(" "), 0]);
  return JSON.parse(result.stdout) as T;
};

const overview = (window: Page) => window.getByRole("listbox", { name: "Overview" });
const modeline = (window: Page) => window.getByLabel("Modeline");

/** Opens an element by Ctrl+P, the text and Enter, typed without waiting in between (SR-119 AK1). */
const jump = async (window: Page, text: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(text);
  await window.keyboard.press("Enter");
};

const runCommand = async (window: Page, command: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(command);
  await window.keyboard.press("Enter");
};

/** Every file under `root` with a hash of its content and its modification time. */
const snapshot = async (root: string): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
      } else {
        const [content, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
        result[path.relative(root, file)] =
          `${createHash("sha256").update(content).digest("hex")} ${String(stat.mtimeMs)}`;
      }
    }
  };
  await walk(root);
  return result;
};

test.describe("the overview of a fixture workspace", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await expect(overview(running.window)).toBeVisible();
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-118/AK1] opening a workspace shows one line per type with its count, as `element facets` gives them", async () => {
    const { window } = running;
    const facets = await cliJson<Facets>(running, ["element", "facets"]);
    await expect(window.getByRole("option")).toHaveCount(facets.types.length);
    expect(await window.getByRole("option").allTextContents()).toEqual(
      facets.types.map((type) => `${type.name} ${String(type.count)}`),
    );
    await expect(modeline(window)).toContainText("Overview");
    await expect(modeline(window)).toContainText(`${String(facets.total)} elements`);
    // Nothing of the recent elements before one was opened.
    await expect(window.getByText("Recent")).toHaveCount(0);
  });

  test("[SR-118/AK1] below the types the overview shows the elements opened last, newest first", async () => {
    const { window } = running;
    await jump(window, "icing");
    await expect(window.locator("article h1")).toHaveText("Survive icing");
    await jump(window, "dial");
    await expect(window.locator("article h1")).toHaveText("Show a dial");
    await jump(window, "storms");
    await expect(window.locator("article h1")).toHaveText("Warn of storms");
    await runCommand(window, "show overview");
    await expect(overview(window)).toBeVisible();
    const facets = await cliJson<Facets>(running, ["element", "facets"]);
    const recent = window.locator(".recent .title");
    await expect(recent).toHaveText(["Warn of storms", "Show a dial", "Survive icing"]);
    await expect(window.getByRole("option")).toHaveCount(facets.types.length + 3);
    // Enter on a recent element opens it.
    await window.getByRole("option").filter({ hasText: "Show a dial" }).click();
    await expect(window.locator("article h1")).toHaveText("Show a dial");
  });

  test("[SR-118/AK1] the recent elements are there again after the app restarts", async () => {
    const { window } = running;
    await jump(window, "icing");
    await expect(window.locator("article h1")).toHaveText("Survive icing");
    await jump(window, "dial");
    await expect(window.locator("article h1")).toHaveText("Show a dial");
    const { kept } = running;
    await running.close({ keep: true });
    running = await launchApp(undefined, { kept });
    await expect(overview(running.window)).toBeVisible();
    await expect(running.window.locator(".recent .title")).toHaveText(["Show a dial", "Survive icing"]);
  });

  test("[SR-118/AK2] a type line opens the list of that type, as long as its count", async () => {
    const { window } = running;
    const facets = await cliJson<Facets>(running, ["element", "facets"]);
    const requirements = facets.types.find((type) => type.key === "system-requirement");
    expect(requirements?.count).toBeGreaterThan(1);
    await window.getByRole("option", { name: `System Requirement ${String(requirements?.count)}` }).click();
    await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", "type: system-requirement");
    await expect(modeline(window)).toContainText(`${String(requirements?.count)} elements`);
    const listed = await cliJson<Listed>(running, [
      "element",
      "list",
      "--input",
      JSON.stringify({
        selection: { where: { type: ["system-requirement"], subtypes: false } },
        sort: DEFAULT_SORT,
      }),
    ]);
    expect(listed.total).toBe(requirements?.count);
    expect(await window.locator(".row .title").allTextContents()).toEqual(
      listed.elements.map((element) => element.title),
    );
    // The same with the keys: Down to the line, Enter.
    await runCommand(window, "show overview");
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", /^type: /);
  });

  test("[SR-118/AK3] right after opening, Ctrl+P reaches every element by short ID and by title", async () => {
    const { window } = running;
    const listed = await cliJson<Listed>(running, ["element", "list"]);
    expect(listed.total).toBe(14);
    for (const element of listed.elements) {
      for (const text of [element.shortId, element.title]) {
        // Each round starts like a fresh start: the overview is the only buffer.
        await jump(window, text);
        await expect(window.locator("article h1")).toHaveText(element.title);
        await expect(modeline(window)).toContainText(element.shortId);
        await runCommand(window, "close buffer");
        await expect(overview(window)).toBeVisible();
      }
    }
  });

  test('[SR-118/AK4] the overview lists no element until "List all elements"', async () => {
    const { window } = running;
    await expect(window.locator(".row")).toHaveCount(0);
    await expect(window.getByLabel("Sheet")).not.toContainText("Survive icing");
    await runCommand(window, "list all");
    await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", "All elements");
    const listed = await cliJson<Listed>(running, [
      "element",
      "list",
      "--input",
      JSON.stringify({ sort: DEFAULT_SORT }),
    ]);
    expect(await window.locator(".row .title").allTextContents()).toEqual(
      listed.elements.map((element) => element.title),
    );
    // Closing the list shows the overview again.
    await runCommand(window, "close buffer");
    await expect(overview(window)).toBeVisible();
  });

  test("[SR-118/AK5] opening elements leaves every file of the workspace unchanged", async () => {
    const { window } = running;
    const root = running.workspace?.root ?? "";
    expect(root).not.toBe("");
    const before = await snapshot(root);
    expect(Object.keys(before).length).toBeGreaterThan(14);
    await jump(window, "icing");
    await expect(window.locator("article h1")).toHaveText("Survive icing");
    await jump(window, "dial");
    await expect(window.locator("article h1")).toHaveText("Show a dial");
    await listAll(window);
    await runCommand(window, "show overview");
    await expect(window.locator(".recent .title")).toHaveText(["Show a dial", "Survive icing"]);
    expect(await snapshot(root)).toEqual(before);
  });

  test("[SR-119/AK1] Ctrl+P, a short ID or words of the title, Enter opens the requirement", async () => {
    const { window } = running;
    const got = await cliJson<{ element: { title: string; shortId: string } }>(running, [
      "element",
      "get",
      "SR-0000b3",
    ]);
    // Two key presses and the text, with no waiting in between.
    await jump(window, got.element.shortId);
    await expect(window.locator("article h1")).toHaveText(got.element.title);
    await runCommand(window, "close buffer");
    await jump(window, "icing");
    await expect(window.locator("article h1")).toHaveText(got.element.title);
  });
});
