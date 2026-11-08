// The evidence records of a requirement on its page in the built app (#218, SR-032): one line per record
// of `evidence.list` as it is, with version, item, date, result and Beleg (AK1) and the baselines that hold
// the record's version (AK2). The fixture has a JUnit record (its Beleg is the place of its test case) and
// a Markdown record with a Beleg of its own; one baseline file lists the requirement with the version of
// both, another with an older version, and a third cannot be read. Only the newest record of the current
// version stands open; the others are in the folded section "Older records" (AK3).
// Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const VERSION = "n1:11335f109ffb1a19";

const BASELINE =
  "reqseq-baseline: 1\nname: Release 1.0\ndate: 2026-10-24T09:30:00Z\nrepositories:\n" +
  "  - { name: system, commit: 3b18e512dba79e4c8300dd08aeb37f8e728b8dad }\nelements:\n" +
  `  - { id: e8df96ea-a168-4d90-8d65-6328cee88fb3, version: ${VERSION} }\n`;

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
  const older = (window: Page): Locator => evidence(window).getByRole("button", { name: /Older records/ });

  /** Opens the folded section, so every record shows. */
  const openOlder = async (window: Page): Promise<void> => {
    await older(window).click();
    await expect(older(window)).toHaveAttribute("aria-expanded", "true");
  };

  test("[SR-032/AK1] the element view shows version, item, date, result and evidence of each record", async () => {
    const { window } = running;
    await openEditor(window, "Show wind speed");
    await openOlder(window);
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
    await openOlder(window);
    await expect(records(window)).toHaveCount(2);
    for (const line of await records(window).all()) {
      await expect(line).toContainText(" · baselines Release 1.0");
      await expect(line).not.toContainText("Beta");
    }
    await expect(
      window
        .locator("article")
        .getByRole("group", { name: "Evidence", exact: true })
        .getByRole("note")
        .first(),
    ).toHaveText("error · baseline.invalid · Invalid baseline baselines/broken.yaml: date is required");
  });

  test("[SR-032/AK3] only the record that bears the status stands open, the others fold away and open by click and keyboard", async () => {
    const { window } = running;
    await openEditor(window, "Show wind speed");
    // Of two records of the current version the newer bears the status; the inspection is history.
    await expect(records(window)).toHaveText([/^2026-10-21T09:00:00Z · test · passed · build-512/]);
    await expect(older(window)).toHaveText("▸ Older records (1)");
    await expect(older(window)).toHaveAttribute("aria-expanded", "false");
    await older(window).click();
    await expect(older(window)).toHaveText("▾ Older records (1)");
    await expect(records(window)).toHaveCount(2);
    await expect(records(window).nth(1)).toContainText("inspection · passed · Display sample B2");
    // By keyboard: Enter on the focused head closes it, Space opens it again.
    await older(window).focus();
    await window.keyboard.press("Enter");
    await expect(older(window)).toHaveAttribute("aria-expanded", "false");
    await expect(records(window)).toHaveCount(1);
    await window.keyboard.press(" ");
    await expect(records(window)).toHaveCount(2);
    // The CLI names the same record as bearing the status (SR-080).
    const cli = await running.cli(["evidence", "list", "SR-e88fb3"]);
    expect((JSON.parse(cli.stdout) as { bearing: number[] }).bearing).toEqual([0]);
  });
});
