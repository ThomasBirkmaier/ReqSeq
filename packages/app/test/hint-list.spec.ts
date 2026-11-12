// The hint list of "List hints" on the built app (SR-026 AK1, AK4, AK5, SR-122 AK4), on fixtures/SR-026/hints:
// eight hints of six kinds. The counts, the order of the groups and of the rows, and the messages are those
// `hint list` gives through the CLI for the same input (SR-080). Keys use ControlOrMeta, so the same tests
// run on Linux and macOS. The light screenshot goes to `test-results/electron/screenshots/` (or the folder
// in REQSEQ_SCREENSHOTS).
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const FIXTURE = { fixture: "SR-026/hints" };

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** A hint as the CLI gives it with `--json`. */
interface Hint {
  readonly code: string;
  readonly message: string;
  readonly elementTitle?: string;
}

interface Listed {
  readonly kinds: readonly { readonly code: string; readonly count: number }[];
  readonly hints: readonly Hint[];
  readonly total: number;
}

const names = (window: Page): Locator => window.locator('.candidates [role="option"] .name');
const label = (window: Page): Locator => window.locator("label.prompt-label");
const heads = (window: Page): Locator => window.locator(".hints .hint-group");
const rows = (window: Page): Locator => window.locator(".hints .hint");
const marked = (window: Page): Locator => window.locator(".hints [data-cursor]");

/** Runs "List hints", with `limit` when one is given, from the command prompt. */
const listHints = async (window: Page, limit?: number): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("List hints");
  await expect(names(window).first()).toHaveText("List hints");
  if (limit === undefined) {
    await window.keyboard.press("Enter");
  } else {
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label(window)).toHaveText("List hints · more arguments:");
    await window.keyboard.type("limit");
    await expect(names(window).first()).toHaveText("limit");
    await window.keyboard.press("Enter");
    await window.keyboard.type(String(limit));
    await window.keyboard.press("Enter");
    await expect(names(window).first()).toHaveText("Run");
    await window.keyboard.press("Enter");
  }
  await expect(window.locator(".hints")).toBeFocused();
};

/** What `hint list` gives through the CLI for `args`. */
const cliList = async (running: RunningApp, ...args: string[]): Promise<Listed> => {
  const run = await running.cli(["hint", "list", ...args]);
  expect(run.code, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as Listed;
};

/** The heading of a kind as the list shows it: its label, its count of all hints and its code. */
const HEADS = [
  "▾ element.missing-required (1)",
  "▾ Unknown properties (2)element.unknown-property",
  "▾ Superseded targets (1)relation.target-superseded",
  "▾ variant.superseded-in-validity (1)",
  "▾ Without parent (1)trace.no-parent",
  "▾ Outdated relations (2)relation.outdated",
];

test.describe("the hint list", () => {
  let running: RunningApp;

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-026/AK-vs4d] [SR-026/AK-s2vt] shows the total, a group per kind with its count in the order of the output, one row per hint with element, title, target and reason, the message on hover and in the modeline, and Enter opens the element", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    const cli = await cliList(running);
    await listHints(window);
    await expect(window.locator(".hints-total")).toHaveText(`${String(cli.total)} hints`);
    await expect(heads(window)).toHaveText(HEADS);
    expect(cli.kinds.map((kind) => `${kind.code} ${String(kind.count)}`)).toEqual([
      "element.missing-required 1",
      "element.unknown-property 2",
      "relation.target-superseded 1",
      "variant.superseded-in-validity 1",
      "trace.no-parent 1",
      "relation.outdated 2",
    ]);
    // One row per hint, in the order of the output; a relation by its kind and its target, else the message.
    await expect(rows(window)).toHaveCount(cli.hints.length);
    await expect(rows(window).locator(".hint-element")).toHaveText([
      "SR-0000b2",
      "N-0000a2",
      "SAF-0000b4",
      "SR-0000b3",
      "SR-0000b3",
      "SAF-0000b4",
      "SR-0000b1",
      "SR-0000b1",
    ]);
    await expect(rows(window).locator(".hint-title")).toHaveText(
      cli.hints.map((hint) => hint.elementTitle ?? ""),
    );
    await expect(rows(window).locator(".hint-reason").nth(3)).toHaveText("refines → SR-0000b9 Show wind");
    await expect(rows(window).locator(".hint-reason").nth(4)).toHaveText("validity → VAR-0000c3 Old basic");
    await expect(rows(window).locator(".hint-reason").nth(6)).toHaveText(
      "derives-from → N-0000a1 See the wind",
    );
    await expect(rows(window).locator(".hint-reason").nth(1)).toHaveText(
      "Property colour is not in the metamodel; ReqSeq keeps it and its value unchanged",
    );
    // The full message on hover, and for the marked row in the modeline.
    for (const [at, hint] of cli.hints.entries()) {
      await expect(rows(window).nth(at)).toHaveAttribute("title", hint.message);
    }
    await window.keyboard.press("Control+N");
    await window.keyboard.press("Control+N");
    await expect(marked(window)).toHaveText(/^SR-0000b2/u);
    await expect(window.getByLabel("Modeline")).toContainText(cli.hints[0]?.message ?? "-");
    await window.screenshot({ path: path.join(OUT, "sr-026-hint-list-light.png") });
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Warn of storms");

    // A page of 3: the counts stay those of all hints, and each group says how many it does not list.
    const page = await cliList(running, "--limit", "3");
    expect(page.kinds).toEqual(cli.kinds);
    await listHints(window, 3);
    await expect(window.locator(".hints-total")).toHaveText(`${String(cli.total)} hints · 3 listed`);
    await expect(heads(window)).toHaveText([
      HEADS[0] ?? "",
      HEADS[1] ?? "",
      `${HEADS[2] ?? ""}1 not listed`,
      `${HEADS[3] ?? ""}1 not listed`,
      `${HEADS[4] ?? ""}1 not listed`,
      `${HEADS[5] ?? ""}2 not listed`,
    ]);
    await expect(rows(window)).toHaveCount(3);
  });

  test("[SR-026/AK-drnx] [SR-122/AK-mqwc] opens with every group open; a click or Tab on a heading folds it, a click on a row opens its element, and Ctrl+N and Ctrl+P move the mark", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await listHints(window);
    await expect(heads(window)).toHaveText(HEADS);
    await expect(rows(window)).toHaveCount(8);
    // Nothing is marked at first; Ctrl+N marks the first row, then goes down, Ctrl+P up.
    await expect(marked(window)).toHaveCount(0);
    await window.keyboard.press("Control+N");
    await expect(marked(window)).toHaveText(HEADS[0] ?? "");
    await window.keyboard.press("Control+N");
    await window.keyboard.press("Control+N");
    await expect(marked(window)).toHaveText(HEADS[1] ?? "");
    await window.keyboard.press("Control+P");
    await expect(marked(window)).toHaveText(/^SR-0000b2/u);
    await window.keyboard.press("Control+N");
    // Tab on the marked heading folds its group and unfolds it again.
    await window.keyboard.press("Tab");
    await expect(heads(window).nth(1)).toHaveText("▸ Unknown properties (2)element.unknown-property");
    await expect(rows(window)).toHaveCount(6);
    await expect(window.locator(".hints")).toBeFocused();
    await window.keyboard.press("Tab");
    await expect(rows(window)).toHaveCount(8);
    // A click on a heading folds it and on it again unfolds it.
    await heads(window).nth(5).click();
    await expect(heads(window).nth(5)).toHaveText("▸ Outdated relations (2)relation.outdated");
    await expect(rows(window)).toHaveCount(6);
    await heads(window).nth(5).click();
    await expect(rows(window)).toHaveCount(8);
    // A click on a row opens its element, as Enter does.
    await rows(window).nth(3).click();
    await expect(window.locator("article h1")).toHaveText("Show wind direction");
  });
});
