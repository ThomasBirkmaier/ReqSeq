// The page of a requirement and its variants on the built app (SR-046, SR-047), on fixtures/SR-043/example
// with an evidence location: Coast (VAR-0000c1) replaces K1 (SR-0000a1) by A1 (SR-0000b1); here Mountain
// (VAR-0000c2) also excludes K1 and Desert (VAR-0000c3) excludes K3 (SR-0000a3), and A2 (SR-0000b2) is
// valid for Coast and Mountain. The records are written with the CLI (SR-080) before the element is opened.
// Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { goTo, launchApp, shownLayer } from "./support/app.js";

const WORKSPACE =
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
  "metamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: evidence }\n";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

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
  await goTo(window);
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(shownLayer(window).locator("article h1")).toHaveText(title);
  const text = shownLayer(window).locator('article [data-field="Text"] .cm-content');
  await expect(text).toBeVisible();
  await window.keyboard.press("Enter");
  await expect(text).toBeFocused();
};

const line = (window: Page, label: string): Locator =>
  shownLayer(window).locator("article").getByRole("group", { name: label, exact: true });

/** The verification badges (SR-157) are `names` on the left and `statuses` on the right, in this order. */
const badges = async (window: Page, names: readonly string[], statuses: readonly string[]): Promise<void> => {
  const verification = line(window, "Verification");
  await expect(verification.locator(".badge-name")).toHaveText([...names]);
  await expect(verification.locator(".badge-status")).toHaveText([...statuses]);
};

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

  test("[SR-046/AK-nbwh] the editor of a requirement with validity [A, B] shows the titles of A and B", async () => {
    const { window } = running;
    await openEditor(window, "Warn of storms");
    await expect(shownLayer(window).locator('article [data-field="validity"] li')).toHaveText([
      "VAR-0000c1 Coast",
      "VAR-0000c2 Mountain",
    ]);
    await badges(window, ["Coast", "Mountain"], ["open", "open"]);
  });

  test("[SR-046/AK-cstc] the editor of a core requirement replaced in A and excluded in B names A and B", async () => {
    const { window } = running;
    await openEditor(window, "Response time at most 10 ms");
    const use = line(window, "Replaced or excluded");
    await expect(use).toHaveText(
      "Replaced in Coast by SR-0000b1 Response time at most 20 ms · Excluded in Mountain",
    );
    // A change of another file from outside (Desert now excludes K1 too) shows without reopening the page.
    await fs.writeFile(
      path.join(running.workspace?.root ?? "", "variants", "VAR-0000000000c3.md"),
      `---\nid: 43043043-0000-4000-8000-0000000000c3\ntype: variant\nstatus: draft\ntitle: Desert\n` +
        `excludes: [${ref("a3", "Measure the rain")}, ${ref("a1", "Response time at most 10 ms")}]\n---\n`,
    );
    await expect(use).toHaveText(
      "Replaced in Coast by SR-0000b1 Response time at most 20 ms · Excluded in Mountain, Desert",
    );
    // Each name opens its element.
    await use.getByRole("link", { name: "Mountain" }).click();
    await expect(shownLayer(window).locator("article h1")).toHaveText("Mountain");
  });

  test("[SR-047/AK-qncz] the status shows one row for the core and each variant it is in, none for excluding or replacing variants", async () => {
    const { window } = running;
    await record(running, "SR-0000a3", "passed");
    await record(running, "SR-0000a3", "failed", "VAR-0000c2");
    await openEditor(window, "Measure the rain");
    // Excluded in Desert: no entry for it.
    await badges(window, ["Core", "Coast", "Mountain"], ["verified", "open", "failed"]);
    // K1 is replaced in Coast and excluded in Mountain: entries for the core and Desert only; A1 has its own.
    await openEditor(window, "Response time at most 10 ms");
    await badges(window, ["Core", "Desert"], ["open", "open"]);
    await openEditor(window, "Response time at most 20 ms");
    await badges(window, ["Coast"], ["open"]);
  });

  test("[SR-157/AK-c9cf] the page shows a pill with round ends per entry: the core or the variant on the left, its status on the right", async () => {
    const { window } = running;
    await record(running, "SR-0000a3", "passed");
    await record(running, "SR-0000a3", "failed", "VAR-0000c2");
    // A record of Coast for an older version of K3: outdated there.
    await fs.writeFile(
      path.join(running.workspace?.root ?? "", "evidence", "2026-11-01-SR-0000a3-coast.md"),
      "---\nreqseq-record: 1\nkind: verification\nelement: 43043043-0000-4000-8000-0000000000a3\n" +
        "version: n1:0000000000000000\nmethod: test\nvariant: 43043043-0000-4000-8000-0000000000c1\n" +
        "item: build-46\nresult: passed\ndate: 2026-11-01T10:00:00Z\n---\n",
    );
    await openEditor(window, "Measure the rain");
    await badges(window, ["Core", "Coast", "Mountain"], ["verified", "outdated", "failed"]);
    const shapes = await line(window, "Verification")
      .locator(".badge")
      .evaluateAll((all) =>
        all.map((badge) => {
          const [name, status] = [".badge-name", ".badge-status"].map((half) =>
            badge.querySelector(half)?.getBoundingClientRect(),
          );
          const box = badge.getBoundingClientRect();
          return {
            radius: parseFloat(getComputedStyle(badge).borderTopLeftRadius),
            height: box.height,
            clipped: getComputedStyle(badge).overflow,
            // The name on the left, the status right next to it, both as high as the pill.
            sideBySide:
              name !== undefined && status !== undefined && Math.abs(name.right - status.left) < 0.5,
            nameLeft: name !== undefined && Math.abs(name.left - box.left) < 0.5,
          };
        }),
      );
    expect(shapes).toHaveLength(3);
    for (const shape of shapes) {
      // Round ends: the radius is half the height, and the halves are clipped to it.
      expect(shape.radius * 2).toBeGreaterThanOrEqual(shape.height - 0.5);
      expect(shape).toMatchObject({ clipped: "hidden", sideBySide: true, nameLeft: true });
    }
    await line(window, "Verification").screenshot({ path: path.join(OUT, "sr-157-badges-light.png") });
    await window.screenshot({ path: path.join(OUT, "sr-157-page-light.png") });
  });

  test("[SR-157/AK-n2py] a click on the left half of a variant's badge opens the variant", async () => {
    const { window } = running;
    await openEditor(window, "Measure the rain");
    await badges(window, ["Core", "Coast", "Mountain"], ["open", "open", "open"]);
    const mountain = line(window, "Verification").locator(".badge-name", { hasText: "Mountain" });
    await expect(mountain).toHaveRole("link");
    // In its padding before the word, at mid height inside the round end: the whole half is the link.
    const box = await mountain.boundingBox();
    await mountain.click({ position: { x: 4, y: (box?.height ?? 0) / 2 } });
    await expect(shownLayer(window).locator("article h1")).toHaveText("Mountain");
  });
});
