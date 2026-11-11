// The short ID with the identifier behind it (SR-084 AK4) on the built app, on a copy of the repository's
// own specification (`spec/`): the modeline, the name of the buffer, the relations and the graph show
// `SR-3c90b0 (SR-036)` as the CLI prints it, and "Copy field" at the ID copies the short ID. A light
// screenshot of the element and of its graph goes to `test-results/electron/screenshots/` (or the folder
// in REQSEQ_SCREENSHOTS).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { launchApp } from "./support/app.js";

const SPEC = fileURLToPath(new URL("../../../spec", import.meta.url));
const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** An element and its relations as `element get` gives them. */
interface Got {
  readonly element: {
    readonly shortId: string;
    readonly identifier?: string;
    readonly title: string;
    readonly relations: readonly {
      readonly kind: string;
      readonly shortId?: string;
      readonly identifier?: string;
    }[];
  };
}

test("[SR-084/AK4] the modeline, the buffer name, the relations and the graph show the identifier in brackets behind the short ID, and Copy field at the ID copies the short ID", async () => {
  const running = await launchApp({ folder: SPEC }, { colorScheme: "light" });
  const { window } = running;
  const before = await running.app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await fs.mkdir(OUT, { recursive: true });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    await expect(window.getByLabel("Modeline")).toContainText("elements", { timeout: 0 });
    const { element } = JSON.parse((await running.cli(["element", "get", "SR-084"])).stdout) as Got;
    const shown = `${element.shortId} (SR-084)`;
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("SR-084");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("SR-084");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(element.title);
    // The modeline.
    await expect(window.locator('.modeline [data-field="ID"]')).toHaveText(shown);
    // The relations: the need it derives from.
    const need = element.relations.find((relation) => relation.kind === "derives-from");
    expect(need?.identifier).toBeDefined();
    await expect(window.locator('[data-field="derives-from"] li').first()).toContainText(
      `${need?.shortId ?? ""} (${need?.identifier ?? ""})`,
    );
    await window.screenshot({ path: path.join(OUT, "sr-084-element-light.png") });
    // "Copy field" with the cursor in no field copies the ID field: the short ID alone.
    await window.locator("article").focus();
    await window.keyboard.press("ControlOrMeta+Shift+C");
    await expect(window.getByLabel("Modeline")).toContainText("Copied ID");
    expect(await running.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(element.shortId);
    // The graph.
    await window.locator("article").focus();
    await window.keyboard.press("ControlOrMeta+Shift+G");
    await expect(window.locator(".graph-id", { hasText: `${shown} · System Requirement` })).toHaveCount(1);
    await window.screenshot({ path: path.join(OUT, "sr-084-graph-light.png") });
    // The name of the element's buffer, as Ctrl+P offers the open buffers besides the graph.
    await window.keyboard.press("ControlOrMeta+P");
    await expect(
      window
        .locator('.candidates [role="option"] .name')
        .getByText(`${shown} ${element.title}`, { exact: true }),
    ).toHaveCount(1);
  } finally {
    await running.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), before);
    await running.close();
  }
});
