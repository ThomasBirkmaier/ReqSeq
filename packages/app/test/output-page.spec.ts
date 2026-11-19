// The output page on the built app (SR-223 AK1): the output of a command opens with its answer as the CLI gives it,
// the problems follow, errors before warnings before infos, every value stands under its title from the catalog
// and not under its field name, and a line under the answer says when the output is incomplete (SR-006 AK2). The
// light screenshot goes to `test-results/electron/screenshots/` (or the folder in REQSEQ_SCREENSHOTS).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, shownLayer } from "./support/app.js";

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** Runs the catalog command titled `title` from the command prompt; it takes no argument it must ask. */
const run = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(title);
  await window.keyboard.press("Enter");
  await expect(shownLayer(window).locator(".result.output h1")).toBeVisible();
};

/** The answer the CLI gives for the same command (SR-080). */
const cliAnswer = async (running: RunningApp, argv: readonly string[]): Promise<string> => {
  const result = await running.cli([...argv, "--json"]);
  return (JSON.parse(result.stdout) as { answer: string }).answer;
};

test.describe("the output page", () => {
  let running: RunningApp;
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-223/AK-ydqh] an output starts with its answer, then errors, warnings and infos, each value under its title", async () => {
    // fixtures/SR-222/criteria: the check finds a warning, an error, an info and a warning, in this order.
    running = await launchApp({ fixture: "SR-222/criteria" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await run(window, "Check workspace");
    const page = shownLayer(window).locator(".result.output");
    await expect(page.locator("h1")).toHaveText(await cliAnswer(running, ["workspace", "check"]));
    // The headings follow the answer in the order of severity, each over its problems.
    await expect(page.locator(".column > :is(h1, .note, .line)").first()).toHaveText(/^Checked 4 elements/u);
    await expect(page.locator(".line.heading")).toHaveText(["Errors", "Warnings", "Info"]);
    const kinds = await page
      .locator(".line")
      .evaluateAll((lines: readonly Element[]) =>
        lines.map((line) => [...line.classList].slice(1).join(" ")),
      );
    expect(kinds.slice(0, 7)).toEqual([
      "heading",
      "problem",
      "heading",
      "problem",
      "problem",
      "heading",
      "problem",
    ]);
    await expect(page.locator(".line.problem").first()).toContainText("SR-0000d3");
    // Every value under its title: "Checked elements", never the field `checkedElements`; `ok` is "Passed".
    await expect(page.locator(".line.text .label")).toHaveText(["Passed", "Checked elements"]);
    await expect(page).not.toContainText("checkedElements");
    await expect(page.locator(".note")).toHaveCount(0);
    await window.screenshot({ path: path.join(SHOTS, "sr-223-output-page-light.png") });
  });

  test("[SR-223/AK-ydqh] the line under the answer says that an output is incomplete", async () => {
    // fixtures/SR-005/cross-repository/system alone: its workspace file lists the repository `platform`, which is
    // not on this machine, so the verification degree is incomplete (SR-006 AK2).
    running = await launchApp({ fixture: "SR-005/cross-repository/system" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await run(window, "Show verification degree");
    const page = shownLayer(window).locator(".result.output");
    await expect(page.locator("h1")).toHaveText(await cliAnswer(running, ["evidence", "degree"]));
    // The answer says why; the line under it marks the output, without saying it again (SR-006 AK2).
    await expect(page.locator("h1 + .note")).toHaveText("Incomplete");
    // The degree's fields under their titles; `failed` is 0 and stays, since the catalog names no normal value.
    await expect(page.locator(".line .label")).toHaveText([
      "Verification degree",
      "Share",
      "Requirements",
      "Counts",
      "Open",
      "Verified",
      "Indirect",
      "Failed",
      "Outdated",
    ]);
  });
});
