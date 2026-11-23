// The element page: any element with what it points to, what points to it, its text and its criteria, as
// `element.get` and `trace.neighbourhood` give them, its problems, and the verification status of each criterion as
// `evidence.list` gives it.
import { elementProblemGroups } from "@reqseq/core/displays";
import type { Run } from "./start-ui.js";
import { expect, test } from "./fixtures.js";

/** The route name of an element: its identifier, else its short ID. */
const refOf = (e: { identifier?: string; shortId: string }): string => e.identifier ?? e.shortId;

/**
 * A requirement of the core view (the page shows the core) with acceptance criteria and an outgoing relation that is
 * not a property.
 */
async function requirementWithTrace(run: Run): Promise<string> {
  const mm = await run("metamodel.get", {});
  const types = mm.types.filter((t) => t.meaning === "requirement" && !t.abstract).map((t) => t.key);
  const { partial = [] } = await run("element.list", {
    limit: 200,
    fields: ["identifier", "relations", "properties", "type"],
    selection: { where: { type: types } },
  });
  const criteria = mm.properties.find((p) => p.meaning === "acceptance-criteria")?.key ?? "";
  const validity = mm.properties.find((p) => p.meaning === "validity")?.key ?? "";
  const found = partial.find(
    (e) =>
      Array.isArray(e.properties?.[criteria]) &&
      !(Array.isArray(e.properties[validity]) && (e.properties[validity] as unknown[]).length > 0) &&
      (e.relations ?? []).some((r) => r.direction === "out" && r.property !== true),
  );
  if (found === undefined) {
    throw new Error("The workspace has no requirement with criteria and a relation");
  }
  return refOf(found);
}

test("a requirement shows its trace, text and criteria", async ({ page, open, ui }) => {
  const ref = await requirementWithTrace(ui.run);
  const { element } = await ui.run("element.get", { ref });
  const mm = await ui.run("metamodel.get", {});
  await open(`/e/${ref}`);
  await expect(page.getByRole("heading", { level: 1, name: element.title })).toBeVisible();
  // What it points to, by the name of each relation kind.
  const out = element.relations.filter((r) => r.direction === "out" && r.property !== true);
  const left = page.locator(".col-left");
  for (const r of out) {
    await expect(
      left.getByRole("heading", { name: mm.relations.find((k) => k.key === r.kind)?.name ?? r.kind }),
    ).toBeVisible();
    await expect(left.locator(`[data-link="${r.id}"]`)).toHaveCount(1);
  }
  // An outdated link is marked as such.
  for (const r of out.filter((x) => x.outdated === true)) {
    await expect(left.locator(`.node.warn[data-link="${r.id}"]`)).toContainText("changed since linked");
  }
  // As many criteria as ReqSeq has.
  const criteria = mm.properties.find((p) => p.meaning === "acceptance-criteria")?.key ?? "";
  await expect(page.locator(".card .crit")).toHaveCount((element.properties[criteria] as unknown[]).length);
  // The text, rendered as Markdown: its first words show without Markdown syntax.
  const firstWords = (element.text ?? "")
    .replace(/[*_`#>[\]]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
  await expect(page.locator(".card .prose")).toContainText(firstWords);
});

test("following a relation opens the related element, which lists the first one as pointing to it", async ({
  page,
  open,
  ui,
}) => {
  const ref = await requirementWithTrace(ui.run);
  const { element } = await ui.run("element.get", { ref });
  await open(`/e/${ref}`);
  await page.locator(".col-left a.node").first().click();
  await expect(page).not.toHaveURL(new RegExp(`#/e/${ref}$`));
  await expect(page.locator(".col-right")).toContainText(element.identifier ?? element.title);
  await expect(
    page.getByRole("link", { name: `Back to ${element.identifier ?? element.title}` }),
  ).toBeVisible();
});

test("an unknown element says so in plain words", async ({ page, open }) => {
  await open("/e/NO-SUCH-ELEMENT");
  await expect(page.getByRole("alert")).toContainText("There is no element with that ID.");
  await page.getByRole("link", { name: "Back to Overview" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
});

test("element text is Markdown: a reference to another element opens it, and no markup of the text runs", async ({
  page,
  open,
  ui,
}) => {
  const ref = await requirementWithTrace(ui.run);
  const before = await ui.run("element.get", { ref });
  const target = before.element.relations.find((r) => r.direction === "out" && r.property !== true);
  if (target === undefined) {
    throw new Error("The requirement has no relation");
  }
  const text = `**Strong** words, [the parent](reqseq:${target.id}) and <img src=x onerror="document.title='run'">.`;
  await ui.run("element.update", { ref, text, expectedFileSha256: before.fileSha256 });
  try {
    await open(`/e/${ref}`);
    const prose = page.locator(".card .prose");
    await expect(prose.locator("strong")).toHaveText("Strong");
    await expect(prose.locator("img")).toHaveCount(0);
    await prose.getByRole("link", { name: "the parent" }).click();
    await expect(page.locator(`#card[data-id="${target.id}"]`)).toBeVisible();
    expect(await page.title()).not.toBe("run");
  } finally {
    const after = await ui.run("element.get", { ref });
    await ui.run("element.update", {
      ref,
      text: before.element.text ?? "",
      expectedFileSha256: after.fileSha256,
    });
  }
});

test("each acceptance criterion shows its own verification status", async ({ page, open, ui }) => {
  const mm = await ui.run("metamodel.get", {});
  const types = mm.types.filter((t) => t.meaning === "requirement" && !t.abstract).map((t) => t.key);
  const { elements } = await ui.run("evidence.status", { limit: 500, selection: { where: { type: types } } });
  // A requirement of the core with records per criterion: without records `evidence.list` has no row.
  let found: { ref: string; rows: { criterion: number; status: string }[] } | undefined;
  for (const e of elements.filter(
    (x) => x.verification?.some((v) => v.view === "core" && v.criteria !== undefined) === true,
  )) {
    const { display } = await ui.run("evidence.list", { ref: e.id });
    // The page shows the core.
    const rows = display.rows.flatMap((r) =>
      r.kind === "verification" && r.criterion !== undefined
        ? [{ criterion: r.criterion, status: r.views?.find((v) => v.view === "core")?.status ?? r.status }]
        : [],
    );
    if (rows.length > 0) {
      found = { ref: refOf(e), rows };
      break;
    }
  }
  if (found === undefined) {
    throw new Error("The workspace has no requirement with records per criterion");
  }
  const { element } = await ui.run("element.get", { ref: found.ref });
  const key = mm.properties.find((p) => p.meaning === "acceptance-criteria")?.key ?? "";
  const count = (element.properties[key] as unknown[]).length;
  await open(`/e/${found.ref}`);
  // A criterion no record bears on is open.
  for (let n = 1; n <= count; n += 1) {
    const status = found.rows.find((r) => r.criterion === n)?.status ?? "open";
    await expect(page.locator(`.card .crit[data-n="${String(n)}"] .crit-end .st.${status}`)).toHaveCount(1);
  }
});

test("each acceptance criterion copies with its reference, and all of them at once", async ({
  page,
  open,
  ui,
}) => {
  const ref = await requirementWithTrace(ui.run);
  const { element, criterionReferences } = await ui.run("element.get", { ref });
  const mm = await ui.run("metamodel.get", {});
  const key = mm.properties.find((p) => p.meaning === "acceptance-criteria")?.key ?? "";
  const texts = (element.properties[key] as unknown[]).map((item) =>
    typeof item === "string" ? item : String((item as { text: unknown }).text),
  );
  // This requirement has criteria with references, so the copy is shown to carry them.
  expect(criterionReferences?.criteria.some((c) => c.reference !== undefined)).toBe(true);
  // The reference as `element.get` gives it, before the text; a criterion without one as its text.
  const expected = texts.map((text, at) => {
    const reference = criterionReferences?.criteria.find((c) => c.criterion === at + 1)?.reference;
    return reference === undefined ? text : `${reference} ${text}`;
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(`/e/${ref}`);
  const clipboard = (): Promise<string> => page.evaluate(() => navigator.clipboard.readText());
  // With the keyboard: the copy button of the last criterion, then the one for all of them.
  const last = page.getByRole("button", {
    name: `Copy criterion ${String(texts.length)}`,
  });
  await last.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#live")).toHaveText(`Criterion ${String(texts.length)} copied.`);
  await expect(last).toHaveText("Copied");
  expect(await clipboard()).toBe(expected.at(-1));
  await page.getByRole("button", { name: "Copy all criteria" }).press("Enter");
  await expect(page.locator("#live")).toHaveText("All criteria copied.");
  expect(await clipboard()).toBe(expected.join("\n"));
  expect(await clipboard()).toMatch(/^\[[^\]]+\/AK-[^\]]+\] /m);
});

test("the problems of an element stand on its page, several of one kind in one row that opens and stays open", async ({
  page,
  open,
  ui,
}) => {
  const ref = await requirementWithTrace(ui.run);
  const before = await ui.run("element.get", { ref });
  // The page is open before the change and draws it once, from the server's change event. Opened after the change,
  // it could get that event only after the row was opened, and that redraw would close the row again (#2490).
  await open(`/e/${ref}`);
  // Two references outside a link: two warnings of one kind.
  const text = `${before.element.text ?? ""}\n\nSee reqseq:NO-SUCH-ONE and reqseq:NO-SUCH-TWO.`;
  await ui.run("element.update", { ref, text, expectedFileSha256: before.fileSha256 });
  try {
    const { element } = await ui.run("element.get", { ref });
    const groups = elementProblemGroups(element.problems);
    const several = groups.find((g) => g.code === "relation.not-a-link" && g.problems.length > 1);
    if (several === undefined) {
      throw new Error("The element has no two problems of one kind");
    }
    await expect(page.locator("#live")).toContainText("The page is up to date.");
    const rows = page.locator(".card .probs > ul > li");
    // Errors first, one row per kind, as core orders them.
    await expect(rows).toHaveCount(groups.length);
    expect(await rows.evaluateAll((li) => li.map((x) => x.getAttribute("data-severity")))).toEqual(
      groups.map((g) => g.severity),
    );
    const row = page.locator(`.card .probs > ul > li[data-code="${several.code}"]`);
    await expect(row.locator("summary")).toContainText(several.title);
    await expect(row.locator("summary")).toContainText(String(several.problems.length));
    const messages = row.locator("details li");
    await expect(messages.first()).toBeHidden();
    await row.locator("summary").click();
    await expect(messages).toHaveText(several.problems.map((p) => p.message));
    // With the keyboard: closed and opened again.
    await row.locator("summary").press("Enter");
    await expect(messages.first()).toBeHidden();
    await row.locator("summary").press("Enter");
    await expect(messages.first()).toBeVisible();
    // A change of the workspace draws the page again: the opened row stays open, also with one problem more (#2503).
    const current = await ui.run("element.get", { ref });
    await ui.run("element.update", {
      ref,
      text: `${text}\n\nAnd reqseq:NO-SUCH-THREE.`,
      expectedFileSha256: current.fileSha256,
    });
    const more = elementProblemGroups((await ui.run("element.get", { ref })).element.problems).find(
      (g) => g.code === several.code,
    );
    if (more === undefined || more.problems.length <= several.problems.length) {
      throw new Error("The third reference added no problem of the same kind");
    }
    await expect(row.locator("summary")).toContainText(String(more.problems.length));
    await expect(messages).toHaveText(more.problems.map((p) => p.message));
    await expect(messages.last()).toBeVisible();
  } finally {
    const after = await ui.run("element.get", { ref });
    await ui.run("element.update", {
      ref,
      text: before.element.text ?? "",
      expectedFileSha256: after.fileSha256,
    });
  }
});
