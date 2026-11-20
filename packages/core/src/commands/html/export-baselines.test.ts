// html.export: baselines, variants and the change since a baseline (SR-232 AK7, SR-233 AK2, SR-234 AK1–AK4), written
// through `invoke` on fixtures/SR-061/export (Git repositories `system` and `sensor`) and read back; the list script
// runs on the written list under happy-dom. The baseline „Release 2“ of PKG-0000d1 is written at the first commit;
// the second commit moves and changes SR-0000b1 (text, criterion, requirement type, one relation added, the stored
// version of another changed), adds SR-0000b3 to the package and lets it replace SR-0000e1 in
// VAR-0000c2, which excludes SR-0000b2, changes N-0000a1, and adds SR-0000b5, which „Release 2“ lists although no file
// held it then. The fixture's own „Release 1“ stores no selection and names a commit no repository has.
import { readFile } from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import type { HTMLElement, HTMLSelectElement } from "happy-dom";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandName, CommandOutput } from "../../catalog.js";
import * as files from "../../files/index.js";
import { listScript } from "../../html-export/list-script.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

vi.mock("../../files/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof files>();
  return { ...original, readElementText: vi.fn(original.readElementText) };
});

const ID = "61061061-0000-4000-8000-0000000000";
const V = { a1: "n1:9d97d0ccf9b75591", b1: "n1:697a2ad17ed49170", b2: "n1:077d46fbf1a6a93d" };

const edit = async (ws: FixtureWorkspace, file: string, from: string, to: string): Promise<void> => {
  const text = await readFile(ws.path(`system/${file}`), "utf8");
  expect(text).toContain(from);
  await ws.write(`system/${file}`, text.replace(from, to));
};

interface Made {
  readonly ws: FixtureWorkspace;
  readonly first: string;
  readonly sensor: string;
  readonly firstDate: string;
}

/** The fixture with the baselines and changes of the file comment committed. */
const made = async (): Promise<Made> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-061/export", git: ["system", "sensor"] });
  onTestFinished(() => ws.cleanup());
  const first = await ws.head("system");
  const sensor = await ws.head("sensor");
  await ws.write(
    "system/baselines/Release-2.yaml",
    [
      "reqseq-baseline: 1",
      "name: Release 2",
      "date: 2026-11-02T13:00:00Z",
      "selection:",
      `  package: { id: ${ID}d1, title: Display }`,
      "repositories:",
      `  - { name: system, commit: ${first} }`,
      `  - { name: sensor, commit: ${sensor} }`,
      "elements:",
      `  - { id: ${ID}a1, version: ${V.a1} }`,
      `  - { id: ${ID}b1, version: ${V.b1} }`,
      `  - { id: ${ID}b2, version: ${V.b2} }`,
      `  - { id: ${ID}b4, version: n1:1e68aa41d13d05b1 }`,
      `  - { id: ${ID}b5, version: n1:5555555555555555 }`,
      `  - { id: ${ID}e1, version: n1:31d60ac7c791e279, repository: sensor }`,
      "",
    ].join("\n"),
  );
  // Names no commit of sensor, where its only element lies.
  await ws.write(
    "system/baselines/Sensor.yaml",
    [
      "reqseq-baseline: 1",
      "name: Sensor",
      "date: 2026-10-01T08:00:00Z",
      "repositories:",
      `  - { name: system, commit: ${first} }`,
      "elements:",
      `  - { id: ${ID}e1, version: n1:1111111111111111, repository: sensor }`,
      "",
    ].join("\n"),
  );
  const b1 = "requirements/SR-0000000000b1.md";
  await ws.git(["mv", b1, "requirements/SR-b1.md"], "system");
  const moved = "requirements/SR-b1.md";
  await edit(ws, moved, "b1: valid for", "b1: now valid for");
  await edit(ws, moved, "then it shows the speed.", "then it shows the speed in knots.");
  await edit(ws, moved, "requirement-type: functional", "requirement-type: performance");
  await edit(
    ws,
    moved,
    `  - { id: ${ID}a1, version: ${V.a1} }`,
    `  - { id: ${ID}a1, version: n1:0000000000000001 }\n  - { id: ${ID}b3, version: n1:4b17a5494b8e80e5, title: Show the wind direction }`,
  );
  await edit(
    ws,
    "requirements/SR-0000000000b3.md",
    "validity:",
    `packages:\n  - { id: ${ID}d1, version: n1:5862e4d618683af6 }\nreplaces:\n  - { id: ${ID}e1, version: n1:31d60ac7c791e279, repository: sensor }\nvalidity:`,
  );
  await edit(
    ws,
    "variants/VAR-0000000000c2.md",
    "title: Mountain",
    `title: Mountain\nexcludes:\n  - { id: ${ID}b2, version: ${V.b2} }`,
  );
  await edit(ws, "needs/N-0000000000a1.md", "a1: the need", "a1: the changed need");
  await ws.write(
    "system/requirements/SR-0000000000b5.md",
    `---\nid: ${ID}b5\ntype: system-requirement\nstatus: draft\ntitle: Show the pressure\nrequirement-type: functional\n---\n\nb5: new.\n`,
  );
  await ws.commit("system", "change");
  const seconds = Number((await ws.git(["log", "-1", "--format=%ct", first], "system")).trim());
  return { ws, first, sensor, firstDate: new Date(seconds * 1000).toISOString().slice(0, 10) };
};

const call = async <N extends CommandName>(
  ws: FixtureWorkspace,
  name: N,
  input: object,
): Promise<CommandOutput<N>> => {
  const workspace = new Workspace(ws.path("system"));
  try {
    return (await invoke(name, input, { workspace })) as CommandOutput<N>;
  } finally {
    await workspace.close();
  }
};

/** Exports into `site` next to the repositories; the folder written. */
const exported = async (ws: FixtureWorkspace): Promise<string> => {
  const out = await call(ws, "html.export", { output: ws.path("site") });
  expect(out.problems.filter((p) => p.severity === "error")).toEqual([]);
  // A warning several baselines give (the same commit named twice) is given once.
  expect(new Set(out.problems.map((p) => JSON.stringify(p))).size).toBe(out.problems.length);
  return ws.path("site");
};

/** The `<main>` text of a page, its blanks folded. */
const text = (html: string): string =>
  (/<main[^>]*>([\s\S]*)<\/main>/u.exec(html)?.[1] ?? html)
    .replace(/<[^>]+>/gu, " ")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, " ");

const page = async (site: string, file: string): Promise<string> => readFile(`${site}/${file}`, "utf8");

/** A window with the `<body>` of `html`, its globals set for the page scripts. */
const browse = (html: string) => {
  const window = new Window();
  window.document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/u.exec(html)?.[1] ?? "";
  vi.stubGlobal("document", window.document);
  return window;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The path of the page of the baseline in `file` as the page of all baselines links it. */
const baselineHref = (index: string, name: string): string =>
  String(new RegExp(`href="\\.\\./(baselines/[0-9a-f]{12}\\.html)">${name}<`, "u").exec(index)?.[1]);

describe("html.export: change since a baseline on the element page", () => {
  it("[SR-232/AK-dywy] names the change since each baseline with its version, and the field difference where Git has the commit", async () => {
    const { ws, firstDate } = await made();
    const site = await exported(ws);
    const b1Html = await page(site, `elements/${ID}b1.html`);
    const b1 = text(b1Html);
    expect(b1).toContain(`Release 2 of 2026-11-02: changed; version in the baseline ${V.b1} of ${firstDate}`);
    // Each baseline with a difference is collapsible, the newest open; one row per changed field, word by word. The
    // file moved since: its old path holds the old text.
    expect(b1Html).toContain(
      '<details class="rq-since-baseline" open><summary><a href="../baselines/488e33aa4e6d.html">Release 2</a> of 2026-11-02: changed;',
    );
    expect(b1Html).toContain(
      '<dl class="rq-diff"><dt>Text</dt><dd><div class="rq-diff-text">b1: <ins>now </ins>valid for VAR-0000c1',
    );
    expect(b1Html).toMatch(/<details class="rq-since-baseline"><summary><a href="[^"]+">Release 1<\/a>/u);
    // The fixture's metamodel gives the criteria no meaning: they are a property that counts to the version.
    expect(b1Html).toContain(
      '<dt>Acceptance Criteria</dt><dd><div class="rq-diff-text">- Given wind, when the station measures it, then it shows the <del>speed.</del><ins>speed in knots.</ins></div></dd>',
    );
    expect(b1Html).toContain(
      '<dt>Requirement Type</dt><dd><div class="rq-diff-text"><del>functional</del><ins>performance</ins></div></dd>',
    );
    // The relation added is named; the new stored version of N-0000a1 is no difference.
    expect(b1).toContain("Relations added Derives from: SR-0000b3 Show the wind direction");
    expect(b1).not.toContain("Relations removed");
    expect(b1).toContain(
      `Release 1 of 2026-10-23: changed; version in the baseline n1:697a2ad17ed49170 of ${firstDate} The difference is not available: the commit 61aa061aa061 of the baseline is not in the local Git history of repository system.`,
    );
    // Added to the package, and listed by Release 1 in an older version.
    const b3 = text(await page(site, `elements/${ID}b3.html`));
    expect(b3).toContain("Release 2 of 2026-11-02: added; the baseline does not list it");
    expect(b3).toContain("Release 1 of 2026-10-23: changed; version in the baseline n1:1111111111111111");
    // Removed and changed: the difference too; no file held SR-0000b5 at the commit.
    const a1Html = await page(site, `elements/${ID}a1.html`);
    const a1 = text(a1Html);
    expect(a1).toContain("Release 2 of 2026-11-02: removed;");
    expect(a1Html).toContain(
      '<div class="rq-diff-text">a1: the <ins>changed </ins>need every requirement derives from.',
    );
    expect(text(await page(site, `elements/${ID}b5.html`))).toContain(
      "The difference is not available: no file of repository system held the element at the commit",
    );
    const e1 = text(await page(site, `elements/${ID}e1.html`));
    expect(e1).toContain("Release 2 of 2026-11-02: removed; version in the baseline n1:31d60ac7c791e279");
    expect(e1).not.toContain(
      "Release 2 of 2026-11-02: removed; version in the baseline n1:31d60ac7c791e279 of 2026-01-01 The",
    );
    expect(text(await page(site, `elements/${ID}b2.html`))).toContain("Release 2 of 2026-11-02: unchanged;");
    expect(e1).toContain(
      "Sensor of 2026-10-01: changed; version in the baseline n1:1111111111111111 The difference is not available: the baseline names no commit of repository sensor.",
    );
    // A baseline that neither lists nor adds the element: not named.
    expect(text(await page(site, `elements/${ID}d1.html`))).not.toContain("Since baselines");
  });

  it("says the difference is not available when the element file changed since it was read", async () => {
    const { ws } = await made();
    // The first text read is that of the first differing row, before the pages are written.
    vi.mocked(files.readElementText).mockResolvedValueOnce(undefined);
    const site = await exported(ws);
    const pages = await Promise.all(
      [`${ID}a1`, `${ID}b1`].map(async (id) => text(await page(site, `elements/${id}.html`))),
    );
    expect(pages.join(" ")).toMatch(
      /The difference is not available: the file \S+ changed since it was read\./u,
    );
  });
});

describe("html.export: lists compared with a baseline", () => {
  it("[SR-233/AK-p6z2] adds the column and filter of the change since the chosen baseline, none chosen at first", async () => {
    const { ws } = await made();
    const site = await exported(ws);
    const window = browse(await page(site, "lists/system-requirement.html"));
    const document = window.document;
    const head = (): string[] =>
      [...document.querySelectorAll(".rq-list thead th")]
        .filter((th) => !(th as unknown as HTMLElement).hidden)
        .map((th) => th.textContent.trim());
    // Without script the column is there, hidden and empty.
    expect(document.querySelector(".rq-list thead th:last-child")?.textContent).toBe("Change since baseline");
    listScript();
    expect(head()).not.toContain("Change since baseline");
    const select = document.querySelector(".rq-baseline") as unknown as HTMLSelectElement;
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "No baseline",
      "Release 2 (2026-11-02)",
      "Release 1 (2026-10-23)",
      "Sensor (2026-10-01)",
    ]);
    const choose = (value: string): void => {
      select.value = value;
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    };
    const changes = (): Record<string, string> =>
      Object.fromEntries(
        [...document.querySelectorAll(".rq-list tbody tr")].map((tr) => {
          const cells = [...tr.querySelectorAll("td")];
          return [String(cells[0]?.textContent), String(cells[cells.length - 1]?.textContent)];
        }),
      );
    choose("0");
    expect(head()).toContain("Change since baseline");
    // A change event of the search field (as a browser fires it on blur) leaves the baseline chosen.
    document.querySelector(".rq-search")?.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(head()).toContain("Change since baseline");
    expect(changes()).toEqual({
      "SR-0000b1": "changed",
      "SR-0000b2": "unchanged",
      "SR-0000b3": "added",
      "SR-0000b5": "removed",
      "SR-0000e1": "removed",
    });
    const chip = [...document.querySelectorAll("[data-chip]")].find(
      (c) => c.querySelector("summary")?.textContent === "Change since baseline",
    ) as unknown as HTMLElement;
    expect(chip.hidden).toBe(false);
    expect([...chip.querySelectorAll("label")].map((l) => l.textContent)).toEqual([
      "changed1",
      "added1",
      "removed2",
      "unchanged1",
    ]);
    const box = chip.querySelector('[data-value="1"]') as unknown as HTMLElement & { checked: boolean };
    box.checked = true;
    box.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(Object.keys(changes())).toEqual(["SR-0000b3"]);
    // Sorted by the change: the order of its values.
    choose("1");
    expect(changes()["SR-0000b5"]).toBe("not in the baseline");
    (document.querySelector('[data-sort="6"]') as unknown as HTMLElement).click();
    expect(Object.values(changes())).toEqual([
      "changed",
      "changed",
      "not in the baseline",
      "not in the baseline",
      "not in the baseline",
    ]);
    choose("-1");
    expect(head()).not.toContain("Change since baseline");
    expect(chip.hidden).toBe(true);
    expect(Object.keys(changes())).toHaveLength(5);
  });
});

describe("html.export: baseline pages", () => {
  it("[SR-234/AK-vjfq] shows a baseline with its commits and its elements by change, superseded ones without link", async () => {
    const { ws, first, sensor, firstDate } = await made();
    const site = await exported(ws);
    const index = await page(site, "baselines/index.html");
    const release2 = await page(site, baselineHref(index, "Release 2"));
    const shown = text(release2);
    expect(shown).toContain("Name Release 2 Date 2026-11-02T13:00:00Z");
    expect(shown).toContain(`Commits Repository Commit system ${first} sensor ${sensor}`);
    expect(shown).toContain(
      `Changed Identifier Title Status Version in the baseline SR-0000b1 Show the wind speed draft ${V.b1} of ${firstDate}`,
    );
    expect(shown).toContain(
      "Added Identifier Title Status Version in the baseline SR-0000b3 Show the wind direction draft –",
    );
    expect(shown).toContain(
      `Removed Identifier Title Status Version in the baseline N-0000a1 Know the wind draft ${V.a1}`,
    );
    expect(shown).toContain(
      `SR-0000b5 Show the pressure draft n1:5555555555555555 SR-0000e1 Heat the anemometer draft n1:31d60ac7c791e279 of 2026-01-01 Unchanged Identifier Title Status Version in the baseline SR-0000b2 Show the gusts draft ${V.b2}`,
    );
    expect(shown).toContain("Superseded Identifier Title Status SR-0000b4 Show the wind obsolete");
    expect(release2).toContain(`<a href="../elements/${ID}b1.html">SR-0000b1</a>`);
    expect(release2).not.toContain(`elements/${ID}b4.html`);
    expect(shown).not.toContain("stores no selection");
    // Without stored selection: nothing added or removed, and the page says so; an entry no file holds by UUID.
    const release1 = text(await page(site, baselineHref(index, "Release 1")));
    expect(release1).toContain(
      "This baseline stores no selection, so no element counts as added or removed.",
    );
    expect(release1).toContain("Added None. Removed None.");
    expect(release1).toContain(`Not in the workspace UUID Repository Why ${ID}ff no element file holds it`);
  });

  it("[SR-234/AK-swvj] lists every baseline with date, number of elements and of changed ones, newest first", async () => {
    const { ws } = await made();
    const site = await exported(ws);
    const index = text(await page(site, "baselines/index.html"));
    expect(index).toContain(
      "Name Date Elements Changed Release 2 2026-11-02T13:00:00Z 6 1 Release 1 2026-10-23T09:00:00Z 4 3 Sensor 2026-10-01T08:00:00Z 1 1",
    );
    // The sidebar names the page of all baselines and each baseline.
    expect(await page(site, "index.html")).toContain('<a href="baselines/index.html"');
  });
});

describe("html.export: variants", () => {
  it("[SR-234/AK-k5g4] compares the verification degree per variant with the core and lists the requirements whose status differs", async () => {
    const { ws } = await made();
    const site = await exported(ws);
    const comparison = text(await page(site, "variants/index.html"));
    const degree = await call(ws, "evidence.degree", {});
    const coast = await call(ws, "evidence.degree", { selection: { view: "VAR-0000c1" } });
    const share = (d: typeof degree): number => d.degree.counts.verified + d.degree.counts.indirect;
    expect(comparison).toContain(
      `core ${String(share(degree))} of ${String(degree.degree.total)} requirements`,
    );
    expect(comparison).toContain(`VAR-0000c1 ${String(share(coast))} of ${String(coast.degree.total)}`);
    expect(comparison).toContain("VAR-0000c2");
    // A view that does not hold a requirement differs from one that gives it a status (#2140): SR-0000b1 stands in
    // VAR-0000c1 only, SR-0000b3 in VAR-0000c2 only, SR-0000e1 (open wherever it stands) is replaced in VAR-0000c2,
    // and SR-0000b2 is failed in the core, open in VAR-0000c1 and excluded from VAR-0000c2.
    expect(comparison).toContain(
      "Requirements whose verification status differs Identifier Title core VAR-0000c1 VAR-0000c2 " +
        "SR-0000b1 Show the wind speed not in the core outdated not in the variant " +
        "SR-0000b2 Show the gusts failed open not in the variant " +
        "SR-0000b3 Show the wind direction not in the core not in the variant open " +
        "SR-0000e1 Heat the anemometer open open not in the variant Commit",
    );
    // Each status as a badge in the colour of its kind.
    expect(await page(site, "variants/index.html")).toContain('<span class="sl-badge danger small');
    // The sidebar names the comparison and the page of each variant.
    const start = await page(site, "index.html");
    expect(start).toContain('<a href="variants/index.html"');
    expect(start).toContain(`<a href="elements/${ID}c1.html"`);
    expect(start.indexOf(`<a href="elements/${ID}c2.html"`)).toBeGreaterThan(
      start.indexOf(`<a href="elements/${ID}c1.html"`),
    );
  });

  it("[SR-234/AK-gzpr] shows on a variant's page what it adds, replaces and excludes, as variant.diff gives it, and its degree", async () => {
    const { ws } = await made();
    const site = await exported(ws);
    const diff = await call(ws, "variant.diff", { variant: "VAR-0000c2" });
    expect(diff).toMatchObject({ added: [], excluded: [`${ID}b2`] });
    expect(diff.replaced).toEqual([{ core: `${ID}e1`, replacement: `${ID}b3` }]);
    const mountain = text(await page(site, `elements/${ID}c2.html`));
    const degree = await call(ws, "evidence.degree", { selection: { view: "VAR-0000c2" } });
    expect(mountain).toContain(
      `Verification degree ${String(degree.degree.counts.verified + degree.degree.counts.indirect)} of ${String(degree.degree.total)}`,
    );
    expect(mountain).toContain(
      "Compared with the core Adds None. Replaces Core requirement Replacement SR-0000e1 Heat the anemometer SR-0000b3 Show the wind direction Excludes SR-0000b2 Show the gusts",
    );
    const coast = text(await page(site, `elements/${ID}c1.html`));
    expect(coast).toContain("Adds SR-0000b1 Show the wind speed Replaces None. Excludes None.");
  });
});
