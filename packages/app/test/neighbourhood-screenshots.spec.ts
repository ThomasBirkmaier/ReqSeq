// Screenshots of the neighbourhood (SR-107) on a copy of the repository's own specification (`spec/`):
// the neighbourhood buffer of a need with its requirements at level 1, and a system requirement with
// the parents line above its title. The window is 1280×800. The PNGs go to
// `test-results/electron/screenshots/` (or the folder in REQSEQ_SCREENSHOTS); keeping them is a
// deliberate step, not part of a test run.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { launchApp } from "./support/app.js";

const SPEC = fileURLToPath(new URL("../../../spec", import.meta.url));
const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** Opens an element by Ctrl+P and its ID, once the hit is there. */
const open = async (window: Page, id: string, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(id);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(id);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
};

test("screenshots of the neighbourhood on the specification workspace", async () => {
  const running = await launchApp({ folder: SPEC });
  const { window } = running;
  try {
    await fs.mkdir(OUT, { recursive: true });
    const shot = (name: string): Promise<Buffer> =>
      window.screenshot({ path: path.join(OUT, `${name}.png`) });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    await expect(window.getByLabel("Modeline")).toContainText("elements");

    // A need: Ctrl+J shows its requirements, level 1 of the tree, as the CLI lists them.
    await open(window, "N-075", "Einfacher Einstieg in die Daten");
    await window.keyboard.press("ControlOrMeta+J");
    const children = JSON.parse(
      (
        await running.cli([
          "trace",
          "neighbourhood",
          "--input",
          JSON.stringify({ ref: "N-075", direction: "down", meanings: ["derivation"] }),
        ])
      ).stdout,
    ) as { nodes: { depth: number; title: string }[] };
    const requirements = children.nodes.filter((node) => node.depth === 1).map((node) => node.title);
    expect(requirements.length).toBeGreaterThan(1);
    await expect(window.locator('[role="tree"] [role="treeitem"]')).toHaveCount(requirements.length);
    await shot("neighbourhood");

    // A system requirement with two parents: the parents line stands above its title.
    await window.keyboard.press("ControlOrMeta+J");
    await open(window, "SR-107", "Umgebung am Element zeigen");
    await expect(window.locator(".parents")).toContainText("Vollständige Kette vom Parent bis zum Child");
    await shot("parents-line");
  } finally {
    await running.close();
  }
});
