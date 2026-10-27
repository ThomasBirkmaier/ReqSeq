// SR-111 AK6 on the built app: „Gegeben ein Graph mit 500 Knoten, wenn er geöffnet wird, dann ist er nach
// höchstens einer Sekunde ausgelegt.“ The workspace is generated (`support/graph-fixture.ts`): three
// packages, each the root of a graph of exactly 500 nodes at depth 1 (24 decisions above, 475 members
// below in four layers, about 790 links). The time runs from the keydown of Ctrl/Cmd+Shift+G on the
// package (its `event.timeStamp`, capture phase) to the frame after the paint in which every box and
// every curve is placed (`[data-laid-out]` and a double `requestAnimationFrame`): IPC, core, the JSON,
// dagre, React's commit, style and paint. No warm-up: the first graph of the app run counts, and so does
// the median of three opens (that first one and two more), each a new graph buffer on another root.
// Each must be within 1000 ms; a miss is a performance finding, never a higher bound. The parts (until
// the request, core, layout, commit and paint) go to the log line `PERF graph` for the record.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";
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

/** Opens an element: Ctrl+P, its title, Enter once its title is there. */
const openElement = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
};

/** Opens the graph of the shown package with Ctrl/Cmd+Shift+G and times it. */
const timeOpen = async (window: Page, root: string): Promise<Timing> => {
  await window.evaluate(
    ({ root, nodes }) => {
      const w = globalThis as unknown as { __graph?: Promise<Timing> };
      let start: number | undefined;
      addEventListener(
        "keydown",
        (event) => {
          if (event.key.toLowerCase() === "g" && event.shiftKey && start === undefined) {
            start = event.timeStamp;
          }
        },
        { capture: true },
      );
      const last = (name: string): number => performance.getEntriesByName(name).at(-1)?.startTime ?? 0;
      w.__graph = new Promise((resolve) => {
        const check = (): void => {
          const view = document.querySelector(".graph[data-laid-out]");
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
                  last("logreq.graph.request"),
                  last("logreq.graph.answer"),
                  last("logreq.graph.layout"),
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
    { root, nodes: NODES },
  );
  await window.keyboard.press("ControlOrMeta+Shift+G");
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
    await expect(window.getByLabel("Modeline")).toContainText("elements");
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
      timings.push(await timeOpen(window, `system:${root.id}`));
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
