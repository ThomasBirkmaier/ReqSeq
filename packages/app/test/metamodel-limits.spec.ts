// The metamodel as text names the most entries of a list property (SR-171) and the limits of a relation
// kind (SR-152) on the built app (#847), as `metamodel.get` gives them: "list of text · at most 3" in the
// property's line, and one line "limit <source> → <target>: <count>" per limit under the relation kind.
// Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const showMetamodelText = async (window: Page): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("sm");
  await expect(window.locator('.candidates [aria-selected="true"] .name')).toHaveText("Show metamodel");
  await window.keyboard.press("Enter");
  await expect(window.locator(".metamodel")).toBeFocused();
  await window.keyboard.press("ControlOrMeta+T");
  await expect(window.locator(".metamodel-text")).toBeFocused();
};

test.describe("limits in the metamodel as text", () => {
  let running: RunningApp | undefined;
  test.afterEach(async () => {
    await running?.close();
  });

  test("a relation kind shows each of its limits on a line of its own", async () => {
    running = await launchApp({ fixture: "SR-152/limits" });
    const { window } = running;
    await showMetamodelText(window);
    await expect(window.locator('[data-row="relation:derives-from"] [data-limit]')).toHaveText([
      "limit → Use Case: at most 1",
      "limit System Requirement → Need: at least 1",
    ]);
    // A relation kind without limits has no such line.
    await expect(window.locator('[data-row="relation:based-on"] [data-limit]')).toHaveCount(0);
  });

  test("a list property shows the most entries it takes", async () => {
    running = await launchApp({ fixture: "SR-171/max-items" });
    const { window } = running;
    await showMetamodelText(window);
    const criteria = window.locator(
      '[data-row="type:system-requirement"] [data-property="acceptance-criteria"] .mm-value',
    );
    await expect(criteria).toHaveText("list of text · at most 3");
  });
});
