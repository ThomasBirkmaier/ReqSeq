// "Create workspace" of the start buffer (SR-225 AK4–AK6): the system folder dialog (stubbed in main), then the
// command prompt asks only the name, pre-filled with the folder's name; Enter creates the workspace with the
// standard model and opens it. A canceled dialog, Escape and an empty name create nothing, and a chosen folder that
// is a workspace is opened as it is.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { FixtureWorkspace, RunningApp } from "./support/app.js";
import { copyFixture, launchApp } from "./support/app.js";

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

let running: RunningApp;
const folders: string[] = [];

test.beforeEach(async () => {
  running = await launchApp(undefined, { colorScheme: "light" });
});

test.afterEach(async () => {
  await running.close();
  // After the app has closed, as Windows keeps an open folder locked.
  for (const folder of folders.splice(0)) {
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 10 });
  }
});

/** A new empty folder named `name` in a new temporary folder. */
const emptyFolder = (name: string): string => {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "reqseq-create-")));
  folders.push(top);
  const folder = path.join(top, name);
  fs.mkdirSync(folder);
  return folder;
};

/** The system folder dialog answers `folder`, or is canceled without one. */
const dialogAnswers = (folder: string | undefined): Promise<void> =>
  running.app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () =>
      Promise.resolve(
        chosen === undefined ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [chosen] },
      );
  }, folder);

const createLine = () => running.window.getByRole("listbox", { name: "Start" }).getByText("Create workspace");

test("[SR-225/AK-tccz] Create workspace of the start buffer asks only the name, pre-filled with the folder's, and Enter creates the workspace and opens it", async () => {
  const { window } = running;
  const folder = emptyFolder("Station");
  await dialogAnswers(folder);
  await createLine().click();
  await expect(window.locator("label.prompt-label")).toHaveText("Create workspace · name:");
  await expect(window.locator("#prompt-input")).toHaveValue("Station");
  await window.screenshot({ path: path.join(SHOTS, "start-create-name-light.png") });
  await window.keyboard.press("Enter");
  await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  await expect(window).toHaveTitle("Station - ReqSeq");
  await expect(window.getByLabel("Minibuffer")).toHaveText(
    /^Created workspace Station; \d+ files written\.$/,
  );
  // With the standard model (SR-014 AK1), in the folder chosen.
  expect(fs.readFileSync(path.join(folder, "reqseq-workspace.yaml"), "utf8")).toContain("name: Station");
  expect(fs.existsSync(path.join(folder, "metamodel", "standard-model.yaml"))).toBe(true);
  await window.screenshot({ path: path.join(SHOTS, "start-create-opened-light.png") });
});

test("[SR-225/AK-mw88] a canceled dialog, Escape and an empty name create nothing, and an empty name says that a name is needed", async () => {
  const { window } = running;
  const folder = emptyFolder("Buoy");
  const prompt = window.locator("label.prompt-label");
  await dialogAnswers(undefined);
  await createLine().click();
  await expect(prompt).toHaveCount(0);
  await expect(window.getByRole("listbox", { name: "Start" })).toBeVisible();
  // Escape in the name.
  await dialogAnswers(folder);
  await createLine().click();
  await expect(prompt).toHaveText("Create workspace · name:");
  await window.keyboard.press("Escape");
  await expect(prompt).toHaveCount(0);
  // An empty name stays in the step.
  await createLine().click();
  await window.locator("#prompt-input").fill("");
  await window.keyboard.press("Enter");
  await expect(prompt).toHaveText("A name is needed · Create workspace · name:");
  await window.screenshot({ path: path.join(SHOTS, "start-create-empty-name-light.png") });
  await window.keyboard.press("Escape");
  expect(fs.readdirSync(folder)).toEqual([]);
});

test("[SR-225/AK-tf62] a chosen folder that is a workspace is opened, and nothing is created", async () => {
  const station: FixtureWorkspace = await copyFixture({ fixture: "SR-004/one-repository" });
  folders.push(path.dirname(station.root));
  const before = fs.readdirSync(station.root).sort();
  await dialogAnswers(station.root);
  await createLine().click();
  const { window } = running;
  await expect(window.getByLabel("Minibuffer")).toHaveText("Opened the existing workspace Weather station");
  await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  await expect(window.locator("label.prompt-label")).toHaveCount(0);
  expect(fs.readdirSync(station.root).sort()).toEqual(before);
});

test("a folder inside a workspace, not itself one, becomes a workspace of its own", async () => {
  const station: FixtureWorkspace = await copyFixture({ fixture: "SR-004/one-repository" });
  folders.push(path.dirname(station.root));
  const inside = path.join(station.root, "buoy");
  fs.mkdirSync(inside);
  await dialogAnswers(inside);
  await createLine().click();
  const { window } = running;
  await expect(window.locator("#prompt-input")).toHaveValue("buoy");
  await window.keyboard.press("Enter");
  await expect(window).toHaveTitle("buoy - ReqSeq");
  expect(fs.existsSync(path.join(inside, "reqseq-workspace.yaml"))).toBe(true);
});
