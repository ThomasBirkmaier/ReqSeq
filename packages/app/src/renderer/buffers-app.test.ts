// @vitest-environment happy-dom
// Working in buffers in the app (SR-115): Ctrl/Cmd+P chooses any buffer and any element with a fuzzy
// text, the one used last first (AK1), and the window has no tab bar, however many buffers are open (AK2).
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeResult, LogReqBridge } from "../shared/protocol.js";
import { App } from "./App.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (n: number) => ({
  id: `uuid-${String(n)}`,
  shortId: `SR-00000${String(n)}`,
  type: "need",
  status: "draft",
  title: `Title ${String(n)}`,
  repository: "spec",
  file: `f${String(n)}.md`,
  text: "",
  properties: {},
  relations: [],
});

const numberOf = (ref: unknown): number => Number(String(ref).replace("uuid-", ""));

type Handler = (input: Record<string, unknown>) => unknown;

/** A workspace with three elements; core's search finds the element whose number is in the text. */
const HANDLERS: Record<string, Handler> = {
  "workspace.status": () => ({ name: "Weather station", readOnly: true }),
  "element.list": () => ({ elements: [row(1), row(2), row(3)], total: 3 }),
  "element.get": (input) => ({ element: row(numberOf(input["ref"])) }),
  "element.search": (input) => {
    const n = Number(/\d/.exec(String(input["query"]))?.[0] ?? "1");
    return {
      hits: [{ ...row(n), score: 1, fields: ["title"], terms: ["title"] }],
      total: 1,
      incomplete: false,
    };
  },
  // No parents: the parents line stays away.
  "trace.neighbourhood": (input) => ({
    root: input["ref"],
    nodes: [{ ...row(numberOf(input["ref"])), depth: 0, expanded: true }],
    total: 1,
    edges: [],
    incomplete: false,
  }),
  // The graph of an element without relations: the element alone.
  "trace.graph": (input) => {
    const {
      text: _text,
      properties: _properties,
      relations: _relations,
      ...node
    } = row(numberOf(input["ref"]));
    return {
      root: input["ref"],
      nodes: [{ ...node, level: 0, marks: [] }],
      edges: [],
      truncated: false,
      incomplete: false,
      problems: [],
    };
  },
  "metamodel.get": () => ({
    relations: [],
    types: [{ key: "need", name: "Need", properties: [] }],
    properties: [],
    statuses: [{ key: "draft" }],
    meanings: {},
  }),
  "element.facets": () => ({
    total: 3,
    types: [{ key: "need", name: "Need", count: 3 }],
    statuses: [{ key: "draft", count: 3 }],
    properties: [],
    incomplete: false,
  }),
};

const invoke = vi.fn((name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> =>
  Promise.resolve({ ok: true, output: HANDLERS[name]?.(input) }),
);

const bridge: LogReqBridge = {
  invoke,
  commands: () => Promise.resolve([]),
  on: () => () => undefined,
  copyText: () => Promise.resolve(true),
  recentWorkspaces: () => Promise.resolve([]),
  openWorkspace: () => Promise.resolve({ ok: true }),
  onSave: () => () => undefined,
};

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  invoke.mockClear();
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

const press = async (target: EventTarget, init: KeyboardEventInit): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
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

const runCommand = async (name: string): Promise<void> => {
  await press(window, { key: "P", ctrlKey: true, shiftKey: true });
  await type(name);
  await press(query("input"), { key: "Enter" });
};

const goTo = async (text: string): Promise<void> => {
  await press(window, { key: "p", ctrlKey: true });
  await type(text);
  await press(query("input"), { key: "Enter" });
};

const search = async (text: string): Promise<void> => {
  await press(window, { key: "F", ctrlKey: true, shiftKey: true });
  await type(text);
  await press(query("input"), { key: "Enter" });
};

/** The name of the shown buffer. */
const shown = (): string | null => query("[data-buffer]").getAttribute("aria-label");

/** The names of the candidates of the open prompt, in the order shown. */
const candidates = (): (string | null)[] =>
  [...container.querySelectorAll('.candidates [role="option"] .name')].map((name) => name.textContent);

const render = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(App, { bridge }));
    await Promise.resolve();
  });
  await flush();
};

describe("App, Go to a buffer or an element (SR-115 AK1)", () => {
  it("[SR-115/AK1] Ctrl+P lists the open buffers, the one used last first, then the elements shown last that are no longer open, and opens any element core finds for a text with a typo", async () => {
    await render();
    // Opened: the overview (at the start), the list, its first element, the second element by Ctrl+P.
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "Enter" });
    await goTo("Title 2");
    expect(shown()).toBe("SR-000002 Title 2");
    // The second element is closed: it is no longer open, but it was used.
    await runCommand("Close buffer");
    expect(shown()).toBe("SR-000001 Title 1");
    await search("wind");
    expect(shown()).toBe("Search: wind");
    await press(window, { key: "p", ctrlKey: true });
    expect(query("label").textContent).toBe("Go to");
    expect(candidates()).toEqual(["SR-000001 Title 1", "All elements", "Overview", "SR-000002 Title 2"]);
    // Choosing the element used before the search switches to its buffer.
    await press(query("input"), { key: "Enter" });
    expect(shown()).toBe("SR-000001 Title 1");
    // Now the search was used last. Opening the prompt asks core nothing (the closed element keeps the
    // name it was shown with), so the search for typed text is not queued behind reads.
    invoke.mockClear();
    await press(window, { key: "p", ctrlKey: true });
    expect(candidates()).toEqual(["Search: wind", "All elements", "Overview", "SR-000002 Title 2"]);
    expect(invoke).not.toHaveBeenCalled();
    // A typed text with a typo goes to core's search; the hit opens.
    await type("Titel 3");
    expect(invoke).toHaveBeenLastCalledWith("element.search", {
      query: "Titel 3",
      fields: ["id", "title"],
      limit: 20,
    });
    expect(candidates()).toEqual(["SR-000003 Title 3"]);
    await press(query("input"), { key: "Enter" });
    expect(shown()).toBe("SR-000003 Title 3");
  });
});

describe("App, Go to after a restart (SR-115 AK1)", () => {
  it("[SR-115/AK1] the elements shown before the app was opened again are offered with the names the overview read, without asking core when Ctrl+P opens", async () => {
    // Kept by the start before: element 3, then element 2 (newest first), per workspace (SR-118 AK5).
    window.localStorage.setItem(
      "logreq.recent.v1\nWeather station",
      JSON.stringify([
        { id: "uuid-3", repository: "spec" },
        { id: "uuid-2", repository: "spec" },
      ]),
    );
    await render();
    expect(shown()).toBe("Overview");
    expect(invoke).toHaveBeenCalledWith("element.get", { ref: "uuid-3", repository: "spec" });
    invoke.mockClear();
    await press(window, { key: "p", ctrlKey: true });
    expect(candidates()).toEqual(["SR-000003 Title 3", "SR-000002 Title 2"]);
    expect(invoke).not.toHaveBeenCalled();
    await press(query("input"), { key: "ArrowDown" });
    await press(query("input"), { key: "Enter" });
    expect(shown()).toBe("SR-000002 Title 2");
  });
});

describe("App, no tab bar (SR-115 AK2)", () => {
  it("[SR-115/AK2] with several buffers open there is no tab bar: no tab or tablist, one buffer in the sheet, and no name of a hidden buffer outside the modeline", async () => {
    await render();
    // Open: the overview, the list, an element, its graph, a search.
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "Enter" });
    await press(window, { key: "G", ctrlKey: true, shiftKey: true });
    expect(shown()).toBe("Graph: SR-000001 Title 1");
    await search("wind");
    const noTabBar = (hidden: readonly string[]): void => {
      expect(container.querySelectorAll('[role="tab"], [role="tablist"], nav')).toHaveLength(0);
      expect(
        [...query(".shell").children].map((part) => part.getAttribute("aria-label") ?? part.className),
      ).toEqual(["Sheet", "Modeline", "Minibuffer"]);
      expect(query('[aria-label="Sheet"]').children).toHaveLength(1);
      const outside = [...query(".shell").children]
        .filter((part) => part.getAttribute("aria-label") !== "Modeline")
        .map((part) => part.textContent)
        .join("\n");
      for (const name of hidden) {
        expect(outside).not.toContain(name);
      }
    };
    expect(shown()).toBe("Search: wind");
    noTabBar(["All elements", "Overview", "Graph: SR-000001 Title 1"]);
    // The same with the graph shown.
    await goTo("graph");
    expect(shown()).toBe("Graph: SR-000001 Title 1");
    noTabBar(["All elements", "Overview", "Search: wind"]);
    // Only the prompt of Ctrl+P names them, while it is asked.
    await press(window, { key: "p", ctrlKey: true });
    expect(candidates()).toEqual(["Search: wind", "SR-000001 Title 1", "All elements", "Overview"]);
  });
});
