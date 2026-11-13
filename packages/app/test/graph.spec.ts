// The graph of the current element (SR-111, ThomasBirkmaier/ReqSeq-archive#407) on the built app, on fixtures/SR-111/graph: the
// element in the middle of its graph with its parents above and its children below, also where links run
// against the levels (D1 and D2 above the element reference the element and one of its children), and
// the view opened on it (AK1); the title, type and marks of every node, never cut, also on the long IDs
// and types of `spec/` (AK4), the keys and Enter (AK5), and `+` and `-` (AK2). What the window shows is
// compared with `reqseq trace graph` for the same input (SR-080). Keys use ControlOrMeta, so the same
// tests run on Linux and macOS. The depth and the relation kinds are chosen in the command prompt
// ("Graph depth", "Show only relation kind", "Also show relation kind"), by keys only (AK2, AK3).
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, shownLayer } from "./support/app.js";

const P = "5e111a7d-2b4f-4c61-9d08-";
const ID = {
  S1: `${P}0b0000000001`,
  N1: `${P}0a0000000001`,
  CR1: `${P}0c0000000001`,
  CR2: `${P}0c0000000002`,
  CR5: `${P}0c0000000005`,
} as const;
const REPOSITORY = "system";

interface GraphOutput {
  readonly evidence?: readonly {
    readonly id: string;
    readonly repository: string;
    readonly level: number;
    readonly testCases: number;
    readonly records: number;
    readonly results: Readonly<Record<string, number>>;
  }[];
  readonly nodes: readonly {
    readonly id: string;
    readonly repository: string;
    readonly shortId: string;
    readonly identifier?: string;
    readonly type: string;
    readonly title: string;
    readonly level: number;
    readonly marks: readonly string[];
  }[];
  readonly edges: readonly {
    readonly source: string;
    readonly sourceRepository: string;
    readonly target: string;
    readonly targetRepository: string;
    readonly link: string;
    readonly kind?: string;
    readonly meaning?: string;
    readonly outdated?: boolean;
    readonly property?: boolean;
  }[];
}

const WORDS: Readonly<Record<string, string>> = {
  outdated: "outdated",
  superseded: "superseded",
};

/** What the CLI gives for `trace graph`. */
const traced = async (running: RunningApp, input: Record<string, unknown>): Promise<GraphOutput> => {
  const result = await running.cli(["trace", "graph", "--input", JSON.stringify({ limit: 500, ...input })]);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout) as GraphOutput;
};

const key = (repository: string, id: string): string => `${repository}:${id}`;

/** The ID a node shows, as the CLI prints it: the short ID with the identifier in brackets (SR-084 AK4). */
const shownId = (node: { readonly shortId: string; readonly identifier?: string }): string =>
  node.identifier === undefined ? node.shortId : `${node.shortId} (${node.identifier})`;

/** Opens an element: Ctrl+P, its short ID, Enter once its title is there. */
const openElement = async (window: Page, shortId: string, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(shortId);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(shownLayer(window).locator("article h1")).toHaveText(title);
};

/** Ctrl/Cmd+Shift+G on the shown element; waits until the graph has the focus and `nodes` placed boxes. */
const showGraph = async (window: Page, nodes: number): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+G");
  await expect(shownLayer(window).locator(".graph")).toBeFocused();
  await expect(shownLayer(window).locator(".graph")).toHaveAttribute("data-laid-out", String(nodes));
};

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The boxes of the nodes by their key, the drawing (`.graph-canvas`), and the visible area of the view. */
const boxes = async (window: Page): Promise<{ nodes: Map<string, Box>; drawing: Box; view: Box }> => {
  const read = await shownLayer(window).evaluate((layer) => {
    const box = (element: Element | null): Box => {
      const rect = element?.getBoundingClientRect();
      return { x: rect?.x ?? 0, y: rect?.y ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0 };
    };
    const view = layer.querySelector<HTMLElement>(".graph");
    const outer = box(view);
    return {
      // The visible area: without the scroll bars.
      view: {
        x: outer.x + (view?.clientLeft ?? 0),
        y: outer.y + (view?.clientTop ?? 0),
        width: view?.clientWidth ?? 0,
        height: view?.clientHeight ?? 0,
      },
      drawing: box(layer.querySelector(".graph-canvas")),
      nodes: [...layer.querySelectorAll<HTMLElement>(".graph-node")].map(
        (node) => [node.dataset["node"] ?? "", box(node)] as const,
      ),
    };
  });
  return { nodes: new Map(read.nodes), drawing: read.drawing, view: read.view };
};

const centreY = (box: Box | undefined): number => (box?.y ?? Number.NaN) + (box?.height ?? 0) / 2;

/** The margin the view keeps beyond the drawing: RANK_SEP of `graph-layout.ts`, the gap between two layers. */
const MARGIN = 56;

/**
 * Where the view stands on one axis when the graph opens (the reading of AK1 „steht es hervorgehoben in
 * der Mitte“: in the middle of its graph, between parents and children, and in the middle of the view
 * as far as the drawing allows):
 * - `fit`: the drawing with its margins fits the view, and the drawing stands in the middle of the view;
 * - `centred`: the drawing reaches half a view (less the margin) beyond the element on both sides, and
 *   the element stands in the middle of the view, within 2 px;
 * - `start` or `end`: the drawing ends nearer to the element on that side, and the drawing's edge on that
 *   side is the margin from the view's edge, within 2 px.
 */
type Placement = "fit" | "centred" | "start" | "end";

const placement = (element: Box, drawing: Box, view: Box, axis: "x" | "y"): Placement => {
  const size = axis === "x" ? "width" : "height";
  const centre = element[axis] + element[size] / 2;
  const viewCentre = view[axis] + view[size] / 2;
  if (drawing[size] + 2 * MARGIN <= view[size]) {
    expect(
      Math.abs(drawing[axis] + drawing[size] / 2 - viewCentre),
      `${axis}: drawing in the middle`,
    ).toBeLessThanOrEqual(2);
    return "fit";
  }
  const before = centre - drawing[axis] + MARGIN;
  const after = drawing[axis] + drawing[size] - centre + MARGIN;
  if (before >= view[size] / 2 && after >= view[size] / 2) {
    expect(Math.abs(centre - viewCentre), `${axis}: element in the middle`).toBeLessThanOrEqual(2);
    return "centred";
  }
  if (before < view[size] / 2) {
    expect(
      Math.abs(drawing[axis] - MARGIN - view[axis]),
      `${axis}: drawing starts a margin in`,
    ).toBeLessThanOrEqual(2);
    return "start";
  }
  expect(
    Math.abs(drawing[axis] + drawing[size] + MARGIN - (view[axis] + view[size])),
    `${axis}: drawing ends a margin in`,
  ).toBeLessThanOrEqual(2);
  return "end";
};

/**
 * AK1 on the graph shown for `output`: the boxes are the nodes of the CLI, each once; the element is
 * marked, wholly in view, and placed as `placement` says on both axes; every node the element links to
 * (level below 0) stands above it, every node linking to it (level above 0) below it, and every link
 * to a lower level has its target above its source (a link within a level or against the levels is
 * drawn after the layout). Gives the placement and the number of links against the levels.
 */
const placedOnce = async (
  window: Page,
  output: GraphOutput,
  root: string,
): Promise<{ x: Placement; y: Placement; against: number }> => {
  const { nodes, drawing, view } = await boxes(window);
  expect([...nodes.keys()].sort()).toEqual(output.nodes.map((node) => key(node.repository, node.id)).sort());
  await expect(shownLayer(window).locator(".graph-node.root")).toHaveAttribute("data-node", root, {
    timeout: 1000,
  });
  const element = nodes.get(root);
  if (element === undefined) {
    throw new Error(`no box for ${root}`);
  }
  // Wholly in view.
  expect(element.x).toBeGreaterThanOrEqual(view.x);
  expect(element.y).toBeGreaterThanOrEqual(view.y);
  expect(element.x + element.width).toBeLessThanOrEqual(view.x + view.width);
  expect(element.y + element.height).toBeLessThanOrEqual(view.y + view.height);
  const level = new Map(output.nodes.map((node) => [key(node.repository, node.id), node.level]));
  // Above the element what it links to, below what links to it.
  for (const node of output.nodes) {
    const at = key(node.repository, node.id);
    if (node.level < 0) {
      expect(centreY(nodes.get(at)), at).toBeLessThan(centreY(element));
    } else if (node.level > 0) {
      expect(centreY(nodes.get(at)), at).toBeGreaterThan(centreY(element));
    }
  }
  let against = 0;
  for (const edge of output.edges) {
    const source = key(edge.sourceRepository, edge.source);
    const target = key(edge.targetRepository, edge.target);
    const [from, to] = [level.get(source) ?? 0, level.get(target) ?? 0];
    if (to > from) {
      against += 1;
    } else if (to < from) {
      expect(centreY(nodes.get(target)), `${source} > ${target}`).toBeLessThan(centreY(nodes.get(source)));
    }
  }
  return {
    x: placement(element, drawing, view, "x"),
    y: placement(element, drawing, view, "y"),
    against,
  };
};

/**
 * `placedOnce` and the `expected` placement until both hold. On a slow macOS runner the view stood 150 px from its
 * place when the boxes were read right after the last layout (#1146), and later stood right: something moves it
 * after the layout effect that places it. A place that stays wrong fails after 5 s.
 */
const expectElementPlaced = async (
  window: Page,
  output: GraphOutput,
  root: string,
  expected: Partial<{ x: Placement; y: Placement; against: number }>,
): Promise<void> => {
  await expect(async () => {
    const placed = await placedOnce(window, output, root);
    expect(placed).toMatchObject(expected);
  }).toPass({ timeout: 10_000, intervals: [100, 250, 500] });
};

/**
 * Sets the size of the window's content (before a graph opens: the view opens on the element then), at most the
 * work area of the screen: macOS keeps a window inside it, and the screen of GitHub's macos-26 runner is lower than
 * 800 px (#490).
 */
const resize = async (running: RunningApp, width: number, height: number): Promise<void> => {
  const fitted = await running.app.evaluate(
    ({ BrowserWindow, screen }, size) => {
      const area = screen.getPrimaryDisplay().workArea;
      const fit = [Math.min(size.width, area.width), Math.min(size.height, area.height)] as const;
      const shown = BrowserWindow.getAllWindows()[0];
      shown?.setPosition(area.x, area.y);
      shown?.setContentSize(...fit);
      return fit;
    },
    { width, height },
  );
  await expect
    .poll(() => running.window.evaluate(() => [window.innerWidth, window.innerHeight]))
    .toEqual(fitted);
};

/** `+` until the graph shows the whole chain, with the nodes the CLI gives for it. */
const wholeChain = async (window: Page, nodes: number): Promise<void> => {
  for (let press = 0; press < 9; press += 1) {
    await window.keyboard.press("+");
  }
  await expect(window.getByLabel("Modeline")).toContainText("whole chain");
  await expect(shownLayer(window).locator(".graph")).toHaveAttribute("data-laid-out", String(nodes));
};

/** What cuts a box's lines: the ID and type line or the marks line wider than the box. */
const cutLines = (window: Page): Promise<string[]> =>
  shownLayer(window).evaluate((layer) =>
    [...layer.querySelectorAll<HTMLElement>(".graph-node")].flatMap((node) =>
      [...node.querySelectorAll<HTMLElement>(".graph-id > span, .graph-marks")]
        .filter((line) => line.scrollWidth > line.clientWidth)
        .map((line) => line.textContent),
    ),
  );

const selectedNode = (window: Page): Promise<string | null> =>
  shownLayer(window).locator('.graph-node[aria-selected="true"]').getAttribute("data-node");

test.describe("the graph of an element on a fixture workspace", () => {
  let running: RunningApp;
  const launch = async (): Promise<RunningApp> => {
    running = await launchApp({ fixture: "SR-111/graph" });
    // Until the workspace is loaded, within the test's own bound: on a loaded runner the start can take
    // longer than expect's 5 s (ThomasBirkmaier/ReqSeq-archive#555 review N2); it is not part of a timed span.
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station", { timeout: 0 });
    return running;
  };
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-111/AK-g4rk] the root is marked, between its parents and children, and centred where its graph reaches around it", async () => {
    const { window } = await launch();
    // A view small enough that the graph of S1 reaches half a view beyond it on every side.
    await resize(running, 760, 420);
    await openElement(window, "SR-b0000000001", "Show wind speed");
    const output = await traced(running, { ref: ID.S1, maxDepth: 1 });
    await showGraph(window, output.nodes.length);
    await expectElementPlaced(window, output, key(REPOSITORY, ID.S1), {
      x: "centred",
      y: "centred",
      against: 2,
    });
    // One drawn curve per pair of nodes that a link joins; D1 references the element and D2 one of its
    // children (against the levels), so the element is in a cycle with D1.
    const pairs = new Set(
      output.edges.map(
        (edge) => `${key(edge.sourceRepository, edge.source)}>${key(edge.targetRepository, edge.target)}`,
      ),
    );
    await expect(shownLayer(window).locator("path.graph-edge")).toHaveCount(pairs.size);
  });

  test("[SR-111/AK-g4rk] a root without parents stands on top of its children, the drawing's top a margin into the view", async () => {
    const { window } = await launch();
    await resize(running, 900, 420);
    await openElement(window, "N-a0000000001", "See the wind");
    const output = await traced(running, { ref: ID.N1, allLevels: true });
    expect(output.nodes.every((node) => node.level >= 0)).toBe(true);
    await showGraph(window, (await traced(running, { ref: ID.N1, maxDepth: 1 })).nodes.length);
    await wholeChain(window, output.nodes.length);
    await expectElementPlaced(window, output, key(REPOSITORY, ID.N1), { y: "start" });
  });

  test("[SR-111/AK-g4rk] a root without children stands under its parents, the drawing's bottom a margin into the view", async () => {
    const { window } = await launch();
    await resize(running, 900, 420);
    await openElement(window, "CR-c0000000005", "Heat the turn sensor");
    const output = await traced(running, { ref: ID.CR5, allLevels: true });
    expect(output.nodes.every((node) => node.level <= 0)).toBe(true);
    await showGraph(window, (await traced(running, { ref: ID.CR5, maxDepth: 1 })).nodes.length);
    await wholeChain(window, output.nodes.length);
    await expectElementPlaced(window, output, key(REPOSITORY, ID.CR5), { y: "end" });
  });

  test("[SR-111/AK-g4rk] a drawing smaller than the view stands in its middle, the root between parents and children", async () => {
    const { window } = await launch();
    await resize(running, 1280, 800);
    await openElement(window, "N-a0000000001", "See the wind");
    const output = await traced(running, { ref: ID.N1, maxDepth: 1 });
    expect(output.nodes.length).toBeGreaterThan(1);
    await showGraph(window, output.nodes.length);
    await expectElementPlaced(window, output, key(REPOSITORY, ID.N1), { x: "fit", y: "fit", against: 0 });
  });

  test("[SR-111/AK-kq3w] an outdated link keeps the accent colour, also as a link of the selected element", async () => {
    const { window } = await launch();
    await openElement(window, "SR-b0000000001", "Show wind speed");
    const output = await traced(running, { ref: ID.S1, maxDepth: 1 });
    await showGraph(window, output.nodes.length);
    /** The classes and stroke of every drawn link, and the colours of the accent and the text. */
    const strokes = (): Promise<{
      accent: string;
      text: string;
      paths: { source: string; classes: string[]; stroke: string }[];
    }> =>
      shownLayer(window).evaluate((layer) => {
        const probe = document.createElement("span");
        document.body.append(probe);
        const colour = (token: string): string => {
          probe.style.color = `var(${token})`;
          return getComputedStyle(probe).color;
        };
        const tokens = { accent: colour("--accent-outdated"), text: colour("--text") };
        probe.remove();
        const paths = [...layer.querySelectorAll<SVGPathElement>("path.graph-edge")].map((path) => ({
          source: path.dataset["source"] ?? "",
          classes: (path.getAttribute("class") ?? "").split(" "),
          stroke: getComputedStyle(path).stroke,
        }));
        return { ...tokens, paths };
      });
    // 10 of the 13 drawn links touch the element, more than half: the graph opens calm, and its two
    // outdated links (S1 → D2, C2 → S1) are in the accent colour.
    const calm = await strokes();
    expect(calm.paths.filter((path) => path.classes.includes("selected"))).toEqual([]);
    const outdated = calm.paths.filter((path) => path.classes.includes("outdated"));
    expect(outdated).toHaveLength(2);
    expect(outdated.every((path) => path.stroke === calm.accent)).toBe(true);
    // Down to C2: its one drawn link, C2 → S1, is outdated and lit up, and keeps the accent colour.
    await window.keyboard.press("ArrowDown");
    expect(await selectedNode(window)).toBe(key(REPOSITORY, ID.CR2));
    const one = await strokes();
    const lit = one.paths.filter((path) => path.classes.includes("selected"));
    expect(lit.map((path) => [path.source, path.classes.includes("outdated"), path.stroke])).toEqual([
      [key(REPOSITORY, ID.CR2), true, one.accent],
    ]);
    // Left to C1: its four links are lit up in the text colour.
    await window.keyboard.press("ArrowLeft");
    expect(await selectedNode(window)).toBe(key(REPOSITORY, ID.CR1));
    const four = await strokes();
    const plain = four.paths.filter((path) => path.classes.includes("selected"));
    expect(plain).toHaveLength(4);
    expect(plain.every((path) => !path.classes.includes("outdated") && path.stroke === four.text)).toBe(true);
    expect(four.accent).not.toBe(four.text);
  });

  test("[SR-111/AK-kq3w] each node shows title and type name, and the mark words only on marked nodes", async () => {
    const { window } = await launch();
    await openElement(window, "SR-b0000000001", "Show wind speed");
    const output = await traced(running, { ref: ID.S1, maxDepth: 1 });
    const metamodel = await running.cli(["metamodel", "get"]);
    const types = new Map(
      (JSON.parse(metamodel.stdout) as { types: { key: string; name: string }[] }).types.map((type) => [
        type.key,
        type.name,
      ]),
    );
    await showGraph(window, output.nodes.length);
    const shown = await shownLayer(window).evaluate((layer) =>
      [...layer.querySelectorAll<HTMLElement>(".graph-node")].map((node) => ({
        key: node.dataset["node"],
        head: node.querySelector(".graph-id")?.textContent,
        title: node.querySelector(".graph-title")?.textContent,
        marks: [...node.querySelectorAll(".graph-marks > span:not(.graph-verification)")].map(
          (mark) => mark.textContent,
        ),
        fits: node.scrollHeight <= node.clientHeight,
      })),
    );
    // No mark is cut, and neither the ID nor the type: the fixture's short IDs (14 characters) with
    // "Component Requirement" fit the box; an ID that does not gives way before the type (short-id.spec.ts).
    expect(await cutLines(window)).toEqual([]);
    expect(shown).toEqual(
      output.nodes.map((node) => ({
        key: key(node.repository, node.id),
        head: `${shownId(node)} · ${types.get(node.type) ?? ""}`,
        title: node.title,
        marks: node.marks.map((mark) => WORDS[mark]),
        fits: true,
      })),
    );
    // Marked and unmarked nodes both occur, and the superseded one is struck through.
    expect(output.nodes.filter((node) => node.marks.length > 0).length).toBeGreaterThan(0);
    expect(output.nodes.filter((node) => node.marks.length === 0).length).toBeGreaterThan(0);
    await expect(shownLayer(window).locator(".graph-node.superseded")).toHaveCount(
      output.nodes.filter((node) => node.marks.includes("superseded")).length,
    );
  });

  test("[SR-111/AK-h6rz] arrows move along edges and layers, Enter opens the node as current element", async () => {
    const { window } = await launch();
    await openElement(window, "SR-b0000000001", "Show wind speed");
    const output = await traced(running, { ref: ID.S1, maxDepth: 1 });
    await showGraph(window, output.nodes.length);
    const root = key(REPOSITORY, ID.S1);
    expect(await selectedNode(window)).toBe(root);
    const { nodes } = await boxes(window);
    const y = (at: string | null): number => centreY(nodes.get(at ?? ""));
    const x = (at: string | null): number => nodes.get(at ?? "")?.x ?? Number.NaN;
    // Down: a node below the element that links to it; Right: the next node of that layer.
    await window.keyboard.press("ArrowDown");
    const below = await selectedNode(window);
    expect(y(below)).toBeGreaterThan(y(root));
    expect(output.edges.some((edge) => key(edge.sourceRepository, edge.source) === below)).toBe(true);
    await window.keyboard.press("ArrowRight");
    const right = await selectedNode(window);
    expect(y(right)).toBe(y(below));
    expect(x(right)).toBeGreaterThan(x(below));
    // Page Up: the layer above; Home: the element again.
    await window.keyboard.press("PageUp");
    expect(y(await selectedNode(window))).toBeLessThan(y(right));
    await window.keyboard.press("Home");
    expect(await selectedNode(window)).toBe(root);
    // Up to a parent, then Enter opens it as the current element, named by its ID in the modeline.
    await window.keyboard.press("ArrowUp");
    const up = await selectedNode(window);
    const [node] = output.nodes.filter((candidate) => key(candidate.repository, candidate.id) === up);
    if (node === undefined) {
      throw new Error(`no node ${String(up)}`);
    }
    expect(node.level).toBeLessThan(0);
    await window.keyboard.press("Enter");
    await expect(shownLayer(window).locator("article h1")).toHaveText(node.title);
    await expect(window.getByLabel("Modeline")).toContainText(shownId(node));
    // Ctrl/Cmd+Shift+G shows its graph, and on the graph the element again.
    const its = await traced(running, { ref: node.id, maxDepth: 1 });
    await showGraph(window, its.nodes.length);
    await window.keyboard.press("ControlOrMeta+Shift+G");
    await expect(shownLayer(window).locator("article h1")).toHaveText(node.title);
  });

  test("[SR-111/AK-p2tx] + and - show the nodes the CLI gives for one level more or less", async () => {
    const { window } = await launch();
    await openElement(window, "SR-b0000000001", "Show wind speed");
    const one = await traced(running, { ref: ID.S1, maxDepth: 1 });
    const two = await traced(running, { ref: ID.S1, maxDepth: 2 });
    expect(two.nodes.length).toBeGreaterThan(one.nodes.length);
    await showGraph(window, one.nodes.length);
    await window.keyboard.press("+");
    await expect(shownLayer(window).locator(".graph")).toHaveAttribute(
      "data-laid-out",
      String(two.nodes.length),
    );
    await expect(window.getByLabel("Modeline")).toContainText("2 levels");
    await window.keyboard.press("-");
    await expect(shownLayer(window).locator(".graph")).toHaveAttribute(
      "data-laid-out",
      String(one.nodes.length),
    );
    await expect(window.getByLabel("Modeline")).toContainText("1 level");
  });
});

test.describe("the graph on the specification workspace", () => {
  const SPEC = fileURLToPath(new URL("../../../spec", import.meta.url));

  /** Opens an element by Ctrl+P and its ID, once the hit is there. */
  const openById = async (window: Page, id: string, title: string): Promise<void> => {
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type(id);
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(id);
    await window.keyboard.press("Enter");
    await expect(shownLayer(window).locator("article h1")).toHaveText(title);
  };

  test("[SR-111/AK-kq3w] never cuts an ID, a type or a mark, on the long IDs and types of spec/", async () => {
    const running = await launchApp({ folder: SPEC });
    const { window } = running;
    try {
      await expect(window.getByLabel("Modeline")).toContainText("elements");
      // The package Editor: its members, nearly every one a System Requirement.
      await openById(window, "Editor", "Element bearbeiten");
      const members = await traced(running, { ref: "Editor", maxDepth: 1 });
      await showGraph(window, members.nodes.length);
      expect(await cutLines(window)).toEqual([]);
      // A box carries a mark word only when it is outdated or superseded; its verification stands apart.
      const words = await shownLayer(window)
        .locator(".graph-marks > span:not(.graph-verification)")
        .allTextContents();
      expect(words.filter((word) => word !== "outdated" && word !== "superseded")).toEqual([]);
      const heads = await shownLayer(window).locator(".graph-id").allTextContents();
      expect(heads.some((head) => head.endsWith(" · System Requirement"))).toBe(true);
      // SR-111 over the whole chain: needs, decisions, packages and requirements of every length.
      await openById(window, "SR-111", "Graph des aktuellen Elements zeigen");
      await showGraph(window, (await traced(running, { ref: "SR-111", maxDepth: 1 })).nodes.length);
      await wholeChain(window, (await traced(running, { ref: "SR-111", allLevels: true })).nodes.length);
      expect(await cutLines(window)).toEqual([]);
      expect(
        await shownLayer(window).locator(".graph-id", { hasText: "(SR-111) · System Requirement" }).count(),
      ).toBe(1);
    } finally {
      await running.close();
    }
  });
});

test.describe("the depth and relation kinds of a graph on a fixture workspace", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-111/graph" });
    // Until the workspace is loaded, within the test's own bound: on a loaded runner the start can take
    // longer than expect's 5 s (ThomasBirkmaier/ReqSeq-archive#555 review N2); it is not part of a timed span.
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station", { timeout: 0 });
  });
  test.afterEach(async () => {
    await running.close();
  });

  /** The boxes and the drawn pairs (`<source> > <target>`, by node key), sorted, as the window shows them. */
  const drawn = (window: Page): Promise<{ nodes: string[]; pairs: string[] }> =>
    shownLayer(window).evaluate((layer) => ({
      nodes: [...layer.querySelectorAll<HTMLElement>(".graph-node")]
        .map((node) => node.dataset["node"] ?? "")
        .sort(),
      pairs: [...layer.querySelectorAll<SVGPathElement>("path.graph-edge")]
        .map((path) => `${path.dataset["source"] ?? ""} > ${path.dataset["target"] ?? ""}`)
        .sort(),
    }));

  /** The same of the CLI's output: one drawn pair per ordered pair of nodes that a link joins. */
  const expected = (output: GraphOutput): { nodes: string[]; pairs: string[] } => ({
    nodes: output.nodes.map((node) => key(node.repository, node.id)).sort(),
    pairs: [
      ...new Set(
        output.edges.map(
          (edge) => `${key(edge.sourceRepository, edge.source)} > ${key(edge.targetRepository, edge.target)}`,
        ),
      ),
    ].sort(),
  });

  /** Runs `title` from the command prompt and takes `entry` in the prompt it opens, by keys only (SR-073). */
  const choose = async (window: Page, title: string, entry: string): Promise<void> => {
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type(title);
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
    await window.keyboard.press("Enter");
    await window.keyboard.type(entry);
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(entry);
    await window.keyboard.press("Enter");
  };

  /** The window shows the graph the CLI gives for `input` on S1, and the modeline says `says`. */
  const shows = async (input: Record<string, unknown>, says: string): Promise<GraphOutput> => {
    const output = await traced(running, { ref: ID.S1, ...input });
    await expect.poll(() => drawn(running.window)).toEqual(expected(output));
    await expect(running.window.getByLabel("Modeline")).toContainText(says);
    await expect(shownLayer(running.window).locator(".graph")).toBeFocused();
    return output;
  };

  test("[SR-111/AK-p2tx] Graph depth shows the direct neighbours, a chosen number of levels or the whole chain, as the CLI gives them", async () => {
    const { window } = running;
    await openElement(window, "SR-b0000000001", "Show wind speed");
    const one = await traced(running, { ref: ID.S1, maxDepth: 1 });
    await showGraph(window, one.nodes.length);
    await choose(window, "Graph depth", "2 levels");
    const two = await shows({ maxDepth: 2 }, "2 levels");
    await choose(window, "Graph depth", "Whole chain");
    const all = await shows({ allLevels: true }, "whole chain");
    await choose(window, "Graph depth", "Direct neighbours");
    await shows({ maxDepth: 1 }, "1 level");
    // The fixture tells the three apart: each depth reaches more nodes.
    expect(one.nodes.length).toBeLessThan(two.nodes.length);
    expect(two.nodes.length).toBeLessThan(all.nodes.length);
  });

  test("[SR-111/AK-h6n9] Show only and Also show relation kind draw only those links, as the CLI gives them", async () => {
    const { window } = running;
    await openElement(window, "SR-b0000000001", "Show wind speed");
    const everything = await traced(running, { ref: ID.S1, maxDepth: 1 });
    await showGraph(window, everything.nodes.length);
    await choose(window, "Show only relation kind", "Derivations");
    const derivations = await shows({ meanings: ["derivation"] }, "only Derivations");
    expect(derivations.edges.every((edge) => edge.meaning === "derivation")).toBe(true);
    await choose(window, "Also show relation kind", "Based on");
    const based = await shows(
      { meanings: ["derivation"], kinds: ["based-on"] },
      "only Derivations, Based on",
    );
    expect(based.edges.some((edge) => edge.kind === "based-on")).toBe(true);
    expect(based.edges.every((edge) => edge.meaning === "derivation" || edge.kind === "based-on")).toBe(true);
    await choose(window, "Show only relation kind", "Inline references");
    const references = await shows({ meanings: ["reference"] }, "only Inline references");
    expect(references.edges.length).toBeGreaterThan(0);
    expect(references.edges.every((edge) => edge.link === "reference")).toBe(true);
    await choose(window, "Show only relation kind", "Everything");
    await shows({ maxDepth: 1 }, "1 level");
    await expect(window.getByLabel("Modeline")).not.toContainText("only");
    // Each filter left out some of the links of the whole graph.
    for (const output of [derivations, based, references]) {
      expect(output.edges.length).toBeLessThan(everything.edges.length);
    }
  });
  /** The evidence boxes the window shows: the node each sums up, and its text. */
  const evidenceBoxes = (window: Page): Promise<[string, string][]> =>
    shownLayer(window).evaluate((layer) =>
      [...layer.querySelectorAll<HTMLElement>(".graph-evidence")]
        .map((box): [string, string] => [box.dataset["evidence"] ?? "", box.textContent])
        .sort(),
    );

  /** The boxes the CLI's `evidence` gives: one per summary, with the CLI's counts. */
  const evidenceOf = (output: GraphOutput): [string, string][] => {
    const counted = (n: number, thing: string): string[] =>
      n === 0 ? [] : [`${String(n)} ${thing}${n === 1 ? "" : "s"}`];
    return (output.evidence ?? [])
      .map((summary): [string, string] => [
        key(summary.repository, summary.id),
        [
          "evidence",
          [...counted(summary.testCases, "test case"), ...counted(summary.records, "record")].join(", "),
          Object.entries(summary.results)
            .map(([result, n]) => `${String(n)} ${result}`)
            .join(", "),
        ].join(" · "),
      ])
      .sort();
  };

  test("[SR-111/AK-h6n9] Evidence in Also show and Show only draws a box below each node with the counts the CLI gives, which the keys skip", async () => {
    const { window } = running;
    await openElement(window, "SR-b0000000001", "Show wind speed");
    const everything = await traced(running, { ref: ID.S1, maxDepth: 1 });
    await showGraph(window, everything.nodes.length);
    await expect(shownLayer(window).locator(".graph-evidence")).toHaveCount(0);
    // Also show on every link adds the evidence: the links stay, a box comes below S1.
    await choose(window, "Also show relation kind", "Evidence");
    const one = await shows({ maxDepth: 1, withEvidence: true }, "with Evidence");
    expect(one.edges.length).toBe(everything.edges.length);
    await expect.poll(() => evidenceBoxes(window)).toEqual(evidenceOf(one));
    expect(evidenceOf(one)).toEqual([
      [key(REPOSITORY, ID.S1), "evidence · 2 test cases, 1 record · 2 passed, 1 failed"],
    ]);
    // One level more: the evidence of C1 is within the depth too (a skipped test case).
    await window.keyboard.press("+");
    const two = await shows({ maxDepth: 2, withEvidence: true }, "with Evidence");
    await expect.poll(() => evidenceBoxes(window)).toEqual(evidenceOf(two));
    expect(evidenceOf(two).map(([node]) => node)).toEqual(
      [key(REPOSITORY, ID.S1), key(REPOSITORY, ID.CR1)].sort(),
    );
    // Each box stands below its node.
    const { nodes } = await boxes(window);
    for (const [node] of evidenceOf(two)) {
      const box = await shownLayer(window).locator(`.graph-evidence[data-evidence="${node}"]`).boundingBox();
      expect(box?.y ?? 0).toBeGreaterThan((nodes.get(node)?.y ?? 0) + (nodes.get(node)?.height ?? 0));
    }
    // The keys move between elements only, through every layer and below the nodes with a box.
    await window.keyboard.press("Home");
    const seen = new Set<string | null>();
    for (const step of [
      "ArrowDown",
      "ArrowRight",
      "ArrowRight",
      "ArrowDown",
      "ArrowDown",
      "PageDown",
      "PageDown",
      "ArrowLeft",
      "PageDown",
    ]) {
      await window.keyboard.press(step);
      seen.add(await selectedNode(window));
    }
    expect(
      [...seen].every((node) => node !== null && two.nodes.some((n) => key(n.repository, n.id) === node)),
    ).toBe(true);
    await expect(
      shownLayer(window).locator(".graph-evidence[role], .graph-evidence[aria-selected]"),
    ).toHaveCount(0);
    await expect(shownLayer(window).locator('[role="option"]')).toHaveCount(two.nodes.length);
    // Show only Evidence: no link is followed, the element with its evidence.
    await choose(window, "Show only relation kind", "Evidence");
    const only = await shows({ maxDepth: 2, kinds: [], withEvidence: true }, "only Evidence");
    expect(only.edges).toEqual([]);
    expect(evidenceOf(only)).not.toEqual([]);
    await expect.poll(() => evidenceBoxes(window)).toEqual(evidenceOf(only));
    // Everything: every link, and the evidence is gone.
    await choose(window, "Show only relation kind", "Everything");
    await shows({ maxDepth: 2 }, "2 levels");
    await expect(shownLayer(window).locator(".graph-evidence")).toHaveCount(0);
  });

  test("[SR-154/AK-rhrj] the mouse on a link and the key l name its relation kinds as the CLI and the metamodel give them", async () => {
    const { window } = running;
    await openElement(window, "SR-b0000000001", "Show wind speed");
    const output = await traced(running, { ref: ID.S1, maxDepth: 1 });
    await showGraph(window, output.nodes.length);
    const model = JSON.parse((await running.cli(["metamodel", "get"])).stdout) as {
      relations: { key: string; name: string }[];
      properties: { key: string; name: string; kind: string }[];
    };
    const names = new Map([
      ...model.relations.map((kind) => [kind.key, kind.name] as const),
      ...model.properties.map((property) => [`property:${property.key}`, property.name] as const),
    ]);
    const idOf = new Map(output.nodes.map((node) => [key(node.repository, node.id), shownId(node)]));
    // The lines the text of a curve must show: each link of its pair, read along the arrow.
    const expected = (curve: string): string[] =>
      output.edges
        .filter(
          (edge) =>
            `${key(edge.sourceRepository, edge.source)}>${key(edge.targetRepository, edge.target)}` === curve,
        )
        .map((edge) =>
          [
            idOf.get(key(edge.sourceRepository, edge.source)),
            edge.kind === undefined
              ? "Refers to"
              : (names.get(edge.property === true ? `property:${edge.kind}` : edge.kind) ?? edge.kind),
            idOf.get(key(edge.targetRepository, edge.target)),
            ...(edge.outdated === true ? ["· outdated"] : []),
          ].join(" "),
        );
    await expect(shownLayer(window).locator(".graph-edge-tip")).toHaveCount(0);
    // The mouse on the middle of the first curve whose middle is in view and on top there (no box over
    // it): the window's size differs between runners, so the first curve's middle may be out of view.
    const middle = await shownLayer(window).evaluate((layer) => {
      for (const path of layer.querySelectorAll<SVGPathElement>("path.graph-edge-hit")) {
        const matrix = path.getScreenCTM();
        if (matrix === null) {
          continue;
        }
        const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(matrix);
        if (document.elementFromPoint(point.x, point.y) === path) {
          return { curve: path.dataset["hit"] ?? "", x: point.x, y: point.y };
        }
      }
      return { curve: "", x: 0, y: 0 };
    });
    expect(middle.curve).not.toBe("");
    await window.mouse.move(middle.x, middle.y);
    const hovered = shownLayer(window).locator(".graph-edge-tip");
    await expect(hovered).toHaveCount(1);
    expect(await hovered.getAttribute("data-edge")).toBe(middle.curve);
    expect(await hovered.locator("div").allTextContents()).toEqual(expected(middle.curve));
    await window.mouse.move(1, 1);
    await expect(shownLayer(window).locator(".graph-edge-tip")).toHaveCount(0);
    // The key l selects the element's first link; its text is the accessible name of the active option.
    await window.keyboard.press("l");
    const chosen = shownLayer(window).locator('[id$="_gedge"]');
    await expect(shownLayer(window).locator(".graph")).toHaveAttribute("aria-activedescendant", /_gedge$/);
    const curve = (await chosen.getAttribute("data-edge")) ?? "";
    expect(curve.split(">")).toContain(key(REPOSITORY, ID.S1));
    await expect(chosen).toHaveAttribute("aria-label", expected(curve).join("; "));
    await expect(shownLayer(window).locator("path.graph-edge.chosen")).toHaveCount(1);
    await window.screenshot({
      path: fileURLToPath(
        new URL("../../../test-results/electron/screenshots/sr-154-light.png", import.meta.url),
      ),
    });
    await window.keyboard.press("Escape");
    await expect(shownLayer(window).locator(".graph-edge-tip")).toHaveCount(0);
    expect(await selectedNode(window)).toBe(key(REPOSITORY, ID.S1));
  });
});
