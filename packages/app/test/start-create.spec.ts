// "Create workspace" of the start buffer (SR-225 AK4–AK6): the system folder dialog (stubbed in main), then the
// command prompt asks only the name, pre-filled with the folder's name; Enter creates the workspace with the
// standard model and opens it. A canceled dialog, Escape and an empty name create nothing, and a chosen folder that
// is a workspace is opened as it is. The new workspace has no element, so its overview shows the first steps
// (SR-118 AK9, SR-225 AK3).
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
  // With its evidence folder, kept in Git by an empty `.gitkeep` (SR-230 AK4).
  expect(fs.readFileSync(path.join(folder, "evidence", ".gitkeep"), "utf8")).toBe("");
  await window.screenshot({ path: path.join(SHOTS, "start-create-opened-light.png") });
});

test("[SR-118/AK-fdqn] [SR-225/AK-tgvr] the new empty workspace shows its first steps in the middle, and a click or Enter runs them as the command prompt does", async () => {
  const { window } = running;
  await dialogAnswers(emptyFolder("Buoy"));
  await createLine().click();
  await expect(window.locator("#prompt-input")).toHaveValue("Buoy");
  await window.keyboard.press("Enter");
  const overview = window.getByRole("listbox", { name: "Overview" });
  await expect(overview.getByRole("option")).toHaveText([
    `Create element${process.platform === "darwin" ? "⌘K E" : "Ctrl+K E"}`,
    "Import ReqIF file",
    "Connect AI agent",
  ]);
  await expect(window.getByRole("listbox", { name: "Start" })).toHaveCount(0);
  // Without a frame, paler than the side texts, as the lines of the start buffer (SR-225 AK1).
  const line = overview.locator(".start-line").first();
  await expect(line).toHaveCSS("border-top-style", "none");
  const colour = (selector: string): Promise<string> =>
    window.evaluate((css) => {
      const probe = document.createElement("span");
      probe.style.color = css;
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    }, selector);
  await expect(line).toHaveCSS("color", await colour("var(--faint)"));
  // In the middle of the sheet.
  const sheet = await window.getByRole("main", { name: "Sheet" }).boundingBox();
  const lines = await overview.locator(".column").boundingBox();
  expect(sheet).not.toBeNull();
  expect(lines).not.toBeNull();
  if (sheet !== null && lines !== null) {
    expect(Math.abs(lines.x + lines.width / 2 - (sheet.x + sheet.width / 2))).toBeLessThan(2);
    expect(Math.abs(lines.y + lines.height / 2 - (sheet.y + sheet.height / 2))).toBeLessThan(40);
  }
  // The pointer away from the lines, which a hover would mark.
  await window.mouse.move(0, 0);
  await window.screenshot({ path: path.join(SHOTS, "overview-first-steps-light.png") });
  // A click runs "Import ReqIF file" as the command prompt does: it asks its first argument.
  const prompt = window.locator("label.prompt-label");
  await overview.getByRole("option", { name: "Import ReqIF file" }).click();
  await expect(prompt).toHaveText(/^Import ReqIF file · /);
  // Escape steps back to the command prompt, then closes it.
  await window.keyboard.press("Escape");
  await window.keyboard.press("Escape");
  await expect(prompt).toHaveCount(0);
  // The arrow keys mark "Create element", and Enter runs it.
  await overview.press("ArrowUp");
  await overview.press("Enter");
  await expect(prompt).toHaveText("Create element · type:");
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
