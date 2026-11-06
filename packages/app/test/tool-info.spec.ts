// "Show tool info" (SR-161) on the built app: the info in a result buffer, "Copy result" on the clipboard of
// the system, and the same values from the command line and the MCP server started on the Electron of the
// app, as the launcher of a delivery starts them (ADR-0014). The clipboard of the machine is kept: it is
// saved before the test and written back after it.
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";
import { resultLines } from "../src/renderer/result.js";
import { resultText } from "../src/renderer/result-copy.js";

const names = (running: RunningApp) => running.window.locator('.candidates [role="option"] .name');

const readClipboard = (running: RunningApp): Promise<string> =>
  running.app.evaluate(({ clipboard }) => clipboard.readText());
const writeClipboard = (running: RunningApp, text: string): Promise<void> =>
  running.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);

/** Runs a command of the command prompt by its title, with no arguments. */
const runCommand = async (running: RunningApp, title: string): Promise<void> => {
  await running.window.keyboard.press("ControlOrMeta+Shift+P");
  await running.window.keyboard.type(title);
  await expect(names(running).first()).toHaveText(title);
  await running.window.keyboard.press("Enter");
};

test.describe("Show tool info", () => {
  let running: RunningApp;
  let before: string;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-004/one-repository" });
    before = await readClipboard(running);
    await expect(running.window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  });
  test.afterEach(async () => {
    await writeClipboard(running, before);
    await running.close();
  });

  test("[SR-161/AK1] the command prompt shows version, build, runtime and the open workspace", async () => {
    await runCommand(running, "Show tool info");
    const result = running.window.locator(".result");
    for (const key of ["versions", "build", "runtime", "workspace", "license", "documentation"]) {
      await expect(result.locator(".line", { hasText: key }).first()).toBeVisible();
    }
    await expect(result).toContainText("Weather station");
    await expect(result).toContainText("electron");
    await expect(result).toContainText("chromium");
  });

  test("[SR-161/AK2] the info names the licences, the bundled documentation and the addresses as text", async () => {
    await runCommand(running, "Show tool info");
    const result = running.window.locator(".result");
    await expect(result).toContainText("Copyright");
    await expect(result).toContainText("https://thomasbirkmaier.github.io/ReqSeq/");
    await expect(result).toContainText("https://github.com/ThomasBirkmaier/ReqSeq/releases");
    // The addresses are text: no line of the info is a link.
    await expect(result.locator("a")).toHaveCount(0);
  });

  test("[SR-161/AK3] Copy result puts the whole info on the clipboard as one block", async () => {
    await runCommand(running, "Show tool info");
    await expect(running.window.locator(".result")).toContainText("Weather station");
    await runCommand(running, "Copy result");
    await expect(running.window.locator(".modeline")).toContainText("Copied result");
    const shown = await running.window.locator(".result .line").allInnerTexts();
    const copied = await readClipboard(running);
    expect(copied.split("\n")).toHaveLength(shown.length);
    expect(copied).toContain("Weather station");
    expect(copied).toContain("documentation:");
  });

  test("[SR-161/AK5] the command line and the MCP server on the app's Electron give the app's values", async () => {
    await runCommand(running, "Show tool info");
    await expect(running.window.locator(".result")).toContainText("Weather station");
    await runCommand(running, "Copy result");
    await expect(running.window.locator(".modeline")).toContainText("Copied result");
    const app = await readClipboard(running);

    const cli = await running.cli(["tool", "info"], { electron: true });
    expect(cli.code).toBe(0);
    const fromCli = JSON.parse(cli.stdout) as Record<string, unknown>;
    const mcp = await running.mcp({ electron: true });
    const fromMcp = (await mcp.call("tool_info", {})) as Record<string, unknown>;
    // The path of the workspace is the only value AK5 leaves out; here all three open the same root.
    const withoutPath = (info: Record<string, unknown>) => ({
      ...info,
      workspace: { ...(info["workspace"] as object), path: "" },
    });
    expect(withoutPath(fromMcp)).toEqual(withoutPath(fromCli));
    expect((fromCli["runtime"] as Record<string, unknown>)["electron"]).toBeDefined();
    expect(app).toBe(resultText(resultLines(fromCli)));
  });
});
