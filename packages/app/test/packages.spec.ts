// Packages on the built app (SR-048, SR-049) on fixtures/SR-048/packages: packages P1 "Release 1" and
// P2 "Release 2"; R1 "Measure wind speed" in P1 and P2, R2 in P1, R3 in none. A package is created with
// "Create element" and opened by Ctrl+P; what the app shows is compared with the CLI (SR-080). Keys use
// ControlOrMeta, so the same tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const R1 = "SR-0000b1";

const cliJson = async <T>(running: RunningApp, argv: readonly string[]): Promise<T> => {
  const result = await running.cli(argv);
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
};

const memberTitles = (window: Page): Promise<string[]> =>
  window.locator(".members .row .title").allTextContents();

/** Opens the package `title` with Ctrl+P and waits for its elements. */
const openPackage = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(window.locator(".members .row").first()).toBeVisible();
};

test.describe("packages on a fixture workspace", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-048/packages" });
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-048/AK1] element.create of type package writes a package file", async () => {
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Create element");
    await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText("Create element");
    await window.keyboard.press("Enter");
    await window.keyboard.type("Package");
    await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText("Package");
    await window.keyboard.press("Enter");
    await window.keyboard.type("Release 3");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Release 3");
    const found = await cliJson<{ hits: { id: string; title: string }[] }>(running, [
      "element",
      "search",
      "Release 3",
    ]);
    const hit = found.hits.find((candidate) => candidate.title === "Release 3");
    const got = await cliJson<{ element: { type: string; file: string } }>(running, [
      "element",
      "get",
      hit?.id ?? "",
    ]);
    expect(got.element.type).toBe("package");
    expect(got.element.file).toMatch(/^package\/PKG-[0-9a-f]{12}\.md$/);
  });

  test("[SR-049/AK1] a requirement in P1 and P2 appears in both", async () => {
    const { window } = running;
    await openPackage(window, "Release 1");
    expect(await memberTitles(window)).toEqual(["Measure wind speed", "Measure wind direction"]);
    await openPackage(window, "Release 2");
    expect(await memberTitles(window)).toEqual(["Measure wind speed"]);
  });

  test("[SR-049/AK2] after a change both packages show the same content and there is exactly one file", async () => {
    const { window } = running;
    await cliJson(running, [
      "element",
      "update",
      R1,
      "--title",
      "Measure the wind speed",
      "--text",
      "R1: changed once.",
    ]);
    const texts: string[] = [];
    for (const pkg of ["Release 1", "Release 2"]) {
      await openPackage(window, pkg);
      await expect(window.locator(".members .row .title").first()).toHaveText("Measure the wind speed");
      // The element opened from this package: the same title and text.
      await window.keyboard.press("ArrowDown");
      await expect(window.locator(".members .list")).toBeFocused();
      await window.keyboard.press("Enter");
      await expect(window.locator("article h1")).toHaveText("Measure the wind speed");
      texts.push((await window.locator(".cm-content").first().innerText()).trim());
    }
    expect(texts).toEqual(["R1: changed once.", "R1: changed once."]);
    const listed = await cliJson<{ total: number }>(running, [
      "element",
      "list",
      "--input",
      JSON.stringify({ selection: { ids: [R1] } }),
    ]);
    expect(listed.total).toBe(1);
  });
});
