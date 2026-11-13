// The fields of a search in the built app (SR-216 AK6, AK8, AK10, AK11) on `fixtures/SR-216/fields`: Ctrl/Cmd+Enter
// at the search words lists the fields of the workspace with the key beside each; a chosen one is a mark, the hits
// while typing and the list of search hits come only from it, the list names it under its heading and comes back
// with it after a restart, and its hits, places and snippets are those of the command line with the same fields.
// The light-theme screenshots go to `test-results/electron/screenshots/` (or REQSEQ_SCREENSHOTS) for the pull
// request. Keys use ControlOrMeta, so the same test runs on Linux, macOS and Windows.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, shownLayer } from "./support/app.js";

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const shownBuffer = (window: Page): Locator => shownLayer(window).locator("[data-buffer]");
const card = (window: Page) => window.locator(".card:not(.card-leaving) .card-list");
const label = (window: Page) => window.locator("label.prompt-label");
const marked = (window: Page) => window.locator('.candidates [aria-selected="true"] .name');
const marks = (window: Page) => window.getByRole("list", { name: "Marks" }).getByRole("listitem");

interface Hit {
  readonly title: string;
  readonly snippet?: { readonly text: string };
}

test.describe("a search in chosen fields (SR-216)", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-216/fields" }, { colorScheme: "light" });
    await expect(shownLayer(running.window).locator(".overview .line").first()).toBeVisible();
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-216/AK-t56j] [SR-216/AK-gg4w] [SR-216/AK-yq3n] [SR-216/AK-dhq2] Ctrl/Cmd+Enter chooses the fields; the hits, the list and the command line agree", async () => {
    let { window } = running;
    await fs.mkdir(SHOTS, { recursive: true });
    await window.keyboard.press("ControlOrMeta+Shift+F");
    await window.keyboard.type("gust");
    // In all fields both elements are hits: one has "gust" in its acceptance criteria, both in their text.
    await expect(card(window).getByRole("option")).toHaveCount(2);
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label(window)).toHaveText("Search · fields:");
    await expect(marked(window)).toHaveText("Search all fields");
    const fields = card(window).getByRole("option");
    await expect(fields.locator(".name")).toHaveText([
      "Search all fields",
      "Title",
      "Text",
      "IDs",
      "All properties",
      "Rationale",
      "Acceptance Criteria",
    ]);
    await expect(fields.filter({ hasText: "Acceptance Criteria" }).locator(".hint")).toHaveText(
      "acceptance-criteria",
    );
    await window.keyboard.type("accept");
    await expect(card(window).getByRole("option").first().locator(".name")).toHaveText("Acceptance Criteria");
    await card(window).getByRole("option").first().click();
    await expect(marks(window)).toHaveText(["Acceptance Criteria×"]);
    await expect(marked(window)).toHaveText("Search in 1 field");
    await window.waitForTimeout(400);
    await window.screenshot({ path: path.join(SHOTS, "sr-216-fields-light.png") });

    // Back to the kept words: the hits come only from the acceptance criteria.
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Search");
    await expect(window.locator("#prompt-input")).toHaveValue("gust");
    await expect(card(window).getByRole("option")).toHaveCount(1);
    await expect(card(window).locator(".name")).toHaveText(/Gust alarm$/u);
    const preview = (await card(window).locator(".name").allTextContents())[0] ?? "";
    await window.keyboard.press("Enter");

    // The list of search hits names the field under its heading, and its first hit is the one shown while typing.
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Search: gust · in Acceptance Criteria");
    await expect(shownLayer(window).getByLabel("Fields")).toHaveText("inAcceptance Criteria");
    const rows = shownLayer(window).locator(".row");
    await expect(rows).toHaveCount(1);
    const first = rows.first();
    expect(
      `${(await first.locator(".id").textContent()) ?? ""} ${(await first.locator(".title").textContent()) ?? ""}`,
    ).toBe(preview);
    await window.waitForTimeout(300);
    await window.screenshot({ path: path.join(SHOTS, "sr-216-list-light.png") });

    // The command line with the same fields: the same hits with the same snippets (AK11).
    const searched = await running.cli(["element", "search", "gust", "--fields", "acceptance-criteria"]);
    const hits = (JSON.parse(searched.stdout) as { hits: Hit[] }).hits;
    expect(hits.map((hit) => hit.title)).toEqual(await rows.locator(".title").allTextContents());
    expect(hits.map((hit) => hit.snippet?.text)).toEqual([
      ((await first.locator(".snippet").getAttribute("title")) ?? "").replace(/^[^:]+: /u, ""),
    ]);

    // Closed and opened again (SR-115 AK4): the list is there with the same field.
    const { kept } = running;
    await running.close({ keep: true });
    running = await launchApp(undefined, { kept });
    ({ window } = running);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
    await expect
      .poll(async () => {
        await window.keyboard.press("ControlOrMeta+P");
        await window.keyboard.type("Search: gust");
        const found = await card(window)
          .getByRole("option")
          .first()
          .waitFor({ timeout: 1000 })
          .then(() => true)
          .catch(() => false);
        if (found) {
          await window.keyboard.press("Enter");
        } else {
          await window.keyboard.press("Escape");
        }
        return shownBuffer(window).getAttribute("aria-label");
      })
      .toBe("Search: gust · in Acceptance Criteria");
    await expect(shownLayer(window).getByLabel("Fields")).toHaveText("inAcceptance Criteria");
    await expect(shownLayer(window).locator(".row")).toHaveCount(1);
  });
});
