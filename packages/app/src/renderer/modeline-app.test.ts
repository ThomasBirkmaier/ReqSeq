// @vitest-environment happy-dom
// The modeline in the app (SR-114): the counts of an element's outdated references and open hints, as
// `element.get` gives them (AK2), and the kind and number of the elements a list, a graph and a package
// page show (AK3).
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeResult, ReqSeqBridge } from "../shared/protocol.js";
import { App } from "./App.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (n: number, extra: object = {}) => ({
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
  ...extra,
});

/** The package "Stufe-3"; elements 2 and 3 name it. */
const PACKAGE = row(9, { id: "uuid-p", shortId: "PKG-0000d1", type: "package", title: "Stufe-3" });

/**
 * Element 1 as `element.get` gives it: an outdated inline reference and an outdated relation are hints
 * `relation.outdated` (the relation itself has no `outdated`), and one other open hint.
 */
const HINTED = row(1, {
  relations: [
    { kind: "based-on", direction: "out", id: "uuid-2", accessible: true, targetState: "available" },
  ],
  problems: [
    {
      code: "relation.outdated",
      severity: "warning",
      message: "The inline reference to SR-000002 is outdated",
      hintId: "spec/uuid-1/@text/0123456789abcdef?target=uuid-2&repository=spec",
      targetId: "uuid-2",
      storedVersion: "1",
    },
    {
      code: "relation.outdated",
      severity: "warning",
      message: "The relation based-on to SR-000002 is outdated",
      hintId: "spec/uuid-1/based-on/uuid-2?target=uuid-2",
      targetId: "uuid-2",
      storedVersion: "1",
    },
    { code: "relation.cycle", severity: "warning", message: "SR-000001 is in a cycle" },
  ],
});

const elementOf = (ref: unknown) =>
  ref === "uuid-p" ? PACKAGE : ref === "uuid-1" ? HINTED : row(Number(String(ref).replace("uuid-", "")));

type Handler = (input: Record<string, unknown>) => unknown;

const HANDLERS: Record<string, Handler> = {
  "workspace.status": () => ({ name: "Weather station", readOnly: false }),
  "element.list": (input) => {
    const selection = input["selection"] as { where?: { package?: string } } | undefined;
    return selection?.where?.package === undefined
      ? { elements: [row(1), row(2), row(3)], total: 3, incomplete: false }
      : { elements: [row(2), row(3)], total: 2, incomplete: false };
  },
  "element.get": (input) => ({ element: elementOf(input["ref"]) }),
  "element.search": (input) => {
    const found = String(input["query"]).startsWith("stufe") ? PACKAGE : row(2);
    return {
      hits: [{ ...found, score: 1, fields: ["title"], terms: ["title"] }],
      total: 1,
      incomplete: false,
    };
  },
  "trace.neighbourhood": (input) => ({
    root: input["ref"],
    nodes: [{ ...elementOf(input["ref"]), depth: 0, expanded: true }],
    total: 1,
    edges: [],
    incomplete: false,
  }),
  // The graph of element 1: it and the element it is based on.
  "trace.graph": () => ({
    root: "uuid-1",
    nodes: [1, 2].map((n, level) => {
      const { text: _text, properties: _properties, relations: _relations, ...node } = row(n);
      return { ...node, level, marks: [] };
    }),
    edges: [
      {
        source: "uuid-1",
        sourceRepository: "spec",
        target: "uuid-2",
        targetRepository: "spec",
        link: "relation",
        kind: "based-on",
        outdated: false,
      },
    ],
    truncated: false,
    incomplete: false,
    problems: [],
  }),
  "metamodel.get": () => ({
    relations: [{ key: "based-on", name: "Based on" }],
    types: [
      { key: "need", name: "Need", properties: [] },
      { key: "package", name: "Package", meaning: "package", properties: [] },
    ],
    properties: [],
    statuses: [{ key: "draft" }],
    meanings: { package: ["package"], packages: ["packages"] },
  }),
  "element.facets": () => ({
    total: 4,
    types: [{ key: "need", name: "Need", count: 3 }],
    statuses: [{ key: "draft", count: 4 }],
    properties: [],
    incomplete: false,
  }),
};

const invoke = vi.fn((name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> =>
  Promise.resolve({ ok: true, output: HANDLERS[name]?.(input) }),
);

const bridge: ReqSeqBridge = {
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

/** The parts of the modeline for the shown buffer, left of the workspace. */
const parts = (): (string | null)[] =>
  [...container.querySelectorAll(".modeline .parts > .segment")].map((part) => part.textContent);

const render = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(App, { bridge }));
    await Promise.resolve();
  });
  await flush();
};

describe("App, the counts of the modeline (SR-114)", () => {
  it("[SR-114/AK2] the modeline of an element with outdated references and an open hint names their counts as element.get gives them; of an element without, only ID, type and status", async () => {
    await render();
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "Enter" });
    expect(query("article h1").textContent).toBe("Title 1");
    // Two hints `relation.outdated` (an inline reference and a relation) and a cycle: not counted twice.
    expect(parts()).toEqual(["SR-000001 · Need · draft", "2 outdated", "1 hint"]);
    await goTo("Title 2");
    expect(query("article h1").textContent).toBe("Title 2");
    expect(parts()).toEqual(["SR-000002 · Need · draft"]);
  });

  it("[SR-114/AK3] the modeline names kind and count of a list, a graph and a package page", async () => {
    await render();
    await runCommand("List all elements");
    expect(parts()).toEqual(["All elements", "3 elements"]);
    await press(query('[role="listbox"]'), { key: "Enter" });
    await press(window, { key: "G", ctrlKey: true, shiftKey: true });
    expect(parts()).toEqual(["Graph: SR-000001 Title 1", "1 level", "2 nodes"]);
    // The package page: its type is the kind, its elements are counted as its heading counts them.
    await goTo("stufe");
    expect(query("article h1").textContent).toBe("Stufe-3");
    expect(query(".members h2").textContent).toBe("← packages 2");
    expect(parts()).toEqual(["PKG-0000d1 · Package · draft", "2 elements"]);
    // Another element of the same kind of buffer has no count.
    await goTo("Title 2");
    expect(parts()).toEqual(["SR-000002 · Need · draft"]);
  });
});
