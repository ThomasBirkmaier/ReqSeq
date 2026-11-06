// The package page (SR-112, ThomasBirkmaier/ReqSeq-archive#408) on the built app: an opened package shows below its title and text
// the elements that name it (AK1), and they sort, filter and show as a tree like any list (AK2). What the
// page shows is compared with what the CLI gives for the same input (SR-080). Keys use ControlOrMeta,
// so the same tests run on Linux and macOS. The package is opened by Ctrl+P, so the tests do not
// depend on what the window shows at the start. The line under the title (AK3, AK4) runs on
// fixtures/SR-037/degree, whose package P3 holds the requirements of every verification status.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { packageSummaryText } from "@reqseq/core/verification-degree";
import type { RunningApp } from "./support/app.js";
import { DEFAULT_SORT, launchApp, listAll } from "./support/app.js";

const P = "69069069-0000-4000-8000-0000000000";
const NAMES_SENSORS = (title: string, extra = ""): string =>
  `type: system-requirement\nstatus: draft\ntitle: ${title}\nrequirement-type: functional\nacceptance-criteria:\n  - Given it, when it is checked, then it holds.\npackages:\n  - { id: ${P}d1, version: n1:1111111111111111 }\n${extra}`;
/** The filter fixture (package Sensors holds b1 and b2) plus three more elements in it; one derives from b1, so the tree has a second level. */
const FIXTURE = {
  fixture: "SR-069/filter",
  files: {
    "requirements/SR-0000000000b6.md": `---\nid: ${P}b6\n${NAMES_SENSORS("Measure the rain")}---\n`,
    "requirements/SR-0000000000b7.md": `---\nid: ${P}b7\n${NAMES_SENSORS("Measure the hail")}---\n`,
    "requirements/SR-0000000000b8.md": `---\nid: ${P}b8\n${NAMES_SENSORS("Calibrate the rain", `derives-from:\n  - { id: ${P}b1, version: n1:1111111111111111 }\n`)}---\n`,
  },
};

interface Listed {
  readonly elements: readonly { readonly title: string }[];
  readonly tree?: readonly { readonly depth: number }[];
  readonly total: number;
}

/** What the CLI lists for the elements of the package Sensors, with `sort` (the default sort of the app: type, then ID, ThomasBirkmaier/ReqSeq-archive#418). */
const listedBy = async (
  running: RunningApp,
  sort: unknown = DEFAULT_SORT,
  where: unknown = { package: "PKG-0000d1" },
): Promise<Listed> => {
  const input = { selection: { where }, sort };
  const result = await running.cli(["element", "list", "--input", JSON.stringify(input)]);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout) as Listed;
};

const memberTitles = (window: Page): Promise<string[]> =>
  window.locator(".members .row .title").allTextContents();

const memberIndents = (window: Page): Promise<string[]> =>
  window
    .locator(".members .row .title")
    .evaluateAll((titles) => titles.map((e) => (e as HTMLElement).style.paddingLeft));

/** Opens the package Sensors: Ctrl+P, its title, and Enter once the hit is there. */
const openPackage = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type("Sensors");
  await expect(window.locator('.candidates [role="option"]').first()).toContainText("Sensors");
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText("Sensors");
  await expect(window.locator(".members .row").first()).toBeVisible();
};

/** Opens the command prompt, types `command` and runs the first candidate; then types `choice` for the prompt "Sort by". */
const sortBy = async (window: Page, choice: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("sort list");
  await window.keyboard.press("Enter");
  await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("Sort by");
  await window.keyboard.type(choice);
  await window.keyboard.press("Enter");
};

test.describe("the package page on a fixture workspace", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-112/AK1] the package page shows below title and text every element that names the package, as the CLI lists them", async () => {
    const { window } = running;
    await openPackage(window);
    const listed = await listedBy(running);
    expect(listed.total).toBe(5);
    expect(await memberTitles(window)).toEqual(listed.elements.map((element) => element.title));
    // Title, then text, then the elements, from top to bottom.
    const top = async (selector: string): Promise<number> =>
      (await window.locator(selector).first().boundingBox())?.y ?? -1;
    const [title, text, heading, first] = [
      await top("article h1"),
      await top(".cm-editor"),
      await top(".members h2"),
      await top(".members .row"),
    ];
    expect(title).toBeGreaterThanOrEqual(0);
    expect([title, text, heading, first]).toEqual([...[title, text, heading, first]].sort((a, b) => a - b));
    await expect(window.locator(".members h2")).toContainText("5");
  });

  test("Down and Enter open an element of the package, and Ctrl+P Enter comes back to the same row", async () => {
    const { window } = running;
    await openPackage(window);
    const listed = await listedBy(running);
    await window.keyboard.press("ArrowDown");
    await expect(window.locator(".members .list")).toBeFocused();
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(listed.elements[1]?.title ?? "");
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Sensors");
    await expect(window.locator(".members .list")).toBeFocused();
    await expect(window.locator('.members [aria-selected="true"] .title')).toHaveText(
      listed.elements[1]?.title ?? "",
    );
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(listed.elements[2]?.title ?? "");
  });

  test("[SR-112/AK2] the elements of the package sort by title descending, as the CLI sorts them", async () => {
    const { window } = running;
    await openPackage(window);
    await sortBy(window, "title desc");
    const listed = await listedBy(running, [{ by: "title", order: "desc" }]);
    await expect(window.locator(".members h2")).toContainText("sorted by title descending");
    expect(await memberTitles(window)).toEqual(listed.elements.map((element) => element.title));
    expect([...listed.elements.map((element) => element.title)]).toEqual(
      [...listed.elements.map((element) => element.title)].sort().reverse(),
    );
    // The page is still the package: its title and text are there.
    await expect(window.locator("article h1")).toHaveText("Sensors");
  });

  test("[SR-112/AK2] the elements of the package filter step by step as the CLI selects them, and the filters clear again", async () => {
    const { window } = running;
    await openPackage(window);
    const command = async (title: string): Promise<void> => {
      await window.keyboard.press("ControlOrMeta+Shift+P");
      await window.keyboard.type(title);
      await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(title);
      await window.keyboard.press("Enter");
    };
    const answer = async (label: string, text: string): Promise<void> => {
      await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText(label);
      await window.keyboard.type(text);
      await window.keyboard.press("Enter");
    };
    await command("Filter list by text search");
    await answer("Text", "rain");
    const rain = await listedBy(running, DEFAULT_SORT, {
      all: [{ package: "PKG-0000d1" }, { text: "rain" }],
    });
    expect(rain.total).toBeGreaterThan(0);
    expect(rain.total).toBeLessThan(5);
    await expect(window.locator(".members h2")).toContainText(`text: rain ${String(rain.total)}`);
    await expect(window.locator(".members .row .title")).toHaveText(
      rain.elements.map((element) => element.title),
    );
    // A second step narrows the elements further.
    await command("Filter list by text search");
    await answer("Text", "calibrate");
    const both = await listedBy(running, DEFAULT_SORT, {
      all: [{ package: "PKG-0000d1" }, { text: "rain" }, { text: "calibrate" }],
    });
    await expect(window.locator(".members h2")).toContainText("text: rain · text: calibrate");
    await expect(window.locator(".members .row .title")).toHaveText(
      both.elements.map((element) => element.title),
    );
    // Title and text stay the package's.
    await expect(window.locator("article h1")).toHaveText("Sensors");
    await expect(window.locator(".cm-editor")).toBeVisible();
    await command("Clear list filter");
    await expect(window.locator(".members h2")).not.toContainText("calibrate");
    await expect(window.locator(".members .row .title")).toHaveText(
      rain.elements.map((element) => element.title),
    );
    await command("Filter list by text search");
    await answer("Text", "calibrate");
    await expect(window.locator(".members h2")).toContainText("calibrate");
    await command("Clear all list filters");
    await expect(window.locator(".members h2")).not.toContainText("text:");
    await expect(window.locator(".members .row .title")).toHaveText(
      (await listedBy(running)).elements.map((element) => element.title),
    );
  });

  test("[SR-112/AK2] the elements of the package show as the derivation tree, as the CLI gives it", async () => {
    const { window } = running;
    await openPackage(window);
    await sortBy(window, "hierarchy");
    const listed = await listedBy(running, [{ by: "hierarchy", order: "asc" }]);
    await expect(window.locator(".members h2")).toContainText("tree");
    expect(await memberTitles(window)).toEqual(listed.elements.map((element) => element.title));
    const depths = (listed.tree ?? []).map((node) => node.depth);
    expect(Math.max(...depths)).toBe(1);
    expect(await memberIndents(window)).toEqual(depths.map((depth) => `${String(depth * 1.25)}rem`));
  });
});

const D = "37373737-3737-4737-8737-00000000";
/** fixtures/SR-037/degree plus package P4 with ten requirements without records and P5 with only a need (AK4). */
const DEGREE = {
  fixture: "SR-037/degree",
  files: {
    "packages/PKG-00000000d004.md": `---\nid: ${D}d004\ntype: package\nstatus: draft\ntitle: Ten open\n---\n`,
    "packages/PKG-00000000d005.md": `---\nid: ${D}d005\ntype: package\nstatus: draft\ntitle: Only a need\n---\n`,
    "needs/N-00000000a005.md": `---\nid: ${D}a005\ntype: need\nstatus: draft\ntitle: Hear the weather\npackages:\n  - { id: ${D}d005, version: n1:1111111111111111 }\n---\n`,
    ...Object.fromEntries(
      Array.from({ length: 10 }, (_, at) => {
        const id = `${D}b4${String(at).padStart(2, "0")}`;
        return [
          `requirements/SR-00000000b4${String(at).padStart(2, "0")}.md`,
          `---\nid: ${id}\ntype: system-requirement\nstatus: draft\ntitle: Open reading ${String(at + 1)}\nrequirement-type: functional\nacceptance-criteria:\n  - Given it, when it is checked, then it holds.\npackages:\n  - { id: ${D}d004, version: n1:1111111111111111 }\n---\n`,
        ];
      }),
    ),
  },
};

/** Opens a package by its short ID with Ctrl+P, and waits for its elements. */
const openById = async (window: Page, shortId: string, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(shortId);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(window.locator(".members .row").first()).toBeVisible();
};

test.describe("the line under the title of a package page", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(DEGREE);
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
  });
  test.afterEach(async () => {
    await running.close();
  });

  /** The line the CLI's numbers give for the package `ref`, formatted by core's rule. */
  const lineOfCli = async (ref: string): Promise<string | undefined> => {
    const input = JSON.stringify({ selection: { package: ref } });
    const coverage = await running.cli(["evidence", "coverage", "--input", input]);
    const degree = await running.cli(["evidence", "degree", "--input", input]);
    expect([coverage.code, degree.code]).toEqual([0, 0]);
    return packageSummaryText(
      (JSON.parse(coverage.stdout) as { levels: Parameters<typeof packageSummaryText>[0] }).levels,
      (JSON.parse(degree.stdout) as { degree: Parameters<typeof packageSummaryText>[1] }).degree,
    );
  };

  test("[SR-112/AK3] a package page shows „Coverage 8 of 10 with evidence · Degree 60 % (6 verified, 1 failed, 1 outdated, 2 open)“ equal to evidence.coverage and evidence.degree", async () => {
    const { window } = running;
    await openById(window, "PKG-00d003", "AK3");
    const line = "Coverage 8 of 10 with evidence · Degree 60 % (6 verified, 1 failed, 1 outdated, 2 open)";
    await expect(window.locator("article .package-summary")).toHaveText(line);
    expect(await lineOfCli("PKG-00d003")).toBe(line);
    // Under the title, before the text.
    const top = async (selector: string): Promise<number> =>
      (await window.locator(selector).first().boundingBox())?.y ?? -1;
    const [title, summary, text] = [
      await top("article h1"),
      await top(".package-summary"),
      await top(".cm-editor"),
    ];
    expect(title).toBeGreaterThanOrEqual(0);
    expect([title, summary, text]).toEqual([...[title, summary, text]].sort((a, b) => a - b));
  });

  test("a list of requirements shows the line of its own elements, as the CLI counts them (product owner decision, 2026-11-06)", async () => {
    const { window } = running;
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Filter list by text search");
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("Text");
    await window.keyboard.type("Open reading");
    await window.keyboard.press("Enter");
    const input = JSON.stringify({ selection: { where: { text: "Open reading" } } });
    const coverage = await running.cli(["evidence", "coverage", "--input", input]);
    const degree = await running.cli(["evidence", "degree", "--input", input]);
    const line = packageSummaryText(
      (JSON.parse(coverage.stdout) as { levels: Parameters<typeof packageSummaryText>[0] }).levels,
      (JSON.parse(degree.stdout) as { degree: Parameters<typeof packageSummaryText>[1] }).degree,
    );
    expect(line).toMatch(/^Coverage \d+ of \d+ with evidence/);
    await expect(window.locator(".buffer.list .package-summary")).toHaveText(line ?? "");
    // Under the heading, above the rows.
    const top = async (selector: string): Promise<number> =>
      (await window.locator(selector).first().boundingBox())?.y ?? -1;
    const [heading, summary, row] = [
      await top(".buffer.list h1"),
      await top(".buffer.list .package-summary"),
      await top(".buffer.list .row"),
    ];
    expect([heading, summary, row]).toEqual([...[heading, summary, row]].sort((a, b) => a - b));
  });

  test("[SR-112/AK4] 10 requirements without records give the line with zeros; a package without requirements has none", async () => {
    const { window } = running;
    await openById(window, "PKG-00d004", "Ten open");
    const line = "Coverage 0 of 10 with evidence · Degree 0 % (10 open)";
    await expect(window.locator("article .package-summary")).toHaveText(line);
    expect(await lineOfCli("PKG-00d004")).toBe(line);
    await openById(window, "PKG-00d005", "Only a need");
    // The line is there once core answered, and hidden: no requirement is counted.
    await expect(window.locator("article .package-summary")).toBeAttached();
    await expect(window.locator("article .package-summary")).toBeHidden();
    expect(await lineOfCli("PKG-00d005")).toBeUndefined();
  });
  test("[SR-036/AK2] a click on a coverage number lists its requirements, those without coverage included", async () => {
    const { window } = running;
    await openById(window, "PKG-00d004", "Ten open");
    const input = JSON.stringify({ selection: { package: "PKG-00d004" } });
    const cli = await running.cli(["evidence", "coverage", "--input", input, "--json"]);
    const levels = (
      JSON.parse(cli.stdout) as {
        readonly levels: readonly { readonly elements: Readonly<Record<string, readonly string[]>> }[];
      }
    ).levels;
    const without = levels.flatMap((level) => level.elements["withoutEvidence"] ?? []);
    // The ten requirements have no evidence: each is listed under the number of those without.
    expect(without).toHaveLength(10);
    await window.locator("article .package-summary [role=link]").click();
    await expect(window.getByLabel("Modeline")).toContainText("Show evidence coverage");
    const rows = window.locator(".result .line.element");
    await expect(rows).toHaveCount(levels.flatMap((level) => Object.values(level.elements).flat()).length);
    const count = window.locator(".result .line", {
      has: window.locator(".label", { hasText: /^withoutEvidence$/ }),
    });
    await expect(count.locator(".text")).toHaveText(["10"]);
    // A row opens its requirement.
    const first = (await rows.first().locator(".text").textContent()) ?? "";
    await rows.first().click();
    await expect(window.locator("article h1")).toHaveText(first);
  });
});
