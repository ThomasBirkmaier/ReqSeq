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

const OUT =
  process.env["LOGREQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const FIXTURE_FOLDER = fileURLToPath(new URL("../../../fixtures/SR-069/filter", import.meta.url));
const SR_ID = "69069069-0000-4000-8000-0000000000b9";
const SR_TITLE = "Veraltete Messung anzeigen";
const FIRST = `**Gegeben** ein Messwert, **wenn** er älter als eine Sekunde ist, **dann** zeigt das Tool [Messung](logreq:${REFERENCE_TARGET_ID}?version=n1:1111111111111111) als veraltet.`;
const SECOND = "Die Anzeige bleibt *lesbar*, und `n/a` erscheint ohne Messung.";
const IMAGE = "![Skizze](skizze.png) steht im Quelltext, nicht als Bild.";

/** The metamodel of the fixture with `markdown: true` on the acceptance criteria. */
const markdownMetamodel = async (): Promise<string> => {
  const file = await fs.readFile(path.join(FIXTURE_FOLDER, "metamodel", "standard-model.yaml"), "utf8");
  const marked = file.replace(
    "  - key: acceptance-criteria\n    name: Acceptance Criteria\n    kind: text\n    many: true\n",
    "  - key: acceptance-criteria\n    name: Acceptance Criteria\n    kind: text\n    many: true\n    markdown: true\n",
  );
  expect(marked).not.toBe(file);
  return marked;
};

const quoted = (value: string): string => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

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
    await expect(criteria.locator(".cm-content")).toHaveCount(3);
    await expect(criteria.locator(".cm-lr-strong")).toHaveText(["Gegeben", "wenn", "dann"]);
    await expect(criteria.locator(".cm-lr-em")).toHaveText("lesbar");
    await expect(criteria.locator(".cm-lr-code")).toHaveText("n/a");
    await expect(criteria.locator(".cm-lr-ref")).toHaveText("Messung");
    const shown = await criteria.locator(".cm-content").allInnerTexts();
    expect(shown[0]).toContain("Gegeben ein Messwert, wenn er älter");
    for (const line of shown.slice(0, 2)) {
      expect(line).not.toMatch(/\*|`|logreq:|\]\(/);
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
    await expect(criteria.locator(".cm-content").nth(2)).toHaveText(IMAGE);
  });

  test("[SR-127/AK5] the title and a property that is not marked markdown show their text as it is", async () => {
    const { window } = running;
    await expect(window.locator("article h1")).toHaveText(`**${SR_TITLE}**`);
    await expect(field(window, "topic")).toContainText("**Anzeige**");
    await expect(field(window, "topic").locator(".cm-editor")).toHaveCount(0);
  });

  test("[SR-127/AK3] an outdated reference in a criterion is marked like one in the text, and a click opens its element", async () => {
    const { window } = running;
    const criteria = field(window, "acceptance-criteria");
    await expect(criteria.locator(".cm-lr-outdated")).toHaveCount(1);
    await expect(criteria.locator(".cm-lr-outdated-word")).toHaveText(" outdated");
    await expect(criteria.locator(".cm-lr-outdated")).toHaveAttribute("title", /older|outdated|changed/i);
    await criteria.locator(".cm-lr-ref").click();
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
