// Creating and editing elements: a form for every property kind of a type, relations, links typed into a text,
// images, and typed text that a change of the workspace or leaving the form does not lose. These tests write, so
// they run on a workspace of their own (`ui` below), never the one the other pages' tests read.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { CommandTypes } from "@reqseq/core";
import type { Ui } from "./fixtures.js";
import { expect, test as base } from "./fixtures.js";
import type { Run } from "./start-ui.js";
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

type Metamodel = CommandTypes["metamodel.get"]["output"];
type Property = Metamodel["properties"][number];

/** A one-pixel PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const refOf = (e: { identifier?: string | undefined; shortId: string }): string => e.identifier ?? e.shortId;

/** The first type with the meaning requirement, and the metamodel. */
async function requirementType(run: Run): Promise<{ mm: Metamodel; type: Metamodel["types"][number] }> {
  const mm = await run("metamodel.get", {});
  const type = mm.types.find((t) => t.meaning === "requirement" && !t.abstract);
  if (type === undefined) {
    throw new Error("The workspace has no requirement type");
  }
  return { mm, type };
}

/** The types `keys` allows, with their subtypes. */
const allowed = (mm: Metamodel, keys: readonly string[] | undefined): string[] =>
  mm.types
    .filter(
      (t) =>
        !t.abstract &&
        (keys === undefined || keys.includes(t.key) || t.ancestors.some((a) => keys.includes(a))),
    )
    .map((t) => t.key);

/** An element of one of `types`, other than `not`. */
async function elementOf(run: Run, types: readonly string[], not?: string) {
  const { partial = [] } = await run("element.list", {
    limit: 50,
    fields: ["identifier", "title", "type", "status"],
    selection: { where: { type: [...types] } },
  });
  return partial.find((e) => e.id !== not);
}

/**
 * Picks the element `ref` in the search field `field`. The UI server learns of an element written just before
 * through its watcher, so the search is typed again until the element is found.
 */
async function pick(page: Page, field: ReturnType<Page["locator"]>, ref: string, id: string): Promise<void> {
  const option = page.locator(`[role=option][data-id="${id}"]`).first();
  await expect(async () => {
    await field.fill("");
    await field.fill(ref);
    await expect(option).toBeVisible({ timeout: 2000 });
  }).toPass();
  await option.click();
}

/** The value the test types into a property, and what ReqSeq stores for it. */
interface Typed {
  readonly key: string;
  readonly stored: unknown;
}

/** Fills the field of property `p` in the form, and says what ReqSeq should store. */
async function fill(
  page: Page,
  run: Run,
  mm: Metamodel,
  p: Property,
  self?: string,
): Promise<Typed | undefined> {
  const field = page.locator(`.ed-field[data-key="${p.key}"]`);
  if (p.kind === "relation") {
    const target = await elementOf(run, allowed(mm, p["target-types"]), self);
    if (target === undefined) {
      return undefined;
    }
    await pick(page, field.locator(".pick-input"), refOf(target), target.id);
    await expect(field.locator(`.ed-chip[data-id="${target.id}"]`)).toBeVisible();
    return { key: p.key, stored: target.id };
  }
  if (p.kind === "choice") {
    const choice = p.choices?.[0]?.key ?? "";
    if (p.many === true) {
      await field.locator(`input[value="${choice}"]`).check();
      return { key: p.key, stored: [choice] };
    }
    await field.locator("select").selectOption(choice);
    return { key: p.key, stored: choice };
  }
  const text = p.kind === "number" ? "7" : p.kind === "date" ? "2026-12-01" : `Typed ${p.name}`;
  const stored = p.kind === "number" ? 7 : text;
  if (p.many === true) {
    await field.getByRole("button", { name: /^Add to / }).click();
    await field.locator(".ed-entry .ed-text, .ed-entry .ed-input").first().fill(text);
    return { key: p.key, stored: [stored] };
  }
  await field.locator(".ed-text, .ed-input").first().fill(text);
  return { key: p.key, stored };
}

/** Whether ReqSeq stored `typed` in `properties`. */
function expectStored(mm: Metamodel, properties: Readonly<Record<string, unknown>>, typed: Typed): void {
  const value = properties[typed.key];
  const p = mm.properties.find((x) => x.key === typed.key);
  if (p?.kind === "relation") {
    const ids = (Array.isArray(value) ? value : [value]).map((v) => (v as { id: string }).id);
    expect(ids, typed.key).toContain(typed.stored);
  } else if (p?.meaning === "acceptance-criteria") {
    expect(
      (value as { text: string }[]).map((c) => c.text),
      typed.key,
    ).toEqual(typed.stored);
  } else {
    expect(value, typed.key).toEqual(typed.stored);
  }
}

/** The meanings only an import writes: the form shows them but has no field for them. */
const ORIGIN = ["source", "source-identifier", "import-date", "delivery", "import-version"];

/** Fills a field for each property of `type` the form has one for, and says what ReqSeq should store. */
async function fillAll(
  page: Page,
  run: Run,
  mm: Metamodel,
  type: Metamodel["types"][number],
): Promise<Typed[]> {
  const typed: Typed[] = [];
  const fields = mm.properties.filter(
    (p) =>
      type.properties.includes(p.key) &&
      p.meaning !== "title" &&
      p.meaning !== "identifier" &&
      !ORIGIN.includes(p.meaning ?? ""),
  );
  for (const p of fields) {
    await expect(page.locator(`.ed-field[data-key="${p.key}"]`), p.key).toBeVisible();
    const got = await fill(page, run, mm, p);
    if (got !== undefined) {
      typed.push(got);
    }
  }
  return typed;
}

/** Adds a target to the first relation kind the form offers. */
async function addRelation(
  page: Page,
  run: Run,
  mm: Metamodel,
): Promise<{ kind: string; id: string } | undefined> {
  const field = page.locator(".ed-group .ed-field").first();
  const kind = (await field.count()) === 0 ? null : await field.getAttribute("data-kind");
  const def = mm.relations.find((r) => r.key === kind);
  const target = def === undefined ? undefined : await elementOf(run, allowed(mm, def["target-types"]));
  if (def === undefined || target === undefined) {
    return undefined;
  }
  await pick(page, field.locator(".pick-input"), refOf(target), target.id);
  return { kind: def.key, id: target.id };
}

test("a new requirement gets a value in every property its type has, its relations and the next identifier", async ({
  page,
  open,
  ui,
}) => {
  const { mm, type } = await requirementType(ui.run);
  const identifier = mm.properties.some((p) => p.meaning === "identifier" && type.properties.includes(p.key));
  const expected = identifier
    ? (await ui.run("element.create", { type: type.key, title: "x", nextIdentifier: true, dryRun: true }))
        .element.identifier
    : undefined;
  await open(`/new?type=${type.key}`);
  await expect(page.getByRole("heading", { level: 1, name: "New element" })).toBeVisible();
  await expect(page.locator(".ed-idnext")).toHaveText(expected === undefined ? [] : [`Gets ${expected}`]);
  await page.locator("#f-title").fill("A requirement typed in the form");
  await page.locator("#f-text").fill("What it must do.");
  const typed = await fillAll(page, ui.run, mm, type);
  const relation = await addRelation(page, ui.run, mm);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.locator(".ed-note")).toContainText("Dry run");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator("#card h1")).toHaveText("A requirement typed in the form");
  const { partial = [] } = await ui.run("element.list", {
    fields: ["title", "identifier", "properties", "relations", "status"],
    limit: 5000,
  });
  const made = partial.find((e) => e.title === "A requirement typed in the form");
  expect(made?.identifier).toBe(expected);
  // The status is the one ReqSeq gives a new element; the form sets none.
  expect(made?.status).toBe(mm.statuses.find((s) => s.initial === true)?.key);
  for (const t of typed) {
    expectStored(mm, made?.properties ?? {}, t);
  }
  const out = (made?.relations ?? []).filter((r) => r.direction === "out");
  expect(relation === undefined || out.some((r) => r.kind === relation.kind && r.id === relation.id)).toBe(
    true,
  );
});

/** A requirement to edit, which the test gives back as it was. */
async function withRequirement(run: Run, body: (ref: string, id: string) => Promise<void>): Promise<void> {
  const { type } = await requirementType(run);
  const made = await run("element.create", { type: type.key, title: "To be edited", text: "Old text.\n" });
  await body(refOf(made.element), made.element.id);
}

test("editing saves only what changed, on the file it was opened on, and never the status", async ({
  page,
  open,
  ui,
}) => {
  await withRequirement(ui.run, async (ref, id) => {
    const before = await ui.run("element.get", { ref: id });
    await open(`/e/${ref}`);
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Edit To be edited" })).toBeVisible();
    await expect(page.locator("[data-save]")).toBeDisabled();
    await page.locator("#f-title").fill("Edited in the form");
    await expect(page.locator(".ed-dirty")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#card h1")).toHaveText("Edited in the form");
    const after = await ui.run("element.get", { ref: id });
    expect(after.element.title).toBe("Edited in the form");
    expect(after.element.text).toBe(before.element.text);
    expect(after.element.status).toBe(before.element.status);
  });
});

/** A requirement with a choice, a plain text with a line break (where the type has one) and one relation. */
async function byParts(run: Run) {
  const { mm, type } = await requirementType(run);
  const ofType = mm.properties.filter((p) => type.properties.includes(p.key));
  const choice = ofType.find((p) => p.kind === "choice" && p.many !== true && (p.choices?.length ?? 0) >= 2);
  const plain = ofType.find(
    (p) =>
      p.kind === "text" &&
      p.many !== true &&
      p.markdown !== true &&
      !["title", "identifier", ...ORIGIN].includes(p.meaning ?? ""),
  );
  const options = mm.relations.filter(
    (r) => r.meaning !== "succession" && allowed(mm, r["source-types"]).includes(type.key),
  );
  const kind = options.find((r) => allowed(mm, r["target-types"]).includes(type.key));
  const first = (await run("element.create", { type: type.key, title: "First target" })).element;
  if (choice === undefined || kind === undefined) {
    throw new Error("The requirement type has no choice or relation kind to test");
  }
  const made = await run("element.create", {
    type: type.key,
    title: "Edited by parts",
    properties: {
      [choice.key]: choice.choices?.[0]?.key ?? "",
      ...(plain === undefined ? {} : { [plain.key]: "Line 1\nLine 2" }),
    },
    relations: { [kind.key]: [first.id] },
  });
  const second = (await run("element.create", { type: type.key, title: "Second target" })).element;
  return { made, choice, plain, kind, second };
}

test("editing sends only a changed choice and a swapped relation, and keeps line breaks of a plain text", async ({
  page,
  open,
  ui,
}) => {
  const { made, choice, plain, kind, second } = await byParts(ui.run);
  await open(`/edit/${refOf(made.element)}`);
  await page
    .locator(`.ed-field[data-key="${choice.key}"] select`)
    .selectOption(choice.choices?.[1]?.key ?? "");
  const field = page.locator(`.ed-field[data-kind="${kind.key}"]`);
  await field.getByRole("button", { name: new RegExp(`^Remove `) }).click();
  // Enter in a search field before its hits came neither saves nor leaves.
  const search = field.locator(".pick-input");
  await search.fill(refOf(second));
  await search.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/edit/`));
  await pick(page, search, refOf(second), second.id);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#card h1")).toHaveText("Edited by parts");
  const after = await ui.run("element.get", { ref: made.element.id });
  expect(after.element.properties[choice.key]).toBe(choice.choices?.[1]?.key);
  const related = after.element.relations
    .filter((r) => r.kind === kind.key && r.direction === "out")
    .map((r) => r.id);
  expect(related).toEqual([second.id]);
  if (plain !== undefined) {
    expect(after.element.properties[plain.key]).toBe("Line 1\nLine 2");
  }
});

test("typed text stays when the workspace changes, and a change of the same file elsewhere stops the save", async ({
  page,
  open,
  ui,
}) => {
  await withRequirement(ui.run, async (ref, id) => {
    await open(`/edit/${ref}`);
    const text = page.locator("#f-text");
    await text.fill("Typed and not saved.");
    // Another element changes: the page reads the workspace again, the form keeps the typed text and its focus.
    const { type } = await requirementType(ui.run);
    await ui.run("element.create", { type: type.key, title: "Made elsewhere" });
    await expect(page.locator("#live")).toContainText("The page is up to date.");
    await expect(text).toHaveValue("Typed and not saved.");
    await expect(text).toBeFocused();
    // The element itself changes on disk: saving over it is refused, and nothing typed is lost.
    const now = await ui.run("element.get", { ref: id });
    await ui.run("element.update", {
      ref: id,
      title: "Changed elsewhere",
      expectedFileSha256: now.fileSha256,
    });
    await expect(page.locator(".ed-elsewhere")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".ed-note.bad")).toBeVisible();
    await expect(text).toHaveValue("Typed and not saved.");
    expect((await ui.run("element.get", { ref: id })).element.text).toBe("Old text.\n");
  });
});

test("leaving a form with typed text asks first", async ({ page, open, ui }) => {
  await withRequirement(ui.run, async (ref) => {
    await open(`/edit/${ref}`);
    await page.locator("#f-title").fill("Not saved");
    await page.getByRole("link", { name: "Cancel" }).click();
    const dialog = page.getByRole("dialog", { name: "Leave without saving?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#f-title")).toHaveValue("Not saved");
    expect(page.url()).toContain(`#/edit/${ref}`);
    // The browser's own way back asks too.
    await page.evaluate(() => {
      history.back();
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Leave without saving" }).click();
    await expect(page).not.toHaveURL(new RegExp(`#/edit/`));
    // The history is as it was: the form is still the entry ahead.
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`#/edit/${ref}$`));
    // Opened again, the form shows the element as saved.
    await open(`/edit/${ref}`);
    await expect(page.locator("#f-title")).toHaveValue("To be edited");
  });
});

test("typing [[ in a text links an element, and an added image goes into the text and the workspace", async ({
  page,
  open,
  ui,
}) => {
  await withRequirement(ui.run, async (ref, id) => {
    const { type } = await requirementType(ui.run);
    const other = await elementOf(ui.run, [type.key], id);
    if (other === undefined) {
      throw new Error("No other requirement");
    }
    await open(`/edit/${ref}`);
    const text = page.locator("#f-text");
    const option = page.locator(`[role=option][data-id="${other.id}"]`).first();
    // The UI server learns of an element written just before through its watcher: type again until it is found.
    await expect(async () => {
      await text.fill("See ");
      await text.press("End");
      await text.pressSequentially(`[[${refOf(other)}`);
      await expect(option).toBeVisible({ timeout: 2000 });
    }).toPass();
    await text.press("Enter");
    await expect(text).toHaveValue(new RegExp(`^See \\[.+\\]\\(reqseq:${refOf(other)}\\)$`));
    // An image chosen with the button.
    await page.locator(".ed-md input[type=file]").first().setInputFiles({
      name: "dot.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await expect(text).toHaveValue(/!\[[^\]]*\]\([^)]*dot\.png\)/);
    await expect(page.locator(".ed-note")).toContainText("dot.png");
    const written = /`?([^`\s]+dot\.png)/.exec(
      (await page.locator(".ed-note code").textContent()) ?? "",
    )?.[1];
    expect(written !== undefined && fs.existsSync(path.join(ui.root, written))).toBe(true);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#card")).toBeVisible();
    const saved = await ui.run("element.get", { ref: id });
    expect(saved.element.text).toContain(`(reqseq:`);
    expect(saved.element.text).toContain("dot.png");
  });
});

test("criteria without a key get their keys from the form", async ({ page, open, ui }) => {
  const { mm, type } = await requirementType(ui.run);
  const criteria = mm.properties.find(
    (p) => p.meaning === "acceptance-criteria" && type.properties.includes(p.key),
  );
  test.skip(criteria === undefined, "The requirement type has no acceptance criteria");
  const made = await ui.run("element.create", {
    type: type.key,
    title: "Criteria without keys",
    properties: { [criteria?.key ?? ""]: [{ text: "One" }] },
  });
  // A criterion written by hand, without its key.
  const file = path.join(ui.root, made.files[0] ?? "");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/- key: [a-z0-9]+\n\s+text: One/, "- One"));
  await expect
    .poll(async () =>
      JSON.stringify((await ui.run("element.get", { ref: made.element.id })).element.properties),
    )
    .toContain('"One"');
  await open(`/edit/${refOf(made.element)}`);
  await expect(page.locator(".ed-keys")).toContainText("1 criterion has no criterion key yet");
  await page.getByRole("button", { name: "Give keys" }).click();
  await expect(page.locator(".ed-keys")).toHaveCount(0);
  await expect(page.locator(".ed-key")).toHaveCount(1);
  const after = await ui.run("element.get", { ref: made.element.id });
  expect((after.element.properties[criteria?.key ?? ""] as { key?: string }[])[0]?.key).toMatch(
    /^[a-z][a-z0-9]{3,15}$/,
  );
});
