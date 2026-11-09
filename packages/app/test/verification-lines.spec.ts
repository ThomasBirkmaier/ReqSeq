// The status lines under the boxes of a requirement on the built app (#214): the children missing for an
// indirect verification (SR-034 AK2), each a link to its element, and the validation status on a line of
// its own, apart from the verification status (SR-038 AK1), an inconclusive one with its reason (SR-172
// AK2). All are `element.get` as it is, the CLI's `verification[].missingChildren`, `validation` and
// `validationReason`. Keys use ControlOrMeta, so the same
// tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const openEditor = async (window: Page, title: string): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
};

const line = (window: Page, label: string): Locator =>
  window.locator("article").getByRole("group", { name: label, exact: true });

test.describe("the children missing for an indirect verification", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-034/indirect" });
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-034/AK2] an open requirement names its missing children as the CLI does, and each opens", async () => {
    const { window } = running;
    await openEditor(window, "Warn of storms");
    const cli = await running.cli(["element", "get", "SR-00b120"]);
    const got = JSON.parse(cli.stdout) as {
      readonly element: {
        readonly verification: readonly { readonly missingChildren?: readonly string[] }[];
      };
      readonly names: readonly { readonly id: string; readonly shortId: string }[];
    };
    const shortIds = new Map(got.names.map((named) => [named.id, named.shortId]));
    expect(got.element.verification[0]?.missingChildren?.map((id) => shortIds.get(id))).toEqual([
      "SR-00b121",
      "SR-00b122",
      "SR-00b123",
    ]);
    const verification = line(window, "Verification");
    await expect(verification.locator(".badge-status")).toHaveText(
      "open (missing SR-00b121, SR-00b122, SR-00b123)",
    );
    await verification.getByRole("link", { name: "SR-00b122" }).click();
    await expect(window.locator("article h1")).toHaveText("Warn of hail");
  });
});

test.describe("the validation status", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-038/validation" });
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-038/AK1] a requirement shows its validation status on a line apart from its verification status", async () => {
    const { window } = running;
    await openEditor(window, "Show wind speed");
    await expect(line(window, "Verification").locator(".badge-name")).toHaveText(["Core"]);
    await expect(line(window, "Verification").locator(".badge-status")).toHaveText(["failed"]);
    await expect(line(window, "Validation")).toHaveText("Validation — validated");
    // A need has a validation status and no verification status (D-012).
    await openEditor(window, "Know the wind");
    await expect(line(window, "Validation")).toHaveText("Validation — validated");
    await expect(line(window, "Verification")).toHaveCount(0);
  });
});

test.describe("an inconclusive validation", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-172/inconclusive" });
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-172/AK2] a need whose newest validation is inconclusive shows that status with the reason", async () => {
    const { window } = running;
    await openEditor(window, "Know the frost");
    await expect(line(window, "Validation")).toHaveText(
      "Validation — inconclusive: The frost sensor was replaced; the field test starts again.",
    );
    // A later passed validation decides over an earlier inconclusive one.
    await openEditor(window, "Know the rain");
    await expect(line(window, "Validation")).toHaveText("Validation — validated");
  });
});

test("a line that cuts a long reason gives the whole reason on hover, click and keys (#846, #862)", async () => {
  // The reason over two lines and longer than the line shows it; the record keeps it as written.
  const reason = `The frost sensor was replaced.\n${"The field test starts again. ".repeat(10).trim()}`;
  const running = await launchApp({
    fixture: "SR-172/inconclusive",
    files: {
      // A later record of N3 than the fixture's: the newest validation decides.
      "evidence/2026-11-03-N-00a003-validation.md":
        "---\nreqseq-record: 1\nkind: validation\nelement: 17201720-1720-4720-8720-00000000a003\n" +
        `version: n1:80a1df5694b73266\nresult: inconclusive\nreason: ${JSON.stringify(reason)}\n` +
        "date: 2026-11-03T09:00:00Z\n---\n",
    },
  });
  try {
    const { window } = running;
    await openEditor(window, "Know the frost");
    await expect(line(window, "Validation")).toContainText("…");
    await expect(line(window, "Validation")).toHaveAttribute("title", reason);
    // On demand by click or by keys too (#862, D-062): the whole reason opens under the line, as written.
    const whole = line(window, "Validation").locator(".whole-reason");
    await expect(whole).toHaveCount(0);
    await line(window, "Validation").click();
    await expect(whole).toHaveText(reason, { useInnerText: true });
    await line(window, "Validation").press("Enter");
    await expect(whole).toHaveCount(0);
    // With a modifier the key stays the app's: Shift+Enter does not open it.
    await line(window, "Validation").press("Shift+Enter");
    await expect(line(window, "Validation")).toHaveAttribute("aria-expanded", "false");
    await line(window, "Validation").press(" ");
    await expect(line(window, "Validation")).toHaveAttribute("aria-expanded", "true");
    // Tab toggles it too, on the line that opens (SR-193); Shift+Tab leaves it as it is.
    await line(window, "Validation").press("Tab");
    await expect(line(window, "Validation")).toHaveAttribute("aria-expanded", "false");
    await expect(line(window, "Validation")).toBeFocused();
    await line(window, "Validation").press("Tab");
    await expect(line(window, "Validation")).toHaveAttribute("aria-expanded", "true");
    // Open, the reason has no tooltip over it.
    await expect(line(window, "Validation")).not.toHaveAttribute("title", /./);
    // The evidence record of the same validation cuts its reason as well and opens the same way.
    const record = window
      .locator("article")
      .getByRole("group", { name: "Evidence", exact: true })
      .getByRole("group", { name: "Evidence record" })
      .first();
    await expect(record).toHaveAttribute("title", reason);
    await record.press("Enter");
    await expect(record.locator(".whole-reason")).toHaveText(reason, { useInnerText: true });
  } finally {
    await running.close();
  }
});
