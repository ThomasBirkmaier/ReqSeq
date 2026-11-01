// The counts of the modeline (SR-114) on the built app, compared with what the CLI gives (SR-080): an
// element's outdated references and open hints as `element get` gives them (AK2), and the kind and
// number of the elements of a list, a graph and a package page (AK3). Keys use ControlOrMeta, so the
// same tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { DEFAULT_SORT, launchApp, listAll } from "./support/app.js";
import { REFERENCE_FILES, REFERENCE_SOURCE_ID, REFERENCE_SOURCE_TITLE } from "./support/demo.js";

/** 14 elements (fixtures/README.md) and a need with an outdated inline reference. */
const FIXTURE = { fixture: "SR-069/filter", files: REFERENCE_FILES };

/** The parts of the modeline for the shown buffer, left of the workspace. */
const parts = (window: Page) => window.locator('[aria-label="Modeline"] .parts > .segment');

const cliJson = async <T>(running: RunningApp, argv: string[]): Promise<T> => {
  const result = await running.cli(argv);
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
};

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/** Opens the element titled `title` with Ctrl/Cmd+P. */
const goTo = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
};

test.describe("the counts of the modeline", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await running.window.locator('[aria-label="Sheet"] > *').first().waitFor();
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-114/AK2] the modeline names the outdated references and the open hints of an element as element get counts them, and nothing for an element without", async () => {
    const { window } = running;
    // An element with outdated relations and another hint, one with an outdated inline reference, one without.
    for (const [ref, title] of [
      ["SR-0000b4", "Show a dial"],
      [REFERENCE_SOURCE_ID, REFERENCE_SOURCE_TITLE],
      ["N-0000a1", "See the wind"],
    ] as const) {
      const got = await cliJson<{ element: { problems?: { code: string }[] } }>(running, [
        "element",
        "get",
        ref,
      ]);
      const problems = got.element.problems ?? [];
      const outdated = problems.filter((problem) => problem.code === "relation.outdated").length;
      const hints = problems.length - outdated;
      await goTo(window, title);
      const counts = [
        ...(outdated > 0 ? [`${String(outdated)} outdated`] : []),
        ...(hints > 0 ? [plural(hints, "hint")] : []),
      ];
      // The first part is ID, type and status (SR-114 AK1); the counts follow, and only those.
      await expect(parts(window)).toHaveText([/ · /, ...counts]);
    }
    // The fixture has each case once: outdated and other hints, an outdated inline reference only, none.
    await goTo(window, "Show a dial");
    await expect(parts(window).nth(1)).toHaveText("1 outdated");
    // Its other hint and its missing parent (SR-022 AK6).
    await expect(parts(window).nth(2)).toHaveText("2 hints");
    await goTo(window, REFERENCE_SOURCE_TITLE);
    await expect(parts(window)).toHaveCount(2);
    await expect(parts(window).nth(1)).toHaveText("1 outdated");
  });

  test("[SR-114/AK3] the modeline names kind and count of a list, a graph and a package page as the CLI gives them", async () => {
    const { window } = running;
    // The list of all elements: its name and the total of `element list`.
    await listAll(window);
    const listed = await cliJson<{ total: number }>(running, [
      "element",
      "list",
      "--input",
      JSON.stringify({ sort: DEFAULT_SORT }),
    ]);
    await expect(parts(window)).toHaveText(["All elements", plural(listed.total, "element")]);
    // The graph of an element: its name, the depth and the nodes of `trace graph`.
    await goTo(window, "Measure wind speed");
    const element = (await window.locator("article").getAttribute("aria-label")) ?? "";
    await window.keyboard.press("ControlOrMeta+Shift+G");
    await expect(window.locator(".graph")).toBeFocused();
    const graph = await cliJson<{ nodes: unknown[] }>(running, [
      "trace",
      "graph",
      "--input",
      JSON.stringify({ ref: "SR-0000b1", maxDepth: 1, limit: 500 }),
    ]);
    await expect(parts(window)).toHaveText([
      `Graph: ${element}`,
      "1 level",
      plural(graph.nodes.length, "node"),
    ]);
    // The package page: its type by the metamodel's name is the kind, its elements as `element list`
    // with `where.package` counts them.
    await goTo(window, "Sensors");
    await expect(window.locator(".members .row").first()).toBeVisible();
    const members = await cliJson<{ total: number }>(running, [
      "element",
      "list",
      "--input",
      JSON.stringify({ selection: { where: { package: "PKG-0000d1" } } }),
    ]);
    const model = await cliJson<{ types: { key: string; name: string }[] }>(running, ["metamodel", "get"]);
    const got = await cliJson<{ element: { type: string; status?: string } }>(running, [
      "element",
      "get",
      "PKG-0000d1",
    ]);
    const typeName = model.types.find((type) => type.key === got.element.type)?.name ?? "";
    expect(typeName).toBe("Package");
    await expect(parts(window)).toHaveText([
      ["PKG-0000d1", typeName, ...(got.element.status === undefined ? [] : [got.element.status])].join(" · "),
      plural(members.total, "element"),
    ]);
  });
});
