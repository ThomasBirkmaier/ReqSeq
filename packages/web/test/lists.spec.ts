// Lists: every type and package, narrowed by facets, sorted and grouped, saved as a filter or a perspective,
// renamed and deleted; the search and the finder (⌘K). What each list holds is what ReqSeq lists.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { Run } from "./start-ui.js";
import { expect, test } from "./fixtures.js";

/** Waits until the page drew the route it shows now (after a click changed the address). */
const settle = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    const app = document.getElementById("app");
    return (
      app?.getAttribute("aria-busy") === "false" &&
      app.dataset["route"] === (location.hash.replace(/^#/, "") || "/q/overview")
    );
  });
};

const rows = (page: Page) => page.locator(".lscroll .it");
const options = (page: Page) => page.locator("#finder-list [role=option]");

/** The view the page lists in: the core where the workspace knows variants, as the page starts. */
async function viewOf(run: Run): Promise<{ view?: string }> {
  const mm = await run("metamodel.get", {});
  return mm.properties.some((p) => p.meaning === "validity") ? { view: "core" } : {};
}

/** The type with the most elements, and a status that only some of them have. */
async function typeAndStatus(run: Run): Promise<{ type: string; status: string; count: number }> {
  const view = await viewOf(run);
  const facets = await run("element.facets", { selection: view });
  const type = [...facets.types].sort((a, b) => b.count - a.count)[0];
  if (type === undefined) {
    throw new Error("The workspace has no elements");
  }
  const own = await run("element.facets", { selection: { ...view, where: { type: [type.key] } } });
  const status = own.statuses.find((s) => s.count < own.total) ?? own.statuses[0];
  if (status === undefined) {
    throw new Error("The type has no status");
  }
  return { type: type.key, status: status.key, count: own.total };
}

test("every list opens without errors", async ({ page, open, ui }) => {
  test.setTimeout(240_000);
  const facets = await ui.run("element.facets", {});
  const mm = await ui.run("metamodel.get", {});
  const packages = mm.properties.find((p) => p.meaning === "packages")?.key;
  const packageValues = facets.properties.find((p) => p.key === packages)?.values ?? [];
  const routes = [
    "/l/all",
    "/l/search",
    "/l/search?q=the",
    "/l/all?sort=hierarchy",
    "/l/all?group=status&sort=verification&order=desc",
    ...facets.types.map((t) => `/l/type/${encodeURIComponent(t.key)}`),
    ...packageValues.slice(0, 3).map((v) => `/l/package/${encodeURIComponent(String(v.value))}`),
  ];
  const problems: string[] = [];
  let seen: string[] = [];
  page.on("pageerror", (e) => seen.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) {
      seen.push(`${String(r.status())} ${new URL(r.url()).pathname}`);
    }
  });
  for (const route of routes) {
    seen = [];
    await open(route);
    if (seen.length > 0 || (await page.locator(".notice.bad:visible").count()) > 0) {
      problems.push(`${route}: ${seen.join(", ")}`);
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

test("a type lists its elements, and a facet narrows them by ReqSeq's counts", async ({ page, open, ui }) => {
  const { type, status, count } = await typeAndStatus(ui.run);
  await open(`/l/type/${encodeURIComponent(type)}`);
  await expect(page.locator(".count")).toHaveAttribute("data-count", String(count));
  await expect(rows(page)).toHaveCount(count);
  const rail = page.getByRole("navigation", { name: "Workspace" });
  await expect(rail.locator('[aria-current="page"]')).toContainText(String(count));

  const narrowed = await ui.run("element.list", {
    limit: 5000,
    fields: ["title"],
    selection: { ...(await viewOf(ui.run)), where: { all: [{ type: [type] }, { status: [status] }] } },
  });
  const box = page.locator(`[data-facet="status"][data-value='${JSON.stringify(status)}']`);
  await box.check();
  await settle(page);
  await expect(rows(page)).toHaveCount(narrowed.total);
  await expect(page.locator(".chip")).toHaveCount(1);
  // The focus stays on the box the person used.
  await expect(page.locator(`[data-facet="status"][data-value='${JSON.stringify(status)}']`)).toBeFocused();
  // The other statuses of the type stay offered, so another one can be added.
  expect(await page.locator('[data-facet="status"]').count()).toBeGreaterThan(1);

  await page.locator(".chip").click();
  await settle(page);
  await expect(rows(page)).toHaveCount(count);
});

test("a list sorts and groups as element.list does", async ({ page, open, ui }) => {
  const view = await viewOf(ui.run);
  const sorted = await ui.run("element.list", {
    selection: view,
    limit: 1,
    fields: ["title"],
    sort: [{ by: "title", order: "desc" }],
  });
  await open("/l/all");
  await page.locator('[data-ctl="sort"]').selectOption("title");
  await settle(page);
  await page.locator('[data-ctl="order"]').selectOption("desc");
  await settle(page);
  await expect(rows(page).first().locator(".t")).toHaveText(sorted.partial?.[0]?.title ?? "");

  const grouped = await ui.run("element.list", {
    selection: view,
    limit: 1,
    fields: ["title"],
    group: "status",
  });
  await page.locator('[data-ctl="group"]').selectOption("status");
  await settle(page);
  const heads = page.locator(".lscroll h2.group");
  await expect(heads).toHaveCount(grouped.groups?.length ?? 0);
  await expect(heads.first().locator("b")).toHaveText(String(grouped.groups?.[0]?.count ?? 0));
  expect(page.url()).toContain("group=status");
});

test("a list is saved as a filter, renamed and deleted", async ({ page, open, ui }) => {
  const { type, status } = await typeAndStatus(ui.run);
  await open(`/l/type/${encodeURIComponent(type)}?status=${encodeURIComponent(status)}`);
  const shown = await rows(page).count();
  await page.getByRole("button", { name: "Save as filter" }).click();
  const dialog = page.getByRole("dialog", { name: "Save as filter" });
  await dialog.getByLabel("Name").fill("Narrowed list");
  await dialog.getByRole("button", { name: "Save" }).click();
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: "Narrowed list" })).toBeVisible();
  await expect(rows(page)).toHaveCount(shown);
  const rail = page.getByRole("navigation", { name: "Workspace" });
  await expect(rail.getByRole("link", { name: "Narrowed list" })).toBeVisible();
  const { filters } = await ui.run("filter.list", {});
  const saved = filters.find((f) => f.name === "Narrowed list");
  const listed = await ui.run("element.list", {
    limit: 5000,
    fields: ["title"],
    selection: { ...(await viewOf(ui.run)), filter: "Narrowed list" },
  });
  expect(saved).toBeDefined();
  expect(listed.total).toBe(shown);

  await page.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename the saved filter" });
  await rename.getByLabel("New name").fill("Renamed list");
  await rename.getByRole("button", { name: "Rename" }).click();
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: "Renamed list" })).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).click();
  const remove = page.getByRole("dialog", { name: "Delete the saved filter?" });
  await expect(remove).toContainText("filters/");
  await remove.getByRole("button", { name: "Delete" }).click();
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: "All elements" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Renamed list" })).toHaveCount(0);
  expect((await ui.run("filter.list", {})).filters.map((f) => f.name)).not.toContain("Renamed list");
});

test("a perspective keeps the grouping, and its changes are saved into it", async ({ page, open, ui }) => {
  await open("/l/all?group=status");
  await page.getByRole("button", { name: "Save as perspective" }).click();
  const dialog = page.getByRole("dialog", { name: "Save as perspective" });
  await dialog.getByLabel("Name").fill("By status");
  await dialog.getByLabel("What it is for (optional)").fill("Every element by its status");
  await dialog.getByRole("button", { name: "Save" }).click();
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: "By status" })).toBeVisible();
  await expect(page.getByText("Every element by its status")).toBeVisible();
  const stored = (await ui.run("perspective.list", {})).perspectives.find((p) => p.name === "By status");
  expect(stored?.group).toBe("status");
  const groups = (
    await ui.run("element.list", {
      selection: await viewOf(ui.run),
      limit: 1,
      fields: ["title"],
      perspective: "By status",
    })
  ).groups;
  await expect(page.locator(".lscroll h2.group")).toHaveCount(groups?.length ?? 0);

  await page.locator('[data-ctl="sort"]').selectOption("title");
  await settle(page);
  await page.getByRole("button", { name: "Save changes" }).click();
  // Saved, the page shows the perspective as stored, without the changes in its address.
  await expect(page).not.toHaveURL(/sort=/);
  await settle(page);
  const changed = (await ui.run("perspective.list", {})).perspectives.find((p) => p.name === "By status");
  expect(changed?.sort).toEqual([{ by: "title", order: "asc" }]);
  expect(changed?.description).toBe("Every element by its status");

  await page.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("dialog", { name: "Delete the perspective?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await settle(page);
  expect((await ui.run("perspective.list", {})).perspectives.map((p) => p.name)).not.toContain("By status");
});

test("a perspective lists in its own sort, over the sort of its filter", async ({ page, open, ui }) => {
  await ui.run("filter.save", {
    name: "Sorted filter",
    where: { all: [] },
    sort: [{ by: "title", order: "asc" }],
  });
  await ui.run("perspective.save", {
    name: "Own sort",
    filter: "Sorted filter",
    where: { all: [] },
    sort: [{ by: "title", order: "desc" }],
  });
  const expected = await ui.run("element.list", {
    selection: await viewOf(ui.run),
    perspective: "Own sort",
    limit: 1,
    fields: ["title"],
  });
  await open("/l/perspective/Own%20sort");
  await expect(rows(page).first().locator(".t")).toHaveText(expected.partial?.[0]?.title ?? "");
  await expect(
    page.getByRole("navigation", { name: "Workspace" }).locator('[aria-current="page"]'),
  ).toHaveText("Own sort");
  await ui.run("perspective.delete", { name: "Own sort", confirm: true });
  await ui.run("filter.delete", { name: "Sorted filter", confirm: true });
});

test("an unknown list goes to all elements", async ({ page, open }) => {
  await open("/q/overview");
  await page.evaluate(() => {
    location.hash = "#/l/nothing";
  });
  await expect(page.getByRole("heading", { level: 1, name: "All elements" })).toBeVisible();
});

test("the search finds elements by their words, and a row leads back to the search", async ({
  page,
  open,
  ui,
}) => {
  const { partial = [] } = await ui.run("element.list", {
    selection: await viewOf(ui.run),
    limit: 50,
    fields: ["title"],
  });
  const title = partial.map((e) => e.title ?? "").find((t) => t.split(" ").length >= 3) ?? "";
  const query = title.split(" ").slice(0, 3).join(" ");
  const hits = await ui.run("element.search", { query, limit: 1, selection: await viewOf(ui.run) });
  await open("/l/search");
  await page.getByRole("searchbox", { name: "Search for" }).fill(query);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await settle(page);
  await expect(page.locator(".count")).toHaveAttribute("data-count", String(hits.total));
  const first = rows(page).first();
  await expect(first.locator(".t")).toHaveText(hits.hits[0]?.title ?? "");
  await expect(first.locator("mark").first()).toBeVisible();
  await first.click();
  await expect(page.getByRole("heading", { level: 1, name: hits.hits[0]?.title ?? "" })).toBeVisible();
  await page.getByRole("link", { name: `Back to Search for “${query}”` }).click();
  await settle(page);
  await expect(page.getByRole("searchbox", { name: "Search for" })).toHaveValue(query);
});

test("the finder opens a list or an element from any page", async ({ page, open, ui }) => {
  const { partial = [] } = await ui.run("element.list", {
    selection: await viewOf(ui.run),
    limit: 1,
    fields: ["title", "identifier"],
  });
  const target = partial[0];
  if (target === undefined) {
    throw new Error("The workspace has no elements");
  }
  await open("/q/overview");
  await page.keyboard.press("Control+k");
  const finder = page.getByRole("combobox", { name: "Find a list or an element" });
  await expect(finder).toBeFocused();
  await finder.fill("All elem");
  await expect(options(page).first()).toContainText("All elements");
  await page.keyboard.press("Enter");
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: "All elements" })).toBeVisible();

  await page.keyboard.press("Control+k");
  await finder.fill(target.identifier ?? target.shortId);
  await expect(
    options(page)
      .filter({ hasText: new RegExp(escape(target.title ?? "")) })
      .first(),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  const active = page.locator('[role="option"][aria-selected="true"]');
  if (!((await active.textContent()) ?? "").includes(target.title ?? "")) {
    await options(page)
      .filter({ hasText: new RegExp(escape(target.title ?? "")) })
      .first()
      .click();
  } else {
    await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("heading", { level: 1, name: target.title ?? "" })).toBeVisible();

  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  await expect(finder).toHaveCount(0);
});

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const scheme of ["light", "dark"] as const) {
  test(`the lists have no WCAG 2.1 AA violations (${scheme})`, async ({ page, open }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const problems: string[] = [];
    const check = async (where: string): Promise<void> => {
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      for (const v of result.violations) {
        problems.push(
          `${where}: ${v.id} ${v.nodes
            .slice(0, 2)
            .map((n) => n.target.join(" "))
            .join(" | ")}`,
        );
      }
    };
    await open("/l/all?group=status");
    await check("list");
    await open("/l/search?q=the");
    await check("search");
    await page.getByRole("button", { name: "Save as filter" }).click();
    await check("dialog");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Find a list or an element" }).fill("a");
    await check("finder");
    expect(problems, problems.join("\n")).toEqual([]);
  });
}

test("a phone shows the facets above the list without a side scroll", async ({ page, open }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open("/l/all");
  await expect(page.getByRole("heading", { level: 1, name: "All elements" })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
