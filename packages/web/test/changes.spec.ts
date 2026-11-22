// Review since a baseline, read only: the changes since a baseline as `baseline.get` gives them, the difference of
// one element word by word as `baseline.compare` gives it, and the check before a baseline of `baseline.prepare`. Runs on
// each workspace: with several baselines, with a metamodel of two settled statuses, and without a baseline.
import AxeBuilder from "@axe-core/playwright";
import type { Run } from "./start-ui.js";
import { expect, test } from "./fixtures.js";

const STATES = ["changed", "added", "superseded", "removed"];

/** The newest baseline as ReqSeq picks it, and its entries the list shows. */
async function newest(
  run: Run,
): Promise<{ name: string; listed: { id: string; state: string }[] } | undefined> {
  const changes = await run("baseline.changes", { limit: 1 });
  if (changes.baseline === undefined) {
    return undefined;
  }
  const got = await run("baseline.get", { baseline: changes.baseline.name, limit: 5000 });
  return {
    name: changes.baseline.name,
    listed: got.elements.filter((e) => STATES.includes(e.state)).map((e) => ({ id: e.id, state: e.state })),
  };
}

test("the list names every element that changed since the newest baseline", async ({ page, open, ui }) => {
  const since = await newest(ui.run);
  await open("/c");
  if (since === undefined) {
    await expect(page.getByRole("heading", { level: 1, name: "No baseline yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Check and create a baseline" })).toBeVisible();
    return;
  }
  await expect(page.getByRole("heading", { level: 1, name: `Changes since ${since.name}` })).toBeVisible();
  const rows = page.locator(".crow a[data-id]");
  await expect(rows).toHaveCount(since.listed.length);
  for (const entry of since.listed.slice(0, 20)) {
    await expect(page.locator(`.crow a[data-id="${entry.id}"]`)).toHaveCount(1);
  }
  // The rail counts the same elements.
  const rail = page.getByRole("navigation", { name: "Workspace" });
  await expect(rail.locator('[data-num="q:changes"]')).toHaveText(String(since.listed.length));
});

test("another baseline can be chosen", async ({ page, open, ui }) => {
  const { baselines } = await ui.run("baseline.list", {});
  test.skip(baselines.length < 2, "The workspace has fewer than two baselines");
  const since = await newest(ui.run);
  const other = baselines.find((b) => b.name !== since?.name);
  if (other === undefined) {
    throw new Error("No other baseline");
  }
  await open("/c");
  await page.getByLabel("Compare with baseline").selectOption(other.name);
  await expect(page.getByRole("heading", { level: 1, name: `Changes since ${other.name}` })).toBeVisible();
  const got = await ui.run("baseline.get", { baseline: other.name, limit: 5000 });
  await expect(page.locator(".crow a[data-id]")).toHaveCount(
    got.elements.filter((e) => STATES.includes(e.state)).length,
  );
});

test("the difference of a changed element shows the old and the new wording word by word", async ({
  page,
  open,
  ui,
}) => {
  const since = await newest(ui.run);
  test.skip(since === undefined, "The workspace has no baseline");
  let found: { id: string; before: string; after: string } | undefined;
  for (const entry of since?.listed.filter((e) => e.state === "changed") ?? []) {
    const out = await ui.run("baseline.compare", { baseline: since?.name ?? "", ref: entry.id });
    const text =
      out.difference.text ??
      out.difference.criteria.find((c) => c.before !== undefined && c.after !== undefined);
    if (text?.before !== undefined && text.after !== undefined) {
      found = { id: entry.id, before: text.before, after: text.after };
      break;
    }
  }
  test.skip(found === undefined, "No element changed its wording since the baseline");
  if (found === undefined) {
    return;
  }
  await open("/c");
  await page.locator(`.crow a[data-id="${found.id}"]`).click();
  const panel = page.locator(`.cdetail[data-id="${found.id}"]`);
  await expect(panel).toBeVisible();
  // Words only in the old wording are struck out, words only in the new one are marked as inserted.
  const marks = panel.locator(".wd del, .wd ins");
  await expect(marks.first()).toBeVisible();
  const removed = (await panel.locator(".wd del").allTextContents()).join("");
  const added = (await panel.locator(".wd ins").allTextContents()).join("");
  for (const word of removed.split(/\s+/).filter((w) => w !== "")) {
    expect(found.before).toContain(word);
  }
  for (const word of added.split(/\s+/).filter((w) => w !== "")) {
    expect(found.after).toContain(word);
  }
});

test("Approve is offered only where a type has one status to approve", async ({ page, open, ui }) => {
  const since = await newest(ui.run);
  test.skip(since === undefined, "The workspace has no baseline");
  const mm = await ui.run("metamodel.get", {});
  const settled = (type: string | undefined): string[] =>
    (mm.types.find((t) => t.key === type)?.statuses ?? []).filter((s) => {
      const d = mm.statuses.find((x) => x.key === s);
      return d?.initial !== true && d?.invalid !== true;
    });
  for (const entry of (since?.listed ?? []).filter((e) => e.state !== "superseded").slice(0, 3)) {
    const { element } = await ui.run("element.get", { ref: entry.id });
    const invalid = mm.statuses.find((s) => s.key === element.status)?.invalid === true;
    const one = settled(element.type);
    await open("/c");
    await page.locator(`.crow a[data-id="${entry.id}"]`).click();
    await expect(page.locator(`.cdetail[data-id="${entry.id}"]`)).toBeVisible();
    const approve = page.locator(".cdetail .cacts").getByRole("button", { name: "Approve" });
    await expect(approve).toHaveCount(!invalid && one.length === 1 && element.status !== one[0] ? 1 : 0);
  }
});

test("the check before a baseline shows what ReqSeq checks before a baseline", async ({ page, open, ui }) => {
  const prep = await ui.run("baseline.prepare", {});
  await open("/r");
  await expect(page.getByRole("heading", { level: 1, name: "Check before a baseline" })).toBeVisible();
  const errors = prep.problems.filter((p) => p.severity === "error").length;
  const counts = page.locator(".ccounts.big dt");
  await expect(counts.nth(0)).toHaveText(String(errors));
  await expect(counts.nth(2)).toHaveText(
    `${String(prep.degree.counts.verified + prep.degree.counts.indirect)} of ${String(prep.degree.total)}`,
  );
  await expect(counts.nth(3)).toHaveText(String(prep.withoutPassedTest));
  // Every problem by its message, as text.
  for (const p of prep.problems.slice(0, 10)) {
    await expect(page.locator(".problems li").filter({ hasText: p.message }).first()).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 2, name: "Create a baseline" })).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`the review pages have no WCAG 2.1 AA violations (${scheme})`, async ({ page, open, ui }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const since = await newest(ui.run);
    const first = since?.listed.find((e) => e.state === "changed") ?? since?.listed[0];
    const routes = ["/c", "/r", ...(first === undefined ? [] : [`/c/${first.id}`])];
    const problems: string[] = [];
    for (const route of routes) {
      await open(route);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      for (const v of result.violations) {
        problems.push(
          `${route}: ${v.id} ${v.nodes
            .slice(0, 2)
            .map((n) => n.target.join(" "))
            .join(" | ")}`,
        );
      }
    }
    // A dialog too: the confirmation of a status.
    if (first !== undefined) {
      await open(`/c/${first.id}`);
      const set = page.locator(".cdetail .cacts").getByRole("button", { name: "Set status" });
      if ((await set.count()) > 0) {
        await set.click();
        await expect(page.getByRole("dialog")).toBeVisible();
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        problems.push(...result.violations.map((v) => `dialog: ${v.id}`));
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
}
