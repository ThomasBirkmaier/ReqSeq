// Renaming and deleting perspectives and saved filters in the command prompt (SR-218) on the built app, on
// fixtures/SR-043/example (six system requirements) with saved filter and perspective files added. Each test
// compares the files and the CLI's `perspective list` and `filter list` with what the app shows. The light
// screenshots of each step are written by the tests of the AKs, and the last test writes them in dark as well
// (`test-results/electron/screenshots/`, or the folder in `REQSEQ_SCREENSHOTS`).
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, modifier, slideSettled } from "./support/app.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const perspective = (lines: readonly string[]): string => ["reqseq-perspective: 1", ...lines, ""].join("\n");

const FILES = {
  "filters/sensors.yaml": [
    "reqseq-filter: 1",
    "name: Sensors",
    "where: { type: [system-requirement] }",
    "",
  ].join("\n"),
  "filters/unused.yaml": ["reqseq-filter: 1", "name: Unused", "where: { status: [draft] }", ""].join("\n"),
  "perspectives/drafts.yaml": perspective(["name: Drafts", "filter: Sensors", "where: { status: [draft] }"]),
  "perspectives/approved.yaml": perspective(["name: Approved", "where: { type: [system-requirement] }"]),
  "perspectives/uses-sensors.yaml": perspective([
    "name: Uses sensors",
    "filter: Sensors",
    "where: { all: [] }",
  ]),
  // A faulty file (SR-213 AK8): no `where`.
  "perspectives/broken.yaml": perspective(["name: Broken"]),
};

const FIXTURE = { fixture: "SR-043/example", files: FILES };

const shownBuffer = (window: Page): Locator => window.locator('[aria-label="Sheet"] [data-buffer]');
const candidates = (window: Page): Locator => window.locator('.candidates [role="option"] .name');
const disabled = (window: Page): Locator =>
  window.locator('.candidates [role="option"][aria-disabled="true"] .name');
const minibuffer = (window: Page): Locator => window.getByLabel("Minibuffer");
const label = (window: Page): Locator => window.locator("label.prompt-label");
const input = (window: Page): Locator => window.locator("#prompt-input");
const explanation = (window: Page): Locator => window.locator("#prompt-explain");
const modeline = (window: Page): Locator => window.locator('[aria-label="Modeline"] .parts > .segment');

/** Runs the command `title` from the command prompt. */
const command = async (window: Page, title: string): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(candidates(window).first()).toHaveText(title);
  await window.keyboard.press("Enter");
};

/** Runs one of the four commands and waits for its first step, which asks once the names are read. */
const start = async (window: Page, title: string): Promise<void> => {
  await command(window, title);
  await expect(label(window)).toHaveText(`${title} · name:`);
  await candidates(window).first().waitFor();
};

/** Takes the hit `name` of the open prompt by typing it. */
const take = async (window: Page, name: string): Promise<void> => {
  await window.keyboard.type(name);
  await expect(candidates(window).first()).toHaveText(name);
  await window.keyboard.press("Enter");
};

/** Opens the perspective `name` with Ctrl/Cmd+K V. */
const open = async (window: Page, name: string): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press(`${await modifier(window)}+K`);
  await window.keyboard.press("v");
  await expect(label(window)).toHaveText("Perspective");
  await take(window, name);
  await expect(shownBuffer(window).locator("h1")).toContainText(name);
};

/** "Sort list" by ID ascending: the perspective buffer is "modified" afterwards (SR-214 AK6). */
const sortById = async (window: Page): Promise<void> => {
  await command(window, "Sort list");
  await take(window, "ID");
  await expect(label(window)).toHaveText("Order");
  await take(window, "ascending");
};

/** The names of the perspectives or saved filters the CLI lists. */
const cliNames = async (running: RunningApp, kind: "perspective" | "filter"): Promise<string[]> => {
  const result = await running.cli([kind, "list"]);
  const output = JSON.parse(result.stdout) as {
    perspectives?: { name: string; filter?: string }[];
    filters?: { name: string; filter?: undefined }[];
  };
  return (output.perspectives ?? output.filters ?? []).map((saved) =>
    saved.filter === undefined ? saved.name : `${saved.name} → ${saved.filter}`,
  );
};

/** The names of the open buffers as "Go to" offers them: every buffer but the shown one. */
const goTo = async (window: Page): Promise<string[]> => {
  await window.keyboard.press("ControlOrMeta+P");
  await candidates(window).first().waitFor();
  const names = await candidates(window).allTextContents();
  await window.keyboard.press("Escape");
  return names;
};

/** The hits of Ctrl/Cmd+K V. */
const openHits = async (window: Page): Promise<string[]> => {
  await window.keyboard.press(`${await modifier(window)}+K`);
  await window.keyboard.press("v");
  await expect(label(window)).toHaveText("Perspective");
  await candidates(window).first().waitFor();
  const names = await candidates(window).allTextContents();
  await window.keyboard.press("Escape");
  return names;
};

const shot = async (window: Page, name: string): Promise<void> => {
  await fs.mkdir(OUT, { recursive: true });
  await window.screenshot({ path: path.join(OUT, name) });
};

test.describe("renaming and deleting perspectives and saved filters", () => {
  let running: RunningApp;
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-218/AK-bqrc] the four commands offer the perspectives in order of use, the shown one first, or the saved filters by name; faulty files cannot be chosen; without any it says so", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await open(window, "Uses sensors");
    await open(window, "Approved");
    await open(window, "Uses sensors");
    for (const title of ["Rename perspective", "Delete perspective"]) {
      await start(window, title);
      // The shown one first and marked, then those opened last, then by name; the faulty file at the end.
      await expect(candidates(window)).toHaveText([
        "Uses sensors",
        "Approved",
        "Drafts",
        /perspectives\/broken\.yaml: where is required$/,
      ]);
      await expect(window.locator('.candidates [role="option"][aria-selected="true"] .name')).toHaveText(
        "Uses sensors",
      );
      await expect(disabled(window)).toHaveText([/broken\.yaml/]);
      if (title === "Rename perspective") {
        await shot(window, "sr-218-choose-light.png");
      }
      await window.keyboard.press("Escape");
    }
    for (const title of ["Rename saved filter", "Delete saved filter"]) {
      await start(window, title);
      await expect(candidates(window)).toHaveText(["Sensors", "Unused"]);
      await window.keyboard.press("Escape");
    }
    await running.close();
    // Without perspectives and saved filters the command prompt says there are none.
    running = await launchApp({ fixture: "SR-043/example" }, { colorScheme: "light" });
    for (const [title, message] of [
      ["Delete perspective", "The workspace has no perspectives."],
      ["Rename saved filter", "The workspace has no saved filters."],
    ] as const) {
      await command(running.window, title);
      await expect(minibuffer(running.window)).toContainText(message);
    }
  });

  test("[SR-218/AK-k1t6] Rename asks the new name with the old one in the input, shows the perspectives that change, renames on Enter and says the result or the refusal", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    const root = running.workspace?.root ?? "";
    await start(window, "Rename saved filter");
    await take(window, "Sensors");
    await expect(label(window)).toHaveText("Rename saved filter Sensors · newName:");
    await expect(input(window)).toHaveValue("Sensors");
    await expect(disabled(window)).toHaveText([
      "2 perspectives name this saved filter and change with it",
      "Drafts",
      "Uses sensors",
    ]);
    // The line of SR-210 AK2: the argument with its catalog description, and the keys of the step.
    await expect(explanation(window)).toContainText("newName · The new name, checked as when saving");
    await expect(explanation(window)).toContainText("Escape back");
    await shot(window, "sr-218-rename-filter-light.png");
    // The rows stay while the name is typed.
    await input(window).fill("Sensor set");
    await expect(disabled(window)).toHaveCount(3);
    await window.keyboard.press("Enter");
    await expect(minibuffer(window)).toContainText(
      "Renamed saved filter Sensors to Sensor set; changed with it: Drafts, Uses sensors",
    );
    await expect.poll(() => cliNames(running, "filter")).toEqual(["Sensor set", "Unused"]);
    expect(await cliNames(running, "perspective")).toEqual(
      expect.arrayContaining(["Drafts → Sensor set", "Uses sensors → Sensor set"]),
    );
    await expect(fs.readFile(path.join(root, "filters", "sensor-set.yaml"), "utf8")).resolves.toContain(
      "name: Sensor set",
    );
    // A name another perspective has is refused, with core's reason, and asked again.
    await start(window, "Rename perspective");
    await take(window, "Drafts");
    await expect(input(window)).toHaveValue("Drafts");
    await input(window).fill("approved");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText(/has this name already · Rename perspective Drafts · newName:$/);
    await expect(input(window)).toHaveValue("approved");
    await window.keyboard.press("Escape");
    await expect(label(window)).toHaveText("Rename perspective · name:");
    await window.keyboard.press("Escape");
    expect(await cliNames(running, "perspective")).toContain("Drafts → Sensor set");
  });

  test("[SR-218/AK-r1kx] Delete names name and file and the lost changes; Ctrl+Enter offers Yes, delete and No; only Yes deletes", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    const root = running.workspace?.root ?? "";
    const file = path.join(root, "perspectives", "drafts.yaml");
    await open(window, "Drafts");
    await sortById(window);
    await expect(modeline(window)).toContainText(["modified"]);
    await start(window, "Delete perspective");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Delete perspective Drafts:");
    await expect(explanation(window)).toContainText(
      "Deletes the perspective Drafts, file perspectives/drafts.yaml; a file Git does not track does not come back; the changes of its modified buffer are lost",
    );
    const enter = process.platform === "darwin" ? "⌘Enter" : "Ctrl+Enter";
    await expect(explanation(window)).toContainText(`${enter} confirms`);
    await shot(window, "sr-218-delete-light.png");
    // Enter without the confirmation deletes nothing.
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText(
      `Nothing was deleted: ${enter} offers Yes, delete · Delete perspective Drafts:`,
    );
    await expect(fs.stat(file)).resolves.toBeDefined();
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label(window)).toHaveText("Delete perspective Drafts · confirm:");
    await expect(candidates(window)).toHaveText(["Yes, delete", "No"]);
    await shot(window, "sr-218-confirm-light.png");
    // "No" and Escape go back a step, and delete nothing.
    await window.locator('.candidates [role="option"]', { hasText: /^No$/ }).click();
    await expect(label(window)).toHaveText("Delete perspective Drafts:");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(candidates(window)).toHaveText(["Yes, delete", "No"]);
    await window.keyboard.press("Escape");
    await expect(label(window)).toHaveText("Delete perspective Drafts:");
    await expect(fs.stat(file)).resolves.toBeDefined();
    // A click on "Yes, delete" deletes the file.
    await window.keyboard.press("ControlOrMeta+Enter");
    await window.locator('.candidates [role="option"]', { hasText: "Yes, delete" }).click();
    await expect(minibuffer(window)).toContainText("Deleted perspective Drafts (perspectives/drafts.yaml)");
    await expect(fs.stat(file)).rejects.toThrow();
    // A saved filter a perspective names is refused already before the confirmation, with core's reason.
    await start(window, "Delete saved filter");
    await take(window, "Sensors");
    await expect(label(window)).toHaveText(/uses-sensors\.yaml.* · Delete saved filter · name:$/);
    await window.keyboard.press("Escape");
    await expect(fs.stat(path.join(root, "filters", "sensors.yaml"))).resolves.toBeDefined();
  });

  test("[SR-218/AK-ktqp] a renamed perspective keeps its buffer, its place, its changes and modified; its new name everywhere; a buffer of the new name closes", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    const root = running.workspace?.root ?? "";
    // A buffer of a perspective "Ready" whose file goes outside the app: the buffer stays (SR-214 rationale).
    await fs.writeFile(
      path.join(root, "perspectives", "ready.yaml"),
      perspective(["name: Ready", "where: { type: [system-requirement] }"]),
    );
    await expect.poll(() => cliNames(running, "perspective")).toContain("Ready");
    await open(window, "Ready");
    await fs.rm(path.join(root, "perspectives", "ready.yaml"));
    await expect.poll(() => cliNames(running, "perspective")).not.toContain("Ready");
    await open(window, "Drafts");
    await sortById(window);
    await open(window, "Approved");
    const before = await goTo(window);
    expect(before.slice(0, 2)).toEqual(["perspective: Drafts · sorted by ID", "perspective: Ready"]);
    await start(window, "Rename perspective");
    await take(window, "Drafts");
    await input(window).fill("Ready");
    await window.keyboard.press("Enter");
    await expect(minibuffer(window)).toContainText("Renamed perspective Drafts to Ready");
    // At its place, with its sort; the buffer of the other "Ready" closed.
    await expect
      .poll(() => goTo(window))
      .toEqual([before[0]?.replace("Drafts", "Ready"), ...before.slice(2)]);
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await expect(shownBuffer(window).locator("h1")).toContainText("Ready");
    await expect(modeline(window).first()).toHaveText(/Ready · sorted by ID/);
    await expect(modeline(window)).toContainText(["modified"]);
    await shot(window, "sr-218-renamed-light.png");
    // Ctrl+K V and the overview name it; "Save list as perspective" proposes the new name.
    expect(await openHits(window)).toEqual([
      "Approved",
      "Ready",
      "Uses sensors",
      expect.stringMatching(/broken/),
    ]);
    await command(window, "Save list as perspective");
    await expect(input(window)).toHaveValue("Ready");
    await window.keyboard.press("Escape");
    await command(window, "Show overview");
    await expect(window.getByRole("option", { name: /^Ready \d+$/ })).toBeVisible();
    await expect(window.getByRole("option", { name: /^Drafts \d+$/ })).toHaveCount(0);
    expect(await cliNames(running, "perspective")).toContain("Ready → Sensors");
  });

  test("[SR-218/AK-xmdn] a renamed saved filter is named in the filter steps of open lists and the selection of perspective buffers, none modified", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await command(window, "List all elements");
    await command(window, "Filter list by saved filter");
    await take(window, "Sensors");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", /filter: Sensors/);
    const rows = await shownBuffer(window).locator(".row .id").allTextContents();
    expect(rows).toHaveLength(6);
    await open(window, "Drafts");
    const drafts = await shownBuffer(window).locator(".row .id").allTextContents();
    await start(window, "Rename saved filter");
    await take(window, "Sensors");
    await input(window).fill("Sensor set");
    await window.keyboard.press("Enter");
    await expect(minibuffer(window)).toContainText("Renamed saved filter Sensors to Sensor set");
    // The perspective buffer lists the same elements by the new name and is not modified.
    await expect(modeline(window)).not.toContainText(["modified"]);
    await expect.poll(() => shownBuffer(window).locator(".row .id").allTextContents()).toEqual(drafts);
    // The list names the new name in its step and still lists the elements.
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", /filter: Sensor set/);
    await expect.poll(() => shownBuffer(window).locator(".row .id").allTextContents()).toEqual(rows);
    await expect(modeline(window).first()).toHaveText(/filter: Sensor set/);
  });

  test("[SR-218/AK-xxcd] a deleted perspective's buffer closes, it is gone from Ctrl+K V and the overview and stays gone after a restart; the prompt says so", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    let { window } = running;
    await open(window, "Drafts");
    await open(window, "Approved");
    await open(window, "Drafts");
    await start(window, "Delete perspective");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Delete perspective Drafts:");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(candidates(window)).toHaveText(["Yes, delete", "No"]);
    // Enter on the marked "Yes, delete" deletes.
    await window.keyboard.press("Enter");
    await expect(minibuffer(window)).toContainText("Deleted perspective Drafts (perspectives/drafts.yaml)");
    // As with "Close buffer": the next buffer is shown, and no buffer of Drafts is left.
    await expect(shownBuffer(window).locator("h1")).toContainText("Approved");
    expect(await goTo(window)).not.toContainEqual(expect.stringMatching(/Drafts/));
    expect(await openHits(window)).not.toContain("Drafts");
    await command(window, "Show overview");
    await expect(window.getByRole("option", { name: /^Approved \d+$/ })).toBeVisible();
    await expect(window.getByRole("option", { name: /^Drafts \d+$/ })).toHaveCount(0);
    // A saved filter no perspective names is deleted too.
    await start(window, "Delete saved filter");
    await take(window, "Unused");
    await expect(label(window)).toHaveText("Delete saved filter Unused:");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(candidates(window)).toHaveText(["Yes, delete", "No"]);
    await window.keyboard.press("Enter");
    await expect(minibuffer(window)).toContainText("Deleted saved filter Unused (filters/unused.yaml)");
    expect(await cliNames(running, "filter")).toEqual(["Sensors"]);
    const { kept } = running;
    await running.close({ keep: true });
    running = await launchApp(undefined, { kept });
    ({ window } = running);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
    await expect(window.getByRole("option", { name: /^Approved \d+$/ })).toBeVisible();
    await expect(window.getByRole("option", { name: /^Drafts \d+$/ })).toHaveCount(0);
    expect(await openHits(window)).not.toContain("Drafts");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`the steps of renaming and deleting in ${scheme}`, async () => {
      running = await launchApp(FIXTURE, { colorScheme: scheme });
      const { window } = running;
      await start(window, "Rename saved filter");
      await take(window, "Sensors");
      await expect(disabled(window)).toHaveCount(3);
      await shot(window, `sr-218-steps-rename-${scheme}.png`);
      await window.keyboard.press("Escape");
      await expect(label(window)).toHaveText("Rename saved filter · name:");
      // Before the first step, back to the command prompt (SR-134 AK1).
      await window.keyboard.press("Escape");
      await expect(label(window)).toHaveText("Command");
      await window.keyboard.press("Escape");
      await open(window, "Drafts");
      await sortById(window);
      await start(window, "Delete perspective");
      await window.keyboard.press("Enter");
      await expect(explanation(window)).toContainText("Deletes the perspective Drafts");
      await shot(window, `sr-218-steps-delete-${scheme}.png`);
      await window.keyboard.press("ControlOrMeta+Enter");
      await expect(candidates(window)).toHaveText(["Yes, delete", "No"]);
      await shot(window, `sr-218-steps-confirm-${scheme}.png`);
      await window.keyboard.press("Escape");
      await window.keyboard.press("Escape");
    });
  }
});
