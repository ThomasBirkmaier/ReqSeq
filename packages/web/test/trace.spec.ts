// The wider trace: the trace graph and the impact of a change of an element, the trace matrix, and a variant
// compared with the core, each as ReqSeq gives it.
import AxeBuilder from "@axe-core/playwright";
import type { Run } from "./start-ui.js";
import { expect, test } from "./fixtures.js";

const refOf = (e: { identifier?: string; shortId: string }): string => e.identifier ?? e.shortId;

/** The keys of the types with `meaning` that can have elements. */
const typesWith = async (run: Run, meaning: string): Promise<string[]> =>
  (await run("metamodel.get", {})).types
    .filter((t) => t.meaning === meaning && !t.abstract)
    .map((t) => t.key);

/** The core view, where the workspace knows variants; ReqSeq refuses a view in a workspace without them. */
const coreView = async (run: Run): Promise<{ view?: string }> =>
  (await run("metamodel.get", {})).properties.some((p) => p.meaning === "validity") ? { view: "core" } : {};

/** The element of the types with `meaning` that most elements point at, so its graph and impact are not empty. */
async function busiest(run: Run, meaning: string): Promise<string> {
  const { partial = [] } = await run("element.list", {
    limit: 5000,
    fields: ["identifier", "relations"],
    selection: { where: { type: await typesWith(run, meaning) } },
  });
  const incoming = (e: (typeof partial)[number]): number =>
    (e.relations ?? []).filter((r) => r.direction === "in").length;
  const top = [...partial].sort((a, b) => incoming(b) - incoming(a))[0];
  if (top === undefined) {
    throw new Error(`The workspace has no element of the meaning ${meaning}`);
  }
  return refOf(top);
}

test("the trace graph shows the nodes ReqSeq gives, and a node centres the graph on it", async ({
  page,
  open,
  ui,
}) => {
  const ref = await busiest(ui.run, "need");
  const graph = await ui.run("trace.graph", { ref, maxDepth: 2, limit: 300, ...(await coreView(ui.run)) });
  await open(`/graph/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Trace graph");
  await expect(page.locator(".gnode")).toHaveCount(graph.nodes.length);
  await expect(page.locator(".gnode.root")).toHaveAttribute("data-id", graph.root);
  // One level only.
  await page.getByLabel("Depth").selectOption("1");
  const near = await ui.run("trace.graph", { ref, maxDepth: 1, limit: 300, ...(await coreView(ui.run)) });
  await expect(page.locator(".gnode")).toHaveCount(near.nodes.length);
  // Another node becomes the centre.
  const other = near.nodes.find((n) => n.id !== near.root);
  expect(other).toBeDefined();
  await page.locator(`.gnode[data-id="${other?.id ?? ""}"]`).click();
  await expect(page.locator(".gnode.root")).toHaveAttribute("data-id", other?.id ?? "");
  // The centre opens its element page, with the way back to the graph.
  await page.locator(".gnode.root").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(other?.title ?? "");
});

test("the impact page lists what a change can affect, nearest first", async ({ page, open, ui }) => {
  const ref = await busiest(ui.run, "need");
  const affected = await ui.run("trace.affected", { ref, limit: 200 });
  await open(`/impact/${ref}`);
  await expect(page.locator(".lead")).toContainText(String(affected.total));
  await expect(page.locator(".dist .it")).toHaveCount(affected.affected.length);
  const first = affected.affected[0];
  if (first !== undefined) {
    await expect(page.locator(".dist .it").first()).toHaveAttribute("data-id", first.id);
  }
});

test("the trace matrix has a row per element and a column per relation, as ReqSeq gives them", async ({
  page,
  open,
  ui,
}) => {
  const [type] = await typesWith(ui.run, "requirement");
  const matrix = await ui.run("trace.matrix", {
    selection: { ...(await coreView(ui.run)), where: { type: [type ?? ""] } },
    limit: 200,
  });
  await open("/matrix");
  await expect(page.getByRole("heading", { level: 1, name: "Trace matrix" })).toBeVisible();
  await expect(page.locator(".matrix tbody tr")).toHaveCount(matrix.rows.length);
  await expect(page.locator(".matrix thead th")).toHaveCount(
    1 + matrix.columns.length + (matrix.evidence === undefined ? 0 : 2),
  );
  const rail = page.getByRole("navigation", { name: "Workspace" });
  await expect(rail.locator('[aria-current="page"]')).toHaveText("Trace matrix");
  // Another type as rows.
  const needs = await typesWith(ui.run, "need");
  if (needs[0] !== undefined) {
    const other = await ui.run("trace.matrix", {
      selection: { ...(await coreView(ui.run)), where: { type: [needs[0]] } },
      limit: 200,
    });
    await page.getByLabel("Rows").selectOption(needs[0]);
    await expect(page.locator(".matrix tbody tr")).toHaveCount(other.rows.length);
  }
});

test("a variant shows what it adds, replaces and excludes, and a core requirement can be excluded and included again", async ({
  page,
  open,
  ui,
}) => {
  const variantTypes = await typesWith(ui.run, "variant");
  test.skip(variantTypes.length === 0, "The workspace has no variant type.");
  const { partial: variants = [] } = await ui.run("element.list", {
    limit: 50,
    fields: ["identifier", "title"],
    selection: { where: { type: variantTypes } },
  });
  const variant = variants[0];
  test.skip(variant === undefined, "The workspace has no variants.");
  if (variant === undefined) {
    return;
  }
  const diff = await ui.run("variant.diff", { variant: variant.id });
  await open(`/variant/${refOf(variant)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `${variant.title ?? ""} compared with the core`,
  );
  const group = (name: RegExp) =>
    page.locator(".vgroup").filter({ has: page.getByRole("heading", { name }) });
  await expect(group(/^Added in/).locator(".vrow")).toHaveCount(diff.added.length);
  await expect(group(/^Excluded/).locator(".vrow")).toHaveCount(diff.excluded.length);
  // A core requirement that the variant keeps.
  const { partial: core = [] } = await ui.run("element.list", {
    limit: 5000,
    fields: ["identifier"],
    selection: { ...(await coreView(ui.run)), where: { type: await typesWith(ui.run, "requirement") } },
  });
  const keep = core.find((e) => !diff.excluded.includes(e.id) && !diff.replaced.some((p) => p.core === e.id));
  expect(keep).toBeDefined();
  await page
    .getByRole("combobox", { name: "Exclude a core requirement" })
    .fill(refOf(keep ?? { shortId: "" }));
  // ReqSeq's own write is followed by no change event: only the page can know the verification is outdated.
  const reread = page.waitForRequest(
    (r) => r.url().endsWith("/api/element.list") && (r.postData() ?? "").includes('"withVerification":true'),
  );
  await page.getByRole("button", { name: "Exclude", exact: true }).click();
  await expect(page.locator(".notice.ok")).toContainText("is excluded from");
  await reread;
  await expect(group(/^Excluded/).locator(".vrow")).toHaveCount(diff.excluded.length + 1);
  expect((await ui.run("variant.diff", { variant: variant.id })).excluded).toContain(keep?.id);
  await group(/^Excluded/)
    .locator(`.vrow[data-id="${keep?.id ?? ""}"]`)
    .getByRole("button", { name: "Include again" })
    .click();
  await expect(page.locator(".notice.ok")).toContainText("again");
  await expect(group(/^Excluded/).locator(".vrow")).toHaveCount(diff.excluded.length);
  expect((await ui.run("variant.diff", { variant: variant.id })).excluded).not.toContain(keep?.id);
});

/** One route of each page of this area. */
async function routes(run: Run): Promise<string[]> {
  const req = await busiest(run, "requirement");
  const need = await busiest(run, "need");
  const variantTypes = await typesWith(run, "variant");
  const { partial: variants = [] } =
    variantTypes.length === 0
      ? {}
      : await run("element.list", {
          limit: 1,
          fields: ["identifier"],
          selection: { where: { type: variantTypes } },
        });
  return [
    ...[req, need].flatMap((ref) => ["evidence", "graph", "impact"].map((page) => `/${page}/${ref}`)),
    `/graph/${need}?depth=all&evidence=1`,
    "/matrix",
    ...variants.map((v) => `/variant/${refOf(v)}`),
  ];
}

test("the pages of the trace open without errors and have no WCAG 2.1 AA violations", async ({
  page,
  open,
  ui,
}) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  let seen: string[] = [];
  page.on("pageerror", (e) => seen.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) {
      seen.push(`${String(r.status())} ${new URL(r.url()).pathname}`);
    }
  });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const route of await routes(ui.run)) {
      seen = [];
      await open(route);
      const boxes = await page.locator(".notice.bad:visible").count();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      for (const v of result.violations) {
        seen.push(
          `${v.id} (${String(v.nodes.length)}) ${v.nodes
            .slice(0, 2)
            .map((n) => n.target.join(" "))
            .join(" | ")}`,
        );
      }
      if (seen.length > 0 || boxes > 0) {
        problems.push(`${scheme} ${route}: ${seen.join(", ")}${boxes > 0 ? " error box" : ""}`);
      }
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
});
