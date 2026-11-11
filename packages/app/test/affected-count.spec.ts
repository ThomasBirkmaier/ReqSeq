// The number of directly affected elements after a save (SR-024 AK2) on the built app: a changed text of an
// element that two others point at says the number in the minibuffer, as `element.update` gives it through
// the CLI for the same change. The light screenshot goes to `test-results/electron/screenshots/` (or the
// folder in REQSEQ_SCREENSHOTS).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { goTo, launchApp } from "./support/app.js";

/** fixtures/SR-024/affected: SR-00b002 derives from "Show wind speed", SR-00b003 refers to it in its text. */
const FIXTURE = { fixture: "SR-024/affected" };
const TITLE = "Show wind speed";
const SPEED = "SR-00b001";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

test.describe("affected elements after a save", () => {
  let running: RunningApp;
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-024/AK2] a save of a changed text says the number of directly affected elements that element.update gives", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await goTo(window);
    await window.keyboard.type(TITLE);
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(TITLE);
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(TITLE);
    await expect(window.locator('article [data-field="Text"] .cm-content')).toBeVisible();
    await window.keyboard.press("Enter");
    await window.keyboard.type(" In knots.");
    const minibuffer = window.getByLabel("Minibuffer");
    // Autosave says it once, without a save command.
    await expect(minibuffer).toHaveText(`Saved ${SPEED} ${TITLE}: 2 elements directly affected`);
    await window.screenshot({ path: path.join(OUT, "sr-024-affected-light.png") });
    // The CLI gives the same number for the next change of the content.
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
  });
});
