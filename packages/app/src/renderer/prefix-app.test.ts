// @vitest-environment happy-dom
// The prefix key in the window (SR-109 AK3, SR-121 AK3): Ctrl/Cmd+K, then a letter runs one of the most
// frequent commands; after half a second without a key the minibuffer shows the possible next keys.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandListing, InvokeResult, LogReqBridge } from "../shared/protocol.js";
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
  properties: { topic: "Weather" },
  relations: [],
  ...extra,
});

type Handler = (input: Record<string, unknown>) => unknown;

const HANDLERS: Record<string, Handler> = {
  "workspace.status": () => ({ name: "Weather station", readOnly: false }),
  "element.list": () => ({ elements: [row(1), row(2)], total: 2 }),
  "element.get": (input) => ({
    element: row(Number(String(input["ref"]).replace("uuid-", "")), { text: "Hello" }),
  }),
  "element.update": (input) => ({ element: row(1, { text: String(input["text"]) }) }),
  "trace.neighbourhood": (input) => ({
    root: input["ref"],
    nodes: [{ ...row(1), depth: 0, expanded: true }],
    total: 1,
    edges: [],
    incomplete: false,
  }),
  "element.search": () => ({ hits: [], total: 0, incomplete: false }),
  "metamodel.get": () => ({
    relations: [],
    types: [{ key: "need", name: "Need", properties: ["title", "topic"] }],
    properties: [
      { key: "title", name: "Title", kind: "text", meaning: "title" },
      { key: "topic", name: "Topic", kind: "text" },
    ],
    statuses: [{ key: "draft" }],
    meanings: {},
  }),
  "element.facets": () => ({
    total: 2,
    types: [{ key: "need", name: "Need", count: 2 }],
    statuses: [{ key: "draft", count: 2 }],
    properties: [],
    incomplete: false,
  }),
};

/** The write commands with a letter after the prefix key, as the bridge lists them; enough for the prompt. */
const write = (name: string, title: string) => ({
  name,
  title,
  summary: "A write command of the catalog.",
  effect: "write-files",
  whileReadOnly: "refuse",
  stage: 3,
  implements: ["SR-073"],
  arguments: [],
  input: { type: "object" },
  output: { type: "object" },
  implemented: true,
});
const CATALOG = [
  write("element.create", "Create element"),
  write("relation.add", "Create relation"),
  write("element.setStatus", "Set status"),
  write("hint.confirm", "Confirm hints"),
] as unknown as readonly CommandListing[];

/** The rows of the write commands, first in the list of next keys. */
const WRITE_ROWS = ["E Create element", "R Create relation", "T Set status", "H Confirm hints"];

const bridge = (workspace = true): LogReqBridge => ({
  invoke: (name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> =>
    Promise.resolve({
      ok: true,
      output: name === "workspace.status" && !workspace ? {} : HANDLERS[name]?.(input),
    }),
  commands: () => Promise.resolve(CATALOG),
  on: () => () => undefined,
  copyText: () => Promise.resolve(true),
  recentWorkspaces: () => Promise.resolve([]),
  openWorkspace: () => Promise.resolve({ ok: true }),
  onSave: () => () => undefined,
});

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

/** Lets the timers (fake once `vi.useFakeTimers` ran) and the answers of the bridge run for `ms`. */
const tick = async (ms = 0): Promise<void> => {
  await act(async () => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(ms);
    } else {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
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
  await tick();
  return event;
};

const ctrlK = (target: EventTarget = window, mac = false): Promise<KeyboardEvent> =>
  press(target, { key: "k", code: "KeyK", ...(mac ? { metaKey: true } : { ctrlKey: true }) });

const type = async (value: string): Promise<void> => {
  const input = query("input");
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const setValue = Reflect.get(descriptor ?? {}, "set") as (this: HTMLElement, value: string) => void;
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  await tick();
};

/** The modifier of the shortcuts on the platform of the test: Cmd under macOS, else Ctrl. */
const mod = (): KeyboardEventInit =>
  navigator.platform.startsWith("Mac") ? { metaKey: true } : { ctrlKey: true };

const runCommand = async (name: string): Promise<void> => {
  await press(window, { key: "P", shiftKey: true, ...mod() });
  await type(name);
  await press(query("input"), { key: "Enter" });
};

const shown = (): string | null => query("[data-buffer]").getAttribute("aria-label");
const echo = (): string | null | undefined => container.querySelector(".minibuffer .echo")?.textContent;

/** The rows of the next keys, as "key command", or undefined while none are shown. */
const nextKeys = (): string[] | undefined => {
  const list = container.querySelector('[aria-label="Next keys"]');
  return list === null
    ? undefined
    : [...list.querySelectorAll("li")].map(
        (item) =>
          `${item.querySelector(".key")?.textContent ?? ""} ${item.querySelector(".name")?.textContent ?? ""}`,
      );
};

const render = async (workspace = true): Promise<void> => {
  await act(async () => {
    root.render(createElement(App, { bridge: bridge(workspace) }));
    await Promise.resolve();
  });
  await tick();
  await tick();
};

/** The app on the element SR-000001, opened from the list of all elements. */
const onElement = async (): Promise<void> => {
  await render();
  await runCommand("List all elements");
  await press(query('[role="listbox"]'), { key: "Enter" });
  expect(shown()).toBe("SR-000001 Title 1");
};

const editorOf = (selector: string): EditorView => {
  const found = EditorView.findFromDOM(query(selector));
  if (found === null) {
    throw new Error(`no editor in ${selector}`);
  }
  return found;
};

describe("the prefix key Ctrl/Cmd+K", () => {
  it("[SR-109/AK3] after Ctrl+K and half a second without a key, shows the next keys with their commands", async () => {
    await onElement();
    vi.useFakeTimers();
    await ctrlK();
    expect(echo()).toBe("Ctrl+K-");
    await tick(499);
    expect(nextKeys()).toBeUndefined();
    await tick(1);
    expect(nextKeys()).toEqual([...WRITE_ROWS, "L List all elements", "O Show overview", "B Close buffer"]);
    expect(echo()).toBe("Ctrl+K-");
    // On a list the list's own commands come in, in the order of the table.
    await press(window, { key: "l" });
    expect(shown()).toBe("All elements");
    expect(nextKeys()).toBeUndefined();
    await ctrlK();
    await tick(500);
    expect(nextKeys()).toEqual([
      ...WRITE_ROWS,
      "L List all elements",
      "O Show overview",
      "F Filter list by type",
      "S Sort list",
      "B Close buffer",
    ]);
  });

  it("[SR-109/AK3] after Cmd+K on macOS and half a second, shows the next keys, the echo written as on macOS", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await onElement();
    vi.useFakeTimers();
    await ctrlK(window, true);
    expect(echo()).toBe("⌘K-");
    await tick(500);
    expect(nextKeys()).toEqual([...WRITE_ROWS, "L List all elements", "O Show overview", "B Close buffer"]);
    await press(window, { key: "o", metaKey: true });
    expect(shown()).toBe("Overview");
    expect(nextKeys()).toBeUndefined();
  });

  it("[SR-109/AK3] in a read-only workspace the next keys leave out the write commands, and their letters say so", async () => {
    HANDLERS["workspace.status"] = () => ({ name: "Weather station", readOnly: true });
    try {
      await onElement();
      vi.useFakeTimers();
      await ctrlK();
      await tick(500);
      expect(nextKeys()).toEqual(["L List all elements", "O Show overview", "B Close buffer"]);
      await press(window, { key: "r" });
      expect(echo()).toBe("Create relation is not available here");
      expect(shown()).toBe("SR-000001 Title 1");
    } finally {
      HANDLERS["workspace.status"] = () => ({ name: "Weather station", readOnly: false });
    }
  });

  it("[SR-109/AK3] a key before half a second runs its command and shows nothing", async () => {
    await onElement();
    vi.useFakeTimers();
    await ctrlK();
    await tick(100);
    await press(window, { key: "l" });
    expect(shown()).toBe("All elements");
    for (let ms = 0; ms < 1000; ms += 100) {
      await tick(100);
      expect(nextKeys()).toBeUndefined();
    }
    expect(echo()).toBe("");
  });

  it("[SR-109/AK3] the next key after the list runs its command and the list goes", async () => {
    await onElement();
    vi.useFakeTimers();
    await ctrlK();
    await tick(500);
    expect(nextKeys()).toHaveLength(7);
    const taken = await press(window, { key: "o" });
    expect(taken.defaultPrevented).toBe(true);
    expect(shown()).toBe("Overview");
    expect(nextKeys()).toBeUndefined();
    expect(echo()).toBe("");

    // Escape ends it without a word.
    await ctrlK();
    await tick(500);
    await press(window, { key: "Escape" });
    expect(nextKeys()).toBeUndefined();
    expect(echo()).toBe("");
    expect(shown()).toBe("Overview");

    // A letter that is not bound says so.
    await ctrlK();
    await press(window, { key: "x" });
    expect(echo()).toBe("Ctrl+K X is not bound");
    await ctrlK();
    await press(window, { key: "ArrowDown" });
    expect(echo()).toBe("Ctrl+K ArrowDown is not bound");

    // A bound letter whose command does not apply here says so.
    await ctrlK();
    await press(window, { key: "f" });
    expect(echo()).toBe("Filter list by type is not available here");
    expect(shown()).toBe("Overview");

    // A mouse press and leaving the window end it.
    await ctrlK();
    await tick(500);
    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await Promise.resolve();
    });
    await tick();
    expect(nextKeys()).toBeUndefined();
    expect(echo()).toBe("");
    await ctrlK();
    await act(async () => {
      window.dispatchEvent(new FocusEvent("blur"));
      await Promise.resolve();
    });
    await tick(1000);
    expect(nextKeys()).toBeUndefined();
    // Ended: the next letter is no longer the prefix's and runs nothing.
    await press(window, { key: "l" });
    expect(shown()).toBe("Overview");

    // A second Ctrl+K shows the list at once; a held K does not; a modifier alone changes nothing.
    await ctrlK();
    await press(window, { key: "k", code: "KeyK", ctrlKey: true, repeat: true });
    expect(nextKeys()).toBeUndefined();
    await press(window, { key: "Control", ctrlKey: true });
    expect(nextKeys()).toBeUndefined();
    await ctrlK();
    expect(nextKeys()).toEqual([...WRITE_ROWS, "L List all elements", "B Close buffer"]);
    // Still waiting: L runs.
    await press(window, { key: "l", ctrlKey: true });
    expect(shown()).toBe("All elements");
  });

  it("[SR-109/AK3] the letter after the prefix never reaches the focused editor or box", async () => {
    for (const mac of [false, true]) {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(mac ? "MacIntel" : "Linux x86_64");
      for (const field of [".cm-editor", '[data-field="topic"] .cm-editor']) {
        await onElement();
        const view = editorOf(field);
        const seen: string[] = [];
        view.contentDOM.addEventListener("keydown", (event) => {
          seen.push(event.key);
        });
        await act(async () => {
          view.focus();
          await Promise.resolve();
        });
        expect(view.contentDOM.contains(document.activeElement)).toBe(true);
        await ctrlK(view.contentDOM, mac);
        await press(view.contentDOM, { key: "o", code: "KeyO" });
        expect(shown()).toBe("Overview");
        // The editor may see Ctrl/Cmd+K itself, which starts at the focused element; never the letter.
        expect(seen).toEqual(["k"]);
        act(() => {
          root.unmount();
        });
        root = createRoot(container);
      }
    }
  });

  it("does not start while a prompt is open, nor without a workspace", async () => {
    await onElement();
    await press(window, { key: "P", ctrlKey: true, shiftKey: true });
    const event = await ctrlK(query("input"));
    expect(event.defaultPrevented).toBe(false);
    expect(container.querySelector("input")).not.toBeNull();
    await press(query("input"), { key: "Escape" });
    await press(window, { key: "l" });
    expect(shown()).toBe("SR-000001 Title 1");
    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    await render(false);
    const none = await ctrlK();
    expect(none.defaultPrevented).toBe(false);
    expect(echo()).not.toBe("Ctrl+K-");
  });

  it("leaves a prevented Ctrl+K alone: on macOS the physical Ctrl+K stays the editor's", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await onElement();
    const view = editorOf(".cm-editor");
    await act(async () => {
      view.focus();
      await Promise.resolve();
    });
    // Physical Ctrl+K on macOS is no prefix.
    await press(view.contentDOM, { key: "k", code: "KeyK", ctrlKey: true });
    expect(echo()).not.toBe("⌘K-");
    // A Cmd+K that a control took is no prefix either.
    view.contentDOM.addEventListener("keydown", (event) => {
      event.preventDefault();
    });
    await press(view.contentDOM, { key: "k", code: "KeyK", metaKey: true });
    expect(echo()).not.toBe("⌘K-");
    await press(view.contentDOM, { key: "o" });
    expect(shown()).toBe("SR-000001 Title 1");
  });

  it("ends when another buffer is shown while it waits (Follow agent)", async () => {
    const listeners = new Set<(data: unknown) => void>();
    const following: LogReqBridge = {
      ...bridge(),
      on: (event, listener) => {
        if (event !== "agent-activity") {
          return () => undefined;
        }
        const added = listener as (data: unknown) => void;
        listeners.add(added);
        return () => listeners.delete(added);
      },
    };
    HANDLERS["workspace.activity"] = () => ({ activity: null });
    await act(async () => {
      root.render(createElement(App, { bridge: following }));
      await Promise.resolve();
    });
    await tick();
    await tick();
    await press(window, { key: "O", ctrlKey: true, shiftKey: true });
    vi.useFakeTimers();
    await ctrlK();
    await act(async () => {
      for (const listener of listeners) {
        listener({
          access: "mcp",
          command: "element.get",
          effect: "read",
          at: new Date().toISOString(),
          element: { id: "uuid-2", repository: "spec" },
        });
      }
      await Promise.resolve();
    });
    await tick();
    await tick();
    expect(shown()).toBe("SR-000002 Title 2");
    await tick(1000);
    expect(nextKeys()).toBeUndefined();
    // The next letter is no longer the prefix's.
    const after = await press(window, { key: "l" });
    expect(after.defaultPrevented).toBe(false);
    delete HANDLERS["workspace.activity"];
  });

  it("ends when another workspace opens, and keeps what the minibuffer says about it", async () => {
    let save: Parameters<LogReqBridge["onSave"]>[0] | undefined;
    const switching: LogReqBridge = {
      ...bridge(),
      onSave: (handler) => {
        save = handler;
        return () => undefined;
      },
    };
    await act(async () => {
      root.render(createElement(App, { bridge: switching }));
      await Promise.resolve();
    });
    await tick();
    await tick();
    await ctrlK();
    expect(echo()).toBe("Ctrl+K-");
    await act(async () => {
      void save?.({ closing: false });
      await Promise.resolve();
    });
    await tick();
    expect(echo()).toBe("Opening another workspace…");
    await tick(600);
    expect(nextKeys()).toBeUndefined();
  });

  it("names a bound key without its command when the catalog could not be read", async () => {
    const without: LogReqBridge = { ...bridge(), commands: () => Promise.reject(new Error("no catalog")) };
    await act(async () => {
      root.render(createElement(App, { bridge: without }));
      await Promise.resolve();
    });
    await tick();
    await tick();
    await ctrlK();
    await press(window, { key: "e" });
    expect(echo()).toBe("Ctrl+K E is not available here");
  });
});
