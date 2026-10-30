// @vitest-environment happy-dom
// Split window in the app (SR-115 AK3): two areas side by side, the active one named by the modeline and
// acted on by the commands; leaving an element for the other area saves its input (SR-105 AK1); no tab
// bar (AK2).
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import type { CommandListing, InvokeResult, ReqSeqBridge, WorkspaceChange } from "../shared/protocol.js";
import { App } from "./App.js";
import { graphEdge, graphNode, graphOutput } from "./graph-test-data.js";
import { NO_SUMMARY } from "./package-summary-test-data.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Element n, whose property `stray` names its target `t<n>` (a relation box with one link). */
const row = (n: number | string, extra: object = {}) => ({
  id: `uuid-${String(n)}`,
  shortId: `SR-00000${String(n)}`,
  type: "need",
  status: "draft",
  title: `Title ${String(n)}`,
  repository: "spec",
  file: `f${String(n)}.md`,
  properties: {},
  relations: [],
  ...extra,
});

const withTarget = (n: number) => ({
  properties: { stray: [{ id: `t${String(n)}` }] },
  relations: [
    {
      kind: "stray",
      property: true,
      direction: "out",
      id: `t${String(n)}`,
      repository: "spec",
      shortId: `T-${String(n)}`,
      title: `Target ${String(n)}`,
      accessible: true,
      targetState: "available",
    },
  ],
});

type Handler = (input: Record<string, unknown>) => unknown;

/** The elements of the package answer once this is resolved (at once unless a test holds them). */
let members: Promise<void> = Promise.resolve();

/** The texts written by the app, by UUID, and every write in order. */
const written = new Map<string, string>();
const writes: string[] = [];
/** The reads of each element, by UUID. */
const reads = new Map<string, number>();

const numberOf = (ref: unknown): number => Number(String(ref).replace("uuid-", ""));

const HANDLERS: Record<string, Handler> = {
  "workspace.status": () => ({ name: "Weather station", readOnly: true }),
  // The elements of package 9 are 1 to 3; the list of all elements has the package too.
  "element.list": (input) =>
    (input["selection"] as { where?: { package?: string } } | undefined)?.where?.package === "uuid-9"
      ? members.then(() => ({ elements: [row(1), row(2), row(3)], total: 3 }))
      : { elements: [row(1), row(2), row(3), row(9, { type: "package" })], total: 4 },
  "element.get": (input) => {
    const ref = String(input["ref"]);
    reads.set(ref, (reads.get(ref) ?? 0) + 1);
    if (ref.startsWith("t")) {
      return {
        element: { ...row(ref), id: ref, shortId: `T-${ref.slice(1)}`, title: `Target ${ref.slice(1)}` },
      };
    }
    const n = numberOf(ref);
    return {
      element: row(n, {
        text: written.get(ref) ?? "Hello",
        ...withTarget(n),
        ...(n === 9 ? { type: "package" } : {}),
      }),
    };
  },
  "element.update": (input) => {
    const ref = String(input["ref"]);
    written.set(ref, String(input["text"]));
    writes.push(ref);
    return { element: row(numberOf(ref), { text: String(input["text"]), ...withTarget(numberOf(ref)) }) };
  },
  "trace.neighbourhood": (input) => ({
    root: input["ref"],
    nodes: [{ ...row(numberOf(input["ref"])), depth: 0, expanded: true }],
    total: 1,
    edges: [],
    incomplete: false,
  }),
  "trace.graph": () =>
    graphOutput([graphNode("1", 0, { title: "Title 1" }), graphNode("2", 1)], [graphEdge("2", "1")], {
      root: "uuid-1",
    }),
  "element.search": () => ({
    hits: [{ ...row(2), score: 1, fields: ["title"], terms: ["title"] }],
    total: 1,
    incomplete: false,
  }),
  "filter.list": () => ({ filters: [{ name: "open", where: {} }] }),
  "metamodel.get": () => ({
    relations: [],
    types: [
      { key: "need", name: "Need", properties: ["stray"] },
      { key: "package", name: "Package", meaning: "package", properties: [] },
    ],
    properties: [{ key: "stray", name: "Stray", kind: "relation", many: true }],
    statuses: [{ key: "draft" }],
    meanings: { packages: ["packages"] },
  }),
  "element.facets": () => ({
    total: 3,
    types: [{ key: "need", name: "Need", count: 3 }],
    statuses: [{ key: "draft", count: 3 }],
    properties: [],
    incomplete: false,
  }),
};

const FILTER_LIST = {
  name: "filter.list",
  title: "List saved filters",
  summary: "A command of the catalog.",
  effect: "read",
  stage: 3,
  implements: ["SR-073"],
  arguments: [],
  input: { type: "object" },
  output: { type: "object" },
  implemented: true,
} as unknown as CommandListing;

const listeners = new Set<(change: WorkspaceChange) => void>();

const bridge: ReqSeqBridge = {
  invoke: (name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> =>
    Promise.resolve((HANDLERS[name] ?? NO_SUMMARY[name])?.(input)).then((output) => ({ ok: true, output })),
  commands: () => Promise.resolve([FILTER_LIST]),
  on: (event: string, listener: (data: never) => void) => {
    if (event !== "workspace-changed") {
      return () => undefined;
    }
    const changed = listener as (change: WorkspaceChange) => void;
    listeners.add(changed);
    return () => listeners.delete(changed);
  },
  copyText: () => Promise.resolve(true),
  recentWorkspaces: () => Promise.resolve([]),
  openWorkspace: () => Promise.resolve({ ok: true }),
  onSave: () => () => undefined,
};

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  members = Promise.resolve();
  written.clear();
  writes.length = 0;
  reads.clear();
  listeners.clear();
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

const press = async (target: EventTarget, init: KeyboardEventInit): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
    await Promise.resolve();
  });
  await flush();
  return event;
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

const render = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(App, { bridge }));
    await Promise.resolve();
  });
  await flush();
};

/** The areas, left to right: the name of the buffer each shows, `*` on the active one. */
const areas = (): string[] =>
  [...container.querySelectorAll<HTMLElement>("[data-area]")].map(
    (area) =>
      `${area.querySelector("[data-buffer]")?.getAttribute("aria-label") ?? ""}${area.hasAttribute("data-active") ? "*" : ""}`,
  );

const modeline = (): string => query('[aria-label="Modeline"]').textContent;

const editorIn = (side: "left" | "right"): EditorView => {
  const found = EditorView.findFromDOM(query(`[data-area="${side}"] .cm-editor`));
  if (found === null) {
    throw new Error(`no editor on the ${side}`);
  }
  return found;
};

/** Types at the end of the text of the element on `side`, with the focus in its editor. */
const typeIn = async (side: "left" | "right", text: string): Promise<void> => {
  await act(async () => {
    const editor = editorIn(side);
    editor.focus();
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: text } });
    await Promise.resolve();
  });
  await flush();
};

const pointerDown = async (side: "left" | "right"): Promise<void> => {
  await act(async () => {
    query(`[data-area="${side}"] [data-buffer]`).dispatchEvent(
      new Event("pointerdown", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
  await flush();
};

/** Opens element 1 from the list of all elements. */
const openElement = async (): Promise<void> => {
  await render();
  await runCommand("List all elements");
  await press(query('[role="listbox"]'), { key: "Enter" });
};

/** Element 1 on the left (active) and element 2 on the right, after Split window. */
const twoElements = async (): Promise<void> => {
  await openElement();
  // Back to the list (Alt+P), its second row, then Alt+P again to element 1: element 2 was used before it.
  await press(window, { key: "p", code: "KeyP", altKey: true });
  await press(query('[role="listbox"]'), { key: "ArrowDown" });
  await press(query('[role="listbox"]'), { key: "Enter" });
  await press(window, { key: "p", code: "KeyP", altKey: true });
  await runCommand("Split window");
  expect(areas()).toEqual(["SR-000001 Title 1*", "SR-000002 Title 2"]);
};

describe("App, Split window (SR-115 AK3)", () => {
  it("[SR-115/AK3] after Split window an element and its graph stand side by side; the modeline names the active one; Other window and a click switch it; the element view is not mounted again", async () => {
    await openElement();
    await press(window, { key: "G", ctrlKey: true, shiftKey: true });
    expect(areas()).toEqual(["Graph: SR-000001 Title 1*"]);
    await runCommand("Split window");
    expect(areas()).toEqual(["Graph: SR-000001 Title 1*", "SR-000001 Title 1"]);
    expect(modeline()).toContain("Graph");
    // The graph keeps the focus, in its area.
    expect(query('[data-area="left"]').contains(document.activeElement)).toBe(true);
    expect(container.querySelectorAll(".graph-node")).toHaveLength(2);
    const readsAfterSplit = reads.get("uuid-1");
    await runCommand("Other window");
    expect(areas()).toEqual(["Graph: SR-000001 Title 1", "SR-000001 Title 1*"]);
    expect(modeline()).not.toContain("Graph");
    expect(modeline()).toContain("SR-000001");
    expect(query('[data-area="right"]').contains(document.activeElement)).toBe(true);
    // A press in the graph's area makes it active again.
    await pointerDown("left");
    expect(areas()).toEqual(["Graph: SR-000001 Title 1*", "SR-000001 Title 1"]);
    expect(modeline()).toContain("Graph");
    // A prompt open while the other area is pressed is cancelled: its choice would act on the area left.
    await press(window, { key: "P", ctrlKey: true, shiftKey: true });
    expect(container.querySelector("input")).not.toBeNull();
    await pointerDown("right");
    expect(container.querySelector("input")).toBeNull();
    expect(areas()).toEqual(["Graph: SR-000001 Title 1", "SR-000001 Title 1*"]);
    await pointerDown("left");
    // Unsplit: the graph stays, alone.
    await runCommand("Unsplit window");
    expect(areas()).toEqual(["Graph: SR-000001 Title 1*"]);
    expect(query('[aria-label="Sheet"]').children).toHaveLength(1);
    expect(reads.get("uuid-1")).toBe(readsAfterSplit);
  });

  it("[SR-115/AK3] two elements side by side: Save element and element commands act on the active one, input goes to its own element", async () => {
    await twoElements();
    await typeIn("left", " ONE");
    await press(window, { key: "s", ctrlKey: true });
    expect(written.get("uuid-1")).toBe("Hello ONE");
    await runCommand("Other window");
    expect(areas()).toEqual(["SR-000001 Title 1", "SR-000002 Title 2*"]);
    await typeIn("right", " TWO");
    await press(window, { key: "s", ctrlKey: true });
    expect(written.get("uuid-2")).toBe("Hello TWO");
    expect(written.get("uuid-1")).toBe("Hello ONE");
    // Follow reference on the relation box of the right element opens its own target, in its area.
    const field = query('[data-area="right"] [data-field="stray"]');
    await act(async () => {
      field.focus();
      await Promise.resolve();
    });
    await press(field, { key: "Enter", ctrlKey: true });
    expect(areas()).toEqual(["SR-000001 Title 1", "T-2 Target 2*"]);
  });

  it("[SR-105/AK1] leaving an element for the other area saves its input at once", async () => {
    await twoElements();
    await typeIn("left", " LEFT");
    expect(writes).toEqual([]);
    await pointerDown("right");
    expect(areas()).toEqual(["SR-000001 Title 1", "SR-000002 Title 2*"]);
    expect(written.get("uuid-1")).toBe("Hello LEFT");
    // The text of the element left stays as typed.
    expect(editorIn("left").state.doc.toString()).toBe("Hello LEFT");
  });

  it("[SR-105/AK1] Close all buffers in a split saves the input of the element in the inactive area once", async () => {
    await twoElements();
    await typeIn("left", " LEFT");
    await runCommand("Other window");
    await runCommand("Close all buffers");
    await flush();
    expect(writes).toEqual(["uuid-1"]);
    expect(written.get("uuid-1")).toBe("Hello LEFT");
    expect(areas()).toEqual(["Overview*"]);
  });

  it("[SR-115/AK3] a result beside an element that reads again stays in its area; the modeline still names the element and the editor keeps the focus", async () => {
    await render();
    await runCommand("List saved filters");
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "Enter" });
    // The result was used before the list: switch to it, then to the element, so it is the one beside.
    await press(window, { key: "p", ctrlKey: true });
    await type("List saved filters");
    await press(query("input"), { key: "Enter" });
    await press(window, { key: "p", ctrlKey: true });
    await type("SR-000001");
    await press(query("input"), { key: "Enter" });
    await runCommand("Split window");
    expect(areas()).toEqual(["SR-000001 Title 1*", "List saved filters"]);
    await typeIn("left", " X");
    // A write of the window: every view that shows several elements reads again.
    await act(async () => {
      for (const listener of listeners) {
        listener({ reason: "written" });
      }
      await Promise.resolve();
    });
    await flush();
    await flush();
    expect(areas()).toEqual(["SR-000001 Title 1*", "List saved filters"]);
    expect(modeline()).toContain("SR-000001");
    expect(document.activeElement?.closest('[data-area="left"] .cm-editor')).not.toBeNull();
  });

  it("[SR-115/AK2] a split window has no tab bar: two areas, no tab, tablist or heading naming a buffer", async () => {
    await render();
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "ArrowDown" });
    await press(window, { key: "F", ctrlKey: true, shiftKey: true });
    await type("wind");
    await press(query("input"), { key: "Enter" });
    await press(query('[role="listbox"]'), { key: "ArrowDown" });
    await runCommand("Split window");
    expect(areas()).toEqual(["Search: wind*", "All elements"]);
    expect(container.querySelectorAll('[role="tab"], [role="tablist"], [role="navigation"]')).toHaveLength(0);
    for (const area of container.querySelectorAll("[data-area]")) {
      expect(area.getAttribute("aria-label")).toBeNull();
      expect(area.getAttribute("title")).toBeNull();
      expect(area.querySelector(":scope > :not([data-buffer])")).toBeNull();
    }
    // Two lists side by side share no id, and each names its own selected row.
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const list of container.querySelectorAll<HTMLElement>("[data-area] [aria-activedescendant]")) {
      const active = list.getAttribute("aria-activedescendant") ?? "";
      expect(list.querySelector(`#${CSS.escape(active)}`)).not.toBeNull();
    }
  });

  it("[SR-115/AK3] a package page that comes back in the inactive area takes no focus; the active area stays active", async () => {
    await render();
    await runCommand("List all elements");
    const list = (): HTMLElement => query('[role="listbox"]');
    for (let step = 0; step < 4; step += 1) {
      await press(list(), { key: "ArrowDown" });
    }
    await press(list(), { key: "Enter" });
    expect(areas()).toEqual(["SR-000009 Title 9*"]);
    // A member is selected: the page takes the focus into its elements when it comes back.
    await press(query("article"), { key: "n", ctrlKey: true });
    await press(window, { key: "p", code: "KeyP", altKey: true });
    for (let step = 0; step < 3; step += 1) {
      await press(list(), { key: "ArrowUp" });
    }
    await press(list(), { key: "Enter" });
    expect(areas()).toEqual(["SR-000001 Title 1*"]);
    // Back to the package page and to element 1 again, so the page is the buffer used before.
    await press(window, { key: "p", code: "KeyP", altKey: true });
    expect(areas()).toEqual(["SR-000009 Title 9*"]);
    await press(window, { key: "n", code: "KeyN", altKey: true });
    // The page's elements answer while nothing has the focus (the reader clicked beside the window).
    let answer: () => void = () => undefined;
    members = new Promise((resolve) => {
      answer = resolve;
    });
    await runCommand("Split window");
    await act(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      answer();
      await Promise.resolve();
    });
    await flush();
    expect(container.querySelector('[data-area="right"] .members [role="option"]')).not.toBeNull();
    expect(areas()).toEqual(["SR-000001 Title 1*", "SR-000009 Title 9"]);
    expect(query('[data-area="right"]').contains(document.activeElement)).toBe(false);
  });
});
