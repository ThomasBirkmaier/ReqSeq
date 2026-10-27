// The mark emergent (SR-035 AK2) on the built app, without a renderer change: the element view shows the
// property with the meaning `emergent` as a property box (SR-104), and a saved filter with the condition
// `emergent` (SR-070) narrows the list as the CLI does for the same condition (SR-080). Keys use
// ControlOrMeta, so the same tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { DEFAULT_SORT, launchApp, listAll } from "./support/app.js";

/** fixtures/SR-035/emergent with a saved filter `emergent` = `{emergent: true}`. */
const FIXTURE = {
  fixture: "SR-035/emergent",
  files: { "filters/emergent.yaml": "logreq-filter: 1\nname: emergent\nwhere:\n  emergent: true\n" },
};

interface Listed {
  readonly elements: readonly { readonly title: string; readonly emergent?: boolean }[];
}

/** Opens the command prompt, types `command` and runs the first candidate. */
const runCommand = async (window: Page, command: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(command);
  await window.keyboard.press("Enter");
};

/** Types `text` into the prompt `label` once it is asked for and presses Enter. */
const answer = async (window: Page, label: string, text: string): Promise<void> => {
  await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText(label);
  await window.keyboard.type(text);
  await window.keyboard.press("Enter");
};

test.describe("the mark emergent in the app", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-035/AK2] the element view shows the box Emergent of an emergent requirement, as the CLI gives the property", async () => {
    const { window } = running;
    const title = "Show the forecast";
    const got = JSON.parse((await running.cli(["element", "get", "SR-00b110", "--json"])).stdout) as {
      readonly element: { readonly emergent?: boolean; readonly properties: Record<string, unknown> };
    };
    expect([got.element.emergent, got.element.properties["emergent"]]).toEqual([true, "yes"]);
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type(title);
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(title);
    await expect(window.locator('article [data-field="emergent"]')).toContainText("yes");
  });

  test("[SR-035/AK2] a saved filter with the condition emergent true shows in the app the elements the CLI lists for it", async () => {
    const { window } = running;
    await listAll(window);
    await runCommand(window, "Filter list by saved filter");
    await answer(window, "Filter", "emergent");
    await expect(window.getByLabel("Modeline")).toContainText("filter: emergent");
    const result = await running.cli([
      "element",
      "list",
      "--input",
      JSON.stringify({ selection: { where: { emergent: true } }, sort: DEFAULT_SORT }),
      "--json",
    ]);
    expect(result.code).toBe(0);
    const listed = JSON.parse(result.stdout) as Listed;
    expect(listed.elements.map((e) => [e.title, e.emergent])).toEqual([
      ["Show the forecast", true],
      ["Warn of storms", true],
      ["Warn of frost", true],
      ["Keep the station running", true],
    ]);
    await expect(window.locator(".row")).toHaveCount(4);
    expect(await window.locator(".row .title").allTextContents()).toEqual(
      listed.elements.map((e) => e.title),
    );
  });
});
