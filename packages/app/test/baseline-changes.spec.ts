// "Show changes since baseline" on the built app (SR-241 AK2): the open hints of the output show like the
// problems of any output (SR-223 AK3), several of one kind as one folded line with the title of their kind and
// their count, which Tab opens to each hint with its element and reason. The light screenshot goes to
// `test-results/electron/screenshots/` (or the folder in REQSEQ_SCREENSHOTS).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, shownLayer } from "./support/app.js";

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

test.describe("Show changes since baseline", () => {
  let running: RunningApp;
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-241/AK-rnfc] shows the open hints like problems of an output: one folded line per kind with its count, Tab opens it to each hint with element and reason", async () => {
    // fixtures/SR-016/unknown: no baseline, five unknown properties of two elements and one hint of three other kinds.
    running = await launchApp({ fixture: "SR-016/unknown" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Show changes since baseline");
    await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(
      "Show changes since baseline",
    );
    await window.keyboard.press("Enter");
    const page = shownLayer(window).locator(".result.output");
    // The answer is the CLI's (SR-080).
    const cli = JSON.parse((await running.cli(["baseline", "changes", "--json"])).stdout) as {
      answer: string;
    };
    await expect(page.locator("h1")).toHaveText(cli.answer);
    const group = page.locator(".line.group");
    await expect(group).toHaveCount(1);
    await expect(group.locator(".text")).toHaveText("▸Unknown property");
    await expect(group.locator(".status")).toHaveText("5");
    await expect(group).toHaveAttribute("aria-expanded", "false");
    // The other kinds are a line each; no code is shown.
    await expect(page.locator(".line.problem")).toHaveCount(3);
    await expect(page).not.toContainText("element.unknown-property");
    await window.screenshot({ path: path.join(SHOTS, "sr-241-changes-hints-light.png") });
    // Tab on the group line opens it: each hint with its element and its reason.
    const at = await page
      .locator(".line")
      .evaluateAll((lines) => lines.findIndex((line) => line.classList.contains("group")));
    for (let step = 0; step <= at; step += 1) {
      await window.keyboard.press("ArrowDown");
    }
    await expect(group).toHaveAttribute("data-cursor", "");
    await window.keyboard.press("Tab");
    await expect(group).toHaveAttribute("aria-expanded", "true");
    const members = page.locator(".line.problem[data-depth='1']");
    await expect(members).toHaveCount(5);
    await expect(members.first().locator(".label")).toHaveText("SR-1b2c3d");
    await expect(members.first().locator(".text")).toHaveText(
      /^Property customer-id is not in the metamodel/u,
    );
    await expect(members.last().locator(".label")).toHaveText("UNKNOWN-8c9d0e");
    await window.screenshot({ path: path.join(SHOTS, "sr-241-changes-hints-open-light.png") });
  });
});
