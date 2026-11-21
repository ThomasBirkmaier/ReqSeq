// html.export: the lists, the start page and the package pages (SR-233 AK1, AK3, AK4, AK5), written through `invoke`
// and read back; the list script runs on the written page under happy-dom.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { HTMLElement, HTMLInputElement } from "happy-dom";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { InvokedOutput } from "../../catalog.js";
import { listScript } from "../../html-export/list-script.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";
const ID = "23300000-0000-4000-8000-0000000000";
const DISPLAY = `${ID}d1`;
const EMPTY = `${ID}d2`;
const UNTITLED = `${ID}d3`;
const NEED = `${ID}a1`;
const OLD = `${ID}b9`;

const element = (lines: readonly string[], text = ""): string =>
  ["---", ...lines, "---", "", text, ""].join("\n");

const FILES: Readonly<Record<string, string>> = {
  "requirements/SR-6328cee88fb3.md": element(
    [
      `id: ${WIND}`,
      "type: system-requirement",
      "status: approved",
      "title: Show wind speed",
      "requirement-type: quality",
      "packages:",
      `  - { id: ${DISPLAY}, version: n2:0000000000000000, title: Display }`,
    ],
    "The station shows the current wind speed.\n\n```mermaid\ngraph LR\n  Sensor --> Display\n```",
  ),
  "requirements/SR-0000000000b9.md": element([
    `id: ${OLD}`,
    "type: system-requirement",
    "status: obsolete",
    "title: Show rain",
  ]),
  "packages/PKG-0000000000d1.md": element(
    [`id: ${DISPLAY}`, "type: package", "title: Display"],
    "All the station shows.",
  ),
  "packages/PKG-0000000000d2.md": element([`id: ${EMPTY}`, "type: package", "title: Empty"]),
  "needs/N-0000000000a1.md": element([
    `id: ${NEED}`,
    "type: need",
    "status: approved",
    "title: Know the wind",
    "packages:",
    `  - { id: ${DISPLAY}, version: n2:0000000000000000, title: Display }`,
    `  - { id: ${UNTITLED}, version: n2:0000000000000000 }`,
    `  - { id: ${ID}dd, version: n2:0000000000000000 }`,
  ]),
  // A package without title (a hint), itself in the package Display.
  "packages/PKG-0000000000d3.md": element([
    `id: ${UNTITLED}`,
    "type: package",
    "packages:",
    `  - { id: ${DISPLAY}, version: n2:0000000000000000, title: Display }`,
  ]),
};

/** GUSTS valid only in the variant Coast, so not in the core's view, and in the package Display (#2243). */
const COAST = `${ID}c1`;
const COAST_ONLY: Readonly<Record<string, string>> = {
  "requirements/SR-1d2e3f4a5b6c.md": element([
    `id: ${GUSTS}`,
    "type: system-requirement",
    "status: draft",
    "title: Show gusts",
    "requirement-type: functional",
    "validity:",
    `  - { id: ${COAST}, version: n2:0000000000000000, title: Coast }`,
    "packages:",
    `  - { id: ${DISPLAY}, version: n2:0000000000000000, title: Display }`,
  ]),
  "variants/VAR-0000000000c1.md": element([`id: ${COAST}`, "type: variant", "title: Coast"]),
};

/** Baseline files: an older one, one of the same instant in an earlier file, and the newest over the package Display, which holds the old version of WIND. */
const BASELINES: Readonly<Record<string, string>> = {
  // At the same instant as Release 1, in an earlier file: Release 1 is the newest.
  "baselines/A-same-day.yaml": [
    "reqseq-baseline: 1",
    "name: Same day",
    "date: 2026-11-02T13:00:00Z",
    "repositories:",
    "  - { name: system, commit: abcdef0123456789abcdef0123456789abcdef01 }",
    "elements: []",
    "",
  ].join("\n"),
  "baselines/Old.yaml": [
    "reqseq-baseline: 1",
    "name: Old",
    "date: 2026-10-01T10:00:00Z",
    "repositories:",
    "  - { name: system, commit: abcdef0123456789abcdef0123456789abcdef01 }",
    "elements: []",
    "",
  ].join("\n"),
  // A date that does not parse (a leap second), in the last file: it counts as the earliest.
  "baselines/Z-leap.yaml": [
    "reqseq-baseline: 1",
    "name: Leap",
    "date: 2026-12-31T23:59:60Z",
    "repositories:",
    "  - { name: system, commit: abcdef0123456789abcdef0123456789abcdef01 }",
    "elements: []",
    "",
  ].join("\n"),
  "baselines/Release-1.yaml": [
    "reqseq-baseline: 1",
    "name: Release 1",
    "date: 2026-11-02T13:00:00Z",
    "selection:",
    `  package: { id: ${DISPLAY}, title: Display }`,
    "repositories:",
    "  - { name: system, commit: abcdef0123456789abcdef0123456789abcdef01 }",
    "elements:",
    `  - { id: ${WIND}, version: n2:0000000000000000 }`,
    "",
  ].join("\n"),
};

const open = async (files: Readonly<Record<string, string>> = {}) => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-001/two-elements",
    files: { ...FILES, ...files },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const call = <N extends "html.export" | "hint.list" | "evidence.degree" | "baseline.get">(
  workspace: Workspace,
  name: N,
  input: object,
) => invoke(name, input, { workspace }) as Promise<InvokedOutput<N>>;

/** A window with the `<body>` of the page `file` of the export in `site`, its globals set for the page scripts. */
const browse = async (site: string, file: string) => {
  const html = await fs.readFile(`${site}/${file}`, "utf8");
  const window = new Window();
  window.document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/u.exec(html)?.[1] ?? "";
  vi.stubGlobal("document", window.document);
  return { html, document: window.document, window };
};

const texts = (rows: Iterable<HTMLElement>): string[][] =>
  [...rows].map((row) => [...row.querySelectorAll("td, th")].map((cell) => cell.textContent.trim()));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("html.export lists, start page and package pages (SR-233)", () => {
  it("[SR-233/AK-pmt8] writes a list per type with a row per element and lets it be searched, filtered, sorted and grouped", async () => {
    const { fixture, workspace } = await open();
    await call(workspace, "html.export", { output: "site" });
    const site = fixture.path("site");
    const lists = await fs.readdir(`${site}/lists`);
    // The package type has no list (it has package pages), nor has a type without an element with a page.
    expect(lists.sort()).toEqual(["need.html", "system-requirement.html"]);
    const { hints } = await call(workspace, "hint.list", { limit: 1000 });
    const hintsOf = (id: string): string => String(hints.filter((h) => h.elementId === id).length);
    const { document, window } = await browse(site, "lists/system-requirement.html");
    expect(texts(document.querySelectorAll("thead tr"))).toEqual([
      ["Identifier", "Title", "Status", "Packages", "Verification status in the core", "Open hints"],
    ]);
    // The obsolete element is left out; the rows are by identifier, here the short ID.
    expect(texts(document.querySelectorAll("tbody tr"))).toEqual([
      ["SR-4a5b6c", "Show gusts", "draft", "–", "open", hintsOf(GUSTS)],
      ["SR-e88fb3", "Show wind speed", "approved", "Display", "open", hintsOf(WIND)],
    ]);
    expect(Number(hintsOf(GUSTS))).toBeGreaterThan(0);
    expect(document.querySelector("tbody a")?.getAttribute("href")).toBe(`../elements/${GUSTS}.html`);

    listScript();
    const box = document.querySelector(".rq-list") as unknown as HTMLElement;
    const rows = (): string[] =>
      texts(box.querySelectorAll("tbody tr")).map((cells) => cells.slice(0, 2).join(" "));
    const search = box.querySelector(".rq-search") as unknown as HTMLInputElement;
    // Search by identifier part, by short ID and by title, ignoring case.
    search.value = "WIND";
    search.dispatchEvent(new window.Event("input"));
    expect(rows()).toEqual(["SR-e88fb3 Show wind speed"]);
    search.value = "sr-4A5b";
    search.dispatchEvent(new window.Event("input"));
    expect(rows()).toEqual(["SR-4a5b6c Show gusts"]);
    search.value = "";
    search.dispatchEvent(new window.Event("input"));
    // Filters: status, packages, verification status in the core, and each choice property of the type.
    const chips = [...box.querySelectorAll(".rq-chip:not([data-chip=group]) .rq-chip-values")].map((c) =>
      c.getAttribute("aria-label"),
    );
    expect(chips).toEqual([
      "Status",
      "Packages",
      "Verification status in the core",
      "Requirement Type",
      "Emergent",
      "Verification Method",
    ]);
    // Values in the order of the metamodel, each with its number of rows; "–" for none.
    const values = (chip: number): string[] =>
      texts(box.querySelectorAll(`[data-chip="${String(chip)}"] label`)).flat();
    expect([...box.querySelectorAll('[data-chip="0"] label')].map((l) => l.textContent)).toEqual([
      "draft1",
      "approved1",
    ]);
    expect([...box.querySelectorAll('[data-chip="3"] label')].map((l) => l.textContent)).toEqual([
      "functional1",
      "quality1",
    ]);
    expect(values(0)).toEqual([]);
    const pick = (chip: number, value: string): void => {
      const label = [...box.querySelectorAll(`[data-chip="${String(chip)}"] label`)].find((l) =>
        l.textContent.startsWith(value),
      );
      const input = label?.querySelector("input") as unknown as HTMLInputElement;
      input.checked = !input.checked;
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    };
    pick(1, "Display");
    expect(rows()).toEqual(["SR-e88fb3 Show wind speed"]);
    // Within one filter any value; another filter with no match leaves none.
    pick(1, "–");
    expect(rows()).toEqual(["SR-4a5b6c Show gusts", "SR-e88fb3 Show wind speed"]);
    pick(3, "functional");
    expect(rows()).toEqual(["SR-4a5b6c Show gusts"]);
    (box.querySelector(".rq-clear") as unknown as HTMLElement).click();
    // Sorted by title, descending on the second click.
    (box.querySelector('th button[data-sort="1"]') as unknown as HTMLElement).click();
    (box.querySelector('th button[data-sort="1"]') as unknown as HTMLElement).click();
    expect(rows()).toEqual(["SR-e88fb3 Show wind speed", "SR-4a5b6c Show gusts"]);
    // Grouped by status, in the metamodel's order.
    const group = box.querySelector('[data-group="0"]') as unknown as HTMLInputElement;
    group.checked = true;
    group.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(texts(box.querySelectorAll("tbody tr")).map((cells) => cells[0])).toEqual([
      "Status: draft · 1",
      "SR-4a5b6c",
      "Status: approved · 1",
      "SR-e88fb3",
    ]);
    // The list of needs has no verification status.
    const needs = await browse(site, "lists/need.html");
    expect(texts(needs.document.querySelectorAll("thead tr"))[0]).toEqual([
      "Identifier",
      "Title",
      "Status",
      "Packages",
      "Open hints",
    ]);
  });

  it("[SR-233/AK-pmt8] shows no verification status for a requirement that is not in the core's view, also to filter, sort and group by", async () => {
    const { fixture, workspace } = await open(COAST_ONLY);
    await call(workspace, "html.export", { output: "site" });
    const site = fixture.path("site");
    const { html, document, window } = await browse(site, "lists/system-requirement.html");
    expect(html).not.toContain("not in the core");
    // Column 4 is the verification status in the core: "–" as for any missing value.
    const column = (): string[][] =>
      texts(document.querySelectorAll("tbody tr:not(.rq-group)")).map((cells) => [
        String(cells[0]),
        String(cells[4]),
      ]);
    expect(column()).toEqual([
      ["SR-4a5b6c", "–"],
      ["SR-e88fb3", "open"],
    ]);
    listScript();
    const box = document.querySelector(".rq-list") as unknown as HTMLElement;
    // Filter 2 is the verification status: the requirement counts under "–".
    expect([...box.querySelectorAll('[data-chip="2"] label')].map((l) => l.textContent)).toEqual([
      "open1",
      "–1",
    ]);
    const none = [...box.querySelectorAll('[data-chip="2"] label')]
      .find((l) => l.textContent.startsWith("–"))
      ?.querySelector("input") as unknown as HTMLInputElement;
    none.checked = true;
    none.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(column()).toEqual([["SR-4a5b6c", "–"]]);
    (box.querySelector(".rq-clear") as unknown as HTMLElement).click();
    // Sorted by it, a row without a value stays last in both directions.
    const sort = box.querySelector('th button[data-sort="4"]') as unknown as HTMLElement;
    sort.click();
    expect(column().map(([id]) => id)).toEqual(["SR-e88fb3", "SR-4a5b6c"]);
    sort.click();
    expect(column().map(([id]) => id)).toEqual(["SR-e88fb3", "SR-4a5b6c"]);
    const group = box.querySelector('[data-group="2"]') as unknown as HTMLInputElement;
    group.checked = true;
    group.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(texts(box.querySelectorAll("tbody tr.rq-group")).map((cells) => cells[0])).toEqual([
      "Verification status in the core: open · 1",
      "Verification status in the core: – · 1",
    ]);
    // The start page counts only the core's view, as before.
    const start = await browse(site, "index.html");
    expect(start.document.querySelector("#verification-degree + p")?.textContent).toMatch(
      /^0 of 1 requirement in the core /u,
    );
    expect(
      texts(start.document.querySelectorAll("#not-verified + table tbody tr")).map((cells) => cells[0]),
    ).toEqual(["SR-e88fb3"]);
  });

  it("[SR-233/AK-hqc9] names the workspace, the export, the verification degree, what needs attention, the changes since the newest baseline and each type on the start page", async () => {
    const { fixture, workspace } = await open(BASELINES);
    const output = await call(workspace, "html.export", { output: "site" });
    const site = fixture.path("site");
    const { html, document } = await browse(site, "index.html");
    expect(html).toContain("<title>Weather station | Weather station</title>");
    expect(document.querySelector("h1")?.textContent).toBe("Weather station");
    const made = document.querySelector(".rq-made")?.textContent ?? "";
    expect(made).toMatch(
      /^(?:Commit [0-9a-f]{12}(?:-dirty)?|no commit) · exported \d{4}-\d{2}-\d{2} with ReqSeq \S+$/u,
    );
    expect(document.querySelector(".rq-footer")?.textContent).toBe(made);
    expect(document.querySelector(".rq-incomplete")).toBeNull();
    // The degree as evidence.degree gives it for the whole workspace.
    const { degree } = await call(workspace, "evidence.degree", {});
    expect(degree).toMatchObject({ total: 2, counts: { open: 2 } });
    expect(document.querySelector("#verification-degree + p")?.textContent).toBe(
      "0 of 2 requirements in the core are verified or indirectly verified (0 %).",
    );
    // The number per verification status as badges of the docs, in the order of common.verificationStatus.
    expect(
      [...document.querySelectorAll(".rq-degree .sl-badge")].map((b) => [b.textContent, b.classList[1]]),
    ).toEqual([
      ["open 2", "caution"],
      ["verified 0", "success"],
      ["indirect 0", "note"],
      ["failed 0", "danger"],
      ["outdated 0", "danger"],
    ]);
    const table = (id: string): string[][] => texts(document.querySelectorAll(`#${id} + table tbody tr`));
    expect(table("not-verified")).toEqual([
      ["SR-4a5b6c", "Show gusts", "open"],
      ["SR-e88fb3", "Show wind speed", "open"],
    ]);
    // Every element with a page and open hints, with their number as hint.list gives it.
    const { hints } = await call(workspace, "hint.list", { limit: 1000 });
    const counts = new Map<string, number>();
    for (const hint of hints) {
      counts.set(String(hint.elementId), (counts.get(String(hint.elementId)) ?? 0) + 1);
    }
    const shown = table("open-hints");
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBe([...counts.keys()].filter((id) => id !== OLD).length);
    for (const [identifier, , count] of shown) {
      const link = [...document.querySelectorAll("#open-hints + table a")].find(
        (a) => a.textContent === identifier,
      );
      const id = /elements\/(.+)\.html/u.exec(String(link?.getAttribute("href")))?.[1];
      expect(count).toBe(String(counts.get(String(id))));
    }
    // The newest baseline, counted as baseline.get counts it.
    const release = await call(workspace, "baseline.get", { baseline: "Release 1" });
    expect(release.counts).toMatchObject({ changed: 1, added: 2 });
    expect(document.querySelector("#since-baseline + p")?.textContent).toBe(
      "Since baseline Release 1 of 2026-11-02: 1 changed, 2 added.",
    );
    const newest = String(document.querySelector("#since-baseline + p a")?.getAttribute("href"));
    expect((await browse(site, newest)).document.querySelector("h1")?.textContent).toBe("Baseline Release 1");
    // Each type with its number of elements with a page, linked to its list where it has one.
    expect(table("types")).toEqual([
      ["Need", "1"],
      ["System Requirement", "2"],
      ["Package", "3"],
    ]);
    expect([...document.querySelectorAll("#types + table a")].map((a) => a.getAttribute("href"))).toEqual([
      "lists/need.html",
      "lists/system-requirement.html",
    ]);
    expect(output.problems).toEqual([]);
  });

  it("[SR-233/AK-hqc9] passes on the warnings of baseline.get on the newest baseline", async () => {
    const release = String(BASELINES["baselines/Release-1.yaml"]).replace(
      `package: { id: ${DISPLAY}`,
      `package: { id: ${ID}ff`,
    );
    const { workspace } = await open({ "baselines/Release-1.yaml": release });
    const output = await call(workspace, "html.export", { output: "site" });
    const { problems } = await call(workspace, "baseline.get", { baseline: "Release 1" });
    expect(problems?.map((p) => p.code)).toEqual(["baseline.invalid"]);
    expect(output.problems).toEqual(problems);
  });

  it("[SR-233/AK-hqc9] says that the export is incomplete when a repository is not on this machine", async () => {
    const { fixture, workspace } = await open({
      "reqseq-workspace.yaml": [
        "reqseq-workspace: 1",
        "name: Weather station",
        "repositories:",
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
        '  - { name: sensor, url: "git@git.example.com:ws/sensor.git", path: ../sensor }',
        "metamodel: { repository: system, path: metamodel }",
        "",
      ].join("\n"),
    });
    await call(workspace, "html.export", { output: "site" });
    const { document } = await browse(fixture.path("site"), "index.html");
    expect(document.querySelector(".rq-incomplete")?.textContent).toBe(
      "This export is incomplete: repository sensor is not on this machine, so its elements are missing.",
    );
    expect(document.querySelector("#since-baseline + p")?.textContent).toBe("The workspace has no baseline.");
  });

  it("[SR-233/AK-kh76] names every package in the sidebar of every page, and shows the text and elements of a package on its page", async () => {
    const { fixture, workspace } = await open();
    await call(workspace, "html.export", { output: "site" });
    const site = fixture.path("site");
    for (const [file, up] of [
      ["index.html", ""],
      ["lists/need.html", "../"],
      [`elements/${WIND}.html`, "../"],
    ] as const) {
      const { document } = await browse(site, file);
      const groups = [...document.querySelectorAll("#starlight__sidebar details")].map((group) => ({
        label: group.querySelector("summary")?.textContent,
        links: [...group.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]),
      }));
      expect(groups).toEqual([
        {
          label: "Lists",
          links: [
            ["Need", `${up}lists/need.html`],
            ["System Requirement", `${up}lists/system-requirement.html`],
          ],
        },
        {
          label: "Packages",
          links: [
            ["Display", `${up}elements/${DISPLAY}.html`],
            ["Empty", `${up}elements/${EMPTY}.html`],
            ["PKG-0000d3", `${up}elements/${UNTITLED}.html`],
          ],
        },
      ]);
    }
    const { document } = await browse(site, `elements/${DISPLAY}.html`);
    expect(document.querySelector('#starlight__sidebar a[aria-current="page"]')?.textContent).toBe("Display");
    // The heading names the package by its title once; its elements follow its text.
    expect(document.querySelector("h1")?.textContent).toBe("Display");
    expect(document.querySelector(".rq-text + .rq-package")).not.toBeNull();
    expect(document.querySelector(".rq-package .sl-badge.caution")?.textContent).toBe("open");
    expect(document.querySelector(".rq-text")?.textContent).toBe("All the station shows.");
    expect(texts(document.querySelectorAll(".rq-package tr"))).toEqual([
      ["Identifier", "Title", "Status", "Verification status in the core"],
      ["N-0000a1", "Know the wind", "approved", "–"],
      ["PKG-0000d3", "", "–", "–"],
      ["SR-e88fb3", "Show wind speed", "approved", "open"],
    ]);
    expect(document.querySelector(".rq-package a")?.getAttribute("href")).toBe(`../elements/${NEED}.html`);
    const empty = await browse(site, `elements/${EMPTY}.html`);
    expect(empty.document.querySelector(".rq-package p")?.textContent).toBe("No element names this package.");
    // A page of an element that is no package has no such section.
    expect((await browse(site, `elements/${WIND}.html`)).document.querySelector(".rq-package")).toBeNull();
  });

  it("[SR-233/AK-kh76] shows no verification status on a package page for a requirement that is not in the core's view", async () => {
    const { fixture, workspace } = await open(COAST_ONLY);
    await call(workspace, "html.export", { output: "site" });
    const { html, document } = await browse(fixture.path("site"), `elements/${DISPLAY}.html`);
    expect(html).not.toContain("not in the core");
    expect(texts(document.querySelectorAll(".rq-package tr"))).toEqual([
      ["Identifier", "Title", "Status", "Verification status in the core"],
      ["N-0000a1", "Know the wind", "approved", "–"],
      ["PKG-0000d3", "", "–", "–"],
      ["SR-4a5b6c", "Show gusts", "draft", "–"],
      ["SR-e88fb3", "Show wind speed", "approved", "open"],
    ]);
  });

  it("[SR-233/AK-twk6] writes each list whole as a table, which the script only adds to, and a diagram's source as text", async () => {
    const { fixture, workspace } = await open();
    await call(workspace, "html.export", { output: "site" });
    const site = fixture.path("site");
    const { html } = await browse(site, "lists/system-requirement.html");
    // Without script: every row is in the table, and nothing needs the script to be read.
    expect(html.match(/<tr data-q=/gu)).toHaveLength(2);
    expect(html).not.toContain("rq-search");
    expect(html).toContain('<script src="../assets/list.js"></script>');
    expect(await fs.readFile(`${site}/assets/list.js`, "utf8")).toContain("rq-search");
    // A Mermaid block shows its source until the page script draws it.
    const page = await fs.readFile(`${site}/elements/${WIND}.html`, "utf8");
    expect(page).toMatch(
      /<pre[^>]*data-rq-diagram[^>]*><code[^>]*>graph LR\n {2}Sensor --&gt; Display\n?<\/code><\/pre>/u,
    );
  });
});
