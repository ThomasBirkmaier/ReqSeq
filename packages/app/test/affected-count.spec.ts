// The number of directly affected elements after a save (SR-024) on the built app: a changed text of an
// element that two others point at says the number in the minibuffer, as `element.update` gives it through
// the CLI for the same change, also when the element is left (AK2); a change of only the title after it shows
// no number (AK3). The light screenshot goes to `test-results/electron/screenshots/` (or the folder in
// REQSEQ_SCREENSHOTS).
import type { Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { goTo, launchApp } from "./support/app.js";

/** fixtures/SR-024/affected: SR-00b002 derives from "Show wind speed", SR-00b003 refers to it in its text. */
const FIXTURE = { fixture: "SR-024/affected" };
const TITLE = "Show wind speed";
const SPEED = "SR-00b001";

const SAVED = `Saved ${SPEED} ${TITLE}: 2 elements directly affected`;

/** Opens the element titled `title` with "Go to"; the element has the focus and its text editor is there. */
const open = async (window: Page, title: string): Promise<void> => {
  await goTo(window);
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(window.locator("article")).toBeFocused();
  await expect(window.locator('article [data-field="Text"] .cm-content')).toBeVisible();
};

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

test.describe("affected elements after a save", () => {
  let running: RunningApp;
  test.afterEach(async () => {
    await running.close();
  });

  test.beforeEach(async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    await running.window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await open(running.window, TITLE);
  });

  test("[SR-024/AK-mf7x] a save of a changed text says the number of directly affected elements that element.update gives", async () => {
    const { window } = running;
    await window.keyboard.press("Enter");
    await window.keyboard.type(" In knots.");
    const minibuffer = window.getByLabel("Minibuffer");
    // Autosave says it once, without a save command.
    await expect(minibuffer).toHaveText(SAVED);
    await window.screenshot({ path: path.join(OUT, "sr-024-affected-light.png") });
    // The CLI gives the same number for the next change of the content, once the app has saved every key (a
    // slow runner may save the typed text in two writes, and a second one would meet the CLI's change).
    await expect(window.getByLabel("Modeline")).not.toContainText("modified");
    await expect
      .poll(async () => (await running.cli(["element", "get", SPEED])).stdout, { timeout: 5000 })
      .toContain("In knots.");
    const got = await running.cli(["element", "get", SPEED]);
    const { fileSha256 } = JSON.parse(got.stdout) as { fileSha256: string };
    const cli = await running.cli([
      "element",
      "update",
      SPEED,
      "--text",
      "In knots.",
      "--expected-file-sha256",
      fileSha256,
    ]);
    expect(cli.code).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({ affected: 2 });
    // The window follows the CLI's change without input left, so it closes without asking.
    await expect(window.locator('article [data-field="Text"] .cm-content')).toHaveText("In knots.");
    await expect(window.getByLabel("Modeline")).not.toContainText(/modified|on disk/);
  });

  test("[SR-024/AK-mf7x] leaving the element saves its text at once and says the number", async () => {
    const { window } = running;
    await window.keyboard.press("Enter");
    await window.keyboard.type(" In knots.");
    await open(window, "Warn of storms");
    await expect(window.getByLabel("Minibuffer")).toHaveText(SAVED);
  });

  test("[SR-024/AK-jt0q] a change of only the title after a changed text shows no number", async () => {
    const { window } = running;
    const minibuffer = window.getByLabel("Minibuffer");
    await window.keyboard.press("Enter");
    await window.keyboard.type(" In knots.");
    await expect(minibuffer).toHaveText(SAVED);
    await expect(window.getByLabel("Modeline")).not.toContainText("modified");
    // Escape back to the element, Tab past the links of the parents line to the title.
    await window.keyboard.press("Escape");
    const title = window.locator('[data-field="Title"]');
    for (let tab = 0; tab < 6; tab += 1) {
      if (await title.evaluate((node) => node === document.activeElement)) {
        break;
      }
      await window.keyboard.press("Tab");
    }
    await expect(title).toBeFocused();
    await window.keyboard.press("Enter");
    await window.keyboard.type(" now");
    await window.keyboard.press("Enter");
    await expect(minibuffer).toHaveText(`Saved ${SPEED} ${TITLE} now`);
    // Ctrl/Cmd+S on the same title says no number either.
    await window.keyboard.press("ControlOrMeta+S");
    await expect(minibuffer).toHaveText("No changes to save");
  });
});
