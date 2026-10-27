// The neighbourhood of an element (SR-107, #403) on the built app, on fixtures/SR-107/neighbourhood: the
// parents above the title (AK1), the children as a tree that opens level by level and the incoming links
// by kind (AK2), a child under every parent (AK3), outdated links (AK4), and the requirements of a need
// by Ctrl+P, its ID, Enter and Ctrl+J (SR-119 AK2). What the window shows is compared with what the CLI
// gives for the same input (SR-080). Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const P = "5e107a7d-2b4f-4c61-9d08-";
const ID = {
  N1: `${P}0a0000000001`,
  S1: `${P}0b0000000001`,
  S2: `${P}0b0000000002`,
  C1: `${P}0c0000000001`,
  D1: `${P}0d0000000001`,
  D2: `${P}0d0000000002`,
} as const;
/** The short IDs the rows show. */
const SHORT = {
  N1: "N-a0000000001",
  S1: "SR-b0000000001",
  D1: "D-d0000000001",
  D2: "D-d0000000002",
  C1: "CR-c0000000001",
} as const;

/** The text of the two decisions changed, so that S1's `based-on` D1 and E's reference to D2 are outdated (SR-025). */
const CHANGED = {
  "decisions/D-0d0000000001.md": `---\nid: ${ID.D1}\ntype: decision\nstatus: approved\ntitle: Use a cup anemometer\n---\n\nA cup anemometer with three cups measures the wind speed.\n`,
  "decisions/D-0d0000000002.md": `---\nid: ${ID.D2}\ntype: decision\nstatus: approved\ntitle: Show values in SI units\n---\n\nSpeeds are shown in metres per second, temperatures in degrees Celsius.\n`,
};

interface Neighbourhood {
  readonly nodes: readonly { readonly id: string; readonly shortId: string; readonly title: string }[];
  readonly edges: readonly {
    readonly source: string;
    readonly target: string;
    readonly kind?: string;
    readonly repeated: boolean;
    readonly outdated: boolean;
  }[];
}

/** What the CLI gives for `trace neighbourhood`. */
const traced = async (running: RunningApp, input: Record<string, unknown>): Promise<Neighbourhood> => {
  const result = await running.cli(["trace", "neighbourhood", "--input", JSON.stringify(input)]);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout) as Neighbourhood;
};

const titleOf = (output: Neighbourhood, id: string): string =>
  output.nodes.find((node) => node.id === id)?.title ?? "";

/** Opens an element: Ctrl+P, its short ID, Enter once its title is there. */
const openElement = async (window: Page, shortId: string, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(shortId);
  // Enter races `element.search` when it comes before the hit (#460).
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  // The next key goes to the element that is shown, not to the buffer behind the prompt.
  await expect(window.locator("article h1")).toHaveText(title);
};

/** Ctrl+J on the shown element; the next key goes to the neighbourhood once it has the focus and its tree. */
const showNeighbourhood = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+J");
  await expect(window.locator(".neighbourhood")).toBeFocused();
  await expect(window.locator('[role="tree"]')).toHaveCount(1);
};

/** The title and the words after it of the rows of the tree, without the arrow before the title. */
const treeRows = async (window: Page): Promise<string[]> =>
  (await window.locator('[role="tree"] [role="treeitem"] .title').allTextContents()).map((text) =>
    text.replace(/^[▸▾]/, ""),
  );

const groupRows = (window: Page, heading: string): Promise<string[]> =>
  window.locator(`[role="listbox"][aria-label="${heading}"] .row .title`).allTextContents();

test.describe("the neighbourhood of an element on a fixture workspace", () => {
  let running: RunningApp;
  const launch = async (files?: Record<string, string>): Promise<RunningApp> => {
    running = await launchApp({ fixture: "SR-107/neighbourhood", ...(files === undefined ? {} : { files }) });
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
    return running;
  };
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-107/AK1] the parents of C1 stand above its title up to the needs, and a click opens one", async () => {
    const { window } = await launch();
    await openElement(window, SHORT.C1, "Count anemometer turns");
    const up = await traced(running, {
      ref: ID.C1,
      direction: "up",
      meanings: ["derivation"],
      allLevels: true,
    });
    // The top needs first, then the requirements C1 derives from: the levels of the CLI's answer.
    const expected = [
      [ID.N1, `${P}0a0000000002`].map((id) => titleOf(up, id)).join(" · "),
      [ID.S1, ID.S2].map((id) => titleOf(up, id)).join(" · "),
    ].join(" › ");
    await expect(window.locator(".parents")).toHaveText(expected);
    expect(expected).toContain("See the wind");
    const line = await window.locator(".parents").boundingBox();
    const title = await window.locator("article h1").boundingBox();
    expect((line?.y ?? 0) + (line?.height ?? 0)).toBeLessThanOrEqual(title?.y ?? 0);
    await window.locator('.parents [role="link"]', { hasText: "See the wind" }).click();
    await expect(window.locator("article h1")).toHaveText("See the wind");
    await expect(window.locator(".parents")).toHaveCount(0);
  });

  test("[SR-107/AK2] Ctrl+J shows the children of N1 as a tree that opens level by level, and S1's incoming links by kind", async () => {
    const { window } = await launch();
    await openElement(window, SHORT.N1, "See the wind");
    await showNeighbourhood(window);
    const asked = (maxDepth: number) =>
      traced(running, { ref: ID.N1, direction: "down", meanings: ["derivation"], maxDepth });
    const first = await asked(1);
    const level1 = first.edges.map((edge) => titleOf(first, edge.source));
    await expect(window.locator(".neighbourhood h1")).toContainText("See the wind");
    expect(await treeRows(window)).toEqual(level1);
    expect(level1).toEqual(["Show wind speed", "Show wind direction"]);
    // Right opens the first row: its child comes one level in.
    await window.keyboard.press("ArrowRight");
    const second = await asked(2);
    const underS1 = second.edges
      .filter((edge) => edge.target === ID.S1)
      .map((e) => titleOf(second, e.source));
    await expect(window.locator('[role="treeitem"][aria-level="2"]')).toHaveCount(underS1.length);
    expect(await treeRows(window)).toEqual(["Show wind speed", ...underS1, "Show wind direction"]);
    // Left closes it again.
    await window.keyboard.press("ArrowLeft");
    expect(await treeRows(window)).toEqual(level1);
    // Back to the element with the same key, and S1's neighbourhood: its incoming links by kind.
    await window.keyboard.press("ControlOrMeta+J");
    await expect(window.locator("article h1")).toHaveText("See the wind");
    await openElement(window, SHORT.S1, "Show wind speed");
    await window.keyboard.press("ControlOrMeta+J");
    const incoming = await traced(running, { ref: ID.S1, direction: "down" });
    const sources = (kind: string | undefined) =>
      incoming.edges.filter((edge) => edge.kind === kind).map((edge) => titleOf(incoming, edge.source));
    await expect(window.locator("h2")).toHaveText(["Children", "← excludes", "← inline reference"]);
    expect(await groupRows(window, "← excludes")).toEqual(sources("excludes"));
    expect(await groupRows(window, "← inline reference")).toEqual(sources(undefined));
    expect(sources("excludes")).toEqual(["Indoor display"]);
    expect(await treeRows(window)).toEqual(sources("derives-from"));
  });

  test("[SR-107/AK3] C1 appears under S1 and under S2 of N1, the second time marked repeated", async () => {
    const { window } = await launch();
    await openElement(window, SHORT.N1, "See the wind");
    await showNeighbourhood(window);
    await expect(window.locator('[role="treeitem"]')).toHaveCount(2);
    await window.keyboard.press("ArrowRight");
    // The next level comes with a second answer: wait for its row before moving on.
    await expect(window.locator('[role="treeitem"][aria-level="2"]')).toHaveCount(1);
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("ArrowRight");
    await expect(window.locator('[role="treeitem"][aria-level="2"]')).toHaveCount(2);
    const two = await traced(running, {
      ref: ID.N1,
      direction: "down",
      meanings: ["derivation"],
      maxDepth: 2,
    });
    const c1 = two.edges.filter((edge) => edge.source === ID.C1);
    expect(c1.map((edge) => [edge.target, edge.repeated])).toEqual([
      [ID.S1, false],
      [ID.S2, true],
    ]);
    expect(await treeRows(window)).toEqual([
      "Show wind speed",
      "Count anemometer turns",
      "Show wind direction",
      "Count anemometer turns repeated",
    ]);
    await expect(window.locator("[role=treeitem] .repeated")).toHaveCount(1);
  });

  test("[SR-107/AK4] S1's based-on to D1 and E's reference to D2 are marked outdated", async () => {
    const { window } = await launch(CHANGED);
    // D1's neighbourhood shows S1 under "← based-on", outdated.
    const d1 = await traced(running, { ref: ID.D1, direction: "down" });
    expect(d1.edges.map((edge) => [edge.kind, edge.outdated])).toEqual([["based-on", true]]);
    await openElement(window, SHORT.D1, "Use a cup anemometer");
    await window.keyboard.press("ControlOrMeta+J");
    await expect(window.locator("h2")).toHaveText(["Children", "← based-on"]);
    await expect(window.locator('[role="listbox"][aria-label="← based-on"] .row')).toContainText("outdated");
    await expect(window.locator('[role="listbox"][aria-label="← based-on"] .outdated')).toHaveCount(1);
    // D2's neighbourhood shows E under "← inline reference", outdated.
    await window.keyboard.press("ControlOrMeta+J");
    await openElement(window, SHORT.D2, "Show values in SI units");
    await window.keyboard.press("ControlOrMeta+J");
    const d2 = await traced(running, { ref: ID.D2, direction: "down" });
    expect(d2.edges.map((edge) => [edge.kind, edge.outdated])).toEqual([[undefined, true]]);
    await expect(window.locator("h2")).toHaveText(["Children", "← inline reference"]);
    await expect(
      window.locator('[role="listbox"][aria-label="← inline reference"] .row .outdated'),
    ).toHaveCount(1);
  });

  test("[SR-119/AK2] Ctrl+P, N1's short ID, Enter and Ctrl+J show its requirements", async () => {
    const { window } = await launch();
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type(SHORT.N1);
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("See the wind");
    await window.keyboard.press("Enter");
    // The AK counts key presses, not waiting: the shortcut goes to the need once it is shown.
    await expect(window.locator("article h1")).toHaveText("See the wind");
    await window.keyboard.press("ControlOrMeta+J");
    const children = await traced(running, {
      ref: ID.N1,
      direction: "down",
      meanings: ["derivation"],
    });
    const requirements = children.edges.map((edge) => titleOf(children, edge.source));
    expect(requirements).toHaveLength(2);
    await expect(window.locator('[role="tree"] [role="treeitem"]')).toHaveCount(requirements.length);
    expect(await treeRows(window)).toEqual(requirements);
    // No row is selected yet (SR-122): the first Down selects the first requirement.
    await expect(window.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(0);
    await window.keyboard.press("ArrowDown");
    await expect(window.locator('[role="treeitem"][aria-selected="true"] .title')).toHaveText(
      `▸${requirements[0] ?? ""}`,
    );
  });
});
