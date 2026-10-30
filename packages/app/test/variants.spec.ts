// Variants on the built app (SR-039) on fixtures/SR-040/validity (standard model; core requirements
// and the variants Coast, Mountain and Desert). A variant is created with "Create element" of the
// command prompt; what the app wrote is read back with the CLI (SR-080). Keys use ControlOrMeta, so
// the same tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const cliJson = async <T>(running: RunningApp, argv: readonly string[]): Promise<T> => {
  const result = await running.cli(argv);
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
};

test.describe("variants on a fixture workspace", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-040/validity" });
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-039/AK1] element.create of type variant writes a variant file in the workspace of the core", async () => {
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Create element");
    await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText("Create element");
    await window.keyboard.press("Enter");
    await window.keyboard.type("Variant");
    await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText("Variant");
    await window.keyboard.press("Enter");
    await window.keyboard.type("Valley");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Valley");
    const found = await cliJson<{ hits: { id: string; title: string }[] }>(running, [
      "element",
      "search",
      "Valley",
    ]);
    const hit = found.hits.find((candidate) => candidate.title === "Valley");
    const got = await cliJson<{ element: { type: string; repository: string; file: string } }>(running, [
      "element",
      "get",
      hit?.id ?? "",
    ]);
    const core = await cliJson<{ element: { repository: string } }>(running, ["element", "get", "SR-000a11"]);
    expect([got.element.type, got.element.repository]).toEqual(["variant", core.element.repository]);
    expect(got.element.file).toMatch(/^variant\/VAR-[0-9a-f]{12}\.md$/);
  });
});
