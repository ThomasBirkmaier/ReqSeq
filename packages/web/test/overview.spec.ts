// The overview and its queues: what needs a look or a decision, as ReqSeq counts it.
import { expect, test } from "./fixtures.js";

const elementsWith = (hints: readonly { code: string; elementId?: string }[], code: string): number =>
  new Set(hints.filter((h) => h.code === code).map((h) => h.elementId)).size;

test("the overview shows the open work as ReqSeq counts it", async ({ page, open, ui }) => {
  const { degree } = await ui.run("evidence.degree", {});
  const { hints } = await ui.run("hint.list", { limit: 5000 });
  await open();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  // The verification sentence is ReqSeq's own count.
  await expect(page.locator(".headline")).toHaveText(
    new RegExp(
      `^${String(degree.counts.verified + degree.counts.indirect)} of ${String(degree.total)} .+ are verified\\.$`,
    ),
  );
  const rail = page.getByRole("navigation", { name: "Workspace" });
  const outdated = elementsWith(hints, "evidence.outdated");
  const missing = elementsWith(hints, "relation.too-few");
  if (outdated > 0) {
    await expect(rail.getByRole("link", { name: /Evidence outdated/ })).toContainText(String(outdated));
    await expect(page.getByRole("heading", { level: 2, name: /Evidence outdated/ })).toBeVisible();
  }
  if (missing > 0) {
    await expect(rail.getByRole("link", { name: /Missing a required relation/ })).toContainText(
      String(missing),
    );
  }
  // Every queue with something in it has its group, with its count.
  const groups = page.locator(".lscroll h2.group");
  expect(await groups.count()).toBeGreaterThan(0);
  for (const group of await groups.all()) {
    const key = ((await group.locator("a").getAttribute("href")) ?? "").split("/").pop() ?? "";
    await expect(rail.locator(`[data-num="q:${key}"]`)).toHaveText(
      (await group.locator("b").textContent()) ?? "",
    );
  }
});

test("a queue lists its elements, and a row opens the element with the way back", async ({
  page,
  open,
  ui,
}) => {
  const { statuses } = await ui.run("metamodel.get", {});
  const initial = statuses.filter((s) => s.initial === true).map((s) => s.key);
  const { partial = [] } = await ui.run("element.list", {
    limit: 5000,
    fields: ["title"],
    selection: { where: { status: initial } },
  });
  await open("/q/drafts");
  const title = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
  await expect(page.locator(".it")).toHaveCount(partial.length);
  const row = page.locator(".it").first();
  const rowTitle = (await row.locator(".t").textContent()) ?? "";
  await row.click();
  await expect(page.getByRole("heading", { level: 1, name: rowTitle })).toBeVisible();
  await page.getByRole("link", { name: `Back to ${title}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
});

test("the overview links each group to its whole queue", async ({ page, open }) => {
  await open();
  const group = page.locator(".lscroll h2.group a").first();
  const name = (await group.textContent()) ?? "";
  await group.click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Workspace" }).locator('[aria-current="page"]'),
  ).toContainText(name);
});

test("the overview counts the changes since the newest baseline and opens their list", async ({
  page,
  open,
  ui,
}) => {
  const { baseline } = await ui.run("baseline.changes", { limit: 1 });
  await open();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  const fact = page.locator(".facts a", { hasText: /since/ });
  if (baseline === undefined) {
    await expect(fact).toHaveCount(0);
    return;
  }
  // The same count as the rail, from the same command.
  const { counts } = baseline;
  const count = counts.changed + counts.superseded + (counts.added ?? 0) + (counts.removed ?? 0);
  await expect(fact).toHaveText(
    `${String(count)}${count === 1 ? "change" : "changes"} since ${baseline.name}`,
  );
  if (count > 0) {
    await expect(
      page.getByRole("navigation", { name: "Workspace" }).locator('[data-num="q:changes"]'),
    ).toHaveText(String(count));
  }
  await fact.click();
  await expect(page.getByRole("heading", { level: 1, name: `Changes since ${baseline.name}` })).toBeVisible();
});

test("where the panel is hidden, the list header still counts the verified requirements and the changes", async ({
  page,
  open,
  ui,
}) => {
  const { degree } = await ui.run("evidence.degree", {});
  const { baseline } = await ui.run("baseline.changes", { limit: 1 });
  await page.setViewportSize({ width: 1000, height: 800 });
  await open();
  await expect(page.locator(".ov")).toBeHidden();
  const mini = page.locator(".ov-mini");
  await expect(mini).toContainText(
    `${String(degree.counts.verified + degree.counts.indirect)} of ${String(degree.total)}`,
  );
  if (baseline === undefined) {
    await expect(mini.getByRole("link")).toHaveCount(0);
    return;
  }
  await mini.getByRole("link", { name: `since ${baseline.name}.` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Changes since ${baseline.name}` })).toBeVisible();
});
