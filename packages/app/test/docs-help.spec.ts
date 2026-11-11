// The bundled documentation from the app (SR-141 AK2, AK3; product owner decision, 2026-11-08): Help > ReqSeq
// Documentation and F1 on a command of the command prompt open a page of the documentation in the default browser,
// served by main's docs server on 127.0.0.1. The browser is the person's, so `shell.openExternal` is stubbed and the
// test fetches the URL it got from that server. The site is a small fixture (the delivery ships the real one, #1205).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

/** Where the screenshots go (as in `app.spec.ts`). */
const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const PAGES: Readonly<Record<string, string>> = {
  "index.html": "<!doctype html><title>ReqSeq documentation</title><h1>Start</h1>",
  "reference/commands/relation-options/index.html":
    "<!doctype html><title>relation.options</title><h1>Show relation options</h1>",
  "reference/keyboard-shortcuts/index.html":
    '<!doctype html><title>Keyboard shortcuts</title><h1>Keys</h1><p id="action-close-all">Close all buffers</p>',
};

/** A fixture site in a temporary folder. */
const fixtureSite = async (): Promise<string> => {
  const top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-docs-site-")));
  for (const [file, text] of Object.entries(PAGES)) {
    await fs.mkdir(path.dirname(path.join(top, file)), { recursive: true });
    await fs.writeFile(path.join(top, file), text);
  }
  return top;
};

/** Stands in for the default browser: main's `shell.openExternal` records the URLs it gets. */
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

/** Help > ReqSeq Documentation, clicked through the menu (a key sent to the page does not reach the menu). */
const clickHelp = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ Menu }) => {
    const help = Menu.getApplicationMenu()?.items.find((item) => item.role === "help");
    help?.submenu?.items.find((item) => item.label === "ReqSeq Documentation")?.click();
  });

/** The page at `url`, as the browser gets it from main's docs server. */
const fetchPage = async (url: string): Promise<{ status: number; csp: string | null; text: string }> => {
  const response = await fetch(url);
  return {
    status: response.status,
    csp: response.headers.get("content-security-policy"),
    text: await response.text(),
  };
};

const LOOPBACK = /^http:\/\/127\.0\.0\.1:(\d+)\//;

test.describe("the bundled documentation", () => {
  let running: RunningApp;
  let site: string;

  test.beforeEach(async () => {
    site = await fixtureSite();
  });

  test.afterEach(async () => {
    await running.close();
    await fs.rm(site, { recursive: true, force: true });
  });

  test("[SR-141/AK2] Help > ReqSeq Documentation opens the bundled documentation", async () => {
    running = await launchApp({ fixture: "SR-069/filter" }, { docsFolder: site });
    const { app, window } = running;
    // The window has loaded its workspace, so it hears the menu and takes keys.
    await expect(window.getByLabel("Modeline")).toContainText("Weather station");
    await stubBrowser(app);
    await clickHelp(app);
    await expect(window.getByLabel("Minibuffer")).toHaveText("Opened the documentation in the browser");
    await window.screenshot({ path: path.join(SHOTS, "help-documentation-light.png") });
    const urls = await opened(app);
    expect(urls).toHaveLength(1);
    const [url = ""] = urls;
    // The start page, on loopback, from the site of the delivery.
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page = await fetchPage(url);
    expect(page.status).toBe(200);
    expect(page.text).toBe(PAGES["index.html"]);
    expect(page.csp).toContain("default-src 'self'");
  });

  test("[SR-141/AK3] help on a command in the command prompt opens its reference page", async () => {
    running = await launchApp({ fixture: "SR-069/filter" }, { docsFolder: site });
    const { app, window } = running;
    // The window has loaded its workspace, so it hears the menu and takes keys.
    await expect(window.getByLabel("Modeline")).toContainText("Weather station");
    await stubBrowser(app);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Show relation options");
    await expect(window.locator('.candidates [aria-selected="true"] .name')).toHaveText(
      "Show relation options",
    );
    await window.keyboard.press("F1");
    await expect.poll(() => opened(app)).toHaveLength(1);
    const [url = ""] = await opened(app);
    expect(url).toMatch(LOOPBACK);
    expect(url.replace(LOOPBACK, "/")).toBe("/reference/commands/relation-options/");
    expect((await fetchPage(url)).text).toBe(PAGES["reference/commands/relation-options/index.html"]);
    // The prompt stays open, and the minibuffer says where the page went once it closes.
    await expect(window.locator("label.prompt-label")).toHaveText("Command");
    await window.keyboard.press("Escape");
    await expect(window.getByLabel("Minibuffer")).toHaveText("Opened the documentation in the browser");
  });

  test("[SR-141/AK3] help on a command only the app has opens its place in the key reference", async () => {
    running = await launchApp({ fixture: "SR-069/filter" }, { docsFolder: site });
    const { app, window } = running;
    await expect(window.getByLabel("Modeline")).toContainText("Weather station");
    await stubBrowser(app);
    // "Close all buffers" is offered once a buffer besides the overview is open.
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("List all elements");
    await window.keyboard.press("Enter");
    await expect(window.getByRole("listbox", { name: "All elements" })).toBeVisible();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Close all buffers");
    await expect(window.locator('.candidates [aria-selected="true"] .name')).toHaveText("Close all buffers");
    await window.keyboard.press("F1");
    await expect.poll(() => opened(app)).toHaveLength(1);
    const [url = ""] = await opened(app);
    expect(url).toMatch(LOOPBACK);
    expect(url.replace(LOOPBACK, "/")).toBe("/reference/keyboard-shortcuts/#action-close-all");
    expect((await fetchPage(url)).text).toBe(PAGES["reference/keyboard-shortcuts/index.html"]);
  });

  test("a delivery without the documentation says so and opens nothing", async () => {
    const missing = path.join(site, "missing");
    running = await launchApp({ fixture: "SR-069/filter" }, { docsFolder: missing });
    const { app, window } = running;
    // The window has loaded its workspace, so it hears the menu and takes keys.
    await expect(window.getByLabel("Modeline")).toContainText("Weather station");
    await stubBrowser(app);
    await clickHelp(app);
    await expect(window.getByLabel("Minibuffer")).toHaveText(
      `No documentation in ${missing}: the folder or its index.html is missing`,
    );
    expect(await opened(app)).toEqual([]);
  });
});
