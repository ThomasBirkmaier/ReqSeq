// @vitest-environment happy-dom
// Alt+N and Alt+P (Option+N and Option+P on macOS) in the app (SR-115 AK5): the next and the previous
// buffer in the order of opening, also while typing in the text editor, and not while a prompt is open.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import type { InvokeResult, LogReqBridge } from "../shared/protocol.js";
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
  properties: {},
  relations: [],
  ...extra,
});

type Handler = (input: Record<string, unknown>) => unknown;

/** A workspace with three elements that have a text. */
const HANDLERS: Record<string, Handler> = {
  "workspace.status": () => ({ name: "Weather station", readOnly: true }),
  "element.list": () => ({ elements: [row(1), row(2), row(3)], total: 3 }),
  "element.get": (input) => ({
    element: row(Number(String(input["ref"]).replace("uuid-", "")), { text: "Hello" }),
  }),
  // No parents: the parents line stays away.
  "trace.neighbourhood": (input) => ({
    root: input["ref"],
    nodes: [{ ...row(Number(String(input["ref"]).replace("uuid-", ""))), depth: 0, expanded: true }],
    total: 1,
    edges: [],
    incomplete: false,
  }),
  "element.search": () => ({
    hits: [{ ...row(2), score: 1, fields: ["title"], terms: ["title"] }],
    total: 1,
    incomplete: false,
  }),
  "metamodel.get": () => ({
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

const bridge: LogReqBridge = {
  invoke: (name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> =>
    Promise.resolve({ ok: true, output: HANDLERS[name]?.(input) }),
  commands: () => Promise.resolve([]),
  on: () => () => undefined,
  copyText: () => Promise.resolve(true),
  recentWorkspaces: () => Promise.resolve([]),
  openWorkspace: () => Promise.resolve({ ok: true }),
};

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

/** Presses a key on `target` and gives the event back, to see whether a handler took it. */
const press = async (target: EventTarget, init: KeyboardEventInit): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
    await Promise.resolve();
  });
  await flush();
  return event;
};

/** Alt+N or Alt+P as Linux and Windows report them. */
const alt = (target: EventTarget, letter: "n" | "p"): Promise<KeyboardEvent> =>
  press(target, { key: letter, code: `Key${letter.toUpperCase()}`, altKey: true });

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

/** The name of the shown buffer. */
const shown = (): string | null => query("[data-buffer]").getAttribute("aria-label");

const render = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(App, { bridge }));
    await Promise.resolve();
  });
  await flush();
};

/** Opens, in this order: the overview (at the start), the list of all elements, its first element, a search. */
const openFour = async (): Promise<void> => {
  await render();
  await runCommand("List all elements");
  await press(query('[role="listbox"]'), { key: "Enter" });
  expect(shown()).toBe("SR-000001 Title 1");
  await press(window, { key: "F", ctrlKey: true, shiftKey: true });
  await type("wind");
  await press(query("input"), { key: "Enter" });
  expect(shown()).toBe("Search: wind");
};

const editorView = (): EditorView => {
  const found = EditorView.findFromDOM(query(".cm-editor"));
  if (found === null) {
    throw new Error("no editor");
  }
  return found;
};

describe("App, Next buffer and Previous buffer (SR-115 AK5)", () => {
  it("[SR-115/AK5] Alt+N shows the next buffer in the order of opening and wraps; Alt+P the previous", async () => {
    await openFour();
    // Go to the element, the buffer used before the search: the order of use changes, not that of opening
    // (overview, list, element, search).
    await press(window, { key: "p", ctrlKey: true });
    await press(query("input"), { key: "Enter" });
    expect(shown()).toBe("SR-000001 Title 1");
    const next = await alt(window, "n");
    expect(next.defaultPrevented).toBe(true);
    expect(shown()).toBe("Search: wind");
    await alt(window, "n");
    expect(shown()).toBe("Overview");
    await alt(window, "n");
    expect(shown()).toBe("All elements");
    await alt(window, "p");
    expect(shown()).toBe("Overview");
    await alt(window, "p");
    expect(shown()).toBe("Search: wind");
    // The shown buffer has the focus, so its keys work.
    expect(document.activeElement).toBe(query("[data-buffer]"));
  });

  it("[SR-115/AK5] Option+N and Option+P in the text editor switch buffers by the physical key; the key is taken and the editor loses the focus", async () => {
    await render();
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "Enter" });
    await act(async () => {
      editorView().focus();
      editorView().dispatch({ changes: { from: editorView().state.doc.length, insert: " ENDE" } });
      await Promise.resolve();
    });
    await flush();
    const content = query(".cm-content");
    expect(content.contains(document.activeElement)).toBe(true);
    // macOS: Option+N is the dead key of "~".
    const next = await press(content, { key: "Dead", code: "KeyN", altKey: true });
    expect(next.defaultPrevented).toBe(true);
    expect(shown()).toBe("Overview");
    expect(container.querySelector(".cm-editor")).toBeNull();
    expect(document.activeElement?.closest(".cm-editor") ?? null).toBeNull();
    expect(document.activeElement).toBe(query("[data-buffer]"));
    // Option+P is "π": back to the list, then once more to the element, its text as it was typed.
    await press(query("[data-buffer]"), { key: "π", code: "KeyP", altKey: true });
    expect(shown()).toBe("SR-000001 Title 1");
    expect(editorView().state.doc.toString()).toBe("Hello ENDE");
    await act(async () => {
      editorView().focus();
      await Promise.resolve();
    });
    const previous = await press(query(".cm-content"), { key: "π", code: "KeyP", altKey: true });
    expect(previous.defaultPrevented).toBe(true);
    expect(shown()).toBe("All elements");
    expect(document.activeElement?.closest(".cm-editor") ?? null).toBeNull();
  });

  it("[SR-115/AK5] with one buffer Alt+N switches nothing and is not taken", async () => {
    await render();
    expect(shown()).toBe("Overview");
    const next = await alt(query("[data-buffer]"), "n");
    expect(next.defaultPrevented).toBe(false);
    expect(shown()).toBe("Overview");
  });

  it("[SR-115/AK5] in an open prompt Alt+N and Alt+P switch nothing and are left to the input", async () => {
    await openFour();
    await press(window, { key: "p", ctrlKey: true });
    const input = query("input");
    for (const letter of ["n", "p"] as const) {
      const event = await alt(input, letter);
      expect(event.defaultPrevented).toBe(false);
    }
    const dead = await press(input, { key: "Dead", code: "KeyN", altKey: true });
    expect(dead.defaultPrevented).toBe(false);
    expect(container.querySelector("input")).not.toBeNull();
    expect(shown()).toBe("Search: wind");
  });

  it('[SR-115/AK5] "Next buffer" and "Previous buffer" are commands of the prompt', async () => {
    await openFour();
    await runCommand("Next buffer");
    expect(shown()).toBe("Overview");
    await runCommand("Previous buffer");
    expect(shown()).toBe("Search: wind");
  });
});
