// The decisions of the review, which write the workspace: a status only after a confirmation that names the
// elements and the status (D-030), superseding with a successor, a property of many with ReqSeq's preview, and a
// new baseline. These tests run on a workspace of their own (a worker of its own), so no other test sees their
// writes; they compare with the baseline `Generated` of the copy of the specification.
import type { Page } from "@playwright/test";
import type { Ui } from "./fixtures.js";
import { expect, test as shared } from "./fixtures.js";
import type { Run } from "./start-ui.js";
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

const BASELINE = "Generated";
const CHANGES = `/c?b=${BASELINE}`;

interface Entry {
  readonly id: string;
  readonly type: string;
  readonly status: string | undefined;
}

/** The entries the list shows since `Generated` that are not superseded, with their type and status now. */
async function listed(run: Run): Promise<Entry[]> {
  const got = await run("baseline.get", { baseline: BASELINE, limit: 5000 });
  const mm = await run("metamodel.get", {});
  const out: Entry[] = [];
  for (const e of got.elements.filter((x) => ["changed", "added"].includes(x.state))) {
    const { element } = await run("element.get", { ref: e.id });
    if (mm.statuses.find((s) => s.key === element.status)?.invalid !== true) {
      out.push({ id: e.id, type: element.type, status: element.status });
    }
  }
  return out;
}

const approvalOf = async (run: Run, type: string): Promise<string | undefined> => {
  const mm = await run("metamodel.get", {});
  const settled = (mm.types.find((t) => t.key === type)?.statuses ?? []).filter((s) => {
    const d = mm.statuses.find((x) => x.key === s);
    return d?.initial !== true && d?.invalid !== true;
  });
  return settled.length === 1 ? settled[0] : undefined;
};

const statusOf = async (run: Run, id: string): Promise<string | undefined> =>
  (await run("element.get", { ref: id })).element.status;

const openEntry = async (page: Page, open: (route?: string) => Promise<void>, id: string): Promise<void> => {
  await open(CHANGES);
  await page.locator(`.crow a[data-id="${id}"]`).click();
  await expect(page.locator(`.cdetail[data-id="${id}"]`)).toBeVisible();
};

test("a new baseline is created after a confirmation and becomes the newest", async ({ page, open, ui }) => {
  await open("/r");
  await page.getByLabel("Name").fill("Review 1");
  await page.getByRole("button", { name: "Create baseline", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Create baseline Review 1 of the whole workspace.");
  expect((await ui.run("baseline.list", {})).baselines.map((b) => b.name)).not.toContain("Review 1");
  await dialog.getByRole("button", { name: "Create baseline Review 1 of the whole workspace" }).click();
  await expect(page.locator("[data-flash]")).toContainText("Baseline Review 1 written to");
  const { baselines } = await ui.run("baseline.list", {});
  expect(baselines.map((b) => b.name)).toContain("Review 1");
  // The changes since it: nothing changed or added yet; what is superseded stays listed as such.
  await open("/c");
  await expect(page.getByRole("heading", { level: 1, name: "Changes since Review 1" })).toBeVisible();
  const got = await ui.run("baseline.get", { baseline: "Review 1", limit: 5000 });
  expect(got.counts.changed + got.counts.added).toBe(0);
  await expect(page.locator(".crow")).toHaveCount(got.counts.superseded);
});

test("Approve sets the status only after the confirmation names the element and the status", async ({
  page,
  open,
  ui,
}) => {
  let target: { entry: Entry; status: string } | undefined;
  for (const entry of await listed(ui.run)) {
    const status = await approvalOf(ui.run, entry.type);
    if (status !== undefined) {
      target = { entry, status };
      break;
    }
  }
  if (target === undefined) {
    throw new Error("No changed element of a type with one status to approve");
  }
  const { status } = target;
  const mm = await ui.run("metamodel.get", {});
  // An element that is still in the status new elements get.
  const initial = mm.statuses.find((s) => s.initial === true)?.key ?? "";
  if (target.entry.status !== initial) {
    await ui.run("element.setStatus", { refs: [target.entry.id], status: initial });
  }
  const entry = { ...target.entry, status: initial };
  const name = mm.statuses.find((s) => s.key === status)?.name ?? status;
  await openEntry(page, open, entry.id);
  await page.locator(".cdetail .cacts").getByRole("button", { name: "Approve" }).click();
  const dialog = page.getByRole("dialog", { name: "Approve" });
  await expect(dialog.locator(`li[data-id="${entry.id}"]`)).toContainText(name);
  // Cancel writes nothing.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await statusOf(ui.run, entry.id)).toBe(entry.status);
  await page.locator(".cdetail .cacts").getByRole("button", { name: "Approve" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: `Set 1 element to ${name}` })
    .click();
  await expect(page.locator("[data-flash]")).toContainText(`Set 1 element to ${name}.`);
  expect(await statusOf(ui.run, entry.id)).toBe(status);
});

test("Set status changes several chosen elements to the status chosen in the confirmation", async ({
  page,
  open,
  ui,
}) => {
  const mm = await ui.run("metamodel.get", {});
  const initial = mm.statuses.find((s) => s.initial === true);
  if (initial === undefined) {
    throw new Error("No initial status");
  }
  const entries = (await listed(ui.run)).filter(
    (e) =>
      e.status !== initial.key &&
      (mm.types.find((t) => t.key === e.type)?.statuses ?? []).includes(initial.key),
  );
  const two = entries.slice(0, 2);
  if (two.length < 2) {
    throw new Error("Fewer than two changed elements to set back");
  }
  await open(CHANGES);
  for (const e of two) {
    await page.locator(`input[data-pick="${e.id}"]`).check();
  }
  await expect(page.locator(".selcount")).toHaveText("2 chosen");
  await page.locator(".selbar").getByRole("button", { name: "Set status" }).click();
  const dialog = page.getByRole("dialog", { name: "Set status" });
  await dialog.getByLabel("Status").selectOption(initial.key);
  for (const e of two) {
    await expect(dialog.locator(`li[data-id="${e.id}"]`)).toContainText(initial.name);
  }
  await dialog.getByRole("button", { name: `Set 2 elements to ${initial.name}` }).click();
  await expect(page.locator("[data-flash]")).toContainText(`Set 2 elements to ${initial.name}.`);
  for (const e of two) {
    expect(await statusOf(ui.run, e.id)).toBe(initial.key);
  }
});

test("Supersede gives the element its superseded status and points its successor to it", async ({
  page,
  open,
  ui,
}) => {
  const mm = await ui.run("metamodel.get", {});
  const invalidOf = (type: string): string[] =>
    (mm.types.find((t) => t.key === type)?.statuses ?? []).filter(
      (s) => mm.statuses.find((x) => x.key === s)?.invalid === true,
    );
  const entry = (await listed(ui.run)).find((e) => invalidOf(e.type).length > 0);
  if (entry === undefined) {
    throw new Error("No changed element that can be superseded");
  }
  const { partial = [] } = await ui.run("element.list", {
    limit: 50,
    fields: ["identifier", "status", "title"],
    selection: { where: { all: [{ type: [entry.type] }, { invalid: false }] } },
  });
  const successor = partial.find((e) => e.id !== entry.id);
  if (successor === undefined) {
    throw new Error("No successor");
  }
  const successorRef = successor.identifier ?? successor.shortId;
  const status = invalidOf(entry.type)[0] ?? "";
  const name = mm.statuses.find((s) => s.key === status)?.name ?? status;
  await openEntry(page, open, entry.id);
  await page.locator(".cdetail .cacts").getByRole("button", { name: "Supersede" }).click();
  const dialog = page.getByRole("dialog", { name: "Supersede" });
  const choose = dialog.locator("#dlg-invalid");
  if ((await choose.count()) > 0) {
    await choose.selectOption(status);
  }
  await dialog.getByLabel("Successor").fill("NO-SUCH-ELEMENT");
  await expect(dialog.locator("[data-summary]")).toHaveText(
    "NO-SUCH-ELEMENT is no element that can follow this one.",
  );
  await dialog.getByLabel("Successor").fill(successorRef);
  await expect(dialog.locator("[data-summary]")).toContainText(`as ${name}, followed by ${successorRef}`);
  await dialog.getByRole("button", { name: /^Supersede / }).click();
  await expect(page.locator("[data-flash]")).toContainText(`as ${name}, followed by`);
  expect(await statusOf(ui.run, entry.id)).toBe(status);
  const after = await ui.run("element.get", { ref: successor.id });
  expect(after.element.relations.some((r) => r.direction === "out" && r.id === entry.id)).toBe(true);
});

test("a property of several elements changes only after ReqSeq's preview is confirmed", async ({
  page,
  open,
  ui,
}) => {
  const mm = await ui.run("metamodel.get", {});
  const entries = await listed(ui.run);
  // A plain text property both elements' types have.
  let pick: { ids: string[]; key: string; name: string } | undefined;
  for (const p of mm.properties.filter(
    (x) => x.kind === "text" && x.many !== true && x.meaning === undefined,
  )) {
    const ids = entries
      .filter((e) => mm.types.find((t) => t.key === e.type)?.properties.includes(p.key) === true)
      .map((e) => e.id);
    if (ids.length >= 2) {
      pick = { ids: ids.slice(0, 2), key: p.key, name: p.name };
      break;
    }
  }
  if (pick === undefined) {
    throw new Error("No text property two changed elements share");
  }
  await open(CHANGES);
  for (const id of pick.ids) {
    await page.locator(`input[data-pick="${id}"]`).check();
  }
  await page.locator(".selbar").getByRole("button", { name: "Change a property" }).click();
  const dialog = page.getByRole("dialog", { name: "Change a property" });
  await dialog.getByLabel("Property").selectOption(pick.key);
  await dialog.getByLabel("Value").fill("Set in review");
  await expect(dialog.getByRole("button", { name: /^Change \d/ })).toBeHidden();
  await dialog.getByRole("button", { name: "Preview" }).click();
  await expect(dialog.locator("[data-preview]")).toContainText("Would change 2 elements.");
  for (const id of pick.ids) {
    expect((await ui.run("element.get", { ref: id })).element.properties[pick.key]).not.toBe("Set in review");
  }
  await dialog.getByRole("button", { name: "Change 2 elements" }).click();
  await expect(page.locator("[data-flash]")).toContainText("of 2 elements.");
  for (const id of pick.ids) {
    expect((await ui.run("element.get", { ref: id })).element.properties[pick.key]).toBe("Set in review");
  }
});

test("a baseline is refused in plain words while element files are not committed", async ({
  page,
  open,
  ui,
}) => {
  // The tests before wrote element files; make sure of one change of its own.
  const [entry] = await listed(ui.run);
  if (entry === undefined) {
    throw new Error("No changed element");
  }
  const mm = await ui.run("metamodel.get", {});
  const initial = mm.statuses.find((s) => s.initial === true)?.key ?? "";
  const other = (mm.types.find((t) => t.key === entry.type)?.statuses ?? []).find(
    (s) => s !== entry.status && mm.statuses.find((x) => x.key === s)?.invalid !== true,
  );
  await ui.run("element.setStatus", { refs: [entry.id], status: other ?? initial });
  await open("/r");
  await page.getByLabel("Name").fill("Review 2");
  await page.getByRole("button", { name: "Create baseline", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Create baseline Review 2/ })
    .click();
  await expect(page.getByRole("dialog").locator(".notice.bad")).toContainText(
    "The workspace has changes that are not committed.",
  );
  expect((await ui.run("baseline.list", {})).baselines.map((b) => b.name)).not.toContain("Review 2");
});

test("Set status leaves superseded elements out and names them", async ({ page, open, ui }) => {
  const got = await ui.run("baseline.get", { baseline: BASELINE, limit: 5000 });
  const superseded = got.elements.filter((e) => e.state === "superseded").map((e) => e.id);
  const before = await statusOf(ui.run, superseded[0] ?? "");
  await open(CHANGES);
  await page.locator('input[data-pick-all="superseded"]').check();
  await page.locator(".selbar").getByRole("button", { name: "Set status" }).click();
  const dialog = page.getByRole("dialog", { name: "Set status" });
  const choose = dialog.locator("#dlg-status");
  if ((await choose.count()) > 0) {
    await choose.selectOption({ index: 1 });
    await expect(dialog.locator(`.dlg-list.left li[data-id="${superseded[0] ?? ""}"]`)).toContainText(
      "superseded",
    );
    await expect(dialog.getByRole("button", { name: /^Set \d/ })).toHaveCount(0);
  }
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(await statusOf(ui.run, superseded[0] ?? "")).toBe(before);
});
