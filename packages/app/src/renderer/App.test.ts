// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeResult, LogReqBridge, WorkspaceChange } from "../shared/protocol.js";
import { EditorView } from "@codemirror/view";
import { App } from "./App.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (input: Record<string, unknown>) => unknown;

/** A bridge that answers each command with `handlers[name](input)`; an Error is the error of the command. */
const fakeBridge = (handlers: Record<string, Handler>) => {
  const listeners = new Set<(change: WorkspaceChange) => void>();
  const invoke = vi.fn((name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> => {
    const output = handlers[name]?.(input);
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, error: { code: "x.failed", message: output.message } as never }
        : { ok: true, output },
    );
  });
  const bridge: LogReqBridge = {
    invoke,
    commands: () => Promise.resolve([]),
    on: (_event, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const change = async (reason: WorkspaceChange["reason"]): Promise<void> => {
    await act(async () => {
      for (const listener of listeners) {
        listener({ reason });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return { bridge, invoke, change, listeners, handlers };
};

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

const STATUS = { name: "Weather station", readOnly: true };
const NO_WORKSPACE = new Error("No workspace is open. Open one with File > Open Workspace.");

/** The commands of a workspace with three elements. */
const workspace = (): Record<string, Handler> => ({
  "workspace.status": () => STATUS,
  "element.list": () => ({ elements: [row(1), row(2), row(3)], total: 3 }),
  "element.get": (input) => ({
    element: row(Number(String(input["ref"]).replace("uuid-", "")), {
      versionDate: "2026-10-24T10:00:00Z",
      relations: [
        {
          kind: "derives-from",
          direction: "out",
          id: "uuid-3",
          shortId: "SR-000003",
          title: "Title 3",
          accessible: true,
          targetState: "available",
        },
      ],
    }),
  }),
  "element.search": () => ({
    hits: [{ ...row(2), score: 1, fields: ["title"], terms: ["title"] }],
    total: 1,
    incomplete: false,
  }),
  "metamodel.get": () => ({ types: [{ key: "need", name: "Need" }], statuses: [{ key: "draft" }] }),
  "filter.list": () => ({ filters: [] }),
});

let container: HTMLElement;
let root: Root;

beforeEach(() => {
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

const render = async (bridge: LogReqBridge): Promise<void> => {
  await act(async () => {
    root.render(createElement(App, { bridge }));
    await Promise.resolve();
  });
  await flush();
};

const text = (label: string): string | null | undefined =>
  container.querySelector(`[aria-label="${label}"]`)?.textContent;

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
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
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
    // React tracks the value; only the prototype's setter lets it see the change.
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

/** Opens the command prompt, types `name` and runs the first candidate. */
const runCommand = async (name: string): Promise<void> => {
  await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
  await type(name);
  await keyDown(query("input"), "Enter");
};

const calls = (invoke: ReturnType<typeof fakeBridge>["invoke"], name: string): unknown[] =>
  invoke.mock.calls.filter(([called]) => called === name).map(([, input]) => input);

describe("App", () => {
  it("is a white sheet with the modeline and the minibuffer; empty until the status is there", async () => {
    let answer: (result: InvokeResult) => void = () => undefined;
    const bridge: LogReqBridge = {
      invoke: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      commands: () => Promise.resolve([]),
      on: () => () => undefined,
    };
    await render(bridge);
    expect(container.querySelector('main[aria-label="Sheet"]')?.childElementCount).toBe(0);
    expect(text("Modeline")).toBe("");
    expect(text("Minibuffer")).toBe("");
    await act(async () => {
      answer({ ok: true, output: STATUS });
      await Promise.resolve();
    });
    // The list is asked for; until it answers, the modeline names the buffer.
    expect(text("Modeline")).toBe("All elementsWeather stationread-only");
    expect(document.title).toBe("Weather station - LogReq");
  });

  it("shows the list of all elements, its count in the modeline, and gives the list the focus", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await render(bridge);
    expect(calls(invoke, "element.list")).toEqual([{ limit: 200, offset: 0 }]);
    expect([...container.querySelectorAll(".row .title")].map((title) => title.textContent)).toEqual([
      "Title 1",
      "Title 2",
      "Title 3",
    ]);
    expect(text("Modeline")).toBe("All elements3 elementsWeather stationread-only");
    expect(text("Minibuffer")).toBe("");
    expect(document.activeElement).toBe(query('[role="listbox"]'));
  });

  it("says why no workspace is open, and then has no buffer and no shortcuts", async () => {
    const { bridge, invoke } = fakeBridge({ "workspace.status": () => NO_WORKSPACE });
    await render(bridge);
    expect(text("Modeline")).toBe("No workspace");
    expect(text("Minibuffer")).toBe("No workspace is open. Open one with File > Open Workspace.");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    await click(query(".echo"));
    expect(container.querySelector("input")).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("opens the command prompt with Ctrl+Shift+P or Cmd+Shift+P, lists what applies and closes it with Escape", async () => {
    const { bridge } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    expect(query("label").textContent).toBe("Command");
    expect(
      [...container.querySelectorAll('[role="option"] .name')].map((name) => name.textContent),
    ).toContain("Sort list");
    expect(document.activeElement).toBe(query("input"));
    await keyDown(query("input"), "Escape");
    expect(container.querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(query('[role="listbox"]'));
    await keyDown(window, "p", { metaKey: true, shiftKey: true });
    expect(query("label").textContent).toBe("Command");
  });

  it("opens the command prompt with a click on the idle minibuffer", async () => {
    const { bridge } = fakeBridge(workspace());
    await render(bridge);
    await click(query(".echo"));
    expect(query("label").textContent).toBe("Command");
  });

  it("opens an element from the list, shows it with its modeline, and Ctrl+P Enter goes back with the selection kept", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(calls(invoke, "element.get")).toEqual([{ ref: "uuid-2", repository: "spec" }]);
    expect(query("article h1").textContent).toBe("Title 2");
    expect(text("Modeline")).toBe("SR-000002 · Need · draftWeather stationread-only");
    expect(document.activeElement).toBe(query("article"));
    await keyDown(window, "p", { ctrlKey: true });
    expect(query("label").textContent).toBe("Go to");
    expect([...container.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual([
      "All elements",
    ]);
    await keyDown(query("input"), "Enter");
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("All elements");
    expect(query('[aria-selected="true"]').id).toBe("row-1");
  });

  it("[SR-114/AK1] the modeline of an open element names its ID, its type and its status", async () => {
    const { bridge } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftWeather stationread-only");
  });

  it("shows the type key in the modeline when the metamodel cannot be read", async () => {
    const { bridge, handlers, change } = fakeBridge(workspace());
    await render(bridge);
    handlers["metamodel.get"] = () => new Error("The metamodel is broken");
    await change("opened");
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(text("Modeline")).toBe("SR-000001 · need · draftWeather stationread-only");
    // No workspace: no names either.
    handlers["workspace.status"] = () => NO_WORKSPACE;
    await change("opened");
    expect(text("Modeline")).toBe("No workspace");
  });

  it("jumps to an element that core finds by its title", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(window, "p", { ctrlKey: true });
    await type("title");
    expect(calls(invoke, "element.search")).toEqual([{ query: "title", fields: ["id", "title"], limit: 20 }]);
    await keyDown(query("input"), "Enter");
    expect(query("article h1").textContent).toBe("Title 2");
  });

  it("searches with Ctrl+Shift+F and opens a search buffer", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(window, "F", { ctrlKey: true, shiftKey: true });
    expect(query("label").textContent).toBe("Search");
    await type("title");
    await keyDown(query("input"), "Enter");
    expect(calls(invoke, "element.search")).toContainEqual({ query: "title", limit: 50, offset: 0 });
    expect(text("Modeline")).toBe("Search: title1 hitWeather stationread-only");
  });

  it("opens the target of a relation, and echoes why it cannot be opened", async () => {
    const { bridge, invoke, handlers } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    await click(query('[role="link"]'));
    expect(calls(invoke, "element.get")).toContainEqual({ ref: "uuid-3" });
    expect(query("article h1").textContent).toBe("Title 3");
    handlers["element.get"] = () => new Error('More than one element has the ID "uuid-3"');
    await click(query('[role="link"]'));
    expect(text("Minibuffer")).toBe('More than one element has the ID "uuid-3"');
    expect(query("article h1").textContent).toBe("Title 3");
  });

  it("filters the list by a type through the command prompt", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await render(bridge);
    await runCommand("filter list by type");
    expect(query("label").textContent).toBe("Type");
    await keyDown(query("input"), "Enter");
    expect(calls(invoke, "element.list").at(-1)).toEqual({
      selection: { where: { type: ["need"] } },
      limit: 200,
      offset: 0,
    });
    expect(text("Modeline")).toBe("type: need3 elementsWeather stationread-only");
    expect(document.activeElement).toBe(query('[role="listbox"]'));
  });

  it("echoes the UUID and the date of the version on request, never the check value", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    await runCommand("show element id");
    expect(calls(invoke, "element.get").at(-1)).toEqual({
      ref: "uuid-1",
      repository: "spec",
      versionDate: true,
    });
    expect(text("Minibuffer")).toBe("uuid-1 · version of 2026-10-24T10:00:00Z · spec:f1.md");
  });

  it("clears the last message when a prompt opens", async () => {
    const { bridge, handlers } = fakeBridge(workspace());
    await render(bridge);
    handlers["metamodel.get"] = () => new Error("The metamodel is not valid");
    await runCommand("filter list by type");
    expect(text("Minibuffer")).toBe("The metamodel is not valid");
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    expect(text("Minibuffer")).toContain("Command");
    expect(text("Minibuffer")).not.toContain("not valid");
  });

  it("asks again for what it shows when files were written or the core process restarted", async () => {
    const { bridge, invoke, change } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(calls(invoke, "element.get")).toHaveLength(1);
    await change("written");
    expect(calls(invoke, "element.get")).toHaveLength(2);
    expect(text("Minibuffer")).toBe("");
    expect(calls(invoke, "workspace.status")).toHaveLength(2);
    await change("restarted");
    expect(calls(invoke, "element.get")).toHaveLength(3);
    expect(text("Minibuffer")).toBe("The core process stopped and was started again.");
    expect(query("article h1").textContent).toBe("Title 1");
  });

  it("starts again with the list when another workspace is opened, and drops the prompt", async () => {
    const { bridge, invoke, handlers, change } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    handlers["workspace.status"] = () => ({ name: "Other", readOnly: false });
    await change("opened");
    expect(container.querySelector("input")).toBeNull();
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("All elements");
    expect(text("Modeline")).toBe("All elements3 elementsOther");
    expect(document.title).toBe("Other - LogReq");
    expect(invoke).toHaveBeenCalled();
  });

  it("asks for the list again when another workspace is opened while the list is shown", async () => {
    const { bridge, handlers, change } = fakeBridge(workspace());
    await render(bridge);
    expect(text("Modeline")).toBe("All elements3 elementsWeather stationread-only");
    handlers["workspace.status"] = () => ({ name: "Other", readOnly: false });
    handlers["element.list"] = () => ({ elements: [row(9)], total: 1 });
    await change("opened");
    expect([...container.querySelectorAll(".row .title")].map((title) => title.textContent)).toEqual([
      "Title 9",
    ]);
    expect(text("Modeline")).toBe("All elements1 elementOther");
  });

  it("does not show the count of the list before a filter when the new list fails", async () => {
    const { bridge, handlers } = fakeBridge(workspace());
    await render(bridge);
    expect(text("Modeline")).toContain("3 elements");
    handlers["element.list"] = () => new Error("The metamodel is not valid");
    await runCommand("filter list by type");
    await keyDown(query("input"), "Enter");
    expect(text("Modeline")).toBe("type: needWeather stationread-only");
  });

  it("empties the sheet when the workspace that was opened is none", async () => {
    const { bridge, handlers, change } = fakeBridge(workspace());
    await render(bridge);
    handlers["workspace.status"] = () => NO_WORKSPACE;
    await change("opened");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(text("Modeline")).toBe("No workspace");
    expect(document.title).toBe("LogReq");
  });

  it("keeps the buffers and sends nothing more when the core process has stopped for good", async () => {
    const { bridge, invoke, handlers, change } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    const before = invoke.mock.calls.length;
    await change("stopped");
    expect(invoke).toHaveBeenCalledTimes(before);
    expect(query("article h1").textContent).toBe("Title 1");
    expect(text("Minibuffer")).toBe(
      "The core process keeps stopping. Open the workspace again with File > Open Workspace.",
    );
    expect(text("Modeline")).toContain("stopped");
    await runCommand("show element id");
    expect(invoke).toHaveBeenCalledTimes(before);
    expect(text("Minibuffer")).toBe(
      "The core process keeps stopping. Open the workspace again with File > Open Workspace.",
    );
    handlers["workspace.status"] = () => ({ name: "Again", readOnly: false });
    await change("opened");
    expect(text("Modeline")).toBe("All elements3 elementsAgain");
  });

  it("stops listening and ignores late answers once it is gone", async () => {
    let answer: (result: InvokeResult) => void = () => undefined;
    const { bridge, listeners } = fakeBridge({});
    bridge.invoke = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    await render(bridge);
    expect(listeners.size).toBe(1);
    act(() => {
      root.unmount();
    });
    expect(listeners.size).toBe(0);
    answer({ ok: true, output: STATUS });
    await Promise.resolve();
    root = createRoot(container);
  });

  it("ignores the answer about the types that comes after it is gone", async () => {
    let names: (result: InvokeResult) => void = () => undefined;
    const { bridge, invoke } = fakeBridge(workspace());
    bridge.invoke = (name, input) =>
      name === "metamodel.get"
        ? new Promise((resolve) => {
            names = resolve;
          })
        : invoke(name, input as Record<string, unknown>);
    await render(bridge);
    act(() => {
      root.unmount();
    });
    names({ ok: true, output: { types: [{ key: "need", name: "Need" }], statuses: [] } });
    await Promise.resolve();
    root = createRoot(container);
  });

  it.each(["MacIntel", "Win32", "Linux x86_64"])(
    "[SR-122/AK2] on %s, Ctrl+N and Ctrl+P in an open prompt only move the selection",
    async (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const { bridge } = fakeBridge(workspace());
      await render(bridge);
      const selected = (): string | undefined =>
        container.querySelector('.candidates [aria-selected="true"]')?.textContent ?? undefined;
      // The command prompt: Ctrl+P must not jump.
      await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
      const first = selected();
      await keyDown(query("input"), "n", { ctrlKey: true });
      expect(selected()).not.toBe(first);
      expect(query("label").textContent).toBe("Command");
      await keyDown(query("input"), "p", { ctrlKey: true });
      expect(selected()).toBe(first);
      expect(query("label").textContent).toBe("Command");
      await keyDown(query("input"), "Escape");
      // The jump prompt: Ctrl+P in it moves the selection and stays "Go to".
      await keyDown(window, "p", { ctrlKey: true });
      expect(query("label").textContent).toBe("Go to");
      await keyDown(query("input"), "p", { ctrlKey: true });
      expect(query("label").textContent).toBe("Go to");
    },
  );

  it("[SR-122/AK1] Ctrl+N and Ctrl+P move through the hits of the go-to prompt", async () => {
    const { bridge } = fakeBridge(workspace());
    await render(bridge);
    // Two more buffers behind the shown one.
    await keyDown(query('[role="listbox"]'), "Enter");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "Enter");
    await keyDown(window, "p", { ctrlKey: true });
    const selected = (): string | null | undefined =>
      container.querySelector('.candidates [aria-selected="true"]')?.textContent;
    const names = [...container.querySelectorAll('.candidates [role="option"]')].map(
      (option) => option.textContent,
    );
    expect(names.length).toBeGreaterThan(1);
    expect(selected()).toBe(names[0]);
    await keyDown(query("input"), "n", { ctrlKey: true });
    expect(selected()).toBe(names[1]);
    await keyDown(query("input"), "p", { ctrlKey: true });
    expect(selected()).toBe(names[0]);
    await keyDown(query("input"), "ArrowDown");
    expect(selected()).toBe(names[1]);
  });

  it("a key that a control handled is no shortcut", async () => {
    const { bridge } = fakeBridge(workspace());
    await render(bridge);
    const handled = (event: Event): void => {
      event.preventDefault();
    };
    document.body.addEventListener("keydown", handled);
    await keyDown(query("main"), "P", { ctrlKey: true, shiftKey: true });
    document.body.removeEventListener("keydown", handled);
    expect(container.querySelector("input")).toBeNull();
    await keyDown(query("main"), "P", { ctrlKey: true, shiftKey: true });
    expect(query("label").textContent).toBe("Command");
  });

  it("ignores keys that are no shortcut", async () => {
    const { bridge } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(window, "x", { ctrlKey: true });
    await keyDown(window, "a");
    expect(container.querySelector("input")).toBeNull();
  });
});

describe("App, the text editor", () => {
  /** A workspace whose elements have a text, and that saves it with a final line break. */
  const withText = (): Record<string, Handler> => {
    const handlers = workspace();
    handlers["element.get"] = (input) => ({
      element: row(Number(String(input["ref"]).replace("uuid-", "")), { text: "Hello", relations: [] }),
    });
    handlers["element.update"] = (input) => ({
      element: row(1, { text: `${String(input["text"])}\n`, relations: [] }),
      files: ["f1.md"],
      affected: 0,
    });
    return handlers;
  };
  const editorView = (): EditorView => {
    const found = EditorView.findFromDOM(query(".cm-editor"));
    if (found === null) {
      throw new Error("no editor");
    }
    return found;
  };
  const typeText = async (insert: string): Promise<void> => {
    await act(async () => {
      editorView().dispatch({ changes: { from: editorView().state.doc.length, insert } });
      await Promise.resolve();
    });
    await flush();
  };
  const openElement = async (handlers = withText()) => {
    const fake = fakeBridge(handlers);
    await render(fake.bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    return fake;
  };

  it("shows the text of the element in the editor", async () => {
    await openElement();
    expect(editorView().state.doc.toString()).toBe("Hello");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftWeather stationread-only");
  });

  it("shows modified in the modeline while the text has unsaved changes", async () => {
    await openElement();
    await typeText("!");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftmodifiedWeather stationread-only");
  });

  it("saves with Ctrl+S or Cmd+S: element.update, Saved in the minibuffer, no modified", async () => {
    const { invoke, change } = await openElement();
    await typeText("!");
    await keyDown(query(".cm-content"), "s", { ctrlKey: true });
    expect(calls(invoke, "element.update")).toEqual([{ ref: "uuid-1", text: "Hello!" }]);
    expect(text("Minibuffer")).toBe("Saved SR-000001 Title 1");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftWeather stationread-only");
    expect(editorView().state.doc.toString()).toBe("Hello!\n");
    // The write reports itself as a change of the workspace; the message of the save stays.
    await change("written");
    expect(text("Minibuffer")).toBe("Saved SR-000001 Title 1");
    expect(query(".cm-editor")).not.toBeNull();
    await keyDown(window, "s", { metaKey: true });
    expect(text("Minibuffer")).toBe("No changes to save");
    await typeText("?");
    await keyDown(window, "s", { metaKey: true });
    expect(calls(invoke, "element.update")).toHaveLength(2);
  });

  it("keeps the editor, with its undo history, when the save is reported as a change of the workspace", async () => {
    const { change } = await openElement();
    const editor = query(".cm-editor");
    await typeText("!");
    await keyDown(window, "s", { ctrlKey: true });
    await change("written");
    await change("restarted");
    expect(query(".cm-editor")).toBe(editor);
  });

  it("saves from the command prompt, and offers editing there", async () => {
    const { invoke } = await openElement();
    await typeText("!");
    await runCommand("save element");
    expect(calls(invoke, "element.update")).toHaveLength(1);
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    expect([...container.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toContain(
      "Edit textEnter",
    );
    await keyDown(query("input"), "Escape");
    await runCommand("edit text");
    expect(editorView().hasFocus).toBe(true);
  });

  it("does not save on a list", async () => {
    const { bridge, invoke } = fakeBridge(withText());
    await render(bridge);
    await keyDown(window, "s", { ctrlKey: true });
    expect(calls(invoke, "element.update")).toEqual([]);
    expect(text("Minibuffer")).toBe("");
  });

  it("keeps the unsaved text of a buffer while another one is shown", async () => {
    await openElement();
    await typeText("!");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    expect(query('[role="listbox"]')).not.toBeNull();
    expect(text("Modeline")).toBe("All elements3 elementsWeather stationread-only");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    expect(editorView().state.doc.toString()).toBe("Hello!");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftmodifiedWeather stationread-only");
  });

  it("keeps the unsaved text and says the file changed on disk when it changed while another buffer was shown", async () => {
    const { handlers } = await openElement();
    await typeText("!");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    handlers["element.get"] = (input) => ({
      element: row(Number(String(input["ref"]).replace("uuid-", "")), { text: "Changed", relations: [] }),
    });
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    expect(text("Minibuffer")).toBe(
      "SR-000001 Title 1 changed on disk; your unsaved changes are kept. Saving overwrites the file.",
    );
    expect(editorView().state.doc.toString()).toBe("Hello!");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftmodifiedWeather stationread-only");
  });

  it("asks before closing a buffer with unsaved text, and discards it when closing is repeated", async () => {
    await openElement();
    await typeText("!");
    await runCommand("close buffer");
    expect(text("Minibuffer")).toBe(
      "SR-000001 Title 1 has unsaved changes: Ctrl+S saves them, closing again discards them",
    );
    expect(query("article")).not.toBeNull();
    await runCommand("close buffer");
    expect(query('[role="listbox"]')).not.toBeNull();
    // Opened again, the element shows its saved text.
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(editorView().state.doc.toString()).toBe("Hello");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftWeather stationread-only");
  });

  it("asks again when text was typed after the question, or another action ran", async () => {
    await openElement();
    await typeText("!");
    await runCommand("close buffer");
    await typeText("?");
    await runCommand("close buffer");
    expect(query("article")).not.toBeNull();
    await runCommand("show element id");
    await runCommand("close buffer");
    expect(query("article")).not.toBeNull();
    // Another buffer in between ends the question as well.
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    await runCommand("close buffer");
    expect(query("article")).not.toBeNull();
  });

  it("[SR-123/AK1] Close all buffers from the command prompt leaves no buffer", async () => {
    await openElement();
    await runCommand("search elements");
    await type("title");
    await keyDown(query("input"), "Enter");
    await runCommand("close all buffers");
    expect(container.querySelector("[data-buffer]")).toBeNull();
    expect(query("main").childElementCount).toBe(0);
    expect(text("Minibuffer")).toBe("Closed 3 buffers");
    expect(text("Modeline")).toBe("Weather stationread-only");
    // No buffer is left to go to, and the global keys still work.
    await keyDown(window, "p", { ctrlKey: true });
    expect(query("label").textContent).toBe("Go to");
    expect(container.querySelectorAll(".candidates [role=option]")).toHaveLength(0);
  });

  it("[SR-123/AK2] asks in the minibuffer about unsaved text, without a dialog; Enter keeps the unsaved buffer", async () => {
    await openElement();
    await typeText("!");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    // The element has unsaved text, the list in front of it does not.
    await runCommand("close all buffers");
    expect(query("label").textContent).toBe("1 buffer with unsaved changes (SR-000001 Title 1)");
    expect(
      [...container.querySelectorAll(".candidates [role=option]")].map((option) => option.textContent),
    ).toEqual([
      "Close all but the buffers with unsaved changes",
      "Close all and discard the unsaved changes",
    ]);
    expect(container.querySelector("dialog, [role=dialog], [role=alertdialog], [aria-modal]")).toBeNull();
    // Escape closes the question and keeps every buffer.
    await keyDown(query("input"), "Escape");
    expect(container.querySelector("input")).toBeNull();
    await keyDown(window, "p", { ctrlKey: true });
    expect(container.querySelectorAll(".candidates [role=option]")).toHaveLength(1);
    await keyDown(query("input"), "Escape");
    // Plain Enter takes the first choice: the buffer with unsaved text stays, and is still modified.
    await runCommand("close all buffers");
    await keyDown(query("input"), "Enter");
    expect(text("Minibuffer")).toBe("Closed 1 buffer");
    expect(editorView().state.doc.toString()).toBe("Hello!");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftmodifiedWeather stationread-only");
    // The second choice closes everything and drops the unsaved text.
    await runCommand("close all buffers");
    await keyDown(query("input"), "ArrowDown");
    await keyDown(query("input"), "Enter");
    expect(container.querySelector("[data-buffer]")).toBeNull();
    expect(text("Minibuffer")).toBe("Closed 1 buffer");
    await runCommand("go to element");
    await type("title");
    await keyDown(query("input"), "Enter");
    expect(editorView().state.doc.toString()).toBe("Hello");
    expect(text("Modeline")).not.toContain("modified");
  });

  it("closes a buffer without unsaved text at once", async () => {
    await openElement();
    await runCommand("close buffer");
    expect(query('[role="listbox"]')).not.toBeNull();
  });

  it("drops the unsaved text when another workspace is opened", async () => {
    const { handlers, change } = await openElement();
    await typeText("!");
    handlers["workspace.status"] = () => ({ name: "Other", readOnly: false });
    await change("opened");
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(editorView().state.doc.toString()).toBe("Hello");
    expect(text("Modeline")).not.toContain("modified");
  });

  describe("inline references (#424)", () => {
    const TARGET = "00000000-0000-4000-8000-000000000002";
    const withReference = (link: string): Record<string, Handler> => {
      const handlers = withText();
      handlers["element.get"] = (input) =>
        input["ref"] === TARGET || input["ref"] === "uuid-2"
          ? { element: row(2, { text: "Target", relations: [] }) }
          : { element: row(1, { text: `${link} tail`, relations: [] }) };
      return handlers;
    };

    /** The questions for the element with this UUID. */
    const asked = (invoke: ReturnType<typeof fakeBridge>["invoke"], ref: string): unknown[] =>
      calls(invoke, "element.get").filter((input) => (input as { ref: string }).ref === ref);

    it("follows an inline reference with Ctrl+Enter, and Follow reference is in the command prompt with its key", async () => {
      const { invoke } = await openElement(withReference(`[Two](logreq:${TARGET}?version=n1:aa)`));
      await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
      expect([...container.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toContain(
        "Follow referenceCtrl+Enter",
      );
      await keyDown(query("input"), "Escape");
      await keyDown(query("article"), "Enter", { ctrlKey: true });
      expect(asked(invoke, TARGET)).toEqual([{ ref: TARGET }]);
      expect(query("article h1").textContent).toBe("Title 2");
    });

    it("opens a reference that names a repository in that repository", async () => {
      const { invoke } = await openElement(withReference(`[Two](logreq:${TARGET}?repository=r2)`));
      await runCommand("follow reference");
      expect(asked(invoke, TARGET)).toEqual([{ ref: TARGET, repository: "r2" }]);
    });

    it("says when there is no reference at the cursor", async () => {
      await openElement(withReference("plain text"));
      await keyDown(query("article"), "Enter", { metaKey: true });
      expect(text("Minibuffer")).toBe("No element reference at the cursor");
    });

    it("says why a reference cannot be opened, and keeps the element", async () => {
      const { handlers } = await openElement(withReference(`[Two](logreq:${TARGET})`));
      handlers["element.get"] = () => new Error(`More than one element has the ID "${TARGET}"`);
      await keyDown(query("article"), "Enter", { ctrlKey: true });
      expect(text("Minibuffer")).toBe(`More than one element has the ID "${TARGET}"`);
      expect(query("article h1").textContent).toBe("Title 1");
    });

    it("Ctrl+Enter in an open prompt runs the candidate only", async () => {
      const { invoke } = await openElement(withReference(`[Two](logreq:${TARGET}?version=n1:aa)`));
      await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
      await type("go to");
      await keyDown(query("input"), "Enter", { ctrlKey: true });
      expect(query("label").textContent).toBe("Go to");
      expect(asked(invoke, TARGET)).toEqual([]);
    });
  });

  it("gives the editor the focus on Enter on the buffer, and the buffer on Escape", async () => {
    await openElement();
    expect(document.activeElement).toBe(query("article"));
    await keyDown(query("article"), "Enter");
    expect(editorView().hasFocus).toBe(true);
    await keyDown(query(".cm-content"), "Escape");
    expect(document.activeElement).toBe(query("article"));
  });
});
