// @vitest-environment happy-dom
// The mode „Agent folgen“ (SR-117) in the window: the bridge's `agent-activity`, the actions, the hold of
// unsaved input, the modeline and the recent elements, with a fake bridge.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentActivity, InvokeResult, ReqSeqBridge, WorkspaceChange } from "../shared/protocol.js";
import { App } from "./App.js";
import { NO_ACCESS } from "./use-follow.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (input: Record<string, unknown>) => unknown;

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

const numberOf = (ref: unknown): number => Number(String(ref).replace("uuid-", ""));

/** The commands of a workspace with three elements, each with a text. */
const workspace = (): Record<string, Handler> => ({
  "workspace.status": () => ({ name: "Weather station", readOnly: false }),
  "workspace.activity": () => ({ activity: null }),
  "element.list": () => ({ elements: [row(1), row(2), row(3)], total: 3 }),
  "element.search": () => ({ hits: [], total: 0, incomplete: false }),
  "element.get": (input) =>
    numberOf(input["ref"]) > 3
      ? new Error(`No element ${String(input["ref"])}`)
      : { element: row(numberOf(input["ref"]), { text: "Hello" }) },
  "element.update": (input) => ({
    element: row(numberOf(input["ref"]), { text: `${String(input["text"])}\n` }),
    files: ["f1.md"],
    affected: 0,
  }),
  "trace.neighbourhood": (input) => ({
    root: input["ref"],
    nodes: [{ ...row(numberOf(input["ref"])), depth: 0, expanded: true }],
    total: 1,
    edges: [],
    incomplete: false,
  }),
  "metamodel.get": () => ({
    types: [{ key: "need", name: "Need", properties: [] }],
    properties: [],
    relations: [],
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
});

/** A bridge with both events: `activity` sends an access, `change` a change of the workspace. */
const fakeBridge = (handlers: Record<string, Handler>, commands: readonly unknown[] = []) => {
  const listeners = {
    "workspace-changed": new Set<(data: never) => void>(),
    "agent-activity": new Set<(data: never) => void>(),
    "save-expired": new Set<(data: never) => void>(),
  };
  const invoke = vi.fn((name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> => {
    const output = handlers[name]?.(input);
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, error: { code: "x.failed", message: output.message } as never }
        : { ok: true, output },
    );
  });
  const bridge: ReqSeqBridge = {
    invoke,
    commands: () => Promise.resolve(commands as never),
    on: (event, listener) => {
      const set = listeners[event];
      set.add(listener);
      return () => set.delete(listener);
    },
    copyText: () => Promise.resolve(true),
    recentWorkspaces: () => Promise.resolve([]),
    openWorkspace: () => Promise.resolve({ ok: true }),
    onSave: () => () => undefined,
  };
  const emit = async (event: keyof typeof listeners, data: unknown): Promise<void> => {
    await act(async () => {
      for (const listener of listeners[event]) {
        (listener as (value: unknown) => void)(data);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
  };
  return {
    bridge,
    invoke,
    handlers,
    listeners,
    activity: (access: AgentActivity) => emit("agent-activity", access),
    change: (reason: WorkspaceChange["reason"]) => emit("workspace-changed", { reason }),
  };
};

let second = 0;
/** An access to element `n`, a second later than the one before. */
const access = (n: number, extra: Partial<AgentActivity> = {}): AgentActivity => {
  second += 1;
  return {
    access: "mcp",
    command: "element.get",
    effect: "read",
    at: new Date(Date.UTC(2026, 9, 27, 10, 0, second)).toISOString(),
    element: { id: `uuid-${String(n)}`, repository: "spec" },
    ...extra,
  };
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

const render = async (bridge: ReqSeqBridge): Promise<void> => {
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
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const setValue = Reflect.get(descriptor ?? {}, "set") as (this: HTMLElement, value: string) => void;
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  await flush();
};

const runCommand = async (name: string): Promise<void> => {
  await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
  await type(name);
  await keyDown(query("input"), "Enter");
};

/** Ctrl+Shift+O: the mode on, or off again. */
const toggle = (): Promise<void> => keyDown(window, "O", { ctrlKey: true, shiftKey: true });

const title = (): string | null | undefined => container.querySelector("article h1")?.textContent;

const typeText = async (insert: string): Promise<void> => {
  const view = EditorView.findFromDOM(query(".cm-editor"));
  if (view === null) {
    throw new Error("no editor");
  }
  await act(async () => {
    view.dispatch({ changes: { from: view.state.doc.length, insert } });
    await Promise.resolve();
  });
  await flush();
};

/** The open buffers but the shown one, as "Go to" (Ctrl+P) lists them; the prompt closes again. */
const openBuffers = async (): Promise<string[]> => {
  await keyDown(window, "p", { ctrlKey: true });
  const names = [...container.querySelectorAll('[role="option"]')].map((option) => option.textContent);
  await keyDown(query("input"), "Escape");
  return names;
};

const calls = (invoke: ReturnType<typeof fakeBridge>["invoke"], name: string): unknown[] =>
  invoke.mock.calls.filter(([called]) => called === name).map(([, input]) => input);

/** The catalog's `filter.list`, as the command prompt offers it ("List saved filters"). */
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
};

const started = async (handlers = workspace(), commands: readonly unknown[] = []) => {
  const fake = fakeBridge(handlers, commands);
  await render(fake.bridge);
  return fake;
};

describe("Follow agent in the window (SR-117)", () => {
  it("[SR-117/AK2] an access while not following changes nothing, and the mode starts off", async () => {
    const fake = await started();
    expect(text("Modeline")).not.toContain("following agent");
    const before = container.innerHTML;
    await fake.activity(access(1));
    await fake.activity(access(2, { command: "element.update", effect: "write-files" }));
    expect(container.innerHTML).toBe(before);
    expect(calls(fake.invoke, "element.get")).toEqual([]);
    expect(calls(fake.invoke, "workspace.activity")).toEqual([]);
  });

  it("[SR-117/AK1] following, an access shows its element, and the buffer the mode opened before is closed", async () => {
    const fake = await started();
    await toggle();
    expect(calls(fake.invoke, "workspace.activity")).toEqual([{}]);
    expect(text("Minibuffer")).toBe(NO_ACCESS);
    await fake.activity(access(1));
    expect(calls(fake.invoke, "element.get")).toContainEqual({ ref: "uuid-1", repository: "spec" });
    expect(title()).toBe("Title 1");
    await fake.activity(access(2));
    expect(title()).toBe("Title 2");
    // One buffer of the mode (shown), next to the user's overview.
    expect(await openBuffers()).toEqual(["Overview"]);
  });

  it('[SR-117/AK3] the modeline says "following agent" while on, and "waits for save" while a draft holds an access back', async () => {
    const fake = await started();
    await toggle();
    expect(text("Modeline")).toContain("Weather stationfollowing agent");
    await fake.activity(access(1));
    await typeText("!");
    await fake.activity(access(2));
    expect(text("Modeline")).toContain("following agent: waits for save");
    await toggle();
    expect(text("Modeline")).not.toContain("following agent");
  });

  it("[SR-117/AK4] the mode switches by the command prompt and by the key, and leaves the local storage as it was but the prompt's use", async () => {
    const fake = await started();
    // The prompt's use and the open buffers (SR-115 AK4: the element the mode showed is an open buffer)
    // change; nothing else does.
    const stored = (): string[] =>
      Object.keys(window.localStorage).filter(
        (name) => !name.startsWith("reqseq.usage") && !name.startsWith("reqseq.buffers"),
      );
    const before = stored().map((name) => [name, window.localStorage.getItem(name)]);
    await runCommand("Follow agent");
    expect(text("Modeline")).toContain("following agent");
    await runCommand("Stop following agent");
    expect(text("Modeline")).not.toContain("following agent");
    await toggle();
    await fake.activity(access(1));
    await toggle();
    await fake.activity(access(2));
    expect(title()).toBe("Title 1");
    // The mode is no stored value: only what the overview, the prompt and the open buffers keep are in the
    // local storage.
    expect(stored().map((name) => [name, window.localStorage.getItem(name)])).toEqual(before);
  });

  it("[SR-117/AK5] with unsaved text an access to another element does not switch the view until Ctrl+S", async () => {
    const fake = await started();
    await toggle();
    await fake.activity(access(1));
    await typeText("!");
    await fake.activity(access(2));
    await fake.activity(access(3));
    expect(title()).toBe("Title 1");
    await keyDown(query(".cm-content"), "s", { ctrlKey: true });
    expect(calls(fake.invoke, "element.update")).toEqual([{ ref: "uuid-1", text: "Hello!" }]);
    // The latest access is shown; the saved buffer is the user's now and stays.
    expect(title()).toBe("Title 3");
    expect(await openBuffers()).toEqual(["SR-000001 Title 1", "Overview"]);
  });

  it("[SR-117/AK5] with the command prompt open an access waits until it closes", async () => {
    const fake = await started();
    await toggle();
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    await fake.activity(access(1));
    expect(title()).toBeUndefined();
    expect(text("Modeline")).toContain("following agent");
    expect(text("Modeline")).not.toContain("waits for save");
    await keyDown(query("input"), "Escape");
    expect(title()).toBe("Title 1");
  });

  it("an access that the open prompt held does not override a buffer the user chose there", async () => {
    const fake = await started();
    await toggle();
    await fake.activity(access(2));
    expect(title()).toBe("Title 2");
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    await fake.activity(access(1));
    await type("Overview");
    await keyDown(query("input"), "Enter");
    expect(title()).toBeUndefined();
    expect(text("Modeline")).toContain("following agent");
    // The next access moves the view again (A3).
    await fake.activity(access(3));
    expect(title()).toBe("Title 3");
  });

  it("an access that the open prompt held does not override a catalog command the user ran there", async () => {
    const handlers = { ...workspace(), "filter.list": () => ({ filters: [{ name: "open", where: {} }] }) };
    const fake = await started(handlers, [FILTER_LIST]);
    await toggle();
    await fake.activity(access(2));
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    await fake.activity(access(1));
    await type("List saved filters");
    await keyDown(query("input"), "Enter");
    // The result buffer opens after core answers, a render later than the prompt closed: it stays.
    expect(text("Modeline")).toContain("List saved filters");
    expect(title()).toBeUndefined();
    expect(calls(fake.invoke, "element.get")).not.toContainEqual({ ref: "uuid-1", repository: "spec" });
  });

  it("an access that the open prompt held does not override a list the user sorted in place there", async () => {
    const fake = await started();
    await toggle();
    await runCommand("List all elements");
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    await fake.activity(access(1));
    await type("Sort list");
    await keyDown(query("input"), "Enter");
    // The next prompt (the sorts) keeps the hold; the sort keeps the list's key.
    await fake.activity(access(1));
    await type("Title descending");
    await keyDown(query("input"), "Enter");
    expect(title()).toBeUndefined();
    expect(container.querySelectorAll(".row").length).toBeGreaterThan(0);
    // Escape in a prompt still shows the held access.
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    await fake.activity(access(3));
    await keyDown(query("input"), "Escape");
    expect(title()).toBe("Title 3");
  });

  it("turning the mode on shows the last recorded access at once", async () => {
    const handlers = workspace();
    const last = access(2);
    handlers["workspace.activity"] = () => ({ activity: last });
    const fake = await started(handlers);
    await toggle();
    expect(title()).toBe("Title 2");
    // Its event as well: shown once.
    await fake.activity(last);
    expect(
      calls(fake.invoke, "element.get").filter((input) => (input as { ref: string }).ref === "uuid-2"),
    ).toHaveLength(2);
  });

  it("asks a changed element that is shown again, and switches to an open buffer of a read element", async () => {
    const fake = await started();
    await toggle();
    await fake.activity(access(1));
    const asked = calls(fake.invoke, "element.get").length;
    await fake.activity(access(1, { command: "element.update", effect: "write-files" }));
    // The lookup for the name, and the shown buffer asks again.
    expect(calls(fake.invoke, "element.get").length).toBeGreaterThan(asked + 1);
    // The user opens element 2 himself, then follows to 3, and an agent reads 2 again: switched, no lookup.
    await fake.activity(access(3));
    const lookups = calls(fake.invoke, "element.get").length;
    await runCommand("Overview");
    await fake.activity(access(3));
    expect(title()).toBe("Title 3");
    expect(calls(fake.invoke, "element.get").length).toBeGreaterThan(lookups);
  });

  it("says why an element cannot be shown", async () => {
    const fake = await started();
    await toggle();
    await fake.activity(access(9));
    expect(text("Minibuffer")).toBe("No element uuid-9");
    expect(title()).toBeUndefined();
  });

  it("drops the answer of a lookup that a newer access replaced", async () => {
    const handlers = workspace();
    const fake = await started(handlers);
    await toggle();
    let answer: () => void = () => undefined;
    const get = handlers["element.get"];
    fake.invoke.mockImplementationOnce(
      (name: string, input: Record<string, unknown> = {}) =>
        new Promise<InvokeResult>((resolve) => {
          answer = () => {
            resolve(
              name === "element.get"
                ? { ok: false, error: { code: "x", message: "late" } as never }
                : { ok: true, output: get?.(input) },
            );
          };
        }),
    );
    await fake.activity(access(1));
    await fake.activity(access(2));
    expect(title()).toBe("Title 2");
    await act(async () => {
      answer();
      await Promise.resolve();
    });
    await flush();
    expect(title()).toBe("Title 2");
    expect(text("Minibuffer")).not.toBe("late");
  });

  it("does not make an element the mode showed a recent element of the overview", async () => {
    const fake = await started();
    await toggle();
    await fake.activity(access(1));
    await toggle();
    await runCommand("Overview");
    // Its buffer is open (and kept as such, SR-115 AK4), but it is no recent element.
    const recent = (): string => window.localStorage.getItem("reqseq.recent.v1\nWeather station") ?? "";
    expect(recent()).not.toContain("uuid-1");
    // Shown by the user later: then it is.
    await keyDown(window, "p", { ctrlKey: true });
    await type("Title 1");
    await keyDown(query("input"), "Enter");
    expect(recent()).toContain("uuid-1");
  });

  it("asks again after a restart of the core process, and another workspace ends the mode", async () => {
    const handlers = workspace();
    const fake = await started(handlers);
    await fake.change("restarted");
    expect(calls(fake.invoke, "workspace.activity")).toEqual([]);
    await toggle();
    handlers["workspace.activity"] = () => ({ activity: access(2) });
    await fake.change("restarted");
    expect(title()).toBe("Title 2");
    // A restart without a recorded access says nothing.
    handlers["workspace.activity"] = () => ({ activity: null });
    await fake.change("restarted");
    expect(text("Minibuffer")).not.toBe(NO_ACCESS);
    await fake.change("opened");
    expect(text("Modeline")).not.toContain("following agent");
    await fake.activity(access(3));
    expect(title()).toBeUndefined();
  });

  it("says why the last access cannot be read", async () => {
    const handlers = workspace();
    handlers["workspace.activity"] = () => new Error("The workspace is closed");
    await started(handlers);
    await toggle();
    expect(text("Minibuffer")).toBe("The workspace is closed");
    expect(text("Modeline")).toContain("following agent");
  });

  it("unsubscribes when the window goes away", async () => {
    const fake = await started();
    expect(fake.listeners["agent-activity"].size).toBe(1);
    act(() => {
      root.unmount();
    });
    expect(fake.listeners["agent-activity"].size).toBe(0);
    root = createRoot(container);
  });
});
