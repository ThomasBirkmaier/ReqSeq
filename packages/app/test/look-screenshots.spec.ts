// Screenshots of the look of the window (#490) for the pull request: the element view with the status
// line, and the command prompt open over it, in light and in dark, and once more with the renderer told it
// runs on macOS (the title bar strip). The window is 1280×800. The PNGs go to
// `test-results/electron/screenshots/` (or the folder in LOGREQ_SCREENSHOTS) as
// `look-[mac-]<scheme>-<view>.png`.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { launchApp, listAll, modifier } from "./support/app.js";

const SPEC = fileURLToPath(new URL("../../../spec", import.meta.url));
const OUT =
  process.env["LOGREQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));
const ELEMENT = "Beim Schreiben per Suche verlinken";

for (const [scheme, mac] of [
  ["light", false],
  ["dark", false],
  ["light", true],
  ["dark", true],
] as const) {
  const platform = mac ? "mac-" : "";
  test(`screenshots of the element view and the command prompt in ${scheme}${mac ? " (macOS)" : ""}`, async () => {
    const running = await launchApp({ folder: SPEC }, { colorScheme: scheme });
    const { window } = running;
    try {
      await fs.mkdir(OUT, { recursive: true });
      await running.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
      });
      if (mac) {
        // The renderer as on macOS: the title bar strip (the traffic lights are the OS's, not in the shot).
        await running.app.context().addInitScript(() => {
          Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
        });
        await window.reload();
      }
      await listAll(window);
      const mod = await modifier(window);
      const shot = (name: string): Promise<Buffer> =>
        window.screenshot({ path: path.join(OUT, `look-${platform}${scheme}-${name}.png`) });
      await window.keyboard.press(`${mod}+P`);
      await window.keyboard.type("SR-066");
      await expect(window.locator('.candidates [role="option"]').first()).toContainText(ELEMENT);
      await window.keyboard.press("Enter");
      await expect(window.locator("article h1")).toHaveText(ELEMENT);
      await expect(window.locator(".cm-content").first()).toBeVisible();
      await shot("element");
      await window.keyboard.press(`${mod}+Shift+P`);
      await expect(window.locator('.candidates [role="option"]').first()).toBeVisible();
      await shot("commands");
    } finally {
      await running.close();
    }
  });
}
