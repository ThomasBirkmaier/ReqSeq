// The short ID with the identifier behind it (SR-084 AK4) on the built app, on a copy of the repository's
// own specification (`spec/`): the modeline, the name of the buffer, the relations and the graph show
// `SR-3c90b0 (SR-036)` as the CLI prints it, and "Copy field" at the ID copies the short ID. A light
// screenshot of the element and of its graph goes to `test-results/electron/screenshots/` (or the folder
// in REQSEQ_SCREENSHOTS).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { launchApp } from "./support/app.js";

const SPEC = fileURLToPath(new URL("../../../spec", import.meta.url));
const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** An element and its relations as `element get` gives them. */
interface Got {
  readonly element: {
    readonly shortId: string;
    readonly identifier?: string;
    readonly title: string;
    readonly relations: readonly {
      readonly kind: string;
      readonly shortId?: string;
      readonly identifier?: string;
    }[];
  };
}

test("[SR-084/AK-c2s2] the modeline, the buffer name, the relations and the graph show the identifier in brackets behind the short ID, and Copy field at the ID copies the short ID", async () => {
  const running = await launchApp({ folder: SPEC }, { colorScheme: "light" });
  const { window } = running;
  const before = await running.app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await fs.mkdir(OUT, { recursive: true });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    await expect(window.getByLabel("Modeline")).toContainText("elements", { timeout: 0 });
    const { element } = JSON.parse((await running.cli(["element", "get", "SR-084"])).stdout) as Got;
    const shown = `${element.shortId} (SR-084)`;
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("SR-084");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("SR-084");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(element.title);
    // The modeline.
    await expect(window.locator('.modeline [data-field="ID"]')).toHaveText(shown);
    // The relations: the need it derives from.
    const need = element.relations.find((relation) => relation.kind === "derives-from");
    expect(need?.identifier).toBeDefined();
    await expect(window.locator('[data-field="derives-from"] li').first()).toContainText(
      `${need?.shortId ?? ""} (${need?.identifier ?? ""})`,
    );
    await window.screenshot({ path: path.join(OUT, "sr-084-element-light.png") });
    // "Copy field" with the cursor in no field copies the ID field: the short ID alone.
    await window.locator("article").focus();
    await window.keyboard.press("ControlOrMeta+Shift+C");
    await expect(window.getByLabel("Modeline")).toContainText("Copied ID");
    expect(await running.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(element.shortId);
    // The graph.
    await window.locator("article").focus();
    await window.keyboard.press("ControlOrMeta+Shift+G");
    await expect(window.locator(".graph-id", { hasText: `${shown} · System Requirement` })).toHaveCount(1);
    await window.screenshot({ path: path.join(OUT, "sr-084-graph-light.png") });
    // The name of the element's buffer, as Ctrl+P offers the open buffers besides the graph.
    await window.keyboard.press("ControlOrMeta+P");
    await expect(
      window
        .locator('.candidates [role="option"] .name')
        .getByText(`${shown} ${element.title}`, { exact: true }),
    ).toHaveCount(1);
  } finally {
    await running.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), before);
    await running.close();
  }
});

test("[SR-084/AK-c2s2] an identifier too long for a graph box gives way with an ellipsis before the type, which stays whole (SR-111 AK4)", async () => {
  const LONG = "REQ-SYS-0123-WIND-SPEED-DISPLAY";
  const FILE = "system-requirement/SR-3d09c015e3b8.md";
  const source = await fs.readFile(path.join(SPEC, FILE), "utf8");
  expect(source).toContain('spec-id: "SR-084"');
  const running = await launchApp(
    { folder: SPEC, files: { [FILE]: source.replace('spec-id: "SR-084"', `spec-id: "${LONG}"`) } },
    { colorScheme: "light" },
  );
  const { window } = running;
  try {
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    await expect(window.getByLabel("Modeline")).toContainText("elements", { timeout: 0 });
    const { element } = JSON.parse((await running.cli(["element", "get", LONG])).stdout) as Got;
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type(LONG);
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(LONG);
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(element.title);
    await window.locator("article").focus();
    await window.keyboard.press("ControlOrMeta+Shift+G");
    const box = window.locator(".graph-node", { hasText: `(${LONG})` });
    await expect(box).toHaveCount(1);
    await expect(box).toHaveAttribute(
      "title",
      `${element.shortId} (${LONG}) · System Requirement\n${element.title}`,
    );
    const parts = await box.evaluate((node) =>
      [...node.querySelectorAll<HTMLElement>(".graph-id > span")].map((part) => ({
        text: part.textContent,
        cut: part.scrollWidth > part.clientWidth,
        inside: part.getBoundingClientRect().right <= node.getBoundingClientRect().right,
      })),
    );
    expect(parts).toEqual([
      { text: `${element.shortId} (${LONG})`, cut: true, inside: true },
      { text: " · System Requirement", cut: false, inside: true },
    ]);
    await window.screenshot({ path: path.join(OUT, "sr-084-graph-long-identifier-light.png") });
  } finally {
    await running.close();
  }
});

test("[SR-084/AK-c2s2] a list and the overview show the short ID with the identifier, uncut", async () => {
  const running = await launchApp({ folder: SPEC }, { colorScheme: "light" });
  const { window } = running;
  try {
    await fs.mkdir(OUT, { recursive: true });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    await expect(window.getByLabel("Modeline")).toContainText("elements", { timeout: 0 });
    // Opened once, SR-084 is among the recent elements of the overview.
    const { element } = JSON.parse((await running.cli(["element", "get", "SR-084"])).stdout) as Got;
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("SR-084");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("SR-084");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(element.title);
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Overview");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Overview");
    await window.keyboard.press("Enter");
    await expect(window.locator(".overview .recent .id").first()).toHaveText(`${element.shortId} (SR-084)`);
    // The list of the system requirements: every ID with its identifier, none cut.
    await window.getByRole("option", { name: /^System Requirement \d+$/ }).click();
    await expect(window.getByLabel("Modeline")).toContainText("type: system-requirement");
    const ids = window.locator(".row .id");
    await expect(ids.first()).toBeVisible();
    const shown = await ids.evaluateAll((all) =>
      all.map((id) => ({ text: id.textContent, cut: id.scrollWidth > id.clientWidth })),
    );
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.filter((id) => !/^SR-[0-9a-f]{6,} \(SR-\d{3}\)$/.test(id.text) || id.cut)).toEqual([]);
    await window.screenshot({ path: path.join(OUT, "sr-084-list-light.png") });
  } finally {
    await running.close();
  }
});
