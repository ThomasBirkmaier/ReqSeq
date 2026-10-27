// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (#460).
import "../../../../scripts/test-support/dom-selection.mjs";
// Changes from outside the app in the window (SR-116, SR-106 AK1): core's watcher reports them as
// `workspace-changed` with the reason `external`. An element buffer reads again only for its own element,
// the other views on every change; the metamodel only on its scope. What changed is highlighted where it
// is shown, and only when the file's bytes differ from what the buffer showed.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeResult, LogReqBridge, WorkspaceChange } from "../shared/protocol.js";
import { App } from "./App.js";
import { FRESH_MS } from "./outside-marks.js";
import { OUTSIDE_CHANGE } from "./use-outside-marks.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (input: Record<string, unknown>) => unknown;

interface Stored {
  id: string;
  shortId: string;
  identifier: string;
  type: string;
  status: string;
  title: string;
  repository: string;
  file: string;
  text: string;
  properties: Record<string, unknown>;
  relations: unknown[];
  /** The bytes of the file, as `element.get` names them. */
  sha: string;
}

const stored = (n: number, type: string, title: string, identifier: string, text = ""): Stored => ({
  id: `uuid-${String(n)}`,
  shortId: identifier,
  identifier,
  type,
  status: "draft",
  title,
  repository: "spec",
  file: `f${String(n)}.md`,
  text,
  properties: {},
  relations: [],
  sha: `sha-${String(n)}-0`,
});

/** The files of the workspace: a need with two requirements below it, and a package with the first one. */
const files = (): Map<string, Stored> =>
  new Map(
    [
      {
        ...stored(1, "need", "See the wind", "N-001", "The wind blows."),
        properties: { topic: "Weather", rationale: "Sailors ask." },
      },
      stored(2, "requirement", "Show wind speed", "SR-001", "Speed."),
      stored(3, "requirement", "Show wind direction", "SR-002"),
      stored(9, "package", "Stage 3", "PKG-1"),
    ].map((element) => [element.id, element]),
  );

const view = ({ sha: _sha, ...element }: Stored) => element;

const fake = () => {
  const disk = files();
  const at = (id: unknown): Stored => {
    const found = disk.get(String(id));
    if (found === undefined) {
      throw new Error(`no element ${String(id)}`);
    }
    return found;
  };
  const listed = (): Stored[] => [1, 2, 3].map((n) => at(`uuid-${String(n)}`));
  const handlers: Record<string, Handler> = {
    "workspace.status": () => ({ name: "Weather station", readOnly: false }),
    "metamodel.get": () => ({
      types: [
        { key: "need", name: "Need", properties: ["title", "topic", "rationale"] },
        { key: "requirement", name: "Requirement", properties: [] },
        { key: "package", name: "Package", meaning: "package", properties: [] },
      ],
      statuses: [],
      properties: [
        { key: "title", name: "Title", kind: "text", meaning: "title" },
        { key: "topic", name: "Topic", kind: "text" },
        { key: "rationale", name: "Rationale", kind: "text" },
      ],
      meanings: { packages: ["packages"] },
    }),
    "element.facets": () => ({
      total: 4,
      types: [{ key: "need", name: "Need", count: 1 }],
      statuses: [],
      properties: [],
      incomplete: false,
    }),
    // The elements of the package page (`where.package`) are the first requirement; the list has the others.
    "element.list": (input) => ({
      elements: (input["selection"] === undefined ? listed() : [at("uuid-2")]).map(view),
      total: input["selection"] === undefined ? 3 : 1,
    }),
    "element.search": () => ({
      hits: [{ ...view(at("uuid-9")), score: 1, fields: ["title"], terms: ["stage"] }],
      total: 1,
      incomplete: false,
    }),
    "element.get": (input) => ({ element: view(at(input["ref"])), fileSha256: at(input["ref"]).sha }),
    "element.update": (input) => {
      const element = at(input["ref"]);
      element.text = String(input["text"]);
      element.sha = `${element.sha}+saved`;
      return { element: view(element), fileSha256: element.sha, files: [element.file], affected: 0 };
    },
    "trace.matrix": () => ({
      columns: [],
      rows: listed().map((element) => ({ ...view(element), cells: [] })),
      total: 3,
      incomplete: false,
    }),
    "trace.neighbourhood": (input) => {
      const children =
        input["ref"] === "uuid-1" && input["direction"] === "down" && input["meanings"] !== undefined;
      const node = (element: Stored, depth: number) => ({ ...view(element), depth, expanded: true });
      const edge = (source: string) => ({
        source,
        sourceRepository: "spec",
        target: "uuid-1",
        targetRepository: "spec",
        link: "relation",
        kind: "derives-from",
        meaning: "derivation",
        direction: "down",
        cyclic: false,
        repeated: false,
        outdated: false,
      });
      return children
        ? {
            root: "uuid-1",
            nodes: [node(at("uuid-1"), 0), node(at("uuid-2"), 1), node(at("uuid-3"), 1)],
            total: 3,
            edges: [edge("uuid-2"), edge("uuid-3")],
            incomplete: false,
          }
        : { root: input["ref"], nodes: [node(at(input["ref"]), 0)], total: 1, edges: [], incomplete: false };
    },
  };
  const listeners = new Set<(change: WorkspaceChange) => void>();
  const invoke = vi.fn((name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> =>
    Promise.resolve({ ok: true, output: handlers[name]?.(input) }),
  );
  const bridge: LogReqBridge = {
    invoke,
    commands: () => Promise.resolve([]),
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
  };
  /** Sends changes to the window, all before it renders. */
  const send = async (...changes: WorkspaceChange[]): Promise<void> => {
    await act(async () => {
      for (const change of changes) {
        for (const listener of listeners) {
          listener(change);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
  };
  /** Changes the file of an element outside the app, as another process does, and reports it. */
  const outside = async (id: string, change: Partial<Stored> = {}): Promise<void> => {
    const element = at(id);
    Object.assign(element, change, { sha: `${element.sha}+outside` });
    await send({
      reason: "external",
      scope: "elements",
      elements: { added: [], changed: [id], removed: [] },
    });
  };
  const calls = (name: string): unknown[] =>
    invoke.mock.calls.filter(([called]) => called === name).map(([, input]) => input);
  return { bridge, invoke, send, outside, calls, disk };
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
  vi.restoreAllMocks();
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

const click = async (target: Element): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  await flush();
};

const runCommand = async (name: string): Promise<void> => {
  await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
  await type(name);
  await keyDown(query("input"), "Enter");
};

const start = async () => {
  const workspace = fake();
  await act(async () => {
    root.render(createElement(App, { bridge: workspace.bridge }));
    await Promise.resolve();
  });
  await flush();
  return workspace;
};

/** The list of all elements, and the element of row `at` opened from it. */
const listAll = async (): Promise<void> => {
  await runCommand("List all elements");
};
const openRow = async (at: number): Promise<void> => {
  const row = container.querySelectorAll(".row")[at];
  if (row === undefined) {
    throw new Error(`no row ${String(at)}`);
  }
  await click(row);
};

const marked = (): string[] =>
  [...container.querySelectorAll(`.${OUTSIDE_CHANGE}`)].map(
    (found) => (found as HTMLElement).dataset["field"] ?? found.querySelector(".id")?.textContent ?? "",
  );

const editorView = (): EditorView => {
  const found = EditorView.findFromDOM(query(".cm-editor"));
  if (found === null) {
    throw new Error("no editor");
  }
  return found;
};

describe("App, changes from outside (SR-116, SR-106)", () => {
  it("[SR-106/AK1] shows the new content of an element without input, and the cursor keeps its place in the text", async () => {
    const { outside } = await start();
    await listAll();
    await openRow(0);
    expect(editorView().state.doc.toString()).toBe("The wind blows.");
    // The caret after "wind".
    act(() => {
      editorView().focus();
      editorView().dispatch({ selection: { anchor: "The wind".length } });
    });
    await outside("uuid-1", { text: "Now: The wind blows." });
    expect(editorView().state.doc.toString()).toBe("Now: The wind blows.");
    expect(editorView().state.selection.main.head).toBe("Now: The wind".length);
    // Typing goes where the caret was: after the same word.
    act(() => {
      editorView().dispatch(editorView().state.replaceSelection("X"));
    });
    expect(editorView().state.doc.toString()).toBe("Now: The windX blows.");
  });

  it("[SR-116/AK1] reads the shown element again only when the change names it, and highlights the field that changed", async () => {
    const { outside, calls, send } = await start();
    await listAll();
    await openRow(0);
    const reads = calls("element.get").length;
    const metamodel = calls("metamodel.get").length;
    const status = calls("workspace.status").length;
    await outside("uuid-2", { title: "Show gust speed" });
    expect(calls("element.get")).toHaveLength(reads);
    expect(marked()).toEqual([]);
    await outside("uuid-1", { text: "The wind blows hard." });
    expect(calls("element.get")).toHaveLength(reads + 1);
    expect(marked()).toEqual(["Text"]);
    // An element change asks neither the metamodel nor the status, and says nothing (D-062).
    expect(calls("metamodel.get")).toHaveLength(metamodel);
    expect(calls("workspace.status")).toHaveLength(status);
    expect(query('[aria-label="Minibuffer"]').textContent).toBe("");
    // A change that names no element of the buffer leaves it as it is.
    await send({ reason: "external", scope: "elements", elements: { added: [], changed: [], removed: [] } });
    expect(calls("element.get")).toHaveLength(reads + 1);
  });

  it("[SR-116/AK1] reads the shown element again when its change and a later one arrive before the window renders", async () => {
    const { send, calls, disk } = await start();
    await listAll();
    await openRow(0);
    const reads = calls("element.get").length;
    const element = disk.get("uuid-1");
    Object.assign(element ?? {}, { text: "The wind blows hard.", sha: "sha-1+outside" });
    await send(
      { reason: "external", scope: "elements", elements: { added: [], changed: ["uuid-1"], removed: [] } },
      { reason: "external", scope: "elements", elements: { added: [], changed: ["uuid-2"], removed: [] } },
    );
    expect(calls("element.get")).toHaveLength(reads + 1);
    expect(editorView().state.doc.toString()).toBe("The wind blows hard.");
    expect(marked()).toEqual(["Text"]);
  });

  it("keeps the element and its editor through a write in progress: removed in one batch, added in the next", async () => {
    const { send, calls, disk } = await start();
    await listAll();
    await openRow(0);
    const editor = query(".cm-editor");
    const reads = calls("element.get").length;
    await send({
      reason: "external",
      scope: "elements",
      elements: { added: [], changed: [], removed: ["uuid-1"] },
    });
    expect(calls("element.get")).toHaveLength(reads);
    expect(editorView().state.doc.toString()).toBe("The wind blows.");
    Object.assign(disk.get("uuid-1") ?? {}, { text: "The wind turned.", sha: "sha-turned" });
    await send({
      reason: "external",
      scope: "elements",
      elements: { added: ["uuid-1"], changed: [], removed: [] },
    });
    expect(calls("element.get")).toHaveLength(reads + 1);
    expect(query(".cm-editor")).toBe(editor);
    expect(editorView().state.doc.toString()).toBe("The wind turned.");
    expect(marked()).toEqual(["Text"]);
  });

  it("highlights the title when the bytes changed but no field shows it, and nothing when the bytes are the same", async () => {
    const { outside, send, calls } = await start();
    await listAll();
    await openRow(0);
    await outside("uuid-1", { status: "approved" });
    expect(marked()).toEqual(["Title"]);
    // Named again with the bytes the buffer shows (an echo of the same file): read, nothing new marked.
    const reads = calls("element.get").length;
    await send({
      reason: "external",
      scope: "elements",
      elements: { added: [], changed: ["uuid-1"], removed: [] },
    });
    expect(calls("element.get")).toHaveLength(reads + 1);
    expect(marked()).toEqual(["Title"]);
  });

  it("neither highlights nor echoes the app's own save", async () => {
    const { send } = await start();
    await listAll();
    await openRow(0);
    act(() => {
      editorView().dispatch({ changes: { from: 0, insert: "Saved: " } });
    });
    await keyDown(query(".cm-content"), "s", { ctrlKey: true });
    expect(query('[aria-label="Minibuffer"]').textContent).toBe("Saved N-001 See the wind");
    await send({ reason: "written" });
    // Even when the watcher names it within the time of a highlight, the bytes are those of the save.
    await send({
      reason: "external",
      scope: "elements",
      elements: { added: [], changed: ["uuid-1"], removed: [] },
    });
    expect(marked()).toEqual([]);
    expect(query('[aria-label="Minibuffer"]').textContent).toBe("Saved N-001 See the wind");
  });

  it("does not highlight a field with input; its input stays", async () => {
    const { outside } = await start();
    await listAll();
    await openRow(0);
    act(() => {
      editorView().dispatch({ changes: { from: 0, insert: "Typed. " } });
    });
    await outside("uuid-1", { text: "The wind blows hard.", title: "See the gusts" });
    expect(editorView().state.doc.toString()).toBe("Typed. The wind blows.");
    expect(marked()).toEqual(["Title"]);
  });

  it("does not highlight a property box with input, and highlights the box without", async () => {
    const { outside } = await start();
    await listAll();
    await openRow(0);
    const topic = EditorView.findFromDOM(query('[data-field="topic"] .cm-editor'));
    act(() => {
      topic?.dispatch({ changes: { from: topic.state.doc.length, insert: " and climate" } });
    });
    await outside("uuid-1", { properties: { topic: "Climate", rationale: "Pilots ask." } });
    expect(marked()).toEqual(["rationale"]);
    expect(topic?.state.doc.toString()).toBe("Weather and climate");
    expect(query('[data-field="rationale"]').textContent).toContain("Pilots ask.");
  });

  it("[SR-116/AK1] reads a list again on any element change, keeps its rows and selection meanwhile, and highlights the row", async () => {
    const { outside, calls, invoke } = await start();
    await listAll();
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    const lists = calls("element.list").length;
    // The answer of the list comes later: the rows stay until it is there.
    let answer: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const plain = invoke.getMockImplementation();
    invoke.mockImplementation(async (name, input) => {
      if (name === "element.list") {
        await waiting;
      }
      return plain === undefined ? { ok: true, output: undefined } : plain(name, input);
    });
    await outside("uuid-2", { title: "Show gust speed" });
    expect(calls("element.list")).toHaveLength(lists + 1);
    expect(container.querySelectorAll(".row")).toHaveLength(3);
    expect(query('.row[aria-selected="true"] .id').textContent).toBe("SR-001");
    expect(query('[aria-label="Modeline"]').textContent).toContain("3");
    await act(async () => {
      answer();
      await waiting;
    });
    await flush();
    expect(query('.row[aria-selected="true"] .title').textContent).toBe("Show gust speed");
    expect(marked()).toEqual(["SR-001"]);
  });

  it("opens the selected row with Enter while the list is asked again after a change from outside", async () => {
    const { outside, calls, invoke } = await start();
    await listAll();
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    // The answer of the list never comes in this test: the kept rows stay what they open.
    const plain = invoke.getMockImplementation();
    invoke.mockImplementation(async (name, input) =>
      name === "element.list"
        ? new Promise<never>(() => undefined)
        : plain === undefined
          ? { ok: true, output: undefined }
          : plain(name, input),
    );
    await outside("uuid-3", { title: "Show wind origin" });
    const reads = calls("element.get").length;
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(calls("element.get").slice(reads)).toEqual([{ ref: "uuid-2", repository: "spec" }]);
    expect(query("h1").textContent).toContain("Show wind speed");
  });

  it("highlights the row element of the matrix and a row of the neighbourhood", async () => {
    const { outside } = await start();
    await listAll();
    await keyDown(query('[role="listbox"]'), "t", { ctrlKey: true });
    query(".matrix");
    await outside("uuid-3", { title: "Show the wind direction" });
    expect([...container.querySelectorAll(`td.${OUTSIDE_CHANGE} .id`)].map((id) => id.textContent)).toEqual([
      "SR-002",
    ]);
    await keyDown(query("table"), "t", { ctrlKey: true });
    await openRow(0);
    await keyDown(window, "j", { ctrlKey: true });
    query(".neighbourhood");
    await outside("uuid-2", { title: "Show the wind speed" });
    // SR-002 changed less than 2 s ago and is shown now: it is highlighted too.
    expect(marked()).toEqual(["SR-001", "SR-002"]);
  });

  it("highlights the elements of a package page and a recent element of the overview", async () => {
    const { outside } = await start();
    await keyDown(window, "p", { ctrlKey: true });
    await type("Stage");
    await keyDown(query("input"), "Enter");
    expect(query(".members .row .id").textContent).toBe("SR-001");
    await outside("uuid-2", { title: "Show the gust speed" });
    expect(marked()).toEqual(["SR-001"]);
    await runCommand("Show overview");
    await outside("uuid-9", { title: "Stage three" });
    expect(marked()).toEqual(["PKG-1"]);
  });

  it("highlights an element that is shown within 2 s of its change, as the follow mode opens it, and not later", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { outside } = await start();
    await listAll();
    await outside("uuid-2", { text: "Faster." });
    await outside("uuid-3", { text: "North." });
    now += FRESH_MS - 1;
    await openRow(1);
    expect(marked()).toEqual(["Title"]);
    await runCommand("List all elements");
    now += 2;
    await openRow(2);
    expect(marked()).toEqual([]);
  });

  it("reads everything again, the metamodel too, and highlights nothing for a change of the workspace (more than 1,000 elements)", async () => {
    const { send, calls } = await start();
    await listAll();
    await openRow(0);
    const metamodel = calls("metamodel.get").length;
    const reads = calls("element.get").length;
    await send({ reason: "external", scope: "workspace", elements: { added: [], changed: [], removed: [] } });
    expect(calls("metamodel.get")).toHaveLength(metamodel + 1);
    expect(calls("element.get").length).toBeGreaterThan(reads);
    expect(marked()).toEqual([]);
    expect(query('[aria-label="Minibuffer"]').textContent).toBe("");
  });

  it("reads the metamodel again on its scope and still highlights the elements the batch names", async () => {
    const { send, calls, disk } = await start();
    await listAll();
    await openRow(0);
    const metamodel = calls("metamodel.get").length;
    const element = disk.get("uuid-1");
    if (element !== undefined) {
      Object.assign(element, { text: "Calm.", sha: "sha-new" });
    }
    await send({
      reason: "external",
      scope: "metamodel",
      elements: { added: [], changed: ["uuid-1"], removed: [] },
    });
    expect(calls("metamodel.get")).toHaveLength(metamodel + 1);
    expect(marked()).toEqual(["Text"]);
  });
});
