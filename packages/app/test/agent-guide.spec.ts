// "Agent guide" (SR-229 AK1) on the built app: the output page shows the guide whole, line by line as the command
// line gives it, not one line cut at the edge (#2141). Keys use ControlOrMeta, so the test runs on Linux and macOS.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

test.describe("Agent guide", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-004/one-repository" });
    await expect(running.window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-229/AK-p4y6] the output page shows the guide with MCP names whole, as the command line gives it", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Agent guide");
    await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText("Agent guide");
    await window.keyboard.press("Enter");
    await expect(window.locator("label.prompt-label")).toHaveText("Agent guide · names:");
    await window.keyboard.type("mcp");
    await window.keyboard.press("Enter");
    const cli = await running.cli(["tool", "guide", "--names", "mcp"]);
    expect(cli.code).toBe(0);
    const expected = JSON.parse(cli.stdout) as { answer: string; guide: string };
    const page = window.locator(".result.output[data-buffer]");
    await expect(page.locator("h1.answer")).toHaveText(expected.answer);
    const block = page.locator(".line.block");
    await expect(block.locator(".label")).toHaveText("Agent guide");
    expect(await block.locator(".text").textContent()).toBe(expected.guide);
    await window.screenshot({ path: path.join(OUT, "agent-guide-light.png") });
  });
});
