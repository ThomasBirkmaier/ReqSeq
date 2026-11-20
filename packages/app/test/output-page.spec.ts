// The output page on the built app (SR-223 AK1): the output of a command opens with its answer as the CLI gives it,
// the problems follow, errors before warnings before infos, every value stands under its title from the catalog
// and not under its field name, and a line under the answer says when the output is incomplete (SR-006 AK2). The
// light screenshot goes to `test-results/electron/screenshots/` (or the folder in REQSEQ_SCREENSHOTS). "Show
// details" (Ctrl+K D) shows the technical values and those equal to their normal value at their lines, per buffer
// until it is closed (SR-223 AK2, AK7), and "Copy as JSON" copies the output as the CLI gives it (SR-223 AK9).
// Several problems of one kind are one folded line with the title of their kind and their count, which Tab opens
// and whose Enter opens the list of their elements (SR-223 AK3).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, shownLayer } from "./support/app.js";

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** Runs the catalog command titled `title` from the command prompt; it takes no argument it must ask. */
const run = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(title);
  await window.keyboard.press("Enter");
  await expect(shownLayer(window).locator(".result.output h1")).toBeVisible();
};

/** The answer the CLI gives for the same command (SR-080). */
const cliAnswer = async (running: RunningApp, argv: readonly string[]): Promise<string> => {
  const result = await running.cli([...argv, "--json"]);
  return (JSON.parse(result.stdout) as { answer: string }).answer;
};

/** Runs the app's action titled `title` from the command prompt. */
const act = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(title);
  await window.keyboard.press("Enter");
};

/** "Show details" by its keys: Ctrl+K D, or Cmd+K D on macOS (SR-223 AK2). */
const showDetails = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+K");
  await window.keyboard.press("d");
};

/** The clipboard of the machine the test runs on. */
const clipboard = (running: RunningApp): Promise<string> =>
  running.app.evaluate(({ clipboard: board }) => board.readText());

test.describe("the output page", () => {
  let running: RunningApp;
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-223/AK-ydqh] an output starts with its answer, then errors, warnings and infos, each value under its title", async () => {
    // fixtures/SR-222/criteria: the check finds a warning, an error, an info and a warning, in this order.
    running = await launchApp({ fixture: "SR-222/criteria" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await run(window, "Check workspace");
    const page = shownLayer(window).locator(".result.output");
    await expect(page.locator("h1")).toHaveText(await cliAnswer(running, ["workspace", "check"]));
    // The headings follow the answer in the order of severity, each over its problems.
    await expect(page.locator(".column > :is(h1, .note, .line)").first()).toHaveText(/^Checked 4 elements/u);
    await expect(page.locator(".line.heading")).toHaveText(["Errors", "Warnings", "Info"]);
    const kinds = await page
      .locator(".line")
      .evaluateAll((lines: readonly Element[]) =>
        lines.map((line) => [...line.classList].slice(1).join(" ")),
      );
    expect(kinds.slice(0, 7)).toEqual([
      "heading",
      "problem",
      "heading",
      "problem",
      "problem",
      "heading",
      "problem",
    ]);
    await expect(page.locator(".line.problem").first()).toContainText("SR-0000d3");
    // Every value under its title: "Checked elements", never the field `checkedElements`; `ok` is "Passed".
    await expect(page.locator(".line.text .label")).toHaveText(["Passed", "Checked elements"]);
    await expect(page).not.toContainText("checkedElements");
    await expect(page.locator(".note")).toHaveCount(0);
    await window.screenshot({ path: path.join(SHOTS, "sr-223-output-page-light.png") });
  });

  test("[SR-223/AK-jgsd] Show details shows the technical values at their lines and hides them again, per buffer until it is closed", async () => {
    running = await launchApp({ fixture: "SR-222/criteria" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await run(window, "Show workspace status");
    const page = shownLayer(window).locator(".result.output");
    const labels = page.locator(".line .label");
    // Without details: no path, no folder, nothing the catalog marks technical.
    await expect(labels).toHaveText([
      "Workspace name",
      "Repositories",
      "Repository",
      "Metamodel",
      "Repository",
      "Evidence locations",
    ]);
    await window.screenshot({ path: path.join(SHOTS, "sr-223-details-hidden-light.png") });
    await showDetails(window);
    // At their lines, in the second grey: the path and the absolute path of the repository, the metamodel folder.
    await expect(page.locator(".line.detail .label")).toContainText(["Path", "Absolute path", "Folder"]);
    await expect(page.locator(".line.detail", { hasText: "Absolute path" })).toContainText(
      running.workspace?.root ?? "",
    );
    const label = await page
      .locator(".line.detail .label")
      .first()
      .evaluate((node) => getComputedStyle(node).color);
    const text = await page
      .locator(".line:not(.detail) .text")
      .first()
      .evaluate((node) => getComputedStyle(node).color);
    const detail = await page
      .locator(".line.detail .text")
      .first()
      .evaluate((node) => getComputedStyle(node).color);
    expect(detail).toBe(label);
    expect(detail).not.toBe(text);
    await window.screenshot({ path: path.join(SHOTS, "sr-223-details-shown-light.png") });
    // The state belongs to this buffer: another output opens without details, and back here they are still on.
    await run(window, "Check workspace");
    await expect(shownLayer(window).locator(".result.output .line.detail")).toHaveCount(0);
    await window.keyboard.press("Alt+P");
    await expect(shownLayer(window).locator(".result.output h1")).toHaveText(/^Workspace Weather station/u);
    await expect(shownLayer(window).locator(".line.detail").first()).toBeVisible();
    // The same command hides them again.
    await showDetails(window);
    await expect(shownLayer(window).locator(".line.detail")).toHaveCount(0);
    await showDetails(window);
    await expect(shownLayer(window).locator(".line.detail").first()).toBeVisible();
    // Closed, the buffer forgets them: opened again, it shows no details.
    await window.keyboard.press("ControlOrMeta+K");
    await window.keyboard.press("b");
    await run(window, "Show workspace status");
    await expect(shownLayer(window).locator(".result.output h1")).toHaveText(/^Workspace Weather station/u);
    await expect(shownLayer(window).locator(".line.detail")).toHaveCount(0);
  });

  test("[SR-223/AK-pxjc] a value equal to its normal value appears only with Show details", async () => {
    running = await launchApp({ fixture: "SR-222/criteria" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await run(window, "Show workspace status");
    const page = shownLayer(window).locator(".result.output");
    // Not read-only, available and valid are the normal values of their fields, and no problems is too.
    for (const title of ["Read-only", "Available", "Valid", "Problems"]) {
      await expect(page.locator(".line .label", { hasText: title })).toHaveCount(0);
    }
    await showDetails(window);
    await expect(page.locator(".line.detail", { hasText: "Read-only" }).first()).toContainText("no");
    await expect(page.locator(".line.detail", { hasText: "Available" })).toContainText("yes");
    await expect(page.locator(".line.detail", { hasText: "Valid" })).toContainText("yes");
    await expect(page.locator(".line.detail", { hasText: "Problems" })).toContainText("0");
  });

  test("[SR-223/AK-d895] several problems of one kind are one folded line with their kind and count; Tab opens it, Enter lists their elements", async () => {
    // fixtures/SR-016/unknown: five unknown properties of two elements, and one problem of each other kind.
    running = await launchApp({ fixture: "SR-016/unknown" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await run(window, "Check workspace");
    const page = shownLayer(window).locator(".result.output");
    const group = page.locator(".line.group");
    await expect(group).toHaveCount(1);
    await expect(group.locator(".text")).toHaveText("▸Unknown property");
    await expect(group.locator(".status")).toHaveText("5");
    await expect(group).toHaveAttribute("aria-expanded", "false");
    // Folded: none of its problems is shown, the other kinds are lines of their own.
    await expect(page.locator(".line.problem", { hasText: "customer-id" })).toHaveCount(0);
    await expect(page.locator(".line.problem")).toHaveCount(4);
    // A problem without an element keeps its file in view; its kind is not shown.
    await expect(
      page.locator(".line.problem", { hasText: "evidence location" }).locator(".label"),
    ).toHaveText("reqseq-workspace.yaml");
    await expect(page).not.toContainText("element.unknown-property");
    await window.screenshot({ path: path.join(SHOTS, "sr-223-problem-group-light.png") });
    // Tab on the group line opens it: each problem with its element and its reason.
    const at = await page
      .locator(".line")
      .evaluateAll((lines) => lines.findIndex((line) => line.classList.contains("group")));
    for (let step = 0; step <= at; step += 1) {
      await window.keyboard.press("ArrowDown");
    }
    await expect(group).toHaveAttribute("data-cursor", "");
    await window.keyboard.press("Tab");
    await expect(group).toHaveAttribute("aria-expanded", "true");
    const members = page.locator(".line.problem[data-depth='1']");
    await expect(members).toHaveCount(5);
    await expect(members.first().locator(".label")).toHaveText("SR-1b2c3d");
    await expect(members.first().locator(".text")).toHaveText(
      /^Property customer-id is not in the metamodel/u,
    );
    await expect(members.last().locator(".label")).toHaveText("UNKNOWN-8c9d0e");
    await window.screenshot({ path: path.join(SHOTS, "sr-223-problem-group-open-light.png") });
    // Tab closes it again.
    await window.keyboard.press("Tab");
    await expect(members).toHaveCount(0);
    // Enter opens the list of their elements, each once, as a list.
    await window.keyboard.press("Enter");
    const rows = shownLayer(window).locator(".buffer.list .row");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "SR-1b2c3d" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "UNKNOWN-8c9d0e" })).toHaveCount(1);
    await expect(window.getByLabel("Modeline")).toContainText("Unknown property");
  });

  test("[SR-223/AK-d895] a group of the copies of one UUID lists every copy, and a list from an output is not saved", async () => {
    // fixtures/SR-088/copied-file/system: two files of one UUID, each with element.duplicate-id.
    running = await launchApp({ fixture: "SR-088/copied-file/system" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await run(window, "Check workspace");
    const page = shownLayer(window).locator(".result.output");
    const group = page.locator(".line.group");
    await expect(group.locator(".status")).toHaveText("2");
    await group.click();
    // Both copies, never ref.ambiguous.
    const rows = shownLayer(window).locator(".buffer.list .row");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "(copy)" })).toHaveCount(1);
    await expect(window.getByLabel("Modeline")).not.toContainText("ambiguous");
    // A list from the output of a command offers neither "Save list as perspective" nor "… as saved filter".
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Save list as");
    const saves = window.locator('.candidates [role="option"] .name', { hasText: /^Save list as/u });
    await expect(saves).toHaveCount(0);
    await window.keyboard.press("Escape");
    // The list of all elements offers both, with the same keys.
    await window.keyboard.press("ControlOrMeta+K");
    await window.keyboard.press("l");
    await expect(window.getByLabel("Modeline")).toContainText("All elements");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Save list as");
    await expect(saves).toHaveText(["Save list as perspective", "Save list as saved filter"]);
    await window.keyboard.press("Escape");
  });

  test("[SR-223/AK-jbgp] Copy as JSON puts the whole output on the clipboard as the CLI gives it with --json", async () => {
    running = await launchApp({ fixture: "SR-222/criteria" });
    const { window } = running;
    const before = await clipboard(running);
    try {
      await window.locator('[aria-label="Sheet"] > *').first().waitFor();
      await run(window, "Check workspace");
      // One command: "Copy as JSON" took the place of "Copy result".
      await window.keyboard.press("ControlOrMeta+Shift+P");
      await window.keyboard.type("Copy result");
      await expect(
        window.locator('.candidates [role="option"] .name', { hasText: /^Copy result$/u }),
      ).toHaveCount(0);
      await window.keyboard.press("Escape");
      await act(window, "Copy as JSON");
      await expect(window.getByLabel("Modeline")).toContainText("Copied output as JSON");
      const cli = await running.cli(["workspace", "check"]);
      expect(await clipboard(running)).toBe(cli.stdout);
    } finally {
      await running.app.evaluate(({ clipboard: board }, text) => board.writeText(text), before);
    }
  });

  test("[SR-223/AK-ydqh] the line under the answer says that an output is incomplete", async () => {
    // fixtures/SR-005/cross-repository/system alone: its workspace file lists the repository `platform`, which is
    // not on this machine, so the verification degree is incomplete (SR-006 AK2).
    running = await launchApp({ fixture: "SR-005/cross-repository/system" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await run(window, "Show verification degree");
    const page = shownLayer(window).locator(".result.output");
    await expect(page.locator("h1")).toHaveText(await cliAnswer(running, ["evidence", "degree"]));
    // The answer says why; the line under it marks the output, without saying it again (SR-006 AK2).
    await expect(page.locator("h1 + .note")).toHaveText("Incomplete");
    // The degree's fields under their titles; `failed` is 0 and stays, since the catalog names no normal value.
    await expect(page.locator(".line .label")).toHaveText([
      "Verification degree",
      "Share",
      "Requirements",
      "Counts",
      "Open",
      "Verified",
      "Indirect",
      "Failed",
      "Outdated",
    ]);
  });
});
