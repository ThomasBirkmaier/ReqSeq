// "Copy graph as Mermaid" (SR-151) on the built app: the command line offers it on the graph of an element
// and of the metamodel only (AK5), the clipboard then holds the text core gives for that graph (AK4), and that
// text, pasted into a `mermaid` code block of the editor (SR-096), is drawn without an error, with every node,
// edge and title (AK3). The graph is fixed: a requirement with 49 children, 100 links among them, and titles
// with quotes, brackets, pipes, hashes, semicolons, backticks and angle brackets; the metamodel is the
// standard model. The tests keep the clipboard of the machine they run on.
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const PREFIX = "15115115-0000-4000-8000-";
const idOf = (n: number): string => `${PREFIX}${String(n).padStart(12, "0")}`;
const ROOT = idOf(0);
const ROOT_TITLE = "Draw the station";
const HOLDER_TITLE = "Diagrams of the station";
/** The children of the root, 1 to 49. */
const CHILDREN = 49;
/** A title with every character AK3 names, and its number. */
const titleOf = (n: number): string => `Part ${String(n)} "q" [s] (r) |p| #h; x;y \`b\` <a> & {c}`;

/** Each child derives from the root and the one before it, the third to fifth also from the one two before: 100 links. */
const parentsOf = (n: number): number[] => [
  0,
  ...(n > 1 ? [n - 1] : []),
  ...(n >= 3 && n <= 5 ? [n - 2] : []),
];

const requirement = (n: number, title: string, parents: readonly number[]): string =>
  [
    "---",
    `id: ${idOf(n)}`,
    "type: system-requirement",
    "status: draft",
    `title: '${title}'`,
    ...(parents.length === 0
      ? []
      : [
          "derives-from:",
          ...parents.map((parent) => `  - { id: ${idOf(parent)}, version: n1:1111111111111111 }`),
        ]),
    "---",
    "",
  ].join("\n");

const FILES: Record<string, string> = {
  [`requirements/SR-${idOf(0).slice(-12)}.md`]: requirement(0, ROOT_TITLE, []),
  ...Object.fromEntries(
    Array.from({ length: CHILDREN }, (_, at) => at + 1).map((n) => [
      `requirements/SR-${idOf(n).slice(-12)}.md`,
      requirement(n, titleOf(n), parentsOf(n)),
    ]),
  ),
  "needs/N-151151151151.md": `---\nid: ${PREFIX}151151151151\ntype: need\nstatus: draft\ntitle: ${HOLDER_TITLE}\n---\n\nDiagrams.\n`,
};

const FIXTURE = { fixture: "SR-004/one-repository", files: FILES };
const COPY = "Copy graph as Mermaid";

const modeline = (window: Page): Locator => window.getByLabel("Modeline");
const candidates = (window: Page): Locator => window.locator('.candidates [role="option"]');
const readClipboard = (running: RunningApp): Promise<string> =>
  running.app.evaluate(({ clipboard }) => clipboard.readText());
const writeClipboard = (running: RunningApp, text: string): Promise<void> =>
  running.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);

/** Opens the element titled `title` with "Go to". */
const openElement = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(candidates(window).first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
};

/**
 * The command prompt finds nothing for `typed`: the list, open with every command before the text, closes for it,
 * so the check reads the result for the whole text.
 */
const findsNothing = async (window: Page, typed: string): Promise<void> => {
  const input = window.locator("#prompt-input");
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await window.keyboard.type(typed);
  await expect(input).toHaveValue(typed);
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(candidates(window)).toHaveCount(0);
  await window.keyboard.press("Escape");
};

/** Runs `name` from the command prompt. */
const fromCommandLine = async (window: Page, name: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(name);
  await expect(candidates(window).first().locator(".name")).toHaveText(name);
  await window.keyboard.press("Enter");
};

/**
 * Copies the shown graph and gives the clipboard once the copy arrived. The clipboard is emptied first, because the
 * modeline may still confirm an earlier copy.
 */
const copyGraph = async (running: RunningApp): Promise<string> => {
  await writeClipboard(running, "");
  await fromCommandLine(running.window, COPY);
  await expect(modeline(running.window)).toContainText("Copied graph as Mermaid");
  await expect.poll(() => readClipboard(running)).not.toBe("");
  return readClipboard(running);
};

/** The graph of the root, as the app shows it after Ctrl/Cmd+Shift+G. */
const showGraph = async (window: Page): Promise<void> => {
  await openElement(window, ROOT_TITLE);
  await window.keyboard.press("ControlOrMeta+Shift+G");
  await expect(window.locator(".graph")).toHaveAttribute("data-laid-out", /[1-9]/u);
};

/** The `mermaid` field of a CLI call on the app's workspace. */
const coreText = async (running: RunningApp, argv: readonly string[]): Promise<string> => {
  const got = await running.cli(argv);
  return (JSON.parse(got.stdout) as { mermaid: string }).mermaid;
};

/** What a drawing shows: its nodes' and edge labels' text and how many nodes, edges and edge labels. */
interface Drawn {
  readonly nodes: number;
  readonly edges: number;
  readonly labels: number;
  readonly text: string;
}

const drawn = async (window: Page, image: Locator): Promise<Drawn> => {
  const source = (await image.getAttribute("src")) ?? "";
  const svg = decodeURIComponent(source.slice(source.indexOf(",") + 1));
  return window.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    return {
      nodes: doc.querySelectorAll("g.node").length,
      edges: doc.querySelectorAll("path.flowchart-link").length,
      labels: doc.querySelectorAll("g.edgeLabel").length,
      text: [...doc.querySelectorAll("g.node, g.edgeLabel")].map((each) => each.textContent).join(" "),
    };
  }, svg);
};

/** Text without white space: Mermaid wraps a long label at spaces. */
const bare = (text: string): string => text.replace(/\s+/gu, "");

test.describe("Copy graph as Mermaid", () => {
  let running: RunningApp;
  let before: string;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    before = await readClipboard(running);
    await running.window.locator('[aria-label="Sheet"] > *').first().waitFor();
  });
  test.afterEach(async () => {
    await writeClipboard(running, before);
    await running.close();
  });

  test("[SR-151/AK-s3cv] [SR-151/AK-c801] the command line offers it on the two graphs only, and the clipboard holds the text core gives for the shown graph", async () => {
    const { window } = running;
    await openElement(window, ROOT_TITLE);
    await findsNothing(window, COPY);
    await window.keyboard.press("ControlOrMeta+Shift+G");
    await expect(window.locator(".graph")).toHaveAttribute("data-laid-out", /[1-9]/u);
    // One level more: the text follows the graph's depth.
    await window.locator(".graph").press("+");
    await expect(modeline(window)).toContainText("2 levels");
    expect(await copyGraph(running)).toBe(
      await coreText(running, ["trace", "mermaid", ROOT, "--max-depth", "2", "--limit", "500"]),
    );
    await fromCommandLine(window, "Show metamodel");
    await expect(window.locator(".metamodel")).toHaveAttribute("data-laid-out", /[1-9]/u);
    expect(await copyGraph(running)).toBe(await coreText(running, ["metamodel", "mermaid"]));
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator(".metamodel-text")).toBeVisible();
    await findsNothing(window, COPY);
  });

  test("[SR-151/AK-n1xs] the text of a graph of 50 nodes and 100 edges with special characters, and of the standard model, is drawn in the editor with every node, edge and title", async () => {
    const { window } = running;
    await showGraph(window);
    const graph = await copyGraph(running);
    await fromCommandLine(window, "Show metamodel");
    await expect(window.locator(".metamodel")).toHaveAttribute("data-laid-out", /[1-9]/u);
    const metamodel = await copyGraph(running);

    await openElement(window, HOLDER_TITLE);
    await window.keyboard.press("Enter");
    const content = window.locator(".cm-content");
    await expect(content).toBeFocused();
    await window.keyboard.press("ControlOrMeta+a");
    await window.keyboard.press("Backspace");
    for (const [at, text] of [graph, metamodel].entries()) {
      await window.keyboard.type(`${at === 0 ? "" : "\n"}\`\`\`mermaid\n`);
      await writeClipboard(running, text);
      await window.keyboard.press("ControlOrMeta+V");
      await window.keyboard.type("```\n");
    }
    await window.keyboard.press("Escape");

    const images = content.locator("img.cm-lr-diagram");
    await expect(images).toHaveCount(2);
    await expect(content.locator("div.cm-lr-render-error")).toHaveCount(0);
    const [ofGraph, ofMetamodel] = [await drawn(window, images.nth(0)), await drawn(window, images.nth(1))];
    expect([ofGraph.nodes, ofGraph.edges, ofGraph.labels]).toEqual([50, 100, 100]);
    for (const n of Array.from({ length: CHILDREN }, (_, at) => at + 1)) {
      expect(bare(ofGraph.text)).toContain(bare(titleOf(n)));
    }
    expect(bare(ofGraph.text)).toContain(bare(ROOT_TITLE));
    // The standard model: every type with its prefix, and every edge of the text.
    const types = (await running.cli(["metamodel", "get"])).stdout;
    const parsed = JSON.parse(types) as { types: { name: string; prefix: string }[] };
    const edges = metamodel.split("\n").filter((line) => line.includes("-->")).length;
    expect([ofMetamodel.nodes, ofMetamodel.edges]).toEqual([parsed.types.length + 1, edges]);
    for (const type of parsed.types) {
      expect(bare(ofMetamodel.text)).toContain(bare(`${type.name} (${type.prefix})`));
    }
    const folder = process.env["REQSEQ_SCREENSHOTS"] ?? path.join("test-results", "electron", "screenshots");
    // The drawing of 50 nodes is too wide to read at window size; the standard model shows how a drawing looks.
    await images.nth(1).scrollIntoViewIfNeeded();
    await window.screenshot({ path: path.join(folder, "graph-mermaid-light.png") });
  });
});
