// "About ReqSeq" (SR-161) on the built app: the info in a window in the middle, each row and the whole content
// on the clipboard of the system, Escape and a click beside it close it, and the same values from the command
// line and the MCP server started on the Electron of the app, as the launcher of a delivery starts them
// (ADR-0014). The clipboard of the machine is kept: it is saved before the test and written back after it.
import { expect, test } from "@playwright/test";
import type { AboutInfo } from "../src/renderer/about.js";
import { aboutGroups, aboutText } from "../src/renderer/about.js";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

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

const about = (running: RunningApp) => running.window.getByRole("dialog", { name: "About ReqSeq" });

test.describe("About ReqSeq", () => {
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

  test("[SR-161/AK-hbxy] the command prompt shows version, build, runtime and the open workspace in a window", async () => {
    await runCommand(running, "About ReqSeq");
    const window = about(running);
    for (const group of ["ReqSeq version", "Build", "Runtime", "Workspace", "Licence", "Documentation"]) {
      await expect(window.getByRole("region", { name: group })).toBeVisible();
    }
    await expect(window).toContainText("Weather station");
    await expect(window.locator('[data-label="Electron"]')).toBeVisible();
    await expect(window.locator('[data-label="Chromium"]')).toBeVisible();
    // No result buffer: the window shows it.
    await expect(running.window.locator(".result")).toHaveCount(0);
  });

  test("[SR-161/AK-ttck] the info names the licences, the bundled documentation and the addresses as text", async () => {
    await runCommand(running, "About ReqSeq");
    const window = about(running);
    await expect(window).toContainText("Copyright");
    await expect(window).toContainText("https://thomasbirkmaier.github.io/ReqSeq/");
    await expect(window).toContainText("https://github.com/ThomasBirkmaier/ReqSeq/releases");
    // The addresses are text: no line of the info is a link.
    await expect(window.locator("a")).toHaveCount(0);
  });

  test("[SR-161/AK-r9fy] a row copies only its value, Copy all the whole content as one block", async () => {
    await runCommand(running, "About ReqSeq");
    const window = about(running);
    const path = window.locator('[data-label="Path"]');
    await path.hover();
    await path.getByRole("button", { name: "Copy Path" }).click();
    await expect(running.window.locator(".modeline")).toContainText("Copied Path");
    expect(await readClipboard(running)).toBe(await path.locator("dd").innerText());

    // From the keyboard: Up and Down move the focus over the rows, Enter copies the value of the one it is on.
    await window.locator('[data-label="Elements"]').focus();
    await running.window.keyboard.press("ArrowUp");
    await running.window.keyboard.press("Enter");
    await expect(running.window.locator(".modeline")).toContainText("Copied Repositories");
    expect(await readClipboard(running)).toBe("system");

    await window.getByRole("button", { name: "Copy all" }).click();
    await expect(running.window.locator(".modeline")).toContainText("Copied About ReqSeq");
    const copied = await readClipboard(running);
    expect(copied.split("\n")[0]).toBe("About ReqSeq");
    expect(copied).toContain("Weather station");
    expect(copied).toContain("Documentation");
  });

  test("[SR-161/AK-r14d] the command line and the MCP server on the app's Electron give the app's values", async () => {
    await runCommand(running, "About ReqSeq");
    await about(running).getByRole("button", { name: "Copy all" }).click();
    await expect(running.window.locator(".modeline")).toContainText("Copied About ReqSeq");
    const app = await readClipboard(running);

    const cli = await running.cli(["tool", "info"], { electron: true });
    expect(cli.code).toBe(0);
    const fromCli = JSON.parse(cli.stdout) as AboutInfo;
    const mcp = await running.mcp({ electron: true });
    const fromMcp = (await mcp.call("tool_info", {})) as AboutInfo;
    // The path of the workspace is the only value AK5 leaves out; here all three open the same root.
    const withoutPath = (info: AboutInfo): AboutInfo => ({
      ...info,
      workspace: { ...info.workspace, path: "" },
    });
    expect(withoutPath(fromMcp)).toEqual(withoutPath(fromCli));
    expect(fromCli.runtime.electron).toBeDefined();
    expect(app).toBe(aboutText(aboutGroups(fromCli)));
  });

  test("[SR-161/AK-q0hr] stands centered over a dimmed, blurred window; Escape or a click beside it closes it", async () => {
    await runCommand(running, "About ReqSeq");
    const card = running.window.locator(".about");
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    const size =
      running.window.viewportSize() ??
      (await running.window.evaluate(() => ({ width: innerWidth, height: innerHeight })));
    expect(box).not.toBeNull();
    if (box !== null) {
      expect(Math.abs(box.x + box.width / 2 - size.width / 2)).toBeLessThanOrEqual(2);
      expect(Math.abs(box.y + box.height / 2 - size.height / 2)).toBeLessThanOrEqual(2);
    }
    const backdrop = running.window.locator(".about-backdrop");
    expect(await backdrop.evaluate((node) => getComputedStyle(node).backdropFilter)).toMatch(/blur\(\d+px\)/);
    // No shortcut of the app acts behind it: the command prompt does not open.
    await running.window.keyboard.press("ControlOrMeta+Shift+P");
    await expect(running.window.locator(".candidates")).toHaveCount(0);
    await expect(card).toBeVisible();
    // Escape closes it.
    await running.window.keyboard.press("Escape");
    await expect(card).toHaveCount(0);

    await runCommand(running, "About ReqSeq");
    await expect(card).toBeVisible();
    await running.window.mouse.click(5, (box?.y ?? 40) + 5);
    await expect(card).toHaveCount(0);
  });
});
