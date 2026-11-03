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
    await expect(verification).toHaveText(
      "Verification — Core: open (missing SR-00b121 Warn of gusts, SR-00b122 Warn of hail, SR-00b123 Warn of lightning)",
    );
    await verification.getByRole("link", { name: "SR-00b122 Warn of hail" }).click();
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
    await expect(line(window, "Verification")).toHaveText("Verification — Core: failed");
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
