// Screenshots of the web UI for the user guide (ADR-0017), at 1280×720 with the settings of the Playwright project
// `guide`, in Chromium on Linux only, because rendering and anti-aliasing differ between systems. Those of Get started and of "Write the text of an element" are made on
// `fixtures/SR-140/get-started`: exactly the need and the requirement the steps of Get started create, with the same
// IDs. The trace matrix is made on `fixtures/enabler-344/weather-station`, which has more elements; the evidence page
// and the verification in the trace graph on `fixtures/SR-136/graph`, whose need has ten requirements with every
// verification status. Each fixture is copied into a temporary folder first (`createFixtureWorkspace`), so the
// UI writes nothing into the repository. The pictures go to `test-results/web/guide-images/`, and with REQSEQ_GUIDE_IMAGES set
// (`pnpm docs:screenshots`) also to `docs/guide/images/`, the copies the guide and the README show; a normal run
// leaves tracked files alone. On a pull request CI compares them with those of main's last nightly run and only
// warns when one changed (packages/docs/src/guide-images.ts).
import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { UiServer } from "@reqseq/api";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { open } from "./fixtures.js";
import { startUi } from "./start-ui.js";

const REPO = path.join(import.meta.dirname, "..", "..", "..");
const FOLDERS = [
  path.join(REPO, "test-results", "web", "guide-images"),
  ...((process.env["REQSEQ_GUIDE_IMAGES"] ?? "") === "" ? [] : [path.join(REPO, "docs", "guide", "images")]),
];

/** The UI server on a temporary copy of the fixture `name` below `fixtures/`. */
async function serve(name: string): Promise<{ server: UiServer; close: () => Promise<void> }> {
  const workspace = await createFixtureWorkspace({ fixture: name });
  const server = await startUi(workspace.root);
  return {
    server,
    close: async () => {
      await server.close();
      await workspace.cleanup();
    },
  };
}

/** Writes a screenshot of the page as `ui-<name>.png` into each folder, once its fonts are loaded. */
async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const png = await page.screenshot({ animations: "disabled", caret: "hide" });
  await Promise.all(FOLDERS.map((folder) => fs.writeFile(path.join(folder, `ui-${name}.png`), png)));
}

test.skip(process.platform !== "linux", "the guide's screenshots are made on Linux only (ADR-0017)");

test.beforeAll(async () => {
  await Promise.all(FOLDERS.map((folder) => fs.mkdir(folder, { recursive: true })));
});

test("screenshots of Get started and of writing a text, on the workspace the steps of Get started create", async ({
  page,
}) => {
  const { server, close } = await serve("SR-140/get-started");
  try {
    await open(page, server.url);
    await expect(page.getByRole("heading", { level: 2, name: "Drafts to decide" })).toBeVisible();
    await shot(page, "overview");

    // ⌘K (Ctrl+K) over the overview, with a word of both titles typed.
    await page.keyboard.press("ControlOrMeta+K");
    await page.getByRole("combobox", { name: "Find a list or an element" }).fill("wind");
    await expect(
      page.getByRole("listbox", { name: "Found" }).getByRole("option", { name: /See the wind speed/ }),
    ).toBeVisible();
    await shot(page, "search");
    // The first Escape empties the search field, the next one closes the dialog.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Find" })).toBeHidden({ timeout: 500 });
    }).toPass();

    await open(page, server.url, "/e/SR-c67baa");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Show the wind speed");
    await expect(page.getByText("updated every 10 seconds")).toBeVisible();
    await shot(page, "element");

    await open(page, server.url, "/graph/N-7fe707");
    await expect(page.locator(".gnode")).toHaveCount(2);
    await shot(page, "trace-graph");

    // The text of the requirement with `[[` typed below it: the list of elements to link.
    await open(page, server.url, "/edit/SR-c67baa");
    const text = page.locator("#f-text");
    await text.press("ControlOrMeta+End");
    await text.pressSequentially("\n\nShown next to [[wind");
    await expect(page.locator(".pick-list [role=option]")).toHaveCount(1);
    await shot(page, "edit");
  } finally {
    await close();
  }
});

test("screenshot of the trace matrix", async ({ page }) => {
  const { server, close } = await serve("enabler-344/weather-station");
  try {
    await open(page, server.url, "/matrix");
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await shot(page, "trace-matrix");
  } finally {
    await close();
  }
});

test("screenshots of the verification: the evidence of a failed requirement and the trace graph of a need", async ({
  page,
}) => {
  const { server, close } = await serve("SR-136/graph");
  try {
    await open(page, server.url, "/evidence/SR-00b007");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Show reading 7");
    await shot(page, "evidence");

    // Derivations only, in a window tall enough for the requirements below the need.
    await page.setViewportSize({ width: 1280, height: 1080 });
    await open(page, server.url, "/graph/N-00a001?chain=1");
    await expect(page.locator(".gnode")).toHaveCount(12);
    await shot(page, "verification-graph");
  } finally {
    await close();
  }
});
