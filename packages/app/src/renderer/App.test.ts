// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeResult, LogReqBridge, WorkspaceChange } from "../shared/protocol.js";
import { EditorView } from "@codemirror/view";
import { App } from "./App.js";
import { DEFAULT_SORT } from "./buffers.js";
import { NOTICE_MS } from "./copy.js";

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
  const copyText = vi.fn<(text: string) => Promise<boolean>>(() => Promise.resolve(true));
  const bridge: LogReqBridge = {
    invoke,
    commands: () => Promise.resolve([]),
    on: (_event, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    copyText,
  };
  const change = async (reason: WorkspaceChange["reason"]): Promise<void> => {
    await act(async () => {
      for (const listener of listeners) {
        listener({ reason });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return { bridge, invoke, change, listeners, handlers, copyText };
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
          repository: "spec",
          shortId: "SR-000003",
          title: "Title 3",
          accessible: true,
          targetState: "available",
        },
      ],
    }),
  }),
  // No parents, children or incoming links: the parents line stays away.
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
  "filter.list": () => ({ filters: [] }),
  "element.facets": () => ({
    total: 3,
    types: [{ key: "need", name: "Need", count: 3 }],
    statuses: [{ key: "draft", count: 3 }],
    properties: [],
    incomplete: false,
  }),
});

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  // The recent elements of the overview are kept in the local storage, which the tests share.
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
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
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

/** Opens the full list: the app starts with the overview, the list only on request (SR-118 AK4). */
const listAll = async (): Promise<void> => {
  await runCommand("List all elements");
};

const renderList = async (bridge: LogReqBridge): Promise<void> => {
  await render(bridge);
  await listAll();
};

const texts = (selector: string): string[] =>
  [...container.querySelectorAll(selector)].map((element) => element.textContent);

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
      copyText: () => Promise.resolve(true),
    };
    await render(bridge);
    expect(container.querySelector('main[aria-label="Sheet"]')?.childElementCount).toBe(0);
    expect(text("Modeline")).toBe("");
    expect(text("Minibuffer")).toBe("");
    await act(async () => {
      answer({ ok: true, output: STATUS });
      await Promise.resolve();
    });
    // The overview is asked for; until it answers, the modeline names the buffer.
    expect(text("Modeline")).toBe("OverviewWeather stationread-only");
    expect(document.title).toBe("Weather station - LogReq");
  });

  it("shows the list of all elements, its count in the modeline, and gives the list the focus", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await renderList(bridge);
    expect(calls(invoke, "element.list")).toEqual([{ sort: DEFAULT_SORT, limit: 200, offset: 0 }]);
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
    await renderList(bridge);
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

  it("[SR-121/AK2] puts the command chosen for a text first the next time, and keeps that after a restart", async () => {
    const options = (): string[] => texts('[role="option"] .name');
    const { bridge } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    await type("fl");
    // By match "Filter list by type" is first.
    expect(options().slice(0, 2)).toEqual(["Filter list by type", "Filter list by status"]);
    await keyDown(query("input"), "ArrowDown");
    await keyDown(query("input"), "Enter");
    expect(query("label").textContent).toBe("Status");
    await keyDown(query("input"), "Escape");
    // The usage is in the storage of the app, never in a workspace file, and holds no title or text.
    const stored = JSON.parse(window.localStorage.getItem("logreq.usage.v1") ?? "null") as {
      commands: unknown[][];
      queries: unknown[][];
    };
    expect(stored.queries).toEqual([
      ["fl", "filter-status"],
      ["list all elements", "list-all"],
    ]);
    expect(stored.commands.map(([id]) => id)).toEqual(["filter-status", "list-all"]);
    for (const restart of [0, 1]) {
      act(() => {
        root.unmount();
      });
      root = createRoot(container);
      await render(fakeBridge(workspace()).bridge);
      await listAll();
      await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
      await type(restart === 0 ? "fl" : " FL ");
      expect(options().slice(0, 2)).toEqual(["Filter list by status", "Filter list by type"]);
    }
    await type("flt");
    expect(options()[0]).toBe("Filter list by type");
  });

  it("[SR-108/AK3] shows the commands in use first when nothing is typed, and records a click as a choice", async () => {
    // Every reading of the clock is a minute later, so that the later choice is the more recent one.
    let clock = Date.UTC(2026, 9, 27);
    vi.spyOn(Date, "now").mockImplementation(() => (clock += 60_000));
    const { bridge } = fakeBridge(workspace());
    await renderList(bridge);
    await click(query(".echo"));
    const status = [...container.querySelectorAll('[role="option"]')].find(
      (option) => option.textContent === "Filter list by status",
    );
    await act(async () => {
      status?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(query("label").textContent).toBe("Status");
    await keyDown(query("input"), "Escape");
    await click(query(".echo"));
    // "List all elements" was chosen before by typing, "Filter list by status" later by a click: both are in use.
    expect(texts('[role="option"] .name').slice(0, 2)).toEqual([
      "Filter list by status",
      "List all elements",
    ]);
  });

  it("opens the command prompt with a click on the idle minibuffer", async () => {
    const { bridge } = fakeBridge(workspace());
    await render(bridge);
    await click(query(".echo"));
    expect(query("label").textContent).toBe("Command");
  });

  it("opens an element from the list, shows it with its modeline, and Ctrl+P Enter goes back with the selection kept", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await renderList(bridge);
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
      "Overview",
    ]);
    await keyDown(query("input"), "Enter");
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("All elements");
    expect(query('[aria-selected="true"]').id).toBe("row-1");
  });

  it("[SR-114/AK1] the modeline of an open element names its ID, its type and its status", async () => {
    const { bridge } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftWeather stationread-only");
  });

  it("shows the type key in the modeline when the metamodel cannot be read", async () => {
    const { bridge, handlers, change } = fakeBridge(workspace());
    await renderList(bridge);
    handlers["metamodel.get"] = () => new Error("The metamodel is broken");
    await change("opened");
    await listAll();
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

  it("opens the target of a relation in its repository, without reading it by UUID alone (#416)", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    await click(query('[role="link"]'));
    const reads = calls(invoke, "element.get");
    expect(reads).toContainEqual({ ref: "uuid-3", repository: "spec" });
    expect(reads).not.toContainEqual({ ref: "uuid-3" });
    expect(query("article h1").textContent).toBe("Title 3");
  });

  it("echoes why the target of a relation cannot be read, and shows it in the opened buffer", async () => {
    const { bridge, handlers } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    const read = handlers["element.get"];
    handlers["element.get"] = (input) =>
      input["ref"] === "uuid-3" ? new Error('The element "uuid-3" is gone') : (read?.(input) ?? {});
    await click(query('[role="link"]'));
    expect(text("Minibuffer")).toBe('The element "uuid-3" is gone');
    expect(query("article .quiet").textContent).toBe('The element "uuid-3" is gone');
    expect(container.querySelector("article h1")).toBeNull();
  });

  it("filters the list by a type through the command prompt", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await renderList(bridge);
    await runCommand("filter list by type");
    expect(query("label").textContent).toBe("Type");
    await keyDown(query("input"), "Enter");
    expect(calls(invoke, "element.list").at(-1)).toEqual({
      selection: { where: { type: ["need"] } },
      sort: DEFAULT_SORT,
      limit: 200,
      offset: 0,
    });
    expect(text("Modeline")).toBe("type: need3 elementsWeather stationread-only");
    expect(document.activeElement).toBe(query('[role="listbox"]'));
  });

  it("echoes the UUID and the date of the version on request, never the check value", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await renderList(bridge);
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
    await renderList(bridge);
    handlers["metamodel.get"] = () => new Error("The metamodel is not valid");
    await runCommand("filter list by type");
    expect(text("Minibuffer")).toBe("The metamodel is not valid");
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    expect(text("Minibuffer")).toContain("Command");
    expect(text("Minibuffer")).not.toContain("not valid");
  });

  it("asks again for what it shows when files were written or the core process restarted", async () => {
    const { bridge, invoke, change } = fakeBridge(workspace());
    await renderList(bridge);
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

  it("starts again with the overview when another workspace is opened, and drops the prompt", async () => {
    const { bridge, invoke, handlers, change } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    handlers["workspace.status"] = () => ({ name: "Other", readOnly: false });
    await change("opened");
    expect(container.querySelector("input")).toBeNull();
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("Overview");
    expect(text("Modeline")).toBe("Overview3 elementsOther");
    expect(document.title).toBe("Other - LogReq");
    expect(invoke).toHaveBeenCalled();
  });

  it("shows the overview of another workspace that is opened while the list is shown", async () => {
    const { bridge, handlers, change } = fakeBridge(workspace());
    await renderList(bridge);
    expect(text("Modeline")).toBe("All elements3 elementsWeather stationread-only");
    handlers["workspace.status"] = () => ({ name: "Other", readOnly: false });
    handlers["element.facets"] = () => ({
      total: 1,
      types: [{ key: "need", name: "Need", count: 1 }],
      statuses: [],
      properties: [],
      incomplete: false,
    });
    await change("opened");
    expect([...container.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual([
      "Need 1",
    ]);
    expect(text("Modeline")).toBe("Overview1 elementOther");
  });

  it("does not show the count of the list before a filter when the new list fails", async () => {
    const { bridge, handlers } = fakeBridge(workspace());
    await renderList(bridge);
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
    await renderList(bridge);
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
    expect(text("Modeline")).toBe("Overview3 elementsAgain");
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
    names({
      ok: true,
      output: {
        types: [{ key: "need", name: "Need", properties: [] }],
        properties: [],
        statuses: [],
        meanings: {},
      },
    });
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
    await renderList(bridge);
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

describe("App, catalog commands in the command prompt (#85)", () => {
  const listing = (name: string, extra: object = {}) => ({
    name,
    title: name === "filter.list" ? "List saved filters" : "Show affected elements",
    summary: "A command of the catalog.",
    effect: "read",
    stage: 3,
    implements: ["SR-073"],
    arguments: name === "filter.list" ? [] : [{ field: "ref", complete: "element" }],
    input:
      name === "filter.list" ? { type: "object" } : { type: "object", required: ["ref"], properties: {} },
    output: { type: "object" },
    implemented: true,
    ...extra,
  });

  it("offers the catalog's read commands by title and shows the output in a result buffer", async () => {
    const fake = fakeBridge({
      ...workspace(),
      "filter.list": () => ({ filters: [{ name: "open", where: {} }] }),
    });
    const bridge = {
      ...fake.bridge,
      commands: () => Promise.resolve([listing("filter.list"), listing("trace.affected")] as never),
    };
    await render(bridge);
    await runCommand("List saved filters");
    expect(text("Sheet")).toContain("filters1");
    expect(text("Modeline")).toContain("List saved filters");
    // Backspace before the first argument goes back to the command prompt.
    await runCommand("Show affected elements");
    expect(query("label").textContent).toBe("Show affected elements · ref:");
    await keyDown(query("input"), "Backspace");
    expect(query("label").textContent).toBe("Command");
  });

  it("puts the selected row of the shown list first for an element argument", async () => {
    const fake = fakeBridge({ ...workspace(), "trace.affected": () => ({ elements: [], total: 0 }) });
    const bridge = { ...fake.bridge, commands: () => Promise.resolve([listing("trace.affected")] as never) };
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await runCommand("Show affected elements");
    expect(query("label").textContent).toBe("Show affected elements · ref:");
    expect(texts('[role="option"] .name')[0]).toBe("SR-000002 Title 2");
    await keyDown(query("input"), "Enter");
    expect(calls(fake.invoke, "trace.affected")).toEqual([{ ref: "uuid-2" }]);
  });

  it("says why the catalog could not be read, and keeps the app's actions in the command prompt", async () => {
    const fake = fakeBridge(workspace());
    const bridge = { ...fake.bridge, commands: () => Promise.reject(new Error("The catalog is unreadable")) };
    await render(bridge);
    expect(text("Minibuffer")).toBe("Error: The catalog is unreadable");
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    expect(texts('[role="option"] .name')).toContain("List all elements");
  });
});

describe("App, the overview (SR-118)", () => {
  const options = (): string[] =>
    [...container.querySelectorAll('[role="option"]')].map((option) => option.textContent);
  const TWO_TYPES = {
    total: 5,
    types: [
      { key: "need", name: "Need", count: 2 },
      { key: "system-requirement", name: "System Requirement", count: 3 },
    ],
    statuses: [{ key: "draft", count: 5 }],
    properties: [],
    incomplete: false,
  };
  const twoTypes = (): Record<string, Handler> => ({ ...workspace(), "element.facets": () => TWO_TYPES });
  const KEY = (name = STATUS.name): string => `logreq.recent.v1\n${name}`;
  const seed = (entries: object[]): void => {
    window.localStorage.setItem(KEY(), JSON.stringify(entries));
  };
  const known = (n: number) => ({ id: `uuid-${String(n)}`, repository: "spec" });

  it("[SR-118/AK1] the first buffer of an opened workspace is the overview, one line per type with its count", async () => {
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("Overview");
    expect(options()).toEqual(["Need 2", "System Requirement 3"]);
    expect(calls(invoke, "element.facets")).toEqual([{}]);
    expect(text("Modeline")).toBe("Overview5 elementsWeather stationread-only");
    expect(document.activeElement).toBe(query('[role="listbox"]'));
    // No heading and no empty line for the recent elements before one was opened (D-062).
    expect(container.querySelector(".group")).toBeNull();
  });

  it("[SR-118/AK1] below the types the overview shows at most five recently opened elements, newest first", async () => {
    seed([1, 2, 3, 4, 5, 6, 7].map(known));
    const handlers = twoTypes();
    const get = handlers["element.get"];
    // The element of the second entry is gone, so its row is left out silently.
    handlers["element.get"] = (input) => (input["ref"] === "uuid-2" ? new Error("gone") : get?.(input));
    const { bridge } = fakeBridge(handlers);
    await render(bridge);
    expect(options()).toEqual([
      "Need 2",
      "System Requirement 3",
      "SR-000001Title 1",
      "SR-000003Title 3",
      "SR-000004Title 4",
      "SR-000005Title 5",
      "SR-000006Title 6",
    ]);
    expect(query(".group").textContent).toBe("Recent");
    expect(text("Minibuffer")).toBe("");
  });

  it("[SR-118/AK1] remembers the elements that were shown, newest first, and shows them again on the overview", async () => {
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    await listAll();
    await keyDown(query('[role="listbox"]'), "Enter");
    await runCommand("list all elements");
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "Enter");
    await runCommand("show overview");
    expect(options()).toEqual(["Need 2", "System Requirement 3", "SR-000002Title 2", "SR-000001Title 1"]);
    // Only the UUID and the repository are kept, under the key of the workspace.
    expect(JSON.parse(window.localStorage.getItem(KEY()) ?? "null")).toEqual([known(2), known(1)]);
    // The counts of the workspace are not asked for again when nothing changed.
    expect(calls(invoke, "element.facets")).toHaveLength(1);
  });

  it("[SR-118/AK1] keeps the recent elements for the next start of the app", async () => {
    const first = fakeBridge(twoTypes());
    await render(first.bridge);
    await listAll();
    await keyDown(query('[role="listbox"]'), "Enter");
    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    await render(fakeBridge(twoTypes()).bridge);
    expect(options().slice(2)).toEqual(["SR-000001Title 1"]);
  });

  it("[SR-118/AK1] keeps the recent elements of each workspace apart, and none for a workspace that failed", async () => {
    seed([known(1)]);
    const { bridge, handlers, change } = fakeBridge(twoTypes());
    await render(bridge);
    expect(options().slice(2)).toEqual(["SR-000001Title 1"]);
    handlers["workspace.status"] = () => ({ name: "Other", readOnly: false });
    await change("opened");
    expect(options()).toEqual(["Need 2", "System Requirement 3"]);
    handlers["workspace.status"] = () => NO_WORKSPACE;
    await change("opened");
    expect(container.querySelector("[data-buffer]")).toBeNull();
  });

  it("[SR-118/AK1] counts again when the workspace changed, and not when the overview is only shown again", async () => {
    const { bridge, invoke, handlers, change } = fakeBridge(twoTypes());
    await render(bridge);
    await listAll();
    await runCommand("show overview");
    expect(calls(invoke, "element.facets")).toHaveLength(1);
    handlers["element.facets"] = () => ({
      ...TWO_TYPES,
      total: 6,
      types: [{ key: "need", name: "Need", count: 6 }],
    });
    await change("written");
    expect(calls(invoke, "element.facets")).toHaveLength(2);
    expect(options()).toEqual(["Need 6"]);
    expect(text("Modeline")).toBe("Overview6 elementsWeather stationread-only");
  });

  it("[SR-118/AK1] says when a repository is missing, so that the counts are partial", async () => {
    const handlers = twoTypes();
    handlers["element.facets"] = () => ({ ...TWO_TYPES, incomplete: true });
    await render(fakeBridge(handlers).bridge);
    expect(text("Modeline")).toBe(
      "Overview5 elementsincomplete: a repository is missingWeather stationread-only",
    );
  });

  it("[SR-118/AK2] Enter on a type line opens the list of the elements of that type", async () => {
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("type: system-requirement");
    expect(calls(invoke, "element.list")).toEqual([
      {
        selection: { where: { type: ["system-requirement"], subtypes: false } },
        sort: DEFAULT_SORT,
        limit: 200,
        offset: 0,
      },
    ]);
  });

  it("[SR-118/AK2] a click on a type line opens its list, a click on a recent element the element", async () => {
    seed([known(3)]);
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    await click(container.querySelectorAll('[role="option"]')[0] ?? container);
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("type: need");
    expect(calls(invoke, "element.list")).toHaveLength(1);
    await runCommand("show overview");
    await click(container.querySelectorAll('[role="option"]')[2] ?? container);
    expect(query("article h1").textContent).toBe("Title 3");
  });

  it("[SR-118/AK3] Ctrl+P right after the workspace opened finds a requirement by its short ID or its title", async () => {
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    await keyDown(window, "p", { ctrlKey: true });
    expect(query("label").textContent).toBe("Go to");
    await type("SR-000002");
    expect(calls(invoke, "element.search")).toEqual([
      { query: "SR-000002", fields: ["id", "title"], limit: 20 },
    ]);
    await keyDown(query("input"), "Enter");
    expect(query("article h1").textContent).toBe("Title 2");
    await keyDown(window, "p", { ctrlKey: true });
    await type("Title 2");
    expect(calls(invoke, "element.search").at(-1)).toEqual({
      query: "Title 2",
      fields: ["id", "title"],
      limit: 20,
    });
  });

  it("[SR-118/AK4] the overview shows no list of all elements and asks for none", async () => {
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    expect(calls(invoke, "element.list")).toEqual([]);
    expect(options()).toHaveLength(2);
    expect(container.querySelector(".row .title")).toBeNull();
  });

  it('[SR-118/AK4] "List all elements" opens the full list from the overview', async () => {
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    await listAll();
    expect(calls(invoke, "element.list")).toEqual([{ sort: DEFAULT_SORT, limit: 200, offset: 0 }]);
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("All elements");
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2", "Title 3"]);
  });

  it("[SR-118/AK5] the recent elements go to the storage of the app, and no write command is called", async () => {
    const setItem = vi.spyOn(window.localStorage, "setItem");
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    await listAll();
    await keyDown(query('[role="listbox"]'), "Enter");
    await runCommand("show overview");
    expect(setItem).toHaveBeenCalledWith(KEY(), JSON.stringify([known(1)]));
    const catalog = JSON.parse(
      readFileSync(join(import.meta.dirname, "../../../../schemas/commands/catalog.json"), "utf8"),
    ) as { commands: { name: string; effect: string }[] };
    const called = new Set(invoke.mock.calls.map(([name]) => name));
    expect(called.size).toBeGreaterThan(3);
    for (const name of called) {
      expect(catalog.commands.find((command) => command.name === name)?.effect).toBe("read");
    }
  });

  it("does not remember anything, and still works, when the storage of the app cannot be used", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    await render(fakeBridge(twoTypes()).bridge);
    await listAll();
    await keyDown(query('[role="listbox"]'), "Enter");
    await runCommand("show overview");
    // The element was shown but not remembered in the storage; the overview still has it for this session.
    expect(options()).toEqual(["Need 2", "System Requirement 3", "SR-000001Title 1"]);
  });

  it("echoes why the counts could not be read, and shows no lines", async () => {
    const handlers = twoTypes();
    handlers["element.facets"] = () => new Error("The workspace file is not valid");
    await render(fakeBridge(handlers).bridge);
    expect(text("Minibuffer")).toBe("The workspace file is not valid");
    expect(options()).toEqual([]);
    expect(text("Modeline")).toBe("OverviewWeather stationread-only");
  });

  it("[SR-118/AK1] closing the last buffer shows the overview again; the lone overview cannot be closed", async () => {
    const { bridge } = fakeBridge(twoTypes());
    await render(bridge);
    await listAll();
    await runCommand("close buffer");
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("Overview");
    expect(options()).toEqual(["Need 2", "System Requirement 3"]);
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    const offered = [...container.querySelectorAll('[role="option"]')].map((option) => option.textContent);
    expect(offered.some((name) => name.startsWith("Close"))).toBe(false);
    expect(offered.some((name) => name.startsWith("Show overview"))).toBe(false);
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
    await renderList(fake.bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    return fake;
  };

  it("shows the text of the element in the editor", async () => {
    await openElement();
    expect(editorView().state.doc.toString()).toBe("Hello");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftWeather stationread-only");
  });

  /** Types as the keyboard does, so the slash menu opens, and lets it answer. */
  const typeKeys = async (insert: string): Promise<void> => {
    for (const char of insert) {
      await act(async () => {
        const head = editorView().state.selection.main.head;
        editorView().dispatch({
          changes: { from: head, insert: char },
          selection: { anchor: head + 1 },
          userEvent: "input.type",
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
  };

  it("[SR-129/AK4] Reference to element asks Insert reference, finds elements as Go to does, and writes the reference of the pick", async () => {
    const { invoke } = await openElement();
    editorView().focus();
    editorView().dispatch({ selection: { anchor: editorView().state.doc.length } });
    await typeKeys(" /ref");
    await keyDown(query(".cm-content"), "Enter");
    expect(query("label").textContent).toBe("Insert reference");
    expect(editorView().state.doc.toString()).toBe("Hello /ref");
    await type("title");
    expect(calls(invoke, "element.search")).toEqual([{ query: "title", fields: ["id", "title"], limit: 20 }]);
    await keyDown(query("input"), "Enter");
    expect(editorView().state.doc.toString()).toBe("Hello [Title 2](logreq:uuid-2)");
    expect(container.querySelector("input")).toBeNull();
    expect(editorView().hasFocus).toBe(true);
    expect(document.activeElement).toBe(query(".cm-content"));
  });

  it("[SR-129/AK3] Escape in Insert reference leaves the / as typed and gives the editor the focus", async () => {
    await openElement();
    editorView().focus();
    editorView().dispatch({ selection: { anchor: editorView().state.doc.length } });
    await typeKeys(" /ref");
    await keyDown(query(".cm-content"), "Enter");
    await keyDown(query("input"), "Escape");
    expect(container.querySelector("input")).toBeNull();
    expect(editorView().state.doc.toString()).toBe("Hello /ref");
    expect(document.activeElement).toBe(query(".cm-content"));
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

  it("[SR-104/AK2] [SR-104/AK3] Ctrl+Alt+A adds a property by the minibuffer, the choice prompt has only the choices, and Ctrl+S saves it", async () => {
    const handlers = withText();
    handlers["metamodel.get"] = () => ({
      types: [{ key: "need", name: "Need", properties: ["title", "method", "topic"] }],
      properties: [
        { key: "title", name: "Title", kind: "text", meaning: "title" },
        {
          key: "method",
          name: "Verification Method",
          kind: "choice",
          choices: [
            { key: "test", name: "Test" },
            { key: "analysis", name: "Analysis" },
          ],
        },
        { key: "topic", name: "Topic", kind: "text" },
      ],
      statuses: [{ key: "draft" }],
      meanings: {},
    });
    handlers["element.update"] = (input) => ({
      element: row(1, { text: "Hello", properties: input["set"], relations: [] }),
      files: ["f1.md"],
      affected: 0,
    });
    const { invoke } = await openElement(handlers);
    await keyDown(window, "a", { ctrlKey: true, altKey: true });
    expect(text("Minibuffer")).toContain("Add property");
    expect([...container.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual([
      "Verification Methodmethod",
      "Topictopic",
    ]);
    await type("method");
    await keyDown(query("input"), "Enter");
    // The box is there, the focus on it, and the choice prompt asks at once with the choices of the metamodel.
    expect(query('[data-field="method"]')).not.toBeNull();
    expect(text("Minibuffer")).toContain("Verification Method");
    expect([...container.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual([
      "Testtest",
      "Analysisanalysis",
    ]);
    await type("anal");
    await keyDown(query("input"), "Enter");
    expect(container.querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(query('[data-field="method"]'));
    expect(texts('[data-field="method"] .line')).toEqual(["analysis"]);
    expect(text("Modeline")).toContain("modified");
    await keyDown(window, "s", { ctrlKey: true });
    expect(calls(invoke, "element.update")).toEqual([{ ref: "uuid-1", set: { method: "analysis" } }]);
    expect(text("Modeline")).not.toContain("modified");
  });

  it("[SR-104/AK4] Clear property is in the command prompt for an element and empties the box the cursor was in", async () => {
    const handlers = withText();
    handlers["metamodel.get"] = () => ({
      types: [{ key: "need", name: "Need", properties: ["method"] }],
      properties: [
        { key: "method", name: "Method", kind: "choice", choices: [{ key: "test", name: "Test" }] },
      ],
      statuses: [{ key: "draft" }],
      meanings: {},
    });
    const element = handlers["element.get"];
    handlers["element.get"] = (input) => {
      const loaded = element?.(input) as { element: object };
      return { element: { ...loaded.element, properties: { method: "test" } } };
    };
    const { invoke } = await openElement(handlers);
    query('[data-field="method"]').focus();
    await runCommand("clear property");
    expect(texts('[data-field="method"] .line')).toEqual([]);
    await keyDown(window, "s", { ctrlKey: true });
    expect(calls(invoke, "element.update")).toEqual([{ ref: "uuid-1", unset: ["method"] }]);
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

  it("[SR-123/AK1] Close all buffers from the command prompt closes them all; the overview is what remains", async () => {
    await openElement();
    await runCommand("search elements");
    await type("title");
    await keyDown(query("input"), "Enter");
    await runCommand("close all buffers");
    expect(query("[data-buffer]").getAttribute("aria-label")).toBe("Overview");
    expect(container.querySelectorAll("[data-buffer]")).toHaveLength(1);
    expect(text("Minibuffer")).toBe("Closed 3 buffers");
    expect(text("Modeline")).toBe("Overview3 elementsWeather stationread-only");
    // No other buffer is left to go to, and the global keys still work.
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
    expect(container.querySelectorAll(".candidates [role=option]")).toHaveLength(2);
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
    expect(query("[data-buffer]").getAttribute("aria-label")).toBe("Overview");
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
    await listAll();
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

describe("App, the package page (SR-112)", () => {
  /** A package "Stufe-3" and three elements that name it; the start list is of no concern to these tests. */
  const withPackage = (forMembers?: Handler): Record<string, Handler> => {
    const handlers = workspace();
    const members = [row(2), row(3), row(4)];
    handlers["metamodel.get"] = () => ({
      types: [
        { key: "need", name: "Need", properties: [] },
        { key: "package", name: "Package", meaning: "package", properties: [] },
      ],
      properties: [],
      statuses: [{ key: "draft" }],
      meanings: { package: ["package"], packages: ["packages"] },
    });
    handlers["element.get"] = (input) => {
      const id = String(input["ref"]);
      return {
        element:
          id === "uuid-p"
            ? row(0, {
                id: "uuid-p",
                shortId: "PKG-0000d1",
                type: "package",
                title: "Stufe-3",
                text: "Third stage",
              })
            : row(Number(id.replace("uuid-", "")), { text: "Hello" }),
      };
    };
    handlers["element.search"] = (input) => {
      const found = String(input["query"]).toLowerCase().startsWith("stufe")
        ? row(0, { id: "uuid-p", shortId: "PKG-0000d1", type: "package", title: "Stufe-3" })
        : row(2);
      return {
        hits: [{ ...found, score: 1, fields: ["title"], terms: [String(input["query"])] }],
        total: 1,
        incomplete: false,
      };
    };
    handlers["element.list"] = (input) => {
      const selection = input["selection"] as { where?: { package?: string } } | undefined;
      if (selection?.where?.package === undefined) {
        return { elements: [row(1)], total: 1 };
      }
      if (forMembers !== undefined) {
        return forMembers(input);
      }
      const sort = input["sort"] as { by: string; order: string }[] | undefined;
      if (sort?.[0]?.by === "hierarchy") {
        return {
          elements: members,
          tree: [0, 1, 0].map((depth, at) => ({ id: `uuid-${String(at + 2)}`, repository: "spec", depth })),
          total: 3,
        };
      }
      return {
        elements: sort?.[0]?.order === "desc" ? [...members].reverse() : members,
        total: 3,
        incomplete: false,
      };
    };
    return handlers;
  };

  const openPackage = async (handlers = withPackage()) => {
    const fake = fakeBridge(handlers);
    await render(fake.bridge);
    await keyDown(window, "p", { ctrlKey: true });
    await type("stufe");
    await keyDown(query("input"), "Enter");
    return fake;
  };

  const memberCalls = (invoke: ReturnType<typeof fakeBridge>["invoke"]): unknown[] =>
    calls(invoke, "element.list").filter(
      (input) => (input as { selection?: unknown }).selection !== undefined,
    );

  const memberTitles = (): string[] =>
    [...container.querySelectorAll(".members .row .title")].map((title) => title.textContent);

  it("[SR-112/AK1] an opened package shows below its title and text every element that names it", async () => {
    const { invoke } = await openPackage();
    expect(query("article h1").textContent).toBe("Stufe-3");
    expect(memberCalls(invoke)).toEqual([
      { selection: { where: { package: "uuid-p" } }, sort: DEFAULT_SORT, limit: 200, offset: 0 },
    ]);
    const parts = [
      ...container.querySelectorAll(
        "article h1, article .cm-editor, article .members h2, article .members .row",
      ),
    ];
    expect(parts.map((part) => part.tagName)).toEqual(["H1", "DIV", "H2", "DIV", "DIV", "DIV"]);
    expect(parts[1]?.className).toContain("cm-editor");
    expect(query(".members h2").textContent).toBe("← packages 3");
    expect(memberTitles()).toEqual(["Title 2", "Title 3", "Title 4"]);
    // The page is the element: the modeline names it, and the focus is on its text, not on the elements.
    expect(text("Modeline")).toBe("PKG-0000d1 · Package · draftWeather stationread-only");
    expect(document.activeElement).toBe(query("article"));
  });

  it("[SR-112/AK1] an element that is no package asks for no elements", async () => {
    const fake = fakeBridge(withPackage());
    await render(fake.bridge);
    await keyDown(window, "p", { ctrlKey: true });
    await type("title");
    await keyDown(query("input"), "Enter");
    expect(query("article h1").textContent).toBe("Title 2");
    expect(container.querySelector(".members")).toBeNull();
    expect(memberCalls(fake.invoke)).toEqual([]);
  });

  it("[SR-112/AK1] a package that no element names shows no heading", async () => {
    await openPackage(withPackage(() => ({ elements: [], total: 0 })));
    expect(query("article h1").textContent).toBe("Stufe-3");
    expect(container.querySelector(".members h2")).toBeNull();
    expect(query(".members").hasAttribute("hidden")).toBe(true);
  });

  it("echoes why the elements of a package could not be listed", async () => {
    await openPackage(withPackage(() => new Error("The reference matches several elements")));
    expect(text("Minibuffer")).toBe("The reference matches several elements");
    expect(query(".members .quiet").textContent).toBe("The reference matches several elements");
  });

  it("the elements of a package are asked for once, and moving through them asks for nothing more", async () => {
    const { invoke } = await openPackage();
    expect(memberCalls(invoke)).toHaveLength(1);
    await keyDown(query("article"), "ArrowDown");
    for (let n = 0; n < 3; n += 1) {
      await keyDown(query(".members .list"), "ArrowDown");
    }
    expect(query('.members [aria-selected="true"]').id).toBe("row-2");
    expect(memberCalls(invoke)).toHaveLength(1);
    expect(calls(invoke, "element.get")).toHaveLength(1);
  });

  it("Down moves into the elements, Enter opens one, and Ctrl+P Enter comes back to the same row", async () => {
    const { invoke } = await openPackage();
    await keyDown(query("article"), "ArrowDown");
    expect(document.activeElement).toBe(query(".members .list"));
    await keyDown(query(".members .list"), "ArrowDown");
    await keyDown(query(".members .list"), "Enter");
    expect(query("article h1").textContent).toBe("Title 3");
    await keyDown(window, "p", { ctrlKey: true });
    expect(query('[role="option"]').textContent).toContain("Stufe-3");
    await keyDown(query("input"), "Enter");
    expect(query("article h1").textContent).toBe("Stufe-3");
    // The focus is on the row that was used, as it is on a list.
    expect(document.activeElement).toBe(query(".members .list"));
    expect(query('.members [aria-selected="true"]').id).toBe("row-1");
    await keyDown(query(".members .list"), "ArrowDown");
    await keyDown(query(".members .list"), "Enter");
    expect(query("article h1").textContent).toBe("Title 4");
    expect(calls(invoke, "element.get").map((input) => (input as { ref: string }).ref)).toEqual([
      "uuid-p",
      "uuid-3",
      "uuid-p",
      "uuid-4",
    ]);
  });

  it("Enter on the first row opens it, and Ctrl+P Enter comes back to row 0 with Down and Enter opening the next", async () => {
    await openPackage();
    await keyDown(query("article"), "ArrowDown");
    await keyDown(query(".members .list"), "Enter");
    expect(query("article h1").textContent).toBe("Title 2");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    expect(query("article h1").textContent).toBe("Stufe-3");
    expect(document.activeElement).toBe(query(".members .list"));
    expect(query('.members [aria-selected="true"]').id).toBe("row-0");
    await keyDown(query(".members .list"), "ArrowDown");
    await keyDown(query(".members .list"), "Enter");
    expect(query("article h1").textContent).toBe("Title 3");
  });

  it("Escape in the elements returns the focus to the page, and Enter on the page still edits the text", async () => {
    await openPackage();
    await keyDown(query("article"), "ArrowDown");
    await keyDown(query(".members .list"), "Escape");
    expect(document.activeElement).toBe(query("article"));
    await keyDown(query("article"), "Enter");
    expect(EditorView.findFromDOM(query(".cm-editor"))?.hasFocus).toBe(true);
  });

  it('[SR-112/AK2] "Sort list" sorts the elements of the package, and the page stays the same element', async () => {
    const { invoke } = await openPackage();
    await runCommand("sort list");
    expect(query("label").textContent).toBe("Sort by");
    await type("title desc");
    await keyDown(query("input"), "Enter");
    expect(memberCalls(invoke).at(-1)).toEqual({
      selection: { where: { package: "uuid-p" } },
      sort: [{ by: "title", order: "desc" }],
      limit: 200,
      offset: 0,
    });
    expect(memberTitles()).toEqual(["Title 4", "Title 3", "Title 2"]);
    expect(query(".members h2").textContent).toBe("← packages 3 · sorted by title descending");
    // The element buffer was replaced in place: its text was not asked for again, and no second buffer is open.
    expect(calls(invoke, "element.get")).toHaveLength(1);
    expect(query("article h1").textContent).toBe("Stufe-3");
    expect(document.activeElement).toBe(query("article"));
  });

  it('[SR-112/AK2] "Hierarchy (tree)" shows the elements of the package as the derivation tree', async () => {
    const { invoke } = await openPackage();
    await runCommand("sort list");
    await type("hier");
    await keyDown(query("input"), "Enter");
    expect(memberCalls(invoke).at(-1)).toEqual({
      selection: { where: { package: "uuid-p" } },
      sort: [{ by: "hierarchy", order: "asc" }],
      limit: 200,
      offset: 0,
    });
    expect(
      [...container.querySelectorAll<HTMLElement>(".members .row .title")].map(
        (title) => title.style.paddingLeft,
      ),
    ).toEqual(["0rem", "1.25rem", "0rem"]);
    expect(query(".members h2").textContent).toBe("← packages 3 · tree");
  });

  it("[SR-112/AK2] the sort and the row of the elements are kept while the buffer is open", async () => {
    await openPackage();
    await runCommand("sort list");
    await type("title desc");
    await keyDown(query("input"), "Enter");
    await keyDown(query("article"), "ArrowDown");
    await keyDown(query(".members .list"), "ArrowDown");
    await keyDown(query(".members .list"), "Enter");
    expect(query("article h1").textContent).toBe("Title 3");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    expect(memberTitles()).toEqual(["Title 4", "Title 3", "Title 2"]);
    expect(query(".members h2").textContent).toBe("← packages 3 · sorted by title descending");
    expect(query('.members [aria-selected="true"]').id).toBe("row-1");
  });

  it("asks for the elements again when the workspace changed, and keeps them until the answer", async () => {
    const { invoke, change } = await openPackage();
    await change("written");
    expect(memberCalls(invoke)).toHaveLength(2);
    expect(memberTitles()).toEqual(["Title 2", "Title 3", "Title 4"]);
  });

  it("has no package page when the metamodel cannot be read", async () => {
    const handlers = withPackage();
    handlers["metamodel.get"] = () => new Error("The metamodel is broken");
    const { invoke } = await openPackage(handlers);
    expect(query("article h1").textContent).toBe("Stufe-3");
    expect(container.querySelector(".members")).toBeNull();
    expect(memberCalls(invoke)).toEqual([]);
  });
});

describe("App, copy field (SR-128)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const withText = (): Record<string, Handler> => ({
    ...workspace(),
    "element.get": (input) => ({
      element: row(Number(String(input["ref"]).replace("uuid-", "")), {
        identifier: "SR-036",
        text: "Hello\n**bold**",
        properties: { criteria: ["first", "second"] },
        relations: [],
      }),
    }),
  });
  const editorView = (): EditorView => {
    const found = EditorView.findFromDOM(query(".cm-editor"));
    if (found === null) {
      throw new Error("no editor");
    }
    return found;
  };
  const openElement = async () => {
    const fake = fakeBridge(withText());
    await renderList(fake.bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    return fake;
  };
  const modeline = (): string => text("Modeline") ?? "";
  const copyKeys = { ctrlKey: true, shiftKey: true };

  it("[SR-128/AK1] shows a copy symbol with the ID in the modeline of an element, and none on a list", async () => {
    await renderList(fakeBridge(withText()).bridge);
    expect(container.querySelector(".modeline .copy")).toBeNull();
    await keyDown(query('[role="listbox"]'), "Enter");
    const field = query('.modeline [data-field="ID"]');
    expect(field.textContent).toBe("SR-036");
    expect(field.querySelector(".copy")?.getAttribute("aria-label")).toBe("Copy ID");
    // The rest of the first part, and the modeline's text, are as before.
    expect(modeline()).toBe("SR-036 · Need · draftWeather stationread-only");
  });

  it("[SR-128/AK2] copies the ID with the symbol in the modeline, and the modeline says so for a few seconds", async () => {
    const { copyText } = await openElement();
    const symbol = query('.modeline [data-field="ID"] .copy');
    vi.useFakeTimers();
    await act(async () => {
      symbol.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(copyText).toHaveBeenCalledExactlyOnceWith("SR-036");
    expect(modeline()).toBe("SR-036 · Need · draftCopied IDWeather stationread-only");
    expect(query(".modeline .notice").getAttribute("role")).toBe("status");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTICE_MS - 1);
    });
    expect(modeline()).toContain("Copied ID");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(modeline()).toBe("SR-036 · Need · draftWeather stationread-only");
  });

  it("[SR-128/AK2] a second copy restarts the time of the confirmation", async () => {
    const { copyText } = await openElement();
    const symbol = query('.modeline [data-field="ID"] .copy');
    vi.useFakeTimers();
    const copyOnce = () =>
      act(async () => {
        symbol.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(0);
      });
    const wait = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    await copyOnce();
    await wait(NOTICE_MS - 1000);
    await copyOnce();
    await wait(NOTICE_MS - 1000);
    expect(modeline()).toContain("Copied ID");
    await wait(1000);
    expect(modeline()).not.toContain("Copied");
    expect(copyText).toHaveBeenCalledTimes(2);
  });

  it("[SR-128/AK2] says Copy failed when the main process could not copy", async () => {
    const { copyText } = await openElement();
    copyText.mockResolvedValueOnce(false);
    await click(query('.modeline [data-field="ID"] .copy'));
    expect(modeline()).toContain("Copy failed");
    expect(modeline()).not.toContain("Copied");
  });

  it("[SR-128/AK3] Ctrl+Shift+C in the text copies the text as it is stored, Markdown marks and all", async () => {
    const { copyText } = await openElement();
    editorView().focus();
    await keyDown(query(".cm-content"), "C", copyKeys);
    expect(copyText).toHaveBeenCalledExactlyOnceWith("Hello\n**bold**");
    expect(modeline()).toContain("Copied Text");
  });

  it("[SR-128/AK3] Cmd+Shift+C copies as well", async () => {
    const { copyText } = await openElement();
    editorView().focus();
    await keyDown(query(".cm-content"), "c", { metaKey: true, shiftKey: true });
    expect(copyText).toHaveBeenCalledExactlyOnceWith("Hello\n**bold**");
  });

  it("[SR-128/AK3] Copy field in the command prompt copies the field the cursor was in", async () => {
    const { copyText } = await openElement();
    await act(async () => {
      query('[data-field="criteria"]').focus();
      await Promise.resolve();
    });
    await keyDown(query('[data-field="criteria"]'), "P", copyKeys);
    expect([...container.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toContain(
      "Copy fieldCtrl+Shift+C",
    );
    await type("Copy field");
    await keyDown(query("input"), "Enter");
    expect(copyText).toHaveBeenCalledExactlyOnceWith("first\nsecond");
    expect(modeline()).toContain("Copied criteria");
  });

  it("[SR-128/AK3] copies the ID when the cursor is in no field", async () => {
    const { copyText } = await openElement();
    await keyDown(window, "C", copyKeys);
    expect(copyText).toHaveBeenCalledExactlyOnceWith("SR-036");
    expect(modeline()).toContain("Copied ID");
  });

  it("[SR-128/AK3] has no Copy field on a list", async () => {
    const { copyText } = await renderListOnly();
    await keyDown(window, "C", copyKeys);
    expect(copyText).not.toHaveBeenCalled();
    await keyDown(window, "P", copyKeys);
    expect([...container.querySelectorAll('[role="option"]')].map((o) => o.textContent)).not.toContain(
      "Copy fieldCtrl+Shift+C",
    );
  });

  const renderListOnly = async () => {
    const fake = fakeBridge(withText());
    await renderList(fake.bridge);
    return fake;
  };
});
