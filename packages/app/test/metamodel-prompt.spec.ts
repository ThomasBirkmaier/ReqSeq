// The commands that change the metamodel in the command prompt, on the built app (SR-236 AK6, AK8, AK11):
// "Add relation kind" asks its values in steps, the key prefilled from the name, the types as a mark with
// "Any type", the target types for limits as a mark, and a minimum and maximum per marked type, and writes the metamodel file; "Change property definition"
// shows the value kind of a property that elements hold as locked with their number. The light screenshots go
// to `test-results/electron/screenshots/` (or the folder in REQSEQ_SCREENSHOTS).
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const label = (window: Page) => window.locator("label.prompt-label");
const input = (window: Page) => window.locator("#prompt-input");
const marked = (window: Page) => window.locator('.candidates [aria-selected="true"] .name');
const marks = (window: Page) => window.getByRole("list", { name: "Marks" }).getByRole("listitem");

/** Types `text` and takes the hit it marks, which must be `name`. */
const pick = async (window: Page, text: string, name: string): Promise<void> => {
  await window.keyboard.type(text);
  await expect(marked(window)).toHaveText(name);
  await window.keyboard.press("Enter");
};

test.describe("the metamodel commands in the command prompt (SR-236)", () => {
  let running: RunningApp;

  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-069/filter" }, { colorScheme: "light" });
    await expect(running.window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  });

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-236/AK-q76q] [SR-236/AK-n13v] Add relation kind asks its steps, prefills the key, takes types as a mark with Any type and limits per target type, and writes the file", async () => {
    const { window } = running;
    await fsp.mkdir(SHOTS, { recursive: true });
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "Add relation kind", "Add relation kind");
    await expect(label(window)).toHaveText("Add relation kind · Name:");
    await window.keyboard.type("Verified by");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Add relation kind Verified by · Key:");
    await expect(input(window)).toHaveValue("verified-by");
    await window.keyboard.press("Enter");
    // An empty inverse name is left out.
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Add relation kind Verified by verified-by · Source types:");
    await expect(marked(window)).toHaveText("Any type");
    await window.keyboard.press("Enter");
    await pick(window, "Decision", "Decision");
    await expect(marks(window)).toHaveText(["type: decision×"]);
    await expect(marked(window)).toHaveText("Take 1 type");
    await window.screenshot({ path: path.join(SHOTS, "sr-236-types-light.png") });
    await window.keyboard.press("Enter");
    // The target types for limits, as a mark from every type, then a minimum and a maximum per marked type.
    await expect(label(window)).toHaveText(
      "Add relation kind Verified by verified-by Decision · Limits for:",
    );
    await expect(marked(window)).toHaveText("No limits");
    await pick(window, "Decision", "Decision");
    await expect(marked(window)).toHaveText("Take 1 type");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText(
      "Add relation kind Verified by verified-by Decision Decision · At least, to Decision:",
    );
    await window.keyboard.type("1");
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    const written = path.join(running.workspace?.root ?? "", "metamodel", "standard-model.yaml");
    await expect
      .poll(async () => fsp.readFile(written, "utf8"), { timeout: 15_000 })
      .toContain("key: verified-by");
    const file = await fsp.readFile(written, "utf8");
    expect(file).toMatch(/target-type: decision[\s\S]*min: 1|min: 1[\s\S]*target-type: decision/u);
  });

  test("[SR-236/AK-wq1x] Change property definition shows the value kind of a property elements hold as locked with their number", async () => {
    const { window } = running;
    await fsp.mkdir(SHOTS, { recursive: true });
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "Change property definition", "Change property definition");
    await pick(window, "Requirement Type", "Requirement Type");
    await expect(label(window)).toHaveText("Change property definition Requirement Type · Change:");
    const kind = window.locator(".candidates [role=option]").filter({ hasText: "Value kind" });
    await expect(kind.locator(".hint")).toHaveText(/^locked: \d+ elements?$/u);
    await window.screenshot({ path: path.join(SHOTS, "sr-236-locked-light.png") });
    // It cannot be chosen: the row is disabled, and Enter on a typed "Value kind" leaves the step as it is.
    await expect(kind).toHaveAttribute("aria-disabled", "true");
    await window.keyboard.type("Value kind");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Change property definition Requirement Type · Change:");
  });
});
