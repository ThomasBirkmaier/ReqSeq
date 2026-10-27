// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeResult, LogReqBridge } from "../shared/protocol.js";
import { App } from "./App.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const query = (selector: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  return found;
};

const keyDown = async (
  target: EventTarget,
  key: string,
  ctrlKey = false,
  shiftKey = false,
): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ctrlKey, shiftKey }),
    );
    await Promise.resolve();
  });
  await flush();
};

const type = async (value: string): Promise<void> => {
  const input = query("input");
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const setValue = Reflect.get(descriptor ?? {}, "set") as (this: HTMLElement, value: string) => void;
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  await flush();
};

// A need N-001 "See the wind" with the requirements SR-001 and SR-002.
const element = (n: number, title: string, identifier: string) => ({
  id: `uuid-${String(n)}`,
  shortId: identifier,
  identifier,
  type: "need",
  status: "draft",
  title,
  repository: "spec",
  file: `f${String(n)}.md`,
  text: "",
  properties: {},
  relations: [],
});
const NEED = element(1, "See the wind", "N-001");
const SPEED = element(2, "Show wind speed", "SR-001");
const DIRECTION = element(3, "Show wind direction", "SR-002");
const ELEMENTS = [NEED, SPEED, DIRECTION];
const node = (e: (typeof ELEMENTS)[number], depth: number, extra: object = {}) => ({
  ...e,
  depth,
  expanded: true,
  ...extra,
});
const edge = (source: string, target: string) => ({
  source,
  sourceRepository: "spec",
  target,
  targetRepository: "spec",
  link: "relation",
  kind: "derives-from",
  meaning: "derivation",
  direction: "down",
  cyclic: false,
  repeated: false,
  outdated: false,
});

/** The need with its two requirements as children; any other element alone. */
const neighbourhood = (input: Record<string, unknown>) => {
  const children =
    input["ref"] === "uuid-1" && input["direction"] === "down" && input["meanings"] !== undefined;
  const root = ELEMENTS.find((candidate) => candidate.id === input["ref"]) ?? NEED;
  return {
    root: input["ref"],
    nodes: children
      ? [node(NEED, 0), node(SPEED, 1, { direction: "down" }), node(DIRECTION, 1, { direction: "down" })]
      : [node(root, 0)],
    total: children ? 3 : 1,
    edges: children ? [edge("uuid-2", "uuid-1"), edge("uuid-3", "uuid-1")] : [],
    incomplete: false,
  };
};

const bridge = (): { bridge: LogReqBridge; invoke: ReturnType<typeof vi.fn> } => {
  const handlers: Record<string, (input: Record<string, unknown>) => unknown> = {
    "workspace.status": () => ({ name: "Weather station", readOnly: false }),
    "metamodel.get": () => ({
      types: [{ key: "need", name: "Need", properties: [] }],
      statuses: [],
      properties: [],
      meanings: {},
    }),
    "element.facets": () => ({ total: 3, types: [], statuses: [], properties: [], incomplete: false }),
    "element.list": () => ({ elements: ELEMENTS, total: 3 }),
    "element.search": () => ({
      hits: [{ ...ELEMENTS[0], score: 1, fields: ["title"], terms: ["wind"] }],
      total: 1,
      incomplete: false,
    }),
    "element.get": (input) => ({
      element: ELEMENTS.find((candidate) => candidate.id === input["ref"]),
    }),
    "trace.neighbourhood": neighbourhood,
    // The graph of the need (SR-111): its two requirements below it.
    "trace.graph": () => ({
      root: "uuid-1",
      nodes: [
        { ...node(NEED, 0), level: 0, marks: [] },
        { ...node(SPEED, 1), level: 1, marks: ["no-evidence"] },
        { ...node(DIRECTION, 1), level: 1, marks: [] },
      ].map(
        ({ depth: _depth, text: _text, properties: _properties, relations: _relations, ...rest }) => rest,
      ),
      edges: [edge("uuid-2", "uuid-1"), edge("uuid-3", "uuid-1")].map(
        ({ direction: _direction, cyclic: _cyclic, repeated: _repeated, ...rest }) => rest,
      ),
      truncated: false,
      incomplete: false,
      problems: [],
    }),
  };
  const invoke = vi.fn((name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> =>
    Promise.resolve({ ok: true, output: handlers[name]?.(input) }),
  );
  return {
    invoke,
    bridge: {
      invoke,
      commands: () => Promise.resolve([]),
      copyText: () => Promise.resolve(true),
      on: () => () => undefined,
    },
  };
};

const open = async (): Promise<ReturnType<typeof bridge>> => {
  const fake = bridge();
  await act(async () => {
    root.render(createElement(App, { bridge: fake.bridge }));
    await Promise.resolve();
  });
  await flush();
  return fake;
};

/** The three key presses of a need's requirements: the title or ID of the need is typed in between. */
const toRequirements = async (): Promise<void> => {
  await keyDown(window, "p", true);
  await type("N-001");
  await keyDown(query("input"), "Enter");
  expect(query("article h1").textContent).toBe("See the wind");
  await keyDown(window, "j", true);
};

describe("the neighbourhood in the app", () => {
  it("[SR-119/AK2] shows the requirements of a need after Ctrl+P, its ID, Enter and Ctrl+J", async () => {
    await open();
    await toRequirements();
    expect(query(".neighbourhood h1").textContent).toBe("N-001 See the wind");
    expect(
      [...container.querySelectorAll('[role="treeitem"] .title')].map((title) => title.textContent),
    ).toEqual(["Show wind speed", "Show wind direction"]);
    // No row is selected yet (SR-122): Ctrl+P stays "Go to"; the first Down selects the first row.
    expect(container.querySelector('[role="treeitem"][aria-selected="true"]')).toBeNull();
    expect(document.activeElement).toBe(query(".neighbourhood"));
    expect(query('[aria-label="Modeline"]').textContent).toContain("Neighbourhood: N-001 See the wind");
  });

  it("[SR-107/AK2] goes back to the element with Ctrl+J, and the neighbourhood is in the buffer list", async () => {
    await open();
    await toRequirements();
    await keyDown(window, "j", true);
    expect(query("article h1").textContent).toBe("See the wind");
    await keyDown(window, "p", true);
    expect([...container.querySelectorAll('[role="option"]')].map((row) => row.textContent)).toContain(
      "Neighbourhood: N-001 See the wind",
    );
  });

  it("opens a requirement from the tree with Enter", async () => {
    await open();
    await toRequirements();
    await keyDown(query(".neighbourhood"), "ArrowDown");
    expect(container.querySelector('[role="treeitem"][aria-selected="true"] .id')?.textContent).toBe(
      "SR-001",
    );
    await keyDown(query(".neighbourhood"), "ArrowDown");
    await keyDown(query(".neighbourhood"), "Enter");
    expect(query("article h1").textContent).toBe("Show wind direction");
  });
});

describe("the graph in the app", () => {
  it("[SR-111/AK1] shows the graph of the element with Ctrl+Shift+G, with the type names, and goes back the same way", async () => {
    const fake = await open();
    await keyDown(window, "p", true);
    await type("N-001");
    await keyDown(query("input"), "Enter");
    expect(query("article h1").textContent).toBe("See the wind");
    await keyDown(window, "G", true, true);
    expect(fake.invoke).toHaveBeenCalledWith("trace.graph", {
      ref: "uuid-1",
      repository: "spec",
      maxDepth: 1,
      limit: 500,
    });
    expect(document.activeElement).toBe(query(".graph"));
    expect([...container.querySelectorAll(".graph-node .graph-id")].map((id) => id.textContent)).toEqual([
      "N-001 · Need",
      "SR-001 · Need",
      "SR-002 · Need",
    ]);
    expect(query('[aria-label="Modeline"]').textContent).toContain("Graph: N-001 See the wind");
    expect(query('[aria-label="Modeline"]').textContent).toContain("3 nodes");
    await keyDown(window, "G", true, true);
    expect(query("article h1").textContent).toBe("See the wind");
  });
});
