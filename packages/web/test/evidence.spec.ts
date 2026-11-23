// The evidence of an element: what was checked per criterion and test case, as ReqSeq lays it out, and a check
// recorded on the page.
import type { Run } from "./start-ui.js";
import { expect, test } from "./fixtures.js";

/** The first requirement with evidence records, and the types of requirements and needs. */
async function withRecords(run: Run): Promise<{ readonly ref: string; readonly need: string | undefined }> {
  const mm = await run("metamodel.get", {});
  const req = mm.types.filter((t) => t.meaning === "requirement" && !t.abstract).map((t) => t.key);
  const need = mm.types.filter((t) => t.meaning === "need" && !t.abstract).map((t) => t.key);
  const { partial = [] } = await run("element.list", {
    limit: 5000,
    fields: ["type"],
    selection: { where: { type: [...req, ...need] } },
  });
  let ref = "";
  for (const e of partial.filter((x) => req.includes(x.type ?? ""))) {
    const { records } = await run("evidence.list", { ref: e.id });
    if (records.length > 0) {
      ref = e.shortId;
      break;
    }
  }
  return { ref, need: partial.find((x) => need.includes(x.type ?? ""))?.shortId };
}

test("the evidence page shows each criterion with its test cases as ReqSeq lays them out", async ({
  page,
  open,
  ui,
}) => {
  const { ref } = await withRecords(ui.run);
  test.skip(ref === "", "The workspace has no evidence records.");
  const { display } = await ui.run("evidence.list", { ref });
  await open(`/evidence/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Evidence");
  await expect(page.getByRole("navigation", { name: "Pages of this element" })).toBeVisible();
  const rows = page.locator(".erow");
  await expect(rows).toHaveCount(display.rows.length);
  for (const [at, row] of display.rows.entries()) {
    await expect(rows.nth(at).locator(".case")).toHaveCount(row.cases.length);
  }
  // A test case opens to its records.
  const at = display.rows.findIndex((row) => row.cases.length > 0);
  const first = rows.nth(at).locator(".case").first();
  await first.locator("summary").click();
  await expect(first.locator(".recs tbody tr")).toHaveCount(display.rows[at]?.cases[0]?.records.length ?? 0);
});

test("a check recorded on the page is written by ReqSeq and shown", async ({ page, open, ui }) => {
  const { ref, need } = await withRecords(ui.run);
  const target = need ?? ref;
  test.skip(target === "", "The workspace has no need and no requirement with records.");
  const before = (await ui.run("evidence.list", { ref: target })).records.length;
  await open(`/evidence/${target}`);
  const form = page.getByRole("form", { name: "Record a check" });
  if (need === undefined) {
    await form.getByLabel("Item under test").fill("build 9.9.9");
  }
  await form.getByLabel("Test case").fill("review with the team");
  await form.getByRole("button", { name: "Record the check" }).click();
  await expect(page.locator(".notice.ok")).toContainText("Recorded");
  const after = await ui.run("evidence.list", { ref: target });
  expect(after.records.length).toBe(before + 1);
  expect(after.records.some((r) => r.testCase === "review with the team")).toBe(true);
  await expect(page.getByText("review with the team").first()).toBeVisible();
});

test("ReqSeq's refusal of a record is shown on the form", async ({ page, open, ui }) => {
  const { ref } = await withRecords(ui.run);
  test.skip(ref === "", "The workspace has no evidence records.");
  await open(`/evidence/${ref}`);
  const form = page.getByRole("form", { name: "Record a check" });
  // A verification without the item under test is refused by ReqSeq, not by the page.
  await form.getByRole("button", { name: "Record the check" }).click();
  await expect(form.getByRole("alert")).toBeVisible();
});
