// Property boxes whose property the metamodel marks `markdown` (SR-127) on the built app: the values
// show formatted like the text, a reference in one is marked outdated and followed, and the properties
// that are not marked show their text as it is. The fixture workspace gets a metamodel with the flag on
// `acceptance-criteria`, as the standard model has it. Keys use ControlOrMeta (Linux and macOS).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { REFERENCE_FILES, REFERENCE_TARGET_ID, REFERENCE_TARGET_TITLE } from "./support/demo.js";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";
import { markdownMetamodel, quoted } from "./support/boxes.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const SR_ID = "69069069-0000-4000-8000-0000000000b9";
const SR_TITLE = "Veraltete Messung anzeigen";
const FIRST = `**Gegeben** ein Messwert, **wenn** er älter als eine Sekunde ist, **dann** zeigt das Tool [Messung](reqseq:${REFERENCE_TARGET_ID}?version=n1:1111111111111111) als veraltet.`;
const SECOND = "Die Anzeige bleibt *lesbar*, und `n/a` erscheint ohne Messung.";
const IMAGE = "![Skizze](skizze.png) steht im Quelltext, nicht als Bild.";

const files = async (): Promise<Record<string, string>> => ({
  ...REFERENCE_FILES,
  "metamodel/standard-model.yaml": await markdownMetamodel(),
  "requirements/SR-0000000000b9.md": `---
id: ${SR_ID}
type: system-requirement
status: draft
title: ${quoted(`**${SR_TITLE}**`)}
requirement-type: functional
acceptance-criteria:
  - ${quoted(FIRST)}
  - ${quoted(SECOND)}
  - ${quoted(IMAGE)}
topic: "**Anzeige**"
---

Das Tool zeigt veraltete Messwerte an.
`,
});

const field = (window: Page, label: string): Locator => window.locator(`[data-field="${label}"]`);

/** Opens the element with "Go to"; the buffer has the focus. */
const openElement = async (window: Page): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type("Veraltete");
  await expect(window.locator('.candidates [role="option"]').first()).toContainText("Veraltete");
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(`**${SR_TITLE}**`);
  await expect(window.locator("article")).toBeFocused();
};

test.describe("Markdown properties in the element buffer", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-069/filter", files: await files() });
    await openElement(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-127/AK1] the acceptance criteria show bold, italic, code and a reference formatted, without their marks", async () => {
    const { window } = running;
    const criteria = field(window, "acceptance-criteria");
    // One editor for the box, one value per line.
    await expect(criteria.locator(".cm-content")).toHaveCount(1);
    await expect(criteria.locator(".cm-line")).toHaveCount(3);
    await expect(criteria.locator(".cm-lr-strong")).toHaveText(["Gegeben", "wenn", "dann"]);
    await expect(criteria.locator(".cm-lr-em")).toHaveText("lesbar");
    await expect(criteria.locator(".cm-lr-code")).toHaveText("n/a");
    await expect(criteria.locator(".cm-lr-ref")).toHaveText("Messung");
    const shown = await criteria.locator(".cm-line").allInnerTexts();
    expect(shown[0]).toContain("Gegeben ein Messwert, wenn er älter");
    for (const line of shown.slice(0, 2)) {
      expect(line).not.toMatch(/\*|`|reqseq:|\]\(/);
    }
    // Bold really is bold.
    const weight = await criteria
      .locator(".cm-lr-strong")
      .first()
      .evaluate((node) => getComputedStyle(node).fontWeight);
    expect(Number(weight)).toBeGreaterThanOrEqual(600);
  });

  test("[SR-127/AK1] an image in a criterion is no picture: its source is shown, nothing is drawn", async () => {
    const { window } = running;
    const criteria = field(window, "acceptance-criteria");
    // (CodeMirror puts empty `img.cm-widgetBuffer` next to widgets; they draw nothing.)
    await expect(criteria.locator("img:not(.cm-widgetBuffer)")).toHaveCount(0);
    await expect(criteria.locator(".cm-line").nth(2)).toHaveText(IMAGE);
  });

  test("[SR-127/AK5] the title and a property that is not marked markdown show their text as it is", async () => {
    const { window } = running;
    await expect(window.locator("article h1")).toHaveText(`**${SR_TITLE}**`);
    await expect(field(window, "topic")).toContainText("**Anzeige**");
    // The plain property is edited in place too, but nothing in it is formatted.
    await expect(field(window, "topic").locator(".cm-content")).toHaveText("**Anzeige**");
    await expect(field(window, "topic").locator(".cm-lr-strong")).toHaveCount(0);
  });

  test("[SR-127/AK1] the Markdown source is shown only on the line with the cursor, and the other values stay formatted", async () => {
    const { window } = running;
    const lines = field(window, "acceptance-criteria").locator(".cm-line");
    await expect(lines.nth(0)).not.toContainText("**");
    await expect(lines.nth(1)).not.toContainText("*lesbar*");
    // A click in the first value shows its source, the others stay formatted.
    await lines.nth(0).click();
    await expect(lines.nth(0)).toContainText("**Gegeben**");
    await expect(lines.nth(0)).toContainText(`reqseq:${REFERENCE_TARGET_ID}`);
    await expect(lines.nth(1)).not.toContainText("*lesbar*");
    await expect(lines.nth(1)).toContainText("Die Anzeige bleibt lesbar");
    // The cursor in the second value: its source shows, the first is formatted again.
    await lines.nth(1).click();
    await expect(lines.nth(1)).toContainText("*lesbar*");
    await expect(lines.nth(1)).toContainText("`n/a`");
    await expect(lines.nth(0)).not.toContainText("**");
    // The keys move the cursor from value to value the same way (a long value takes more than one Down).
    await window.keyboard.press("ControlOrMeta+Home");
    await expect(lines.nth(0)).toContainText("**Gegeben**");
    await expect(lines.nth(1)).not.toContainText("*lesbar*");
    for (let step = 0; step < 4 && !(await lines.nth(1).innerText()).includes("*lesbar*"); step += 1) {
      await window.keyboard.press("ArrowDown");
    }
    await expect(lines.nth(1)).toContainText("*lesbar*");
    await expect(lines.nth(0)).not.toContainText("**");
    // Escape leaves the box: no cursor, no source anywhere.
    await window.keyboard.press("Escape");
    await expect(field(window, "acceptance-criteria")).toBeFocused();
    await expect(lines.nth(1)).not.toContainText("*lesbar*");
    await expect(lines.nth(0)).not.toContainText("**");
    await expect(lines.nth(1)).toContainText("Die Anzeige bleibt lesbar");
  });

  test("[SR-127/AK3] an outdated reference in a criterion is marked like one in the text, and a click opens its element", async () => {
    const { window } = running;
    const criteria = field(window, "acceptance-criteria");
    await expect(criteria.locator(".cm-lr-outdated")).toHaveCount(1);
    // With the date of the version it stores once the buffer has it (SR-110 AK2): no Git here, so unknown.
    await expect(criteria.locator(".cm-lr-outdated-word")).toHaveText(
      " link outdated · version of unknown date",
    );
    await expect(criteria.locator(".cm-lr-outdated")).toHaveAttribute("title", /older|outdated|changed/i);
    await criteria.locator(".cm-lr-ref").click();
    await expect(window.locator("article h1")).toHaveText(REFERENCE_TARGET_TITLE);
  });

  test("[SR-127/AK2] [[ in an acceptance criterion inserts a reference: saved with ID and version in that criterion, shown with the title of the target, and a click opens it", async () => {
    const { window, workspace } = running;
    const criteria = field(window, "acceptance-criteria");
    const lines = criteria.locator(".cm-line");
    // The end of the last value (a long value wraps, so End would stop at the end of its first row).
    await lines.nth(2).click();
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.type(" Siehe [[");
    await expect(window.getByLabel("Insert reference")).toBeVisible();
    await window.keyboard.type(REFERENCE_TARGET_TITLE);
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(REFERENCE_TARGET_TITLE);
    await window.keyboard.press("Enter");
    await expect(criteria.locator(".cm-content")).toBeFocused();
    await window.keyboard.press("ControlOrMeta+s");
    await expect(window.getByLabel("Minibuffer")).toContainText("Saved");
    const file = await fs.readFile(
      path.join(workspace?.root ?? "", "requirements", "SR-0000000000b9.md"),
      "utf8",
    );
    // The last criterion holds the reference with ID and version, as one YAML value; the rest stays.
    expect(file).toMatch(
      new RegExp(
        `\\n  - ["']?!\\[Skizze\\]\\(skizze\\.png\\) steht im Quelltext, nicht als Bild\\. Siehe \\[${REFERENCE_TARGET_TITLE}\\]\\(reqseq:${REFERENCE_TARGET_ID}\\?version=n1:[0-9a-f]+\\)["']?\\ntopic:`,
        "u",
      ),
    );
    expect(file).not.toContain("[[");
    expect(file).toContain("Das Tool zeigt veraltete Messwerte an.");
    // Off the caret line the value shows the title of the target, and a click opens it.
    await window.keyboard.press("Escape");
    await expect(lines.nth(2)).toContainText(`nicht als Bild. Siehe ${REFERENCE_TARGET_TITLE}`);
    await expect(lines.nth(2)).not.toContainText("reqseq:");
    await expect(lines.nth(1)).toHaveText("Die Anzeige bleibt lesbar, und n/a erscheint ohne Messung.");
    await lines.nth(2).locator(".cm-lr-ref").click();
    await expect(window.locator("article h1")).toHaveText(REFERENCE_TARGET_TITLE);
  });

  test("[SR-127/AK3] Ctrl/Cmd+Enter with the focus in the box of the criteria opens the first reference", async () => {
    const { window } = running;
    await field(window, "acceptance-criteria").focus();
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(window.locator("article h1")).toHaveText(REFERENCE_TARGET_TITLE);
  });

  test("[SR-128/AK2] copying the criteria still puts the stored Markdown source on the clipboard", async () => {
    const { window } = running;
    // The clipboard of the machine is kept: saved here, written back whatever happens.
    const before = await running.app.evaluate(({ clipboard }) => clipboard.readText());
    try {
      await field(window, "acceptance-criteria").hover();
      await field(window, "acceptance-criteria").locator("> .copy").click();
      await expect(window.getByLabel("Modeline")).toContainText("Copied acceptance-criteria");
      expect(await running.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
        [FIRST, SECOND, IMAGE].join("\n"),
      );
    } finally {
      await running.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), before);
    }
  });

  test("screenshot: an element with formatted acceptance criteria and a reference (light)", async () => {
    const { window } = running;
    await fs.mkdir(OUT, { recursive: true });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    await window.mouse.move(0, 0);
    await expect(field(window, "acceptance-criteria").locator(".cm-lr-outdated")).toBeVisible();
    await window.screenshot({ path: path.join(OUT, "criteria-formatted.png") });
  });
});
