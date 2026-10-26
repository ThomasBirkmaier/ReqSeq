// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeResult, LogReqBridge, WorkspaceChange } from "../shared/protocol.js";
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
  "metamodel.get": () => ({ types: [{ key: "need" }], statuses: [{ key: "draft" }] }),
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
    expect(text("Modeline")).toBe("SR-000002needdraftWeather stationread-only");
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

  it("ignores keys that are no shortcut", async () => {
    const { bridge } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(window, "x", { ctrlKey: true });
    await keyDown(window, "a");
    expect(container.querySelector("input")).toBeNull();
  });
});
