// "Open workspace" on the built app (SR-131): the command prompt lists the workspaces opened last, the
// most recent first, narrows them as typed, and opens the chosen one in the same window; one that is gone
// is marked and keeps the open workspace; the list outlives a restart; unsaved input is in its file
// before a switch, also from File > Open Workspace; a typed folder path opens its workspace. The two workspaces lie in folders
// whose names share no letters in order with each other or the temporary folder, so narrowing cannot pass
// by chance. Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import fs from "node:fs/promises";
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
    "reqseq-workspace.yaml": [
      "reqseq-workspace: 1",
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

/** The element of the first workspace that the AK3 tests type in, and its file. */
const ICING = { title: "Survive icing", file: "requirements/SR-0000000000b3.md" };

/** Opens the element with this title by "Go to" and types `text` at the end of its text, unsaved. */
const typeUnsaved = async (window: Page, title: string, text: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(options(window).first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(window.locator("article")).toBeFocused();
  // Enter edits the text, with the cursor at its end.
  await window.keyboard.press("Enter");
  await expect(window.getByRole("textbox", { name: "Text" })).toBeFocused();
  await window.keyboard.insertText(text);
  await expect(window.getByLabel("Modeline")).toContainText("modified");
  // Leave the editor: the input stays unsaved.
  await window.keyboard.press("Escape");
  await expect(window.locator("article")).toBeFocused();
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
    await expect(window).toHaveTitle("Weather station - ReqSeq");
    expect(await goToFinds(window, "Survive icing")).toBe(true);
    await openWorkspacePrompt(window);
    await window.keyboard.type("quokka");
    await expect(names(window)).toHaveText([buoy.root]);
    await window.keyboard.press("Enter");
    await expect(window).toHaveTitle("Ocean buoy - ReqSeq");
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
    const gone = path.join(os.tmpdir(), `reqseq-app-gone-${String(process.pid)}`, "harbour");
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
    await expect(window).toHaveTitle("Weather station - ReqSeq");
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
    await expect(window).toHaveTitle("Ocean buoy - ReqSeq");
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
    await expect(window).toHaveTitle("Ocean buoy - ReqSeq");
  });

  test("[SR-131/AK3] unsaved input in the editor is in the file before the workspace changes", async () => {
    running = await launchApp(STATION, { recent: [buoy.root] });
    const { window } = running;
    const file = path.join(running.workspace?.root ?? "", ...ICING.file.split("/"));
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await typeUnsaved(window, ICING.title, "Typed before the switch.");
    expect(await fs.readFile(file, "utf8")).not.toContain("Typed before the switch.");
    await openWorkspacePrompt(window);
    await window.keyboard.type("quokka");
    await expect(names(window)).toHaveText([buoy.root]);
    await window.keyboard.press("Enter");
    await expect(window).toHaveTitle("Ocean buoy - ReqSeq");
    expect(await fs.readFile(file, "utf8")).toContain("Typed before the switch.");
  });

  test("[SR-131/AK3] File > Open Workspace saves the unsaved input first too, in the same window", async () => {
    running = await launchApp(STATION);
    const { app, window } = running;
    const file = path.join(running.workspace?.root ?? "", ...ICING.file.split("/"));
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await typeUnsaved(window, ICING.title, "Typed before the dialog.");
    // The native dialog answers with the second workspace; the menu item is clicked as a person does.
    await app.evaluate(({ dialog, Menu }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
      const file = Menu.getApplicationMenu()?.items.find((item) => item.label === "File");
      file?.submenu?.items.find((item) => item.label === "Open Workspace…")?.click();
    }, buoy.root);
    await expect(window).toHaveTitle("Ocean buoy - ReqSeq");
    expect(app.windows()).toEqual([window]);
    expect(await fs.readFile(file, "utf8")).toContain("Typed before the dialog.");
  });

  test("[SR-131/AK5] a typed folder path opens its workspace and lists it first afterwards", async () => {
    running = await launchApp(STATION);
    const { app, window } = running;
    const station = running.workspace?.root ?? "";
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await openWorkspacePrompt(window);
    // Not in the list: only the open workspace is.
    await expect(names(window)).toHaveText([station]);
    // A folder inside the workspace: the workspace is found upwards, as `--workspace` finds it.
    const typed = path.join(buoy.root, "requirements");
    await window.keyboard.type(typed);
    await expect(names(window).first()).toHaveText(`Open ${typed}`);
    await window.keyboard.press("Enter");
    await expect(window).toHaveTitle("Ocean buoy - ReqSeq");
    expect(app.windows()).toEqual([window]);
    expect(await goToFinds(window, "Show wind speed")).toBe(true);
    await openWorkspacePrompt(window);
    await expect(names(window)).toHaveText([buoy.root, station]);
    await expect(options(window).first().locator(".hint")).toHaveText("open");
    // A folder without a workspace opens nothing, and says so.
    await window.keyboard.type(os.tmpdir());
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Minibuffer")).toHaveText(
      `No workspace in ${os.tmpdir()} or a folder above it; Ocean buoy stays open`,
    );
    await expect(window).toHaveTitle("Ocean buoy - ReqSeq");
  });
});
