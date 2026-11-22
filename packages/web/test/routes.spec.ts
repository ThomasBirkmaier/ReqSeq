// Every page of this package opens on the workspace of the project, whatever its metamodel: no script error, no
// failed request, no error box. Axe checks WCAG 2.1 AA on each kind of page, in the light and the dark theme.
import AxeBuilder from "@axe-core/playwright";
import type { Run } from "./start-ui.js";
import { expect, test } from "./fixtures.js";

const QUEUES = [
  "evidence-outdated",
  "approved-no-evidence",
  "missing-relation",
  "links",
  "needs-without",
  "drafts",
];

/** The overview, every queue, and one element of each type that has elements (up to `perType`). */
async function routes(run: Run, perType: number): Promise<string[]> {
  const mm = await run("metamodel.get", {});
  const out = ["/q/overview", ...QUEUES.map((q) => `/q/${q}`)];
  for (const type of mm.types.filter((t) => !t.abstract)) {
    const { partial = [] } = await run("element.list", {
      limit: perType,
      fields: ["identifier"],
      selection: { where: { type: [type.key] } },
    });
    out.push(...partial.map((e) => `/e/${encodeURIComponent(e.identifier ?? e.shortId)}`));
  }
  return out;
}

test("every page opens without errors", async ({ page, open, ui }) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  let seen: string[] = [];
  page.on("pageerror", (e) => seen.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) {
      seen.push(`${String(r.status())} ${new URL(r.url()).pathname}`);
    }
  });
  for (const route of await routes(ui.run, 2)) {
    seen = [];
    await open(route);
    const boxes = await page.locator(".notice.bad:visible").count();
    if (seen.length > 0 || boxes > 0) {
      problems.push(`${route}: ${seen.join(", ")}${boxes > 0 ? " error box" : ""}`);
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the pages have no WCAG 2.1 AA violations (${scheme})`, async ({ page, open, ui }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const problems: string[] = [];
    for (const route of [
      "/q/overview",
      "/q/drafts",
      ...(await routes(ui.run, 1)).filter((r) => r.startsWith("/e/")),
    ]) {
      await open(route);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      for (const v of result.violations) {
        problems.push(
          `${route}: ${v.id} (${String(v.nodes.length)}) ${v.nodes
            .slice(0, 2)
            .map((n) => n.target.join(" "))
            .join(" | ")}`,
        );
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
}

test("a phone shows the menu instead of the rail", async ({ page, open }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open();
  const rail = page.getByRole("navigation", { name: "Workspace" });
  await expect(rail).toBeHidden();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(rail).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(rail).toBeHidden();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
