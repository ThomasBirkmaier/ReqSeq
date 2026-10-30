// The view of a variant on the built app (SR-043 AK1, SR-041 AK1) on fixtures/SR-043/example, the
// „Beispielbestand“: core requirements K1–K4 (SR-0000a1–a4); variant A „Coast“ (VAR-0000c1) replaces K1
// by A1 (SR-0000b1, validity [A]), excludes K2 and adds A2 (SR-0000b2, validity [A]); variants B and C.
// "Choose view" in the command prompt picks the view, and the list shows it as the CLI gives it for the
// same view (SR-080). Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { DEFAULT_SORT, launchApp, listAll } from "./support/app.js";

const A = "VAR-0000c1";
const B = "VAR-0000c2";

/** The short IDs of the system requirements the shown list has, in its order. */
const shownRequirements = async (window: Page): Promise<string[]> =>
  (await window.locator(".row .id").allTextContents())
    .map((text) => text.trim())
    .filter((id) => id.startsWith("SR-"));

/** The short IDs of the system requirements in `view`, by the CLI, in the order of the app's list. */
const cliView = async (running: RunningApp, view: string): Promise<string[]> => {
  const input = { selection: { view, where: { type: ["system-requirement"] } }, sort: DEFAULT_SORT };
  const result = await running.cli(["element", "list", "--input", JSON.stringify(input), "--json"]);
  expect(result.code, result.stderr).toBe(0);
  return (JSON.parse(result.stdout) as { elements: { shortId: string }[] }).elements.map((e) => e.shortId);
};

/** Runs "Choose view" and takes the view whose name starts with `name`. */
const chooseView = async (window: Page, name: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("Choose view");
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText("Choose view");
  await window.keyboard.press("Enter");
  await expect(window.locator("label.prompt-label")).toHaveText("View");
  await window.keyboard.type(name);
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(
    new RegExp(`^${name}`),
  );
  await window.keyboard.press("Enter");
};

test.describe("the view of a variant in the app", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-043/example" });
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
    await listAll(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-043/AK1] Choose view shows exactly K3, K4, A1 and A2 in the view of A, and the core view only the core", async () => {
    const { window } = running;
    const modeline = window.getByLabel("Modeline");
    await chooseView(window, `${A} Coast`);
    await expect(modeline).toContainText("view: Coast");
    await expect
      .poll(() => shownRequirements(window))
      .toEqual(["SR-0000a3", "SR-0000a4", "SR-0000b1", "SR-0000b2"]);
    expect(await shownRequirements(window)).toEqual(await cliView(running, A));
    await chooseView(window, "Core");
    await expect(modeline).toContainText("view: Core");
    await expect
      .poll(() => shownRequirements(window))
      .toEqual(["SR-0000a1", "SR-0000a2", "SR-0000a3", "SR-0000a4"]);
    expect(await shownRequirements(window)).toEqual(await cliView(running, "core"));
    await chooseView(window, "All elements");
    await expect(modeline).not.toContainText("view:");
    await expect.poll(() => shownRequirements(window)).toContain("SR-0000a2");
  });

  test("[SR-041/AK1] the view of A lists SR-A instead of SR-K, and the view of B keeps SR-K", async () => {
    const { window } = running;
    await chooseView(window, `${A} Coast`);
    await expect.poll(() => shownRequirements(window)).toContain("SR-0000b1");
    expect(await shownRequirements(window)).not.toContain("SR-0000a1");
    await chooseView(window, B);
    await expect.poll(() => shownRequirements(window)).toContain("SR-0000a1");
    expect(await shownRequirements(window)).not.toContain("SR-0000b1");
  });

  test("[SR-042/AK6] in the view of A, variant.exclude with undo still offers the excluded K2, and K2 is back in the list", async () => {
    const { window } = running;
    const names = window.locator('.candidates [role="option"] .name');
    const label = window.locator("label.prompt-label");
    const title = "Exclude requirements from variant";
    await chooseView(window, `${A} Coast`);
    await expect.poll(() => shownRequirements(window)).not.toContain("SR-0000a2");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type(title);
    await expect(names.first()).toHaveText(title);
    await window.keyboard.press("Enter");
    await window.keyboard.type("Coast");
    await expect(names.first()).toHaveText(`${A} Coast`);
    await window.keyboard.press("Enter");
    await expect(label).toHaveText(`${title} ${A} · refs:`);
    // The offer searches all elements: K2 is not in the view of A, but it is excluded there.
    await window.keyboard.type("Measure the wind");
    await expect(names.first()).toHaveText("SR-0000a2 Measure the wind");
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(names).toHaveText(["Run", "undo"]);
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(names).toHaveText(["yes", "no"]);
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    await expect(window.locator(".result")).toContainText("variants/VAR-0000000000c1.md");
    expect(await cliView(running, A)).toContain("SR-0000a2");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("List all elements");
    await window.keyboard.press("Enter");
    await expect.poll(() => shownRequirements(window)).toContain("SR-0000a2");
    await expect(window.getByLabel("Modeline")).toContainText("view: Coast");
  });
});
