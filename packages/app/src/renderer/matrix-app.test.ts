// @vitest-environment happy-dom
// The traceability matrix in the window (SR-125): Ctrl+T on a list and on a package page, the focus, the
// modeline, and the filter that keeps the matrix.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeResult, ReqSeqBridge } from "../shared/protocol.js";
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
  modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {},
): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }),
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

/** Opens the command prompt, types `name` and runs the first candidate. */
const runCommand = async (name: string): Promise<void> => {
  await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
  await type(name);
  await keyDown(query("input"), "Enter");
};

const element = (n: number, type: string, title: string, identifier: string) => ({
  id: `uuid-${String(n)}`,
  shortId: identifier,
  identifier,
  type,
  status: "draft",
  title,
  repository: "spec",
  file: `f${String(n)}.md`,
  text: "",
  properties: {},
  relations: [],
});
const PACKAGE = element(9, "package", "Stage 3", "PKG-1");
const ELEMENTS = [
  element(1, "need", "See the wind", "N-001"),
  element(2, "need", "See the rain", "N-002"),
  PACKAGE,
];

const COLUMNS = [
  { type: "relation", kind: "derives-from", direction: "out", name: "Derives from", count: 1, share: 0.5 },
];
const matrixOf = (rows: typeof ELEMENTS) => ({
  columns: COLUMNS,
  rows: rows.map((row, at) => ({
    ...row,
    cells: [
      at === 0
        ? [
            {
              kind: "derives-from",
              direction: "out",
              id: "uuid-1",
              repository: "spec",
              shortId: "N-000001",
              identifier: "N-001",
              title: "See the wind",
              accessible: true,
              targetState: "available",
              outdated: true,
            },
          ]
        : [],
    ],
  })),
  total: rows.length,
  incomplete: false,
});

const bridge = () => {
  const handlers: Record<string, (input: Record<string, unknown>) => unknown> = {
    "workspace.status": () => ({ name: "Weather station", readOnly: false }),
    "metamodel.get": () => ({
      relations: [],
      types: [
        { key: "need", name: "Need", properties: [] },
        { key: "package", name: "Package", meaning: "package", properties: [] },
      ],
      statuses: [],
      properties: [],
      meanings: { packages: ["packages"] },
    }),
    "element.facets": () => ({
      total: 3,
      types: [],
      statuses: [{ key: "draft", count: 3 }],
      properties: [],
      incomplete: false,
    }),
    "element.list": () => ({ elements: ELEMENTS.slice(0, 2), total: 2 }),
    "element.search": () => ({
      hits: [{ ...PACKAGE, score: 1, fields: ["title"], terms: ["stage"] }],
      total: 1,
      incomplete: false,
    }),
    "element.get": (input) => ({ element: ELEMENTS.find((candidate) => candidate.id === input["ref"]) }),
    "trace.matrix": () => matrixOf(ELEMENTS.slice(0, 2)),
    // No parents: the parents line of the element stays away.
    "trace.neighbourhood": (input) => ({
      root: input["ref"],
      nodes: [],
      total: 0,
      edges: [],
      incomplete: false,
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
      recentWorkspaces: () => Promise.resolve([]),
      openWorkspace: () => Promise.resolve({ ok: true }),
      onSave: () => () => undefined,
      on: () => () => undefined,
    } satisfies ReqSeqBridge,
  };
};

const open = async () => {
  const fake = bridge();
  await act(async () => {
    root.render(createElement(App, { bridge: fake.bridge }));
    await Promise.resolve();
  });
  await flush();
  return fake;
};

const modeline = (): string => query('[aria-label="Modeline"]').textContent;

describe("the matrix in the app", () => {
  it("[SR-125/AK1] Ctrl+T on a list shows its matrix with the keys in it, and Ctrl+T again the list", async () => {
    const fake = await open();
    await runCommand("List all elements");
    expect(container.querySelectorAll(".row")).toHaveLength(2);
    await keyDown(window, "t", { ctrlKey: true });
    expect(container.querySelector(".row")).toBeNull();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(modeline()).toContain("All elements · matrix");
    expect(modeline()).toContain("2 elements");
    expect(document.activeElement).toBe(query("table"));
    expect(fake.invoke).toHaveBeenCalledWith(
      "trace.matrix",
      expect.objectContaining({ limit: 200, offset: 0 }),
    );
    await keyDown(query("table"), "ArrowDown");
    await keyDown(query("table"), "ArrowDown");
    await keyDown(window, "t", { ctrlKey: true });
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelectorAll(".row")).toHaveLength(2);
    expect(container.querySelector('.row[aria-selected="true"] .id')?.textContent).toBe("N-002");
    expect(document.activeElement).toBe(query(".list"));
    expect(modeline()).not.toContain("matrix");
  });

  it("[SR-125/AK1] a filter on the matrix keeps the matrix and asks it for the narrower selection", async () => {
    const fake = await open();
    await runCommand("List all elements");
    await keyDown(window, "t", { ctrlKey: true });
    await runCommand("Filter list by status");
    await keyDown(query("input"), "Enter");
    expect(container.querySelector("table")).not.toBeNull();
    expect(modeline()).toContain("status: draft · matrix");
    expect(fake.invoke).toHaveBeenLastCalledWith(
      "trace.matrix",
      expect.objectContaining({ selection: { where: { status: ["draft"] } } }),
    );
    expect(document.activeElement).toBe(query("table"));
    await runCommand("Clear list filter");
    expect(modeline()).toContain("All elements · matrix");
  });

  it("[SR-125/AK4] shows the outdated mark of a link, and Enter on the link opens its element", async () => {
    await open();
    await runCommand("List all elements");
    await keyDown(window, "t", { ctrlKey: true });
    expect(query("tbody tr .outdated").textContent).toBe(" outdated");
    await keyDown(query("table"), "ArrowRight");
    expect(query(".current").textContent).toBe("N-001 See the wind");
    await keyDown(query("table"), "Enter");
    expect(query("article h1").textContent).toBe("See the wind");
  });

  it("[SR-125/AK1] a package page opens its members as a matrix with Ctrl+T", async () => {
    const fake = await open();
    await keyDown(window, "p", { ctrlKey: true });
    await type("Stage");
    await keyDown(query("input"), "Enter");
    expect(query("article h1").textContent).toBe("Stage 3");
    await keyDown(window, "t", { ctrlKey: true });
    expect(container.querySelector("table")).not.toBeNull();
    expect(modeline()).toContain("package: PKG-1 Stage 3 · matrix");
    expect(fake.invoke).toHaveBeenLastCalledWith(
      "trace.matrix",
      expect.objectContaining({ selection: { where: { package: "uuid-9" } } }),
    );
  });

  it("does not open a matrix on the overview", async () => {
    await open();
    await keyDown(window, "t", { ctrlKey: true });
    expect(container.querySelector("table")).toBeNull();
  });
});
