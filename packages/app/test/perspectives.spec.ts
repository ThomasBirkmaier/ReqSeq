// Perspectives in the app (SR-214, and the app side of SR-213 AK4, AK6–AK8) on the built app, on
// fixtures/SR-043/example (the „Beispielbestand“: six system requirements, the variant Coast VAR-0000c1)
// with a saved filter and perspective files added. Ctrl/Cmd+K V or "Open perspective" lists them; Enter
// opens one as a buffer of its own, which shows the elements, groups and order the CLI gives for
// `element.list` with the perspective, in the window's view. "Save list as perspective" saves a list, and
// the modeline says "modified" while a perspective buffer differs from what was saved.
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, modifier, slideSettled, snapshot } from "./support/app.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const COAST = "VAR-0000c1";

/** A perspective file. */
const perspective = (lines: readonly string[]): string => ["reqseq-perspective: 1", ...lines, ""].join("\n");

const FILES = {
  // A saved filter with a sort of its own: the system requirements, by title descending.
  "filters/requirements.yaml": [
    "reqseq-filter: 1",
    "name: Requirements",
    "where: { type: [system-requirement] }",
    "sort: [{ by: title, order: desc }]",
    "",
  ].join("\n"),
  // Each fallback of the sort (SR-213 AK4): stored, the filter's, the workspace order, none at all.
  "perspectives/by-title.yaml": perspective([
    "name: By title",
    "where: { type: [system-requirement] }",
    "group: validity",
    "sort: [{ by: title }]",
  ]),
  "perspectives/filtered.yaml": perspective(["name: filtered", "filter: Requirements", "where: { all: [] }"]),
  "perspectives/workspace-order.yaml": perspective([
    "name: Workspace order",
    "where: { type: [system-requirement] }",
    "sort: []",
  ]),
  "perspectives/plain.yaml": perspective(["name: plain", "where: { type: [system-requirement] }"]),
  // Grouped by the title, whose values no two elements share (SR-124 AK2): it cannot be grouped (SR-213 AK7).
  "perspectives/titles.yaml": perspective([
    "name: Titles",
    "where: { type: [system-requirement] }",
    "group: title",
  ]),
  // A faulty file (SR-213 AK8): no `where`.
  "perspectives/broken.yaml": perspective(["name: Broken"]),
};

const FIXTURE = { fixture: "SR-043/example", files: FILES };

const shownBuffer = (window: Page): Locator => window.locator('[aria-label="Sheet"] [data-buffer]');
const candidates = (window: Page): Locator => window.locator('.candidates [role="option"] .name');
const minibuffer = (window: Page): Locator => window.getByLabel("Minibuffer");

/** The short IDs of the rows of the shown list, in order (of every group). */
const shownIds = async (window: Page): Promise<string[]> =>
  (await shownBuffer(window).locator(".row .id").allTextContents()).map((text) => text.trim());

/**
 * The short IDs and the groups `element.list` with the perspective gives through the CLI, each group as the
 * app heads it: the short ID and title of its target, "(no value)" without one, then its count.
 */
const cliList = async (
  running: RunningApp,
  name: string,
  view?: string,
): Promise<{ ids: string[]; groups: string[] }> => {
  const input = { perspective: name, ...(view === undefined ? {} : { selection: { view } }) };
  const result = await running.cli(["element", "list", "--input", JSON.stringify(input)]);
  expect(result.code, result.stderr).toBe(0);
  const output = JSON.parse(result.stdout) as {
    elements: { shortId: string }[];
    groups?: { value?: string; title?: string; count: number }[];
  };
  return {
    ids: output.elements.map((element) => element.shortId),
    groups: (output.groups ?? []).map(
      (group) =>
        `${group.value === undefined ? "(no value)" : [group.value, group.title].filter(Boolean).join(" ")} ${String(group.count)}`,
    ),
  };
};

/** The group headings of the shown list, in order: label and count. */
const shownGroups = async (window: Page): Promise<string[]> =>
  (await shownBuffer(window).locator(".group h2").allTextContents()).map((heading) =>
    heading.replace(/\s+/g, " ").trim(),
  );

/** Ctrl/Cmd+K V: the prompt of the perspectives. */
const prefixV = async (window: Page): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press(`${await modifier(window)}+K`);
  await window.keyboard.press("v");
  await expect(window.locator("label.prompt-label")).toHaveText("Perspective");
};

/** Opens the perspective `name` with Ctrl/Cmd+K V. */
const open = async (window: Page, name: string): Promise<void> => {
  await prefixV(window);
  await window.keyboard.type(name);
  await expect(candidates(window).first()).toHaveText(name);
  await window.keyboard.press("Enter");
  await expect(shownBuffer(window).locator("h1")).toContainText(name);
};

const command = async (window: Page, title: string, answer?: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(candidates(window).first()).toHaveText(title);
  await window.keyboard.press("Enter");
  if (answer !== undefined) {
    await window.keyboard.type(answer);
    await expect(candidates(window).first()).toHaveText(answer);
    await window.keyboard.press("Enter");
  }
};

/** Runs the command `title` and answers its prompt `label`, once it is open, with `value`. */
const answered = async (window: Page, title: string, label: string, value: string): Promise<void> => {
  await command(window, title);
  await expect(window.locator("label.prompt-label")).toHaveText(label);
  await window.keyboard.type(value);
  await expect(candidates(window).first()).toHaveText(value);
  await window.keyboard.press("Enter");
};

/** "Filter list by text search" with `text`. */
const textFilter = async (window: Page, text: string): Promise<void> => {
  await command(window, "Filter list by text search");
  await expect(window.locator("label.prompt-label")).toHaveText("Text");
  await window.keyboard.type(text);
  await window.keyboard.press("Enter");
  await expect(shownBuffer(window)).toHaveAttribute("aria-label", new RegExp(`text: ${text}`));
};

/** The prompt of "Save list as perspective". */
const savePrompt = async (window: Page): Promise<void> => {
  await command(window, "Save list as perspective");
  await expect(window.locator("label.prompt-label")).toHaveText("Perspective name");
};

/** The input of the minibuffer. */
const promptInput = (window: Page): Locator => window.locator("#prompt-input");

/** Saves the shown list as the perspective `name`, typed over the name proposed. */
const saveAs = async (window: Page, name: string): Promise<void> => {
  await savePrompt(window);
  await promptInput(window).fill(name);
  await window.keyboard.press("Enter");
  await expect(minibuffer(window)).toContainText(`Saved perspective ${name}`);
};

/** The parts of the modeline for the shown buffer. */
const modeline = (window: Page): Locator => window.locator('[aria-label="Modeline"] .parts > .segment');

/**
 * The perspective `name` as `perspective list` gives it through the CLI; it ends with 1 for the faulty file
 * of the fixture, and lists the others.
 */
const cliPerspective = async (running: RunningApp, name: string): Promise<Record<string, unknown>> => {
  const result = await running.cli(["perspective", "list"]);
  expect(result.code, result.stderr).toBe(1);
  const output = JSON.parse(result.stdout) as { perspectives: { name: string }[] };
  const found = output.perspectives.find((perspective) => perspective.name === name);
  expect(found, name).toBeDefined();
  return found as Record<string, unknown>;
};

/** Whether the command prompt offers `title` for the shown buffer; "Save perspective" (the catalog) shows it ran. */
const offersSave = async (window: Page): Promise<boolean> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  // Both titles match the typed text; the catalog command is offered wherever a workspace is open.
  await window.keyboard.type("save perspective");
  await expect(candidates(window).filter({ hasText: /^Save perspective$/ })).toHaveCount(1);
  const names = await candidates(window).allTextContents();
  await window.keyboard.press("Escape");
  return names.includes("Save list as perspective");
};

/** Runs "Choose view" and takes the view whose name starts with `name`. */
const chooseView = async (window: Page, name: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("Choose view");
  await expect(candidates(window).first()).toHaveText("Choose view");
  await window.keyboard.press("Enter");
  await expect(window.locator("label.prompt-label")).toHaveText("View");
  await window.keyboard.type(name);
  await expect(candidates(window).first()).toHaveText(new RegExp(`^${name}`));
  await window.keyboard.press("Enter");
};

test.describe("perspectives in the app", () => {
  let running: RunningApp;
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-214/AK-sd9r] [SR-213/AK-qp6d] Ctrl+K V lists only the perspectives, those opened last first, then by name ignoring case, and the faulty file with its reason", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    const root = running.workspace?.root ?? "";
    const broken = await fs.readFile(path.join(root, "perspectives", "broken.yaml"));
    await prefixV(window);
    // By name ignoring case: "filtered" and "plain" between the others.
    await expect(candidates(window)).toHaveText([
      "By title",
      "filtered",
      "plain",
      "Titles",
      "Workspace order",
      /perspectives\/broken\.yaml: where is required$/,
    ]);
    // The faulty file cannot be chosen; its reason names what is wrong.
    await expect(window.locator('.candidates [role="option"][aria-disabled="true"]')).toHaveCount(1);
    await fs.mkdir(OUT, { recursive: true });
    await window.screenshot({ path: path.join(OUT, "sr-214-open-perspective-light.png") });
    // The typed text narrows them with the fuzzy match.
    await window.keyboard.type("wrkspc");
    await expect(candidates(window)).toHaveText(["Workspace order"]);
    await window.keyboard.press("Enter");
    await expect(shownBuffer(window).locator("h1")).toContainText("Workspace order");
    await open(window, "plain");
    // The ones opened last come first, the most recent first; the command does the same as the keys.
    await command(window, "Open perspective");
    await expect(window.locator("label.prompt-label")).toHaveText("Perspective");
    await expect(candidates(window)).toHaveText([
      "plain",
      "Workspace order",
      "By title",
      "filtered",
      "Titles",
      /perspectives\/broken\.yaml: where is required$/,
    ]);
    await window.keyboard.press("Escape");
    // Listing never writes the faulty file.
    expect(await fs.readFile(path.join(root, "perspectives", "broken.yaml"))).toEqual(broken);
    await running.close();

    // A workspace without perspectives: the minibuffer says so.
    running = await launchApp({ fixture: "SR-043/example" });
    await running.window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await running.window.keyboard.press(`${await modifier(running.window)}+K`);
    await running.window.keyboard.press("v");
    await expect(minibuffer(running.window)).toContainText("The workspace has no perspectives.");
  });

  test("[SR-214/AK-kqd2] [SR-213/AK-gcgz] Enter opens a buffer of its own with its name as heading, its selection, grouping and sort, in the window's view, as the CLI lists it", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    const root = running.workspace?.root ?? "";
    const before = await snapshot(root);
    await open(window, "By title");
    const heading = shownBuffer(window).locator("h1");
    await expect(heading).toHaveText(/^By title /);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", /grouped by validity/);
    await expect(shownBuffer(window).locator(".group h2").first()).toBeVisible();
    await fs.mkdir(OUT, { recursive: true });
    await window.screenshot({ path: path.join(OUT, "sr-214-perspective-light.png") });
    // The same elements, groups and order as `element.list` with the perspective, for each sort fallback:
    // a stored sort, the sort of its saved filter, the workspace order (`sort: []`), and none at all.
    for (const name of ["By title", "filtered", "Workspace order", "plain"]) {
      if (name !== "By title") {
        await open(window, name);
      }
      const cli = await cliList(running, name);
      await expect.poll(() => shownIds(window)).toEqual(cli.ids);
      expect(await shownGroups(window)).toEqual(cli.groups);
    }
    // In the view of the window: the view of Coast.
    await open(window, "By title");
    await chooseView(window, `${COAST} Coast`);
    await expect(window.getByLabel("Modeline")).toContainText("view: Coast");
    const coast = await cliList(running, "By title", COAST);
    await expect.poll(() => shownIds(window)).toEqual(coast.ids);
    expect(await shownGroups(window)).toEqual(coast.groups);
    expect(await snapshot(root)).toEqual(before);
  });

  test("[SR-214/AK-wngq] after A and then B both are open as buffers of their own, and Alt+P shows A again", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await open(window, "plain");
    await open(window, "By title");
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await expect(shownBuffer(window).locator("h1")).toContainText("plain");
    await window.keyboard.press("ControlOrMeta+P");
    // "Go to" offers the other buffers: B, then the overview (the shown A is not offered).
    await expect(candidates(window)).toHaveText([/^perspective: By title/, "Overview"]);
    await window.keyboard.press("Escape");
  });

  test("[SR-214/AK-rgnq] opened again, a changed perspective buffer shows the perspective as saved", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await open(window, "By title");
    const saved = await shownIds(window);
    await command(window, "Ungroup list");
    await command(window, "Sort list", "ID ascending");
    await expect(shownBuffer(window)).not.toHaveAttribute("aria-label", /grouped by/);
    await command(window, "Show traceability matrix");
    await expect(window.locator(".matrix")).toBeVisible();
    await open(window, "By title");
    await expect(shownBuffer(window)).toHaveAttribute(
      "aria-label",
      "perspective: By title · sorted by title · grouped by validity",
    );
    await expect.poll(() => shownIds(window)).toEqual(saved);
  });

  test("[SR-214/AK-sf7b] after a restart the perspective buffers are back as saved with their grouping; a deleted perspective does not come back", async () => {
    running = await launchApp(FIXTURE);
    let { window } = running;
    await open(window, "plain");
    await open(window, "By title");
    // Not saved: the change goes at the restart.
    await command(window, "Ungroup list");
    await expect(shownBuffer(window)).toHaveAttribute(
      "aria-label",
      "perspective: By title · sorted by title",
    );
    const { kept } = running;
    await running.close({ keep: true });
    await fs.rm(path.join(kept.workspace?.root ?? "", "perspectives", "plain.yaml"));
    running = await launchApp(undefined, { kept });
    ({ window } = running);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
    const names = candidates(window);
    await expect
      .poll(
        async () => {
          await window.keyboard.press("ControlOrMeta+P");
          await names
            .first()
            .waitFor({ timeout: 1000 })
            .catch(() => undefined);
          const offered = await names.allTextContents();
          await window.keyboard.press("Escape");
          return offered.filter((name) => name.startsWith("perspective:"));
        },
        { timeout: 15_000 },
      )
      .toEqual(["perspective: By title · sorted by title · grouped by validity"]);
    await window.keyboard.press("Alt+KeyP");
    await slideSettled(window);
    await expect(shownBuffer(window).locator(".group h2").first()).toBeVisible();
  });

  test("[SR-213/AK-tj6p] its saved filter applies as saved again; without it, opening says so and names perspective and filter", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    const root = running.workspace?.root ?? "";
    await open(window, "filtered");
    await expect.poll(() => shownIds(window)).toHaveLength(6);
    // The filter is saved again with another condition: opening the perspective again applies it.
    const saved = await running.cli([
      "filter",
      "save",
      "--input",
      JSON.stringify({
        name: "Requirements",
        where: { all: [{ type: ["system-requirement"] }, { text: "rain" }] },
      }),
    ]);
    expect(saved.code, saved.stderr).toBe(0);
    await open(window, "filtered");
    await expect.poll(() => shownIds(window)).toEqual(["SR-0000a3"]);
    // Without the filter, opening is refused and names the perspective and the filter.
    await fs.rm(path.join(root, "filters", "requirements.yaml"));
    await command(window, "List all elements");
    await prefixV(window);
    await window.keyboard.type("filtered");
    await expect(candidates(window).first()).toHaveText("filtered");
    await window.keyboard.press("Enter");
    // Core's message names the perspective and its saved filter (SR-213 AK6).
    await expect(minibuffer(window)).toContainText(
      /Perspective "filtered" \(perspectives\/filtered\.yaml\).*saved filter "Requirements" does not exist/,
    );
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "All elements");
  });

  test("[SR-213/AK-zz87] a grouping that can no longer be chosen gives the list without groups and the warning", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await open(window, "Titles");
    await expect(minibuffer(window)).toContainText(
      'Perspective "Titles" (perspectives/titles.yaml) groups by title, whose values can no longer be chosen',
    );
    await expect(shownBuffer(window).locator(".group h2")).toHaveCount(0);
    await expect.poll(() => shownIds(window)).toEqual((await cliList(running, "Titles")).ids);
  });

  test("a change of the perspective file outside the app leaves the open list as it is until it is opened again", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    const root = running.workspace?.root ?? "";
    await open(window, "plain");
    await expect.poll(() => shownIds(window)).toHaveLength(6);
    const changed = await running.cli([
      "perspective",
      "save",
      "--input",
      JSON.stringify({ name: "plain", where: { all: [{ type: ["system-requirement"] }, { text: "rain" }] } }),
    ]);
    expect(changed.code, changed.stderr).toBe(0);
    // An element changes too, so the list reads again (SR-116).
    const file = path.join(root, "requirements", "SR-0000000000a4.md");
    await fs.writeFile(
      file,
      (await fs.readFile(file, "utf8")).replace("Show the temperature", "Show the heat"),
    );
    await expect(shownBuffer(window).locator(".row", { hasText: "Show the heat" })).toBeVisible();
    expect(await shownIds(window)).toHaveLength(6);
    await open(window, "plain");
    await expect.poll(() => shownIds(window)).toEqual(["SR-0000a3"]);
  });

  test("[SR-214/AK-bzs1] Save list as perspective asks only for the name, proposes the perspective's, lists the others while typing, and saves steps, grouping and the shown sort", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    // A list with a text step and a saved filter step, grouped, with no sort chosen: the saved filter's
    // sort is the one shown.
    await command(window, "List all elements");
    await textFilter(window, "Measure");
    await answered(window, "Filter list by saved filter", "Filter", "Requirements");
    await answered(window, "Group list", "Group by", "Status");
    await savePrompt(window);
    // Only the name: a plain list proposes none, and the perspectives there are show while typing.
    await expect(promptInput(window)).toHaveValue("");
    await window.keyboard.type("wrk");
    await expect(candidates(window)).toHaveText(["Workspace order"]);
    await fs.mkdir(OUT, { recursive: true });
    await window.screenshot({ path: path.join(OUT, "sr-214-save-prompt-light.png") });
    await promptInput(window).fill("Measured");
    await window.keyboard.press("Enter");
    await expect(minibuffer(window)).toContainText("Saved perspective Measured");
    // The text step is a text condition, the saved filter is named, the grouping is saved, and no sort:
    // the order shown is the filter's.
    expect(await cliPerspective(running, "Measured")).toMatchObject({
      where: { all: [{ text: "Measure" }] },
      filter: "Requirements",
      group: "status",
    });
    expect(await cliPerspective(running, "Measured")).not.toHaveProperty("sort");
    // The list is now the buffer of the perspective, headed by its name, and the CLI gives the same.
    await expect(shownBuffer(window).locator("h1")).toHaveText(/^Measured /);
    const measured = await cliList(running, "Measured");
    await expect.poll(() => shownIds(window)).toEqual(measured.ids);
    // The app heads a status group by the status's name in the metamodel ("Draft"), the CLI gives its key.
    const lower = (groups: readonly string[]): string[] => groups.map((group) => group.toLowerCase());
    expect(lower(await shownGroups(window))).toEqual(lower(measured.groups));
    await window.screenshot({ path: path.join(OUT, "sr-214-save-perspective-light.png") });

    // No sort chosen and no saved filter: the app's own default order is written, so the CLI gives it too.
    await command(window, "List all elements");
    await answered(window, "Filter list by type", "Type", "system-requirement");
    await expect.poll(() => shownIds(window)).toHaveLength(6);
    const shown = await shownIds(window);
    await saveAs(window, "Typed");
    expect(await cliPerspective(running, "Typed")).toMatchObject({
      sort: [
        { by: "type", order: "asc" },
        { by: "identifier", order: "asc" },
      ],
    });
    expect((await cliList(running, "Typed")).ids).toEqual(shown);
    await expect.poll(() => shownIds(window)).toEqual(shown);

    // From a perspective buffer the prompt proposes its name.
    await open(window, "By title");
    await savePrompt(window);
    await expect(promptInput(window)).toHaveValue("By title");
    await window.keyboard.press("Escape");

    // Not offered in the matrix, in the hits of a search, on a package page, nor in the context menu.
    expect(await offersSave(window)).toBe(true);
    const menu = window.getByRole("menu", { name: "Context menu" });
    await shownBuffer(window).locator("h1").click({ button: "right" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeVisible();
    expect(await menu.getByRole("menuitem").locator(".name").allTextContents()).not.toContain(
      "Save list as perspective",
    );
    await window.keyboard.press("Escape");
    await command(window, "Show traceability matrix");
    await expect(window.locator(".matrix")).toBeVisible();
    expect(await offersSave(window)).toBe(false);
    await window.keyboard.press("ControlOrMeta+Shift+F");
    await window.keyboard.type("rain");
    await window.keyboard.press("Enter");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", /^Search: rain/);
    expect(await offersSave(window)).toBe(false);
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Sensors");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Sensors");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Sensors");
    expect(await offersSave(window)).toBe(false);
  });

  test("[SR-213/AK-mfbk] saved again under its name with only a new grouping, a perspective keeps its bare where and the comments on it", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    const file = path.join(running.workspace?.root ?? "", "perspectives", "commented.yaml");
    await fs.writeFile(
      file,
      perspective([
        "name: commented",
        "# Only the system requirements.",
        "where: { type: [system-requirement] } # bare, not under all",
      ]),
    );
    await open(window, "commented");
    await answered(window, "Group list", "Group by", "Status");
    await saveAs(window, "commented");
    const saved = await fs.readFile(file, "utf8");
    expect(saved).toContain(
      "# Only the system requirements.\nwhere: { type: [system-requirement] } # bare, not under all\n",
    );
    expect(saved).toContain("group: status");
  });

  test("[SR-214/AK-fgs9] the modeline says modified after the name when a step, the sort or the grouping changes, until saved under this name or opened again; Clear all list filters keeps the perspective's selection", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    const NAME = "perspective: By title · sorted by title · grouped by validity";
    await open(window, "By title");
    await expect(modeline(window).first()).toHaveText(NAME);
    await expect(modeline(window).nth(1)).toHaveText(/elements?$/);
    // A filter step: "modified" right after the name.
    await textFilter(window, "rain");
    await expect(modeline(window).nth(1)).toHaveText("modified");
    await expect(window.locator("label.prompt-label")).toBeHidden();
    // The card of the prompt has faded out.
    await expect
      .poll(() =>
        window.evaluate(() => document.getAnimations().filter((one) => one.playState === "running").length),
      )
      .toBe(0);
    await fs.mkdir(OUT, { recursive: true });
    await window.screenshot({ path: path.join(OUT, "sr-214-modified-light.png") });
    // Clear all list filters takes back only the steps after the perspective's selection.
    await textFilter(window, "Measure");
    await command(window, "Clear all list filters");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", NAME);
    await expect(shownBuffer(window).locator("h1")).toHaveText(/^By title /);
    await expect(modeline(window)).not.toContainText(["modified"]);
    // Another sort: modified; opened again: no more.
    await answered(window, "Sort list", "Sort by", "ID ascending");
    await expect(modeline(window).nth(1)).toHaveText("modified");
    await open(window, "By title");
    await expect(modeline(window).first()).toHaveText(NAME);
    await expect(modeline(window)).not.toContainText(["modified"]);
    // The matrix and back keep the grouping, and set nothing.
    await command(window, "Show traceability matrix");
    await expect(window.locator(".matrix")).toBeVisible();
    await expect(modeline(window)).not.toContainText(["modified"]);
    await command(window, "Show as list");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", NAME);
    await expect(modeline(window)).not.toContainText(["modified"]);
    // Another grouping: modified; saved under this name: no more, and the file has the new grouping.
    await answered(window, "Group list", "Group by", "Status");
    await expect(modeline(window).nth(1)).toHaveText("modified");
    await savePrompt(window);
    await expect(promptInput(window)).toHaveValue("By title");
    await window.keyboard.press("Enter");
    await expect(minibuffer(window)).toContainText("Saved perspective By title");
    await expect(modeline(window).first()).toHaveText(
      "perspective: By title · sorted by title · grouped by status",
    );
    await expect(modeline(window)).not.toContainText(["modified"]);
    expect(await cliPerspective(running, "By title")).toMatchObject({
      group: "status",
      sort: [{ by: "title" }],
    });
    // Saved under another name, the buffer becomes that perspective's buffer, not modified.
    await textFilter(window, "rain");
    await saveAs(window, "Rain");
    await expect(shownBuffer(window).locator("h1")).toHaveText(/^Rain /);
    await expect(modeline(window)).not.toContainText(["modified"]);
    await window.keyboard.press("ControlOrMeta+P");
    await expect(candidates(window).first()).toBeVisible();
    const offered = await candidates(window).allTextContents();
    await window.keyboard.press("Escape");
    expect(offered.filter((name) => name.startsWith("perspective:"))).toEqual([]);
  });
});
