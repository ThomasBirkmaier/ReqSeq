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
import type { InvokeResult, ReqSeqBridge, WorkspaceChange } from "../shared/protocol.js";
import { App } from "./App.js";
import { GONE_CONFIRM_MS } from "./outside-change.js";
import { FRESH_MS } from "./outside-marks.js";
import { OUTSIDE_CHANGE } from "./use-outside-marks.js";
import { NO_SUMMARY } from "./package-summary-test-data.js";

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
      relations: [],
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
  // The elements core's store does not know: as core, from the batch that removed them until one adds
  // them again, also while their file is only being written (a pull).
  const deleted = new Set<string>();
  const invoke = vi.fn((name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> =>
    Promise.resolve(
      name.startsWith("element.") && deleted.has(String(input["ref"]))
        ? {
            ok: false,
            error: {
              code: "ref.unknown",
              message: `${String(input["ref"])} is not an element of the workspace`,
            },
          }
        : { ok: true, output: (handlers[name] ?? NO_SUMMARY[name])?.(input) },
    ),
  );
  const bridge: ReqSeqBridge = {
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
    onSave: () => () => undefined,
  };
  /** Sends changes to the window, all before it renders. */
  const send = async (...changes: WorkspaceChange[]): Promise<void> => {
    await act(async () => {
      for (const change of changes) {
        // Core's watcher calls the listeners after the change is in its store.
        for (const id of change.elements?.removed ?? []) {
          deleted.add(id);
        }
        for (const id of change.elements?.added ?? []) {
          deleted.delete(id);
        }
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
  /** Deletes the file of an element outside the app, and reports it. */
  const remove = async (id: string): Promise<void> => {
    await send({
      reason: "external",
      scope: "elements",
      elements: { added: [], changed: [], removed: [id] },
    });
  };
  const calls = (name: string): unknown[] =>
    invoke.mock.calls.filter(([called]) => called === name).map(([, input]) => input);
  return { bridge, invoke, send, outside, remove, calls, disk, deleted };
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
  vi.useRealTimers();
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

/** A read that found the file gone asks again after a batch of the watcher; still gone, it is deleted. */
const confirmGone = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(GONE_CONFIRM_MS);
  });
  await flush();
};

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

  it("[SR-106/AK3] a file being written is no deletion: removed in one batch, added in the next, the element and its editor stay editable", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
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
    // The read after the removal finds no element, as core's store during a pull: no deletion yet, and
    // keys typed now are taken.
    expect(calls("element.get")).toHaveLength(reads + 1);
    expect(editorView().state.doc.toString()).toBe("The wind blows.");
    expect(editorView().state.readOnly).toBe(false);
    expect(query('[aria-label="Minibuffer"]').textContent).toBe("");
    expect(query('[aria-label="Modeline"]').textContent).not.toContain("on disk");
    Object.assign(disk.get("uuid-1") ?? {}, { text: "The wind turned.", sha: "sha-turned" });
    await send({
      reason: "external",
      scope: "elements",
      elements: { added: ["uuid-1"], changed: [], removed: [] },
    });
    expect(calls("element.get")).toHaveLength(reads + 2);
    expect(query(".cm-editor")).toBe(editor);
    expect(editorView().state.doc.toString()).toBe("The wind turned.");
    expect(marked()).toEqual(["Text"]);
    // The added element answered: it is not asked for again, and nothing says it was deleted.
    await confirmGone();
    expect(calls("element.get")).toHaveLength(reads + 2);
    expect(editorView().state.readOnly).toBe(false);
    expect(query('[aria-label="Modeline"]').textContent).not.toContain("on disk");
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

  it("keeps the metamodel buffer for a change of elements and reads it again on a change of the metamodel (SR-130)", async () => {
    const { outside, send, calls } = await start();
    await runCommand("Show metamodel");
    expect(container.querySelector(".metamodel")).not.toBeNull();
    const metamodel = calls("metamodel.get").length;
    // Elements only: the metamodel stays, the buffer does not ask again.
    await outside("uuid-2", { title: "Show gust speed" });
    expect(calls("metamodel.get")).toHaveLength(metamodel);
    // A change of the metamodel: the app and the buffer read it again.
    await send({ reason: "external", scope: "metamodel", elements: { added: [], changed: [], removed: [] } });
    expect(calls("metamodel.get")).toHaveLength(metamodel + 2);
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

  it("[SR-106/AK3] keeps the content of an element whose file was deleted, read-only, and names the deletion", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { remove, deleted, send } = await start();
    await listAll();
    await openRow(0);
    act(() => {
      editorView().dispatch({ changes: { from: 0, insert: "Typed. " } });
    });
    await remove("uuid-1");
    await confirmGone();
    expect(editorView().state.doc.toString()).toBe("Typed. The wind blows.");
    expect(query(".cm-content").getAttribute("contenteditable")).toBe("false");
    expect(query('[aria-label="Modeline"]').textContent).toContain("deleted on disk");
    expect(query('[aria-label="Minibuffer"]').textContent).toBe(
      "N-001 See the wind was deleted on disk; its content stays here until you close the buffer",
    );
    // The file is there again: the buffer is editable, and its input on other bytes asks which holds.
    deleted.delete("uuid-1");
    await send({
      reason: "external",
      scope: "elements",
      elements: { added: ["uuid-1"], changed: [], removed: [] },
    });
    expect(query(".cm-content").getAttribute("contenteditable")).toBe("true");
    expect(editorView().state.doc.toString()).toBe("Typed. The wind blows.");
    expect(query('[aria-label="Modeline"]').textContent).not.toContain("deleted on disk");
  });

  it("[SR-106/AK3] a buffer not shown when its file is deleted shows its input again, read-only, and names the deletion", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { remove, calls } = await start();
    await listAll();
    await openRow(0);
    act(() => {
      editorView().dispatch({ changes: { from: 0, insert: "Typed. " } });
    });
    // The file goes while the buffer is shown, and the buffer is left before the deletion is certain:
    // leaving writes nothing over a file that may be gone (SR-105 AK1, SR-106), so the input stays a draft.
    await remove("uuid-1");
    await listAll();
    await openRow(1);
    expect(query("article h1").textContent).toBe("Show wind speed");
    expect(calls("element.update")).toEqual([]);
    await listAll();
    await openRow(0);
    // Shown again: the element the input was typed on, with the input, and not an error.
    expect(query("article h1").textContent).toBe("See the wind");
    expect(editorView().state.doc.toString()).toBe("Typed. The wind blows.");
    await confirmGone();
    expect(editorView().state.doc.toString()).toBe("Typed. The wind blows.");
    expect(query(".cm-content").getAttribute("contenteditable")).toBe("false");
    expect(query('[aria-label="Modeline"]').textContent).toContain("deleted on disk");
    expect(query('[aria-label="Minibuffer"]').textContent).toBe(
      "N-001 See the wind was deleted on disk; its content stays here until you close the buffer",
    );
    await keyDown(query(".cm-content"), "s", { ctrlKey: true });
    expect(calls("element.update")).toEqual([]);
  });

  it("[SR-116/AK3] with unsaved input a change from outside follows the conflict rule: no input is lost, nothing is saved over the file", async () => {
    const { outside, calls, disk } = await start();
    await listAll();
    await openRow(0);
    act(() => {
      editorView().dispatch({ changes: { from: 0, insert: "Typed. " } });
    });
    await outside("uuid-1", { text: "The wind blows hard." });
    expect(editorView().state.doc.toString()).toBe("Typed. The wind blows.");
    expect(query('[data-on-disk="Text"]').textContent).toBe("On diskThe wind blows hard.");
    expect(query('[aria-label="Modeline"]').textContent).toContain("changed on disk");
    expect(query('[aria-label="Minibuffer"]').textContent).toBe(
      'N-001 See the wind changed on disk. Resolve with "Resolve change on disk"',
    );
    await keyDown(query(".cm-content"), "s", { ctrlKey: true });
    expect(query('[aria-label="Minibuffer"]').textContent).toBe("Resolve the change on disk first");
    expect(calls("element.update")).toEqual([]);
    expect(disk.get("uuid-1")?.text).toBe("The wind blows hard.");
    // "Resolve change on disk" in the command prompt: keeping the input writes it on the new file.
    await runCommand("Resolve change on disk");
    await type("Keep");
    await keyDown(query("input"), "Enter");
    expect(calls("element.update")).toEqual([
      { ref: "uuid-1", text: "Typed. The wind blows.", expectedFileSha256: "sha-1-0+outside" },
    ]);
    expect(query('[aria-label="Modeline"]').textContent).not.toContain("on disk");
  });
});
