// The next steps of an output (SR-226 AK5): the output of "Create workspace" names connecting an AI agent and
// creating an element as its next steps (SR-226 AK2); its page shows them as its last lines, each with the name of its
// command and its key where it has one, and Enter or a click runs it, the command prompt asking the open inputs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const COMMANDS = process.platform === "darwin" ? "Meta+Shift+P" : "Control+Shift+P";

let running: RunningApp;
let folder: string;

test.beforeEach(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "reqseq-next-"));
  running = await launchApp(undefined, { colorScheme: "light" });
});

test.afterEach(async () => {
  await running.close();
  // After the app has closed, as Windows keeps an open folder locked.
  fs.rmSync(folder, { recursive: true, force: true, maxRetries: 10 });
});

test("[SR-226/AK-sfy2] the next steps of an output are its last lines with the name and key of their command, and Enter or a click runs one", async () => {
  const { window } = running;
  // Open the empty folder, then create the workspace in it: the command line keeps the answer, whose click opens
  // the output (SR-223 AK8).
  await running.app.evaluate(({ dialog, Menu }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    const file = Menu.getApplicationMenu()?.items.find((item) => item.label === "File");
    file?.submenu?.items.find((item) => item.label === "Open Workspace…")?.click();
  }, folder);
  await expect(window.getByLabel("Minibuffer")).toContainText("Create workspace");
  await window.keyboard.press(COMMANDS);
  await window.keyboard.type("Create workspace");
  await window.keyboard.press("Enter");
  await window.keyboard.type(folder);
  await window.keyboard.press("Enter");
  await window.keyboard.type("Station");
  await window.keyboard.press("Enter");
  await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  await window.locator(".echo-open").click();
  const page = window.locator(".result.output");
  await expect(page).toBeVisible();

  // The steps are the last lines, each with the name the command prompt gives its command and its key where it
  // has one: "Create element" has one after the prefix key, "Connect AI agent" none.
  const steps = page.locator(".line.step");
  await expect(steps.locator(".text")).toHaveText(["Connect AI agent", "Create element"]);
  await expect(steps.nth(1).locator("kbd")).toHaveText(process.platform === "darwin" ? "⌘K E" : "Ctrl+K E");
  await expect(steps.nth(0).locator("kbd")).toHaveCount(0);
  await expect(page.locator(".line").last()).toHaveText(/^Create element/);
  await window.screenshot({ path: path.join(SHOTS, "next-steps-light.png") });

  // Enter on a step runs its command, and the command prompt asks its open inputs.
  await page.focus();
  await window.keyboard.press("End");
  await expect(steps.nth(1)).toHaveAttribute("aria-selected", "true");
  await window.keyboard.press("Enter");
  await expect(window.locator("label.prompt-label")).toHaveText("Create element · type:");
  // Escape before the first input goes back to the command prompt, as for an entry of the context menu (SR-134 AK1).
  await window.keyboard.press("Escape");
  await expect(window.locator("label.prompt-label")).toHaveText("Command");
  await window.keyboard.press("Escape");
  await expect(window.locator("label.prompt-label")).toHaveCount(0);

  // A click does the same.
  await steps.nth(0).click();
  await expect(window.locator("label.prompt-label")).toHaveText("Connect AI agent · client:");
  await window.screenshot({ path: path.join(SHOTS, "next-steps-prompt-light.png") });
});
