// The page of a requirement and its variants on the built app (SR-046, SR-047), on fixtures/SR-043/example
// with an evidence location: Coast (VAR-0000c1) replaces K1 (SR-0000a1) by A1 (SR-0000b1); here Mountain
// (VAR-0000c2) also excludes K1 and Desert (VAR-0000c3) excludes K3 (SR-0000a3), and A2 (SR-0000b2) is
// valid for Coast and Mountain. The records are written with the CLI (SR-080) before the element is opened.
// Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const WORKSPACE =
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
  "metamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: evidence }\n";

const VERSION = "n1:67ebd0624004c969";
const ref = (id: string, title: string): string =>
  `{ id: 43043043-0000-4000-8000-0000000000${id}, version: ${VERSION}, title: ${title} }`;

const FILES = {
  "reqseq-workspace.yaml": WORKSPACE,
  "evidence/.keep": "",
  "variants/VAR-0000000000c2.md": `---\nid: 43043043-0000-4000-8000-0000000000c2\ntype: variant\nstatus: draft\ntitle: Mountain\nexcludes: [${ref("a1", "Response time at most 10 ms")}]\n---\n`,
  "variants/VAR-0000000000c3.md": `---\nid: 43043043-0000-4000-8000-0000000000c3\ntype: variant\nstatus: draft\ntitle: Desert\nexcludes: [${ref("a3", "Measure the rain")}]\n---\n`,
  "requirements/SR-0000000000b2.md":
    `---\nid: 43043043-0000-4000-8000-0000000000b2\ntype: system-requirement\nstatus: draft\ntitle: Warn of storms\n` +
    `derives-from: [${ref("d1", "See the weather")}]\nvalidity: [${ref("c1", "Coast")}, ${ref("c2", "Mountain")}]\n---\n`,
};

/** Opens the element `title` with "Go to" and its text editor with Enter; the editor has the focus. */
const openEditor = async (window: Page, title: string): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  const text = window.locator('article [data-field="Text"] .cm-content');
  await expect(text).toBeVisible();
  await window.keyboard.press("Enter");
  await expect(text).toBeFocused();
};

const line = (window: Page, label: string): Locator =>
  window.locator(`article p.variant-line[aria-label="${label}"]`);

/** Writes a verification record of `result` for `shortId`, for `variant` or else the core. */
const record = async (
  running: RunningApp,
  shortId: string,
  result: "passed" | "failed",
  variant?: string,
): Promise<void> => {
  const argv = [
    "evidence",
    "record",
    shortId,
    "verification",
    result,
    "--method",
    "test",
    "--item",
    "build-47",
  ];
  const written = await running.cli(variant === undefined ? argv : [...argv, "--variant", variant]);
  expect(written.code, written.stderr).toBe(0);
};

test.describe("the page of a requirement with variants", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-043/example", files: FILES });
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-046/AK1] the editor of a requirement with validity [A, B] shows the titles of A and B", async () => {
    const { window } = running;
    await openEditor(window, "Warn of storms");
    await expect(window.locator('article [data-field="validity"] li')).toHaveText([
      "VAR-0000c1 Coast",
      "VAR-0000c2 Mountain",
    ]);
    await expect(line(window, "Verification")).toHaveText("Verification — Coast: open · Mountain: open");
  });

  test("[SR-046/AK2] the editor of a core requirement replaced in A and excluded in B names A and B", async () => {
    const { window } = running;
    await openEditor(window, "Response time at most 10 ms");
    const use = line(window, "Replaced or excluded");
    await expect(use).toHaveText(
      "Replaced in Coast by SR-0000b1 Response time at most 20 ms · Excluded in Mountain",
    );
    // Each name opens its element.
    await use.getByRole("link", { name: "Mountain" }).click();
    await expect(window.locator("article h1")).toHaveText("Mountain");
  });

  test("[SR-047/AK3] the status shows one row for the core and each variant it is in, none for excluding or replacing variants", async () => {
    const { window } = running;
    await record(running, "SR-0000a3", "passed");
    await record(running, "SR-0000a3", "failed", "VAR-0000c2");
    await openEditor(window, "Measure the rain");
    // Excluded in Desert: no row for it.
    await expect(line(window, "Verification")).toHaveText(
      "Verification — Core: verified · Coast: open · Mountain: failed",
    );
    // K1 is replaced in Coast and excluded in Mountain: rows for the core and Desert only; A1 has its own.
    await openEditor(window, "Response time at most 10 ms");
    await expect(line(window, "Verification")).toHaveText("Verification — Core: open · Desert: open");
    await openEditor(window, "Response time at most 20 ms");
    await expect(line(window, "Verification")).toHaveText("Verification — Coast: open");
  });
});
