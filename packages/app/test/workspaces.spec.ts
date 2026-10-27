// "Open workspace" on the built app (SR-131): the command prompt lists the workspaces opened last, the
// most recent first, narrows them as typed, and opens the chosen one in the same window; one that is gone
// is marked and keeps the open workspace; the list outlives a restart. The two workspaces lie in folders
// whose names share no letters in order with each other or the temporary folder, so narrowing cannot pass
// by chance. Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { FixtureWorkspace, RunningApp } from "./support/app.js";
import { copyFixture, launchApp } from "./support/app.js";

/** The first workspace: the app starts on it. */
const STATION = { fixture: "SR-069/filter", name: "kestrel" };

/** The second workspace, under another name. */
const BUOY = {
  fixture: "SR-004/one-repository",
  name: "quokka",
  files: {
    "logreq-workspace.yaml": [
      "logreq-workspace: 1",
      "name: Ocean buoy",
      "repositories:",
      '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
      "metamodel: { repository: system, path: metamodel }",
      "",
    ].join("\n"),
  },
};

const names = (window: Page) => window.locator('.candidates [role="option"] .name');
const options = (window: Page) => window.locator('.candidates [role="option"]');

/** Opens the prompt "Open workspace" from the command prompt. */
const openWorkspacePrompt = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("Open workspace");
  await expect(names(window).first()).toHaveText("Open workspace");
  await window.keyboard.press("Enter");
  await expect(window.locator("label.prompt-label")).toHaveText("Workspace");
};

/** Whether "Go to" finds an element with this title in the open workspace. */
const goToFinds = async (window: Page, title: string): Promise<boolean> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  // The search answers within the typing; give it the time of one answer.
  await window.waitForTimeout(500);
  const found = (await options(window).allTextContents()).some((text) => text.includes(title));
  await window.keyboard.press("Escape");
  return found;
};

test.describe("Open workspace", () => {
  let running: RunningApp;
  let buoy: FixtureWorkspace;

  test.beforeEach(async () => {
    buoy = await copyFixture(BUOY);
  });

  test.afterEach(async () => {
    await running.close();
    await buoy.cleanup();
  });

  test('[SR-131/AK1] "Open workspace" lists the recent workspaces, the last opened first, and narrows them as typed', async () => {
    running = await launchApp(STATION, { recent: [buoy.root] });
    const { window } = running;
    const station = running.workspace?.root ?? "";
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await openWorkspacePrompt(window);
    // The workspace opened at the start comes first, marked open; then the one opened before it.
    await expect(names(window)).toHaveText([station, buoy.root]);
    await expect(options(window).first().locator(".hint")).toHaveText("open");
    await expect(options(window).nth(1).locator(".hint")).toHaveCount(0);
    await window.keyboard.type("quokka");
    await expect(names(window)).toHaveText([buoy.root]);
    await window.keyboard.press("ControlOrMeta+A");
    await window.keyboard.type("kestrel");
    await expect(names(window)).toHaveText([station]);
  });

  test("[SR-131/AK2] choosing another workspace replaces the open one in the same window", async () => {
    running = await launchApp(STATION, { recent: [buoy.root] });
    const { app, window } = running;
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await expect(window).toHaveTitle("Weather station - LogReq");
    expect(await goToFinds(window, "Survive icing")).toBe(true);
    await openWorkspacePrompt(window);
    await window.keyboard.type("quokka");
    await expect(names(window)).toHaveText([buoy.root]);
    await window.keyboard.press("Enter");
    await expect(window).toHaveTitle("Ocean buoy - LogReq");
    await expect(window.getByLabel("Modeline")).toContainText("Ocean buoy");
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    // The same window, and no other.
    expect(app.windows()).toEqual([window]);
    expect(await goToFinds(window, "Show wind speed")).toBe(true);
    expect(await goToFinds(window, "Survive icing")).toBe(false);
    // The workspace now open is first and marked open.
    await openWorkspacePrompt(window);
    await expect(names(window)).toHaveText([buoy.root, running.workspace?.root ?? ""]);
    await expect(options(window).first().locator(".hint")).toHaveText("open");
  });

  test("[SR-131/AK4] a recent workspace that is gone is marked not found, and choosing it keeps the open workspace", async () => {
    const gone = path.join(os.tmpdir(), `logreq-app-gone-${String(process.pid)}`, "harbour");
    running = await launchApp(STATION, { recent: [gone, buoy.root] });
    const { app, window } = running;
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await openWorkspacePrompt(window);
    await expect(names(window)).toHaveText([running.workspace?.root ?? "", gone, buoy.root]);
    await expect(options(window).nth(1).locator(".hint")).toHaveText("not found");
    await window.keyboard.type("harbour");
    await expect(names(window)).toHaveText([gone]);
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Minibuffer")).toHaveText(
      `${gone} is not found; Weather station stays open`,
    );
    await expect(window).toHaveTitle("Weather station - LogReq");
    expect(app.windows()).toEqual([window]);
    expect(await goToFinds(window, "Survive icing")).toBe(true);
  });

  test('[SR-131/AK6] after a restart "Open workspace" lists the same workspaces in the same order', async () => {
    running = await launchApp(STATION, { recent: [buoy.root] });
    let { window } = running;
    const station = running.workspace?.root ?? "";
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await openWorkspacePrompt(window);
    await window.keyboard.type("quokka");
    await window.keyboard.press("Enter");
    await expect(window).toHaveTitle("Ocean buoy - LogReq");
    const { kept } = running;
    await running.close({ keep: true });
    // Started as the packaged app starts: no workspace; the command prompt works all the same.
    running = await launchApp(undefined, { kept, withoutWorkspace: true });
    ({ window } = running);
    await expect(window.getByLabel("Modeline")).toHaveText("No workspace");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await expect(names(window)).toHaveText(["Open workspace"]);
    await window.keyboard.press("Enter");
    await expect(names(window)).toHaveText([buoy.root, station]);
    await expect(options(window).locator(".hint")).toHaveCount(0);
    // And it opens one.
    await window.keyboard.press("Enter");
    await expect(window).toHaveTitle("Ocean buoy - LogReq");
  });
});
