// SR-248 AK3: the web UI sets no status of its own (D-030, SR-087). The page's command calls are recorded while it
// loads, an element is created, changed and opened: none sets a status. Then a status is set and an element
// superseded through the confirmations of the review: each gives exactly one call, with the element, the status
// and the successor the confirmation names. The test writes, so it runs on a workspace of its own.
import type { Ui } from "./fixtures.js";
import { expect, test as base } from "./fixtures.js";
import { recordCommandCalls } from "./contract.js";
import { createWorkspace, runOn, startUi } from "./start-ui.js";

const test = base.extend<object, { ui: Ui }>({
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

const STATUS_COMMANDS = ["element.setStatus", "element.supersede"];

test("[SR-248/AK-xgr3] a status is set only by a confirmation that names the element and the status", async ({
  page,
  open,
  ui,
}) => {
  const calls = recordCommandCalls(page);
  const mm = await ui.run("metamodel.get", {});
  const type = mm.types.find((t) => !t.abstract && t.meaning === "need");
  const initial = mm.statuses.find((s) => s.initial === true);
  const settled = mm.statuses.find((s) => s.initial !== true && s.invalid !== true);
  const invalid = mm.statuses.find((s) => s.invalid === true);
  if (type === undefined || initial === undefined || settled === undefined || invalid === undefined) {
    throw new Error("The metamodel lacks a need type or an initial, settled or invalid status");
  }

  // Load, create, change and open: no call sets a status.
  await open();
  await open(`/new?type=${type.key}`);
  await page.locator("#f-title").fill("Made in the contract test");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator("#card h1")).toHaveText("Made in the contract test");
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.locator("#f-title").fill("Changed in the contract test");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#card h1")).toHaveText("Changed in the contract test");
  const { partial = [] } = await ui.run("element.list", {
    limit: 100,
    fields: ["identifier", "title", "type", "status"],
  });
  const made = partial.find((e) => e.title === "Changed in the contract test");
  const successor = partial.find((e) => e.type === type.key && e.id !== made?.id && e.status !== invalid.key);
  if (made === undefined || successor === undefined) {
    throw new Error("The element made or a successor is missing");
  }
  expect(made.status).toBe(initial.key);
  await open(`/e/${made.identifier ?? made.shortId}`);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.filter((c) => STATUS_COMMANDS.includes(c.name))).toEqual([]);

  // Set status: a cancelled confirmation calls nothing; a confirmed one calls once, with this element and status.
  // The page's list of elements takes the new one when the UI server's watcher reports it.
  const actions = page.locator(`.cdetail[data-id="${made.id}"] .cacts`);
  await expect(async () => {
    await open("/c");
    await page.reload();
    await page.locator(`.crow a[data-id="${made.id}"]`).click();
    await expect(actions.getByRole("button", { name: "Set status" })).toBeVisible({ timeout: 2000 });
  }).toPass();
  await actions.getByRole("button", { name: "Set status" }).click();
  const setDialog = page.getByRole("dialog", { name: "Set status" });
  await setDialog.getByLabel("Status").selectOption(settled.key);
  await expect(setDialog.locator(`li[data-id="${made.id}"]`)).toContainText(settled.name);
  await setDialog.getByRole("button", { name: "Cancel" }).click();
  expect(calls.filter((c) => STATUS_COMMANDS.includes(c.name))).toEqual([]);
  await actions.getByRole("button", { name: "Set status" }).click();
  await setDialog.getByLabel("Status").selectOption(settled.key);
  const before = calls.length;
  await setDialog.getByRole("button", { name: `Set 1 element to ${settled.name}` }).click();
  await expect(page.locator("[data-flash]")).toContainText(`Set 1 element to ${settled.name}.`);
  expect(calls.slice(before).filter((c) => STATUS_COMMANDS.includes(c.name))).toEqual([
    { name: "element.setStatus", input: { refs: [made.id], status: settled.key } },
  ]);

  // Supersede: once, with this element, the status chosen and the successor typed.
  await page.locator(`.crow a[data-id="${made.id}"]`).click();
  await actions.getByRole("button", { name: "Supersede" }).click();
  const supersede = page.getByRole("dialog", { name: "Supersede" });
  const choose = supersede.locator("#dlg-invalid");
  if ((await choose.count()) > 0) {
    await choose.selectOption(invalid.key);
  }
  await supersede.getByLabel("Successor").fill(successor.identifier ?? successor.shortId);
  const atSupersede = calls.length;
  await supersede.getByRole("button", { name: /^Supersede / }).click();
  await expect(page.locator("[data-flash]")).toContainText(`as ${invalid.name}, followed by`);
  expect(calls.slice(atSupersede).filter((c) => STATUS_COMMANDS.includes(c.name))).toEqual([
    { name: "element.supersede", input: { ref: made.id, status: invalid.key, successor: successor.id } },
  ]);
  expect((await ui.run("element.get", { ref: made.id })).element.status).toBe(invalid.key);
});
