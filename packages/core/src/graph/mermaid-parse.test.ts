// The text of trace.mermaid and metamodel.mermaid read by Mermaid itself (SR-151 AK3): a graph of 50 nodes and
// 100 edges whose titles hold every character the criterion names, and the metamodel graph of the standard
// model, each parsed by the Mermaid release core's HTML export ships (devDependency `mermaid`) into its
// flowchart model, without an error, with every node, edge and title character for character. Drawing needs a
// browser's layout and is not done. Mermaid needs a window, which happy-dom gives. Mermaid runs DOMPurify on
// each label, which on happy-dom's DOM drops a label's text before its first `<br/>` (a browser keeps it), so the
// model's sanitizer is left out here: the labels hold no HTML but `<br/>`, since core writes `<`, `>` and `&` as
// entities, and a browser's DOMPurify leaves them as they are.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { Window } from "happy-dom";
import type MermaidApi from "mermaid";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandName } from "../catalog.js";
import { STANDARD_MODEL_TEXT } from "../metamodel/standard-model.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";

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
  "metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
  [`requirements/SR-${idOf(0).slice(-12)}.md`]: requirement(0, ROOT_TITLE, []),
  ...Object.fromEntries(
    Array.from({ length: CHILDREN }, (_, at) => at + 1).map((n) => [
      `requirements/SR-${idOf(n).slice(-12)}.md`,
      requirement(n, titleOf(n), parentsOf(n)),
    ]),
  ),
};

const open = async (): Promise<Workspace> => {
  const copy = await createFixtureWorkspace({ fixture: "SR-004/one-repository", files: FILES });
  onTestFinished(() => copy.cleanup());
  const workspace = new Workspace(copy.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const run = async <T>(workspace: Workspace, name: CommandName, input: object): Promise<T> =>
  (await invoke(name, input, { workspace })) as T;

/** The parts of Mermaid's flowchart model this test reads. */
interface FlowModel {
  getVertices(): Map<string, { readonly id: string; readonly text?: string }>;
  getEdges(): readonly { readonly start: string; readonly end: string; readonly text: string }[];
}

/**
 * A label as Mermaid shows it: its placeholders for entities back to entities (Mermaid's `decodeEntities`),
 * then the entities to characters as the browser reads them, one line per `<br/>`.
 */
const shown = (label: string): string[] =>
  label.split(/<br\s*\/?>/u).map((line) => {
    const area = window.document.createElement("textarea");
    area.innerHTML = line.replace(/ﬂ°°/gu, "&#").replace(/ﬂ°/gu, "&").replace(/¶ß/gu, ";");
    return area.value;
  });

let mermaid: typeof MermaidApi;
let window: Window;

/** The parsed diagram with its model. */
const diagramOf = (text: string): Promise<{ readonly db: unknown }> =>
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- `parse`, its replacement, gives only the diagram type; this is the one way to read the model Mermaid parsed without a browser to draw in.
  mermaid.mermaidAPI.getDiagramFromText(text);

beforeAll(async () => {
  window = new Window();
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false });
  const probe = await diagramOf("flowchart BT\n  a --> b\n");
  const flowDb = Object.getPrototypeOf(probe.db) as { sanitizeText: (text: string) => string };
  vi.spyOn(flowDb, "sanitizeText").mockImplementation((text) => text);
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await window.happyDOM.close();
});

/** Parses `text` as Mermaid does before drawing it; throws on a syntax error. */
const parsed = async (text: string): Promise<FlowModel> => {
  expect(await mermaid.parse(text)).toMatchObject({ diagramType: "flowchart-v2" });
  return (await diagramOf(text)).db as FlowModel;
};

describe("Mermaid reads the graph text (SR-151 AK3)", () => {
  it("[SR-151/AK-n1xs] parses the graph of 50 nodes and 100 edges with special characters in its titles, with every node, edge and title", async () => {
    const { mermaid: text } = await run<{ mermaid: string }>(await open(), "trace.mermaid", {
      ref: ROOT,
      limit: 500,
    });
    expect(text.startsWith("flowchart BT\n")).toBe(true);
    const model = await parsed(text);
    const vertices = [...model.getVertices().values()];
    const edges = model.getEdges();
    expect([vertices.length, edges.length]).toEqual([50, 100]);
    // The title is the second line of a node, after the short ID and the type.
    const titles = vertices.map((vertex) => shown(vertex.text ?? "")[1]);
    expect(titles.sort()).toEqual(
      [ROOT_TITLE, ...Array.from({ length: CHILDREN }, (_, at) => titleOf(at + 1))].sort(),
    );
    // Every edge joins two nodes of the graph and is labelled with its kind.
    const ids = new Set(vertices.map((vertex) => vertex.id));
    for (const edge of edges) {
      expect([ids.has(edge.start), ids.has(edge.end), shown(edge.text)]).toEqual([
        true,
        true,
        ["Derives from · outdated"],
      ]);
    }
  });

  it("[SR-151/AK-n1xs] parses the metamodel graph of the standard model, with every type, edge and label", async () => {
    const workspace = await open();
    const { mermaid: text } = await run<{ mermaid: string }>(workspace, "metamodel.mermaid", {});
    const model = await parsed(text);
    const lines = text.split("\n");
    const nodeLines = lines.filter((line) => /^ {2}\w+\["/u.test(line));
    const edgeLines = lines.filter((line) => line.includes("-->"));
    const vertices = model.getVertices();
    expect([vertices.size, model.getEdges().length]).toEqual([nodeLines.length, edgeLines.length]);
    // Each node and each edge with its label as the text writes it, character for character.
    for (const line of nodeLines) {
      const [, id = "", label = ""] = /^ {2}(\w+)\["(.*)"\]$/u.exec(line) ?? [];
      expect(shown(vertices.get(id)?.text ?? "")).toEqual(shown(label));
    }
    const written = edgeLines.map((line) => {
      const [, start = "", label = "", end = ""] = /^ {2}(\w+) -->\|"(.*)"\| (\w+)$/u.exec(line) ?? [];
      return [start, end, shown(label)];
    });
    expect(model.getEdges().map((edge) => [edge.start, edge.end, shown(edge.text)])).toEqual(written);
    // Every type of the standard model is a node with its name and prefix.
    const { types } = await run<{ types: readonly { name: string; prefix?: string }[] }>(
      workspace,
      "metamodel.get",
      {},
    );
    expect(types.length).toBeGreaterThan(5);
    const heads = nodeLines.map((line) => shown(/\["(.*)"\]$/u.exec(line)?.[1] ?? "")[0]);
    for (const type of types) {
      expect(heads).toContain(`${type.name} (${type.prefix ?? ""})`);
    }
  });
});
