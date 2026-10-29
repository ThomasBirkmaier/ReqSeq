// SR-111 AK6 on the built app: „Gegeben ein Graph mit 500 Knoten, wenn er geöffnet wird, dann ist er nach
// höchstens einer Sekunde ausgelegt.“ Two generated workspaces, each with its own app run:
// - wide (`support/graph-fixture.ts`): three packages, each the root of a graph of exactly 500 nodes at
//   depth 1 (24 decisions above, 475 members below, about 790 links). The time runs from the keydown of
//   Ctrl/Cmd+Shift+G on the package. No warm-up: the first graph of the app run counts, and so does the
//   median of three opens (that first one and two more), each a new graph buffer on another root.
// - deep (`support/graph-deep-fixture.ts`): three needs, each the root of a whole chain of exactly 500
//   nodes with the link profile of the N-036 whole chain (#500: 263 links within a level, 45 against the
//   levels, 886 in all). The graph opens at depth 1 (53 nodes), and `+` gives the 500 nodes (#500).
// The time runs from the keydown (its `event.timeStamp`, capture phase) to the frame after the paint in
// which every box and every curve is placed (`[data-laid-out]` and a double `requestAnimationFrame`):
// IPC, core, the JSON, dagre, React's commit, style and paint. Each must be within 1000 ms; a miss is a
// performance finding, never a higher bound. The parts (until the request, core, layout, commit and
// paint) go to the log lines `PERF graph` and `PERF graph deep` for the record.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";
import type { GraphDeepFixture } from "./support/graph-deep-fixture.js";
import { writeGraphDeepFixture } from "./support/graph-deep-fixture.js";
import type { GraphFixture } from "./support/graph-fixture.js";
import { writeGraphFixture } from "./support/graph-fixture.js";

/** SR-111 AK6. */
const LAID_OUT_MS = 1000;
const NODES = 500;

interface Timing {
  /** From the keydown to the frame after the paint. */
  readonly total: number;
  /** From the keydown to the request of `trace.graph`. */
  readonly request: number;
  /** The call: IPC, core and the JSON. */
  readonly core: number;
  /** dagre. */
  readonly layout: number;
  /** React's commit, style and paint. */
  readonly paint: number;
}

/** The parts of a `trace.graph` answer this test compares. */
interface GraphAnswer {
  readonly nodes: readonly { readonly id: string; readonly level: number }[];
  readonly edges: readonly { readonly source: string; readonly target: string }[];
  readonly truncated: boolean;
}

/** Opens an element: Ctrl+P, its title, Enter once its title is there. */
const openElement = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
};

/** The key that opens a graph, and how its keydown is known. */
interface Opener {
  /** For `keyboard.press`. */
  readonly press: string;
  /** The keydown's `event.key`, in lower case. */
  readonly key: string;
}

const SHOW_GRAPH: Opener = { press: "ControlOrMeta+Shift+G", key: "g" };
const ONE_LEVEL_MORE: Opener = { press: "+", key: "+" };

/**
 * Presses `opener` and times it until the graph of `nodes` boxes, `root` among them, is laid out and
 * painted.
 */
const timeOpen = async (window: Page, opener: Opener, root: string, nodes: number): Promise<Timing> => {
  await window.evaluate(
    ({ root, nodes, key }) => {
      const w = globalThis as unknown as { __graph?: Promise<Timing> };
      let start: number | undefined;
      addEventListener(
        "keydown",
        (event) => {
          if (event.key.toLowerCase() === key && start === undefined) {
            start = event.timeStamp;
          }
        },
        { capture: true },
      );
      const last = (name: string): number => performance.getEntriesByName(name).at(-1)?.startTime ?? 0;
      w.__graph = new Promise((resolve) => {
        const check = (): void => {
          const view = document.querySelector(`.graph[data-laid-out="${String(nodes)}"]`);
          const placed =
            view !== null &&
            view.querySelector(`.graph-node.root[data-node="${root}"]`) !== null &&
            view.querySelectorAll(".graph-node").length === nodes;
          if (placed && start !== undefined) {
            observer.disconnect();
            const from = start;
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const end = performance.now();
                const [request, answer, layout] = [
                  last("reqseq.graph.request"),
                  last("reqseq.graph.answer"),
                  last("reqseq.graph.layout"),
                ];
                resolve({
                  total: end - from,
                  request: request - from,
                  core: answer - request,
                  layout: layout - answer,
                  paint: end - layout,
                });
              });
            });
          }
        };
        const observer = new MutationObserver(check);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      });
    },
    { root, nodes, key: opener.key },
  );
  await window.keyboard.press(opener.press);
  return window.evaluate(() => (globalThis as unknown as { __graph: Promise<Timing> }).__graph);
};

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

test.describe("a graph of 500 nodes", () => {
  let fixture: GraphFixture;
  let running: RunningApp | undefined;

  test.beforeAll(async () => {
    // Writing 1,500 elements and confirming their links' versions takes a while on a slow runner.
    test.setTimeout(300_000);
    fixture = await writeGraphFixture();
  });

  test.afterAll(async () => {
    await running?.close();
    await fixture.cleanup();
  });

  test("[SR-111/AK6] a graph of 500 nodes is laid out within 1 s", async () => {
    test.setTimeout(180_000);
    running = await launchApp({ folder: fixture.folder });
    const { window } = running;
    // Until the workspace is loaded: 1,500 elements can take longer than expect's 5 s on a loaded runner,
    // so this waits for the condition within the test's own bound (not part of any timed span).
    await expect(window.getByLabel("Modeline")).toContainText("elements", { timeout: 0 });
    // Each root gives exactly 500 nodes, none left out.
    for (const root of fixture.roots) {
      const answer = await running.cli([
        "trace",
        "graph",
        "--input",
        JSON.stringify({ ref: root.id, maxDepth: 1, limit: NODES }),
      ]);
      const output = JSON.parse(answer.stdout) as { nodes: unknown[]; truncated: boolean };
      expect([output.nodes.length, output.truncated]).toEqual([NODES, false]);
    }
    const timings: Timing[] = [];
    for (const root of fixture.roots) {
      await openElement(window, root.title);
      timings.push(await timeOpen(window, SHOW_GRAPH, `system:${root.id}`, NODES));
      await expect(window.getByLabel("Modeline")).toContainText(`${String(NODES)} nodes`);
    }
    const totals = timings.map((timing) => timing.total);
    const record = { timings, first: totals[0], median: median(totals) };
    // eslint-disable-next-line no-console -- the numbers are the result of this test, the PR quotes them.
    console.log(`PERF graph ${JSON.stringify(record)}`);
    test.info().annotations.push({ type: "SR-111 AK6", description: JSON.stringify(record) });
    expect(totals[0], "the first graph of the app run").toBeLessThanOrEqual(LAID_OUT_MS);
    expect(median(totals), "the median of three opens").toBeLessThanOrEqual(LAID_OUT_MS);
    for (const total of totals) {
      expect(total).toBeLessThanOrEqual(LAID_OUT_MS);
    }
  });
});

test.describe("the whole chain of 500 nodes", () => {
  let fixture: GraphDeepFixture;
  let running: RunningApp | undefined;

  test.beforeAll(async () => {
    // Writing 1,500 elements and confirming their links' versions takes a while on a slow runner.
    test.setTimeout(300_000);
    fixture = await writeGraphDeepFixture();
  });

  test.afterAll(async () => {
    await running?.close();
    await fixture.cleanup();
  });

  test("[SR-111/AK6] the whole chain of 500 nodes is laid out within 1 s", async () => {
    test.setTimeout(180_000);
    // An app of its own: the 500-node layouts of the wide test would warm dagre and the renderer.
    running = await launchApp({ folder: fixture.folder });
    const { window } = running;
    // Until the workspace is loaded: 1,500 elements can take longer than expect's 5 s on a loaded runner,
    // so this waits for the condition within the test's own bound (not part of any timed span).
    await expect(window.getByLabel("Modeline")).toContainText("elements", { timeout: 0 });
    // Each root gives a whole chain of exactly 500 nodes, none left out, which depth 2 (what `+` asks for
    // on a graph of depth 1) already reaches, with at least 250 links within a level and 40 against the
    // levels, so the fixture cannot get easier unnoticed. Depth 2 and the whole chain are compared by
    // their nodes (ID and level) and edges: the nodes of level ±2 are not expanded at depth 2.
    const graph = async (input: Record<string, unknown>): Promise<GraphAnswer> =>
      JSON.parse(
        (await running?.cli(["trace", "graph", "--input", JSON.stringify({ limit: NODES, ...input })]))
          ?.stdout ?? "{}",
      ) as GraphAnswer;
    const shape = (answer: GraphAnswer): unknown => [
      answer.nodes.map((node) => [node.id, node.level]),
      answer.edges,
    ];
    for (const root of fixture.roots) {
      const all = await graph({ ref: root.id, allLevels: true });
      const deep = await graph({ ref: root.id, maxDepth: 2 });
      expect([all.nodes.length, all.truncated]).toEqual([NODES, false]);
      expect(shape(deep)).toEqual(shape(all));
      const level = new Map(all.nodes.map((node) => [node.id, node.level]));
      const within = all.edges.filter(
        (edge) => edge.source !== edge.target && level.get(edge.source) === level.get(edge.target),
      );
      const against = all.edges.filter(
        (edge) => (level.get(edge.target) ?? 0) > (level.get(edge.source) ?? 0),
      );
      expect(within.length).toBeGreaterThanOrEqual(250);
      expect(against.length).toBeGreaterThanOrEqual(40);
    }
    // For each root: its graph at depth 1 (53 nodes, the only layout before the first timed `+` of the
    // app run, timed and logged too), then `+`, timed. The depth-1 layout warms dagre: measured in Node
    // (#500, a 55-node layout before a 500-node one), the first big layout is 17 to 32 % faster in wall
    // time, about 30 to 60 ms of dagre on CI. It is the user's only path to a deep graph until a depth can
    // be chosen in the command prompt, and that does not change it.
    const depthOne: Timing[] = [];
    const timings: Timing[] = [];
    for (const root of fixture.roots) {
      const key = `system:${root.id}`;
      await openElement(window, root.title);
      const one = (await graph({ ref: root.id, maxDepth: 1 })).nodes.length;
      depthOne.push(await timeOpen(window, SHOW_GRAPH, key, one));
      await expect(window.locator(".graph")).toHaveAttribute("data-laid-out", String(one));
      timings.push(await timeOpen(window, ONE_LEVEL_MORE, key, NODES));
      await expect(window.getByLabel("Modeline")).toContainText(`${String(NODES)} nodes`);
    }
    const totals = timings.map((timing) => timing.total);
    const record = { depthOne, timings, first: totals[0], median: median(totals) };
    // eslint-disable-next-line no-console -- the numbers are the result of this test, the PR quotes them.
    console.log(`PERF graph deep ${JSON.stringify(record)}`);
    test.info().annotations.push({ type: "SR-111 AK6 (deep)", description: JSON.stringify(record) });
    expect(totals[0], "the first deep graph of the app run").toBeLessThanOrEqual(LAID_OUT_MS);
    expect(median(totals), "the median of three").toBeLessThanOrEqual(LAID_OUT_MS);
    for (const total of totals) {
      expect(total).toBeLessThanOrEqual(LAID_OUT_MS);
    }
  });
});
