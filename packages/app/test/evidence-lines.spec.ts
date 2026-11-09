// The evidence records of a requirement on its page in the built app (#218, SR-032): one line per record
// of `evidence.list` as it is, with version, item, date, result and Beleg (AK1) and the baselines that hold
// the record's version (AK2). The fixture has a JUnit record (its Beleg is the place of its test case) and
// a Markdown record with a Beleg of its own; one baseline file lists the requirement with the version of
// both, another with an older version, and a third cannot be read. The section is laid out from core's
// `display` (AK3 to AK5): the values the open records share once, one fold line for the verification of
// the requirement (it has no acceptance criteria), opening to its test case and that to its record, and
// the older inspection under "Older runs".
// Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const VERSION = "n1:11335f109ffb1a19";

const BASELINE =
  "reqseq-baseline: 1\nname: Release 1.0\ndate: 2026-10-24T09:30:00Z\nrepositories:\n" +
  "  - { name: system, commit: 3b18e512dba79e4c8300dd08aeb37f8e728b8dad }\nelements:\n" +
  `  - { id: e8df96ea-a168-4d90-8d65-6328cee88fb3, version: ${VERSION} }\n`;

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const openEditor = async (window: Page, title: string): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
};

interface Listed {
  readonly records: readonly { readonly version: string; readonly baselines: readonly string[] }[];
}

test.describe("the evidence records of a requirement", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({
      fixture: "enabler-535/evidence",
      files: {
        "baselines/release-1.0.yaml": BASELINE,
        // A baseline that holds another version of the requirement is named at no record.
        // A baseline file that cannot be read names no baseline, and the page says so.
        "baselines/broken.yaml": "reqseq-baseline: 1\nname: Broken\n",
        "baselines/beta.yaml": BASELINE.replace("Release 1.0", "Beta").replace(
          VERSION,
          "n1:2222222222222222",
        ),
      },
    });
  });
  test.afterEach(async () => {
    await running.close();
  });

  const evidence = (window: Page): Locator =>
    window.locator("article").getByRole("group", { name: "Evidence", exact: true });
  const records = (window: Page): Locator => evidence(window).getByRole("group");
  const head = (window: Page, name: RegExp): Locator => evidence(window).getByRole("button", { name });
  const older = (window: Page): Locator => head(window, /Older runs/);
  const shared = (window: Page): Locator => evidence(window).locator(".evidence-shared");

  /** Opens `fold` and checks it says so. */
  const unfold = async (fold: Locator): Promise<void> => {
    await fold.click();
    await expect(fold).toHaveAttribute("aria-expanded", "true");
  };

  /** Opens every fold, so every record shows: the verification, its test case, the older runs and their run. */
  const openAll = async (window: Page): Promise<void> => {
    await unfold(head(window, /^▸ Verification/));
    await unfold(head(window, /^▸ test_shows_wind_speed/));
    await unfold(older(window));
    await unfold(head(window, /^▸ 2026-10-20 14:00 UTC/));
  };

  test("[SR-032/AK1] the element view shows version, item, date, result and evidence of each record", async () => {
    const { window } = running;
    await openEditor(window, "Show wind speed");
    await openAll(window);
    await expect(records(window)).toHaveText([
      `2026-10-21T09:00:00Z · test · passed · build-512 · system/evidence/ci/results.xml:4 · version ${VERSION} · baselines Release 1.0`,
      `2026-10-20T14:00:00Z · inspection · passed · Display sample B2 · //fileserver/qa/ws/inspection-2026-10-20.docx · version ${VERSION} · baselines Release 1.0`,
    ]);
    // The Beleg is text: nothing on the line opens it (offline).
    await expect(records(window).getByRole("link")).toHaveCount(0);
  });

  test("[SR-032/AK2] the element view names the baselines that contain the version of a record", async () => {
    const { window } = running;
    const cli = await running.cli(["evidence", "list", "SR-e88fb3"]);
    const listed = JSON.parse(cli.stdout) as Listed;
    expect(listed.records.map((record) => record.baselines)).toEqual([["Release 1.0"], ["Release 1.0"]]);
    await openEditor(window, "Show wind speed");
    await openAll(window);
    await expect(records(window)).toHaveCount(2);
    for (const line of await records(window).all()) {
      await expect(line).toContainText(" · baselines Release 1.0");
      await expect(line).not.toContainText("Beta");
    }
    await expect(evidence(window).getByRole("note").first()).toHaveText(
      "error · baseline.invalid · Invalid baseline baselines/broken.yaml: date is required",
    );
  });

  test("[SR-032/AK3] the newest run stands open, older runs fold away one line each and open by click and keyboard", async () => {
    const { window } = running;
    await openEditor(window, "Show wind speed");
    // The test of the 21st bears the status; the inspection of the 20th is an older run.
    await expect(head(window, /^▸ Verification/)).toHaveText("▸ Verification · verified · 1 test");
    await expect(older(window)).toHaveText("▸ Older runs (1)");
    await expect(older(window)).toHaveAttribute("aria-expanded", "false");
    await older(window).click();
    await expect(older(window)).toHaveText("▾ Older runs (1)");
    const run = head(window, /^▸ 2026-10-20/);
    await expect(run).toHaveText(`▸ 2026-10-20 14:00 UTC · version ${VERSION} · 1 record`);
    await run.click();
    await expect(records(window)).toHaveText([/inspection · passed · Display sample B2/]);
    // By keyboard: Enter on the focused head closes it, Space opens it again.
    await older(window).focus();
    await window.keyboard.press("Enter");
    await expect(older(window)).toHaveAttribute("aria-expanded", "false");
    await expect(records(window)).toHaveCount(0);
    await window.keyboard.press(" ");
    await expect(older(window)).toHaveAttribute("aria-expanded", "true");
    // The CLI names the same record as bearing the status (SR-080).
    const cli = await running.cli(["evidence", "list", "SR-e88fb3"]);
    expect((JSON.parse(cli.stdout) as { bearing: number[] }).bearing).toEqual([0]);
  });

  test("[SR-032/AK4] one line per criterion with result and test count opens to its test cases, and those to their records", async () => {
    const { window } = running;
    await openEditor(window, "Show wind speed");
    const row = head(window, /^▸ Verification/);
    await row.focus();
    await window.keyboard.press("Enter");
    await expect(row).toHaveText("▾ Verification · verified · 1 test");
    const test = head(window, /test_shows_wind_speed/);
    await expect(test).toHaveText("▸ test_shows_wind_speed[SR-e88fb3] · passed");
    await test.click();
    await expect(records(window)).toHaveText([/^2026-10-21T09:00:00Z · test · passed · build-512/]);
    await window.screenshot({ path: path.join(SHOTS, "sr-032-evidence-light.png") });
  });

  test("[SR-032/AK5] the values the open records share stand once above the lines", async () => {
    const { window } = running;
    await openEditor(window, "Show wind speed");
    await expect(shared(window)).toHaveText(
      `2026-10-21 09:00 UTC · build-512 · version ${VERSION} · baselines Release 1.0`,
    );
    const cli = await running.cli(["evidence", "list", "SR-e88fb3"]);
    expect((JSON.parse(cli.stdout) as { display: { shared: unknown } }).display.shared).toEqual({
      date: "2026-10-21T09:00:00Z",
      item: "build-512",
      version: VERSION,
      baselines: ["Release 1.0"],
    });
  });
});
