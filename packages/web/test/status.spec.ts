// The status on the element page, in a workspace without a baseline: the overview sends the person to a draft, and
// its page sets the status after the confirmation (D-030), as the changes since a baseline do. These tests write
// the workspace, so they run on one of their own (a worker of its own); it has no baseline.
import type { Ui } from "./fixtures.js";
import { expect, test as shared } from "./fixtures.js";
import { createWorkspace, runOn, startUi } from "./start-ui.js";

const test = shared.extend<object, { ui: Ui }>({
  ui: [
    async ({ kind }, use) => {
      const workspace = await createWorkspace(kind);
      const server = await startUi(workspace.root);
      await use({ server, root: workspace.root, run: runOn(workspace.root) });
      await server.close();
      await workspace.cleanup();
    },
    { scope: "worker" },
  ],
});
// A workspace without a baseline.
test.use({ kind: "no-identifier" });

test("a draft from the overview is approved on its page before the first baseline", async ({
  page,
  open,
  ui,
}) => {
  expect((await ui.run("baseline.list", {})).baselines).toHaveLength(0);
  const mm = await ui.run("metamodel.get", {});
  await open("/q/drafts");
  const row = page.locator(".it").first();
  const id = (await row.getAttribute("data-id")) ?? "";
  await row.click();
  const { element } = await ui.run("element.get", { ref: id });
  const settled = (mm.types.find((t) => t.key === element.type)?.statuses ?? []).filter((s) => {
    const d = mm.statuses.find((x) => x.key === s);
    return d?.initial !== true && d?.invalid !== true;
  });
  expect(settled).toHaveLength(1);
  const name = mm.statuses.find((s) => s.key === settled[0])?.name ?? "";
  await page.locator(".topbar").getByRole("button", { name: "Approve" }).click();
  const dialog = page.getByRole("dialog", { name: "Approve" });
  await expect(dialog.locator(`li[data-id="${id}"]`)).toContainText(name);
  // Cancel writes nothing.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect((await ui.run("element.get", { ref: id })).element.status).toBe(element.status);
  await page.locator(".topbar").getByRole("button", { name: "Approve" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: `Set 1 element to ${name}` })
    .click();
  await expect(page.locator("[data-flash]")).toContainText(`Set 1 element to ${name}.`);
  expect((await ui.run("element.get", { ref: id })).element.status).toBe(settled[0]);
  // The page shows the new status, and Approve is no longer offered.
  await expect(page.locator(".card .kick")).toContainText(name);
  await expect(page.locator(".topbar").getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("Set status on the element page sets the status chosen in the confirmation", async ({
  page,
  open,
  ui,
}) => {
  const mm = await ui.run("metamodel.get", {});
  const initial = mm.statuses.find((s) => s.initial === true)?.key ?? "";
  await open("/q/drafts");
  const row = page.locator(".it").first();
  const id = (await row.getAttribute("data-id")) ?? "";
  await row.click();
  await page.locator(".topbar").getByRole("button", { name: "Set status" }).click();
  const dialog = page.getByRole("dialog", { name: "Set status" });
  const choice = await dialog
    .locator("#dlg-status option")
    .evaluateAll(
      (options, skip) =>
        options.map((o) => (o as HTMLOptionElement).value).find((v) => v !== "" && v !== skip),
      initial,
    );
  expect(choice).toBeDefined();
  await dialog.locator("#dlg-status").selectOption(choice ?? "");
  const name = mm.statuses.find((s) => s.key === choice)?.name ?? "";
  await dialog.getByRole("button", { name: `Set 1 element to ${name}` }).click();
  await expect(page.locator("[data-flash]")).toContainText(`Set 1 element to ${name}.`);
  expect((await ui.run("element.get", { ref: id })).element.status).toBe(choice);
});
