// The Mermaid text core writes (trace.mermaid, metamodel.mermaid; SR-151 AK3), drawn by Mermaid in Chromium: a graph
// of 50 nodes and 100 edges whose titles hold every character the criterion names, and the metamodel graph of the
// standard model. Mermaid is the build ReqSeq ships with its HTML export (`packages/core/vendor/html-export/mermaid.js`,
// written by `pnpm build`), loaded into an empty page; `mermaid.render` draws each text into an SVG, which must have
// every node, every edge and every title character for character.
import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { CommandTypes } from "@reqseq/core";
import { Workspace, invoke } from "@reqseq/core";
import { createFixtureWorkspace, defaultStandardModelFile } from "@reqseq/testkit";

const MERMAID = path.join(import.meta.dirname, "..", "..", "core", "vendor", "html-export", "mermaid.js");

const PREFIX = "15115115-0000-4000-8000-";
const idOf = (n: number): string => `${PREFIX}${String(n).padStart(12, "0")}`;
const ROOT = idOf(0);
const ROOT_TITLE = "Draw the station";
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
};

interface Texts {
  readonly graph: string;
  readonly metamodel: string;
  readonly types: readonly { readonly name: string; readonly prefix?: string }[];
}

/** The texts core gives for the graph of the root and for the metamodel, and the types of the metamodel. */
const textsOfCore = async (): Promise<Texts> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-004/one-repository",
    files: { ...FILES, "metamodel/standard-model.yaml": await fs.readFile(defaultStandardModelFile, "utf8") },
  });
  const workspace = new Workspace(fixture.root);
  try {
    const graph = (await invoke(
      "trace.mermaid",
      { ref: ROOT, limit: 500 },
      { workspace },
    )) as CommandTypes["trace.mermaid"]["output"];
    const metamodel = (await invoke(
      "metamodel.mermaid",
      {},
      { workspace },
    )) as CommandTypes["metamodel.mermaid"]["output"];
    const get = (await invoke("metamodel.get", {}, { workspace })) as CommandTypes["metamodel.get"]["output"];
    return { graph: graph.mermaid, metamodel: metamodel.mermaid, types: get.types };
  } finally {
    await workspace.close();
    await fixture.cleanup();
  }
};

interface Drawn {
  readonly error?: string;
  readonly nodes: number;
  readonly edges: number;
  /** The text of each node, its lines joined without a separator. */
  readonly nodeTexts: readonly string[];
  /** The text of each edge label. */
  readonly edgeTexts: readonly string[];
}

/** Draws `text` with Mermaid in the page and reads the SVG. */
const draw = (page: Page, id: string, text: string): Promise<Drawn> =>
  page.evaluate(
    async ({ id, text }) => {
      const api = (
        globalThis as unknown as { mermaid: { render(id: string, text: string): Promise<{ svg: string }> } }
      ).mermaid;
      try {
        const { svg } = await api.render(id, text);
        const holder = document.createElement("div");
        holder.innerHTML = svg;
        document.body.append(holder);
        const texts = (selector: string): string[] =>
          [...holder.querySelectorAll(selector)].map((element) => element.textContent);
        return {
          nodes: holder.querySelectorAll("g.node").length,
          edges: holder.querySelectorAll("path.flowchart-link").length,
          nodeTexts: texts("g.node"),
          edgeTexts: texts("g.edgeLabel").filter((label) => label !== ""),
        };
      } catch (error) {
        return { error: String(error), nodes: 0, edges: 0, nodeTexts: [], edgeTexts: [] };
      }
    },
    { id, text },
  );

/** The lines of a label in the text core wrote, as a browser shows them: entities as characters, without `<br/>`. */
const linesOf = (page: Page, label: string): Promise<string> =>
  page.evaluate((written) => {
    const area = document.createElement("textarea");
    area.innerHTML = written.replace(/#(\w+);/gu, "&$1;").replace(/&(\d+);/gu, "&#$1;");
    return area.value.split("<br/>").join("");
  }, label);

test.describe("Mermaid draws the graph text of core (SR-151 AK3)", () => {
  let texts: Texts;
  test.beforeAll(async () => {
    texts = await textsOfCore();
  });

  test.beforeEach(async ({ page }) => {
    await page.setContent("<!doctype html><html><head></head><body></body></html>");
    await page.addScriptTag({ content: await fs.readFile(MERMAID, "utf8") });
    await page.evaluate(() => {
      (globalThis as unknown as { mermaid: { initialize(config: object): void } }).mermaid.initialize({
        startOnLoad: false,
      });
    });
  });

  test("[SR-151/AK-n1xs] draws the graph of 50 nodes and 100 edges with special characters in its titles, with every node, edge and title", async ({
    page,
  }) => {
    const drawn = await draw(page, "graph", texts.graph);
    expect(drawn.error).toBeUndefined();
    expect([drawn.nodes, drawn.edges, drawn.edgeTexts.length]).toEqual([50, 100, 100]);
    for (const title of [ROOT_TITLE, ...Array.from({ length: CHILDREN }, (_, at) => titleOf(at + 1))]) {
      expect(
        drawn.nodeTexts.filter((node) => node.includes(title)),
        title,
      ).toHaveLength(1);
    }
    expect(new Set(drawn.edgeTexts)).toEqual(new Set(["Derives from · outdated"]));
  });

  test("[SR-151/AK-n1xs] draws the metamodel graph of the standard model, with every type, edge and label", async ({
    page,
  }) => {
    const drawn = await draw(page, "metamodel", texts.metamodel);
    expect(drawn.error).toBeUndefined();
    const lines = texts.metamodel.split("\n");
    const nodeLabels = lines.flatMap((line) => /^ {2}\w+\["(.*)"\]$/u.exec(line)?.[1] ?? []);
    const edgeLabels = lines.flatMap((line) => /^ {2}\w+ -->\|"(.*)"\| \w+$/u.exec(line)?.[1] ?? []);
    expect([drawn.nodes, drawn.edges]).toEqual([nodeLabels.length, edgeLabels.length]);
    expect(drawn.nodes).toBe(texts.types.length + 1);
    // Every node and edge label as the text writes it, character for character.
    const shownNodes = await Promise.all(nodeLabels.map((label) => linesOf(page, label)));
    expect([...drawn.nodeTexts].sort()).toEqual([...shownNodes].sort());
    const shownEdges = await Promise.all(edgeLabels.map((label) => linesOf(page, label)));
    expect([...drawn.edgeTexts].sort()).toEqual([...shownEdges].sort());
    for (const type of texts.types) {
      expect(drawn.nodeTexts.some((node) => node.startsWith(`${type.name} (${type.prefix ?? ""})`))).toBe(
        true,
      );
    }
  });
});
