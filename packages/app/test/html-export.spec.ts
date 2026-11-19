// The pages of the HTML export in Chromium (SR-231 AK2, AK4, AK5): the CLI exports a workspace, and a window of
// the built app with a session of its own opens the pages over `file://` and from a server on 127.0.0.1 under the
// sub-path /a/b/. Every request is recorded: none may leave the folder, and the server answers a request outside
// /a/b/ with a sentinel the test fails on. The window loads each page from main (`loadURL`), as the app's guard
// stops navigations a page starts. Firefox treats `file://` stricter and is checked by hand (see the PR of #1963).
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

const TEXT = [
  "Speed $v = \\frac{d}{t}$ of the wind.",
  "",
  "$$",
  "E = \\tfrac{1}{2} m v^2",
  "$$",
  "",
  "> [!WARNING]",
  "> Check the mast.",
  "",
  "| Range | Unit |",
  "|:--|--:|",
  "| 0–60 | m/s |",
  "",
  "![mast](img/mast.png)",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Sensor] --> B[Display]",
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  "  A -->",
  "```",
  "",
  `See [gusts](reqseq:${GUSTS}).`,
  "",
  // The unsafe content of SR-235 AK4: each would set the sentinel if it ran.
  '<img src=x onerror="window.reqseqSentinel=1"> <script>window.reqseqSentinel=2</script>',
  "",
  "[run](javascript:window.reqseqSentinel=3) ![net](https://example.org/x.png)",
  "",
  "```mermaid",
  "flowchart LR",
  "  A --> B",
  "  click A call reqseqSentinel()",
  "```",
].join("\n");

const FIXTURE = {
  fixture: "SR-001/two-elements",
  files: {
    "requirements/SR-6328cee88fb3.md": `---\nid: ${WIND}\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\n---\n\n${TEXT}\n`,
    "requirements/img/mast.png": PNG,
  },
};

const PARTITION = "reqseq-html-export";

/** A window of its own session, which records every request it makes; gives its id. */
const openWindow = async (app: ElectronApplication): Promise<{ page: Page; id: number }> => {
  const next = app.waitForEvent("window");
  const id = await app.evaluate(({ BrowserWindow, session }, partition) => {
    const own = session.fromPartition(partition);
    const requests: string[] = [];
    Object.assign(globalThis, { reqseqExportRequests: requests });
    own.webRequest.onBeforeRequest((details, callback) => {
      requests.push(details.url);
      callback({});
    });
    const window = new BrowserWindow({
      width: 1280,
      height: 900,
      webPreferences: { partition, sandbox: true, contextIsolation: true },
    });
    void window.loadURL("about:blank");
    return window.id;
  }, PARTITION);
  return { page: await next, id };
};

/** Loads `url` into the window from main, and waits until its scripts drew every diagram. */
const load = async (app: ElectronApplication, page: Page, id: number, url: string): Promise<void> => {
  await app.evaluate(
    ({ BrowserWindow }, [windowId, address]) => BrowserWindow.fromId(windowId)?.loadURL(address),
    [id, url] as const,
  );
  await expect(page).toHaveURL(url);
  await page.waitForFunction(
    () =>
      document.querySelectorAll("pre[data-rq-diagram]").length === 0 ||
      document.querySelector(".rq-diagram-image, .rq-render-error") !== null,
  );
};

const requests = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => [...((globalThis as { reqseqExportRequests?: string[] }).reqseqExportRequests ?? [])]);

const resize = (app: ElectronApplication, id: number, width: number): Promise<void> =>
  app.evaluate(({ BrowserWindow }, [windowId, w]) => BrowserWindow.fromId(windowId)?.setContentSize(w, 900), [
    id,
    width,
  ] as const);

/** A server of `site` under /a/b/; a request outside it gets the sentinel and is recorded. */
const serve = async (
  site: string,
): Promise<{ base: string; outside: string[]; close: () => Promise<void> }> => {
  const outside: string[] = [];
  const server = http.createServer((request, response) => {
    const url = new URL(String(request.url), "http://127.0.0.1");
    if (!url.pathname.startsWith("/a/b/")) {
      outside.push(url.pathname);
      response.writeHead(200, { "content-type": "text/plain" }).end("sentinel");
      return;
    }
    const file = path.join(site, ...decodeURIComponent(url.pathname.slice("/a/b/".length)).split("/"));
    const type =
      { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png" }[
        path.extname(file)
      ] ?? "application/octet-stream";
    fs.readFile(file).then(
      (bytes) => response.writeHead(200, { "content-type": type }).end(bytes),
      () => response.writeHead(404).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${String(port)}/a/b/`,
    outside,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
};

test.describe("the pages of the HTML export", () => {
  let running: RunningApp;
  let site: string;
  const problems: string[] = [];
  test.beforeEach(async () => {
    problems.length = 0;
    running = await launchApp(FIXTURE);
    site = path.join(String(running.workspace?.root), "site");
    const exported = await running.cli(["html", "export", "--output", site]);
    expect(exported.code, exported.stderr).toBe(0);
  });
  test.afterEach(async () => {
    // The window of the pages first, so the app ends as after a user closes its own window.
    await running.app.evaluate(({ BrowserWindow, session }, partition) => {
      const own = session.fromPartition(partition);
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.webContents.session === own) {
          window.destroy();
        }
      }
    }, PARTITION);
    expect(problems).toEqual([]);
    await running.close();
  });

  const watch = (page: Page): void => {
    page.on("console", (message) => {
      if (
        /Content Security Policy|Refused to|quirks mode/iu.test(message.text()) ||
        message.type() === "error"
      ) {
        problems.push(message.text());
      }
    });
    page.on("pageerror", (error) => problems.push(error.message));
  };

  /** The checks of one page with formulas and diagrams, at the folder `base`. */
  const checkElementPage = async (page: Page): Promise<void> => {
    // Formulas: set at export, in KaTeX's own font from the folder's stylesheet.
    await expect(page.locator(".katex").first()).toBeVisible();
    expect(
      await page.evaluate(async () => {
        await document.fonts.load("1em KaTeX_Main");
        return [...document.fonts].some((font) => font.family === "KaTeX_Main" && font.status === "loaded");
      }),
    ).toBe(true);
    // The good diagram is an image that loaded; the broken one shows its error under its source.
    const image = page.locator("img.rq-diagram-image");
    await expect(image).toHaveCount(1);
    expect(await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(page.locator(".rq-render-error")).toHaveCount(1);
    await expect(page.locator(".rq-render-error")).toContainText("Error");
    // The callout is the docs' aside, the table and the image copy are there.
    await expect(page.locator("aside.starlight-aside--caution")).toContainText("Check the mast.");
    await expect(page.locator("td", { hasText: "m/s" })).toHaveCSS("text-align", /right$/u);
    // Nothing of the unsafe content ran or loaded; it is text.
    expect(
      await page.evaluate(() => (window as { reqseqSentinel?: unknown }).reqseqSentinel),
    ).toBeUndefined();
    await expect(page.locator(".sl-markdown-content")).toContainText(
      "<script>window.reqseqSentinel=2</script>",
    );
    expect(await page.locator('img[alt="mast"]').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(
      1,
    );
  };

  /** Dark on one page stays dark on the next; the menu is a popover below 50em. */
  const checkThemeAndMenu = async (
    app: ElectronApplication,
    page: Page,
    id: number,
    index: string,
  ): Promise<void> => {
    await page.locator("header starlight-theme-select select").selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await load(app, page, id, index);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator("header starlight-theme-select select").selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await resize(app, id, 600);
    const pane = page.locator("sl-sidebar-pane");
    await expect(pane).toHaveAttribute("popover", "auto");
    await expect(pane).toBeHidden();
    await page.locator("button.sl-menu-button").click();
    await expect(pane).toBeVisible();
    await expect(page.locator(".main-frame")).toHaveAttribute("inert", "");
    await page.keyboard.press("Escape");
    await expect(pane).toBeHidden();
    await resize(app, id, 1280);
    await expect(pane).not.toHaveAttribute("popover");
    await expect(pane).toBeVisible();
  };

  test("[SR-231/AK-f39g] opened over file://, every page shows its content and asks for no file outside the folder", async () => {
    const { app } = running;
    const { page, id } = await openWindow(app);
    watch(page);
    const root = pathToFileURL(`${site}${path.sep}`).href;
    await load(app, page, id, `${root}elements/${WIND}.html`);
    await checkElementPage(page);
    await page.screenshot({ path: path.join(SHOTS, "html-export-element-light.png"), fullPage: true });
    await checkThemeAndMenu(app, page, id, `${root}index.html`);
    for (const url of await requests(app)) {
      expect(url.startsWith(root) || url === "about:blank" || url.startsWith("data:"), url).toBe(true);
    }
  });

  test("[SR-231/AK-f39g] served under a sub-path, every page shows its content and asks for nothing outside it", async () => {
    const { app } = running;
    const server = await serve(site);
    try {
      const { page, id } = await openWindow(app);
      watch(page);
      await load(app, page, id, `${server.base}elements/${WIND}.html`);
      await checkElementPage(page);
      await checkThemeAndMenu(app, page, id, `${server.base}index.html`);
      await page.screenshot({ path: path.join(SHOTS, "html-export-index-light.png") });
      await load(app, page, id, `${server.base}elements/${GUSTS}.html`);
      await expect(page.locator("h1#_top")).toBeVisible();
      for (const url of await requests(app)) {
        expect(url.startsWith(server.base) || url === "about:blank" || url.startsWith("data:"), url).toBe(
          true,
        );
      }
      expect(server.outside).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
