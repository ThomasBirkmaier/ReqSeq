// @vitest-environment happy-dom
// The open buffers come back when the app opens again (SR-115 AK4): behind the overview, which shows
// first (SR-118 AK1), in their order of use (Ctrl/Cmd+P), which Alt+P walks too (SR-115 AK5), per
// workspace, in the app's storage and never through a write command.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeEvents, InvokeResult, ReqSeqBridge } from "../shared/protocol.js";
import { App } from "./App.js";
import { sessionKey } from "./buffer-session.js";
import { DRAFTS_KEY, keepDrafts } from "./draft-store.js";
import { NO_SUMMARY } from "./package-summary-test-data.js";

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

/** The workspace that is open: its name is all that tells two workspaces apart here. */
let workspace = "Weather station";

const HANDLERS: Record<string, Handler> = {
  // The line of coverage over a list: no counted requirement.
  ...NO_SUMMARY,
  "workspace.status": () => ({ name: workspace, readOnly: true }),
  "element.list": (input) => {
    const ids = (input["selection"] as { ids?: string[] } | undefined)?.ids;
    const all = [row(1), row(2), row(3)];
    const elements = ids === undefined ? all : all.filter((e) => ids.includes(e.id));
    return { elements, total: elements.length };
  },
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
    relations: [],
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

/** `workspace.status` finds no workspace (core restarting) while this is set. */
let statusFails = false;

const invoke = vi.fn((name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> => {
  if (name === "workspace.status" && statusFails) {
    return Promise.resolve({ ok: false, error: { code: "workspace.not-found", message: "restarting" } });
  }
  return Promise.resolve({ ok: true, output: HANDLERS[name]?.(input) });
});

/** The listeners of `workspace-changed`, to open another workspace. */
const changed = new Set<(change: BridgeEvents["workspace-changed"]) => void>();

const bridge: ReqSeqBridge = {
  invoke,
  commands: () => Promise.resolve([]),
  on: (event, listener) => {
    if (event !== "workspace-changed") {
      return () => undefined;
    }
    const added = listener as (change: BridgeEvents["workspace-changed"]) => void;
    changed.add(added);
    return () => {
      changed.delete(added);
    };
  },
  copyText: () => Promise.resolve(true),
  pasteText: () => Promise.resolve(true),
  recentWorkspaces: () => Promise.resolve([]),
  openWorkspace: () => Promise.resolve({ ok: true }),
  listFolder: () => Promise.resolve({ name: "", entries: [] }),
  onSave: () => () => undefined,
  openDocs: () => Promise.resolve({ ok: true as const }),
  onHelp: () => () => undefined,
};

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  workspace = "Weather station";
  statusFails = false;
  invoke.mockClear();
  changed.clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
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

/** The name of the shown buffer. */
const shown = (): string | null => query("[data-buffer]").getAttribute("aria-label");

/** The names of the candidates of the open prompt, in the order shown. */
const candidates = (): (string | null)[] =>
  [...container.querySelectorAll('.candidates [role="option"] .name')].map((name) => name.textContent);

const render = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(App, { bridge }));
    await Promise.resolve();
  });
  await flush();
};

/** Closes the app (its window) and opens it again, with the same storage. */
const restart = async (): Promise<void> => {
  act(() => {
    root.unmount();
  });
  invoke.mockClear();
  changed.clear();
  root = createRoot(container);
  await render();
};

/** Opens another workspace in the window, as main reports it. */
const openWorkspace = async (name: string): Promise<void> => {
  workspace = name;
  await act(async () => {
    for (const listener of changed) {
      listener({ reason: "opened" });
    }
    await Promise.resolve();
  });
  await flush();
};

/** Opens, in this order: the overview (at the start), the list of all elements, its first element, a search. */
const openFour = async (): Promise<void> => {
  await runCommand("List all elements");
  await press(query('[role="listbox"]'), { key: "Enter" });
  expect(shown()).toBe("SR-000001 Title 1");
  await press(window, { key: "F", ctrlKey: true, shiftKey: true });
  await type("wind");
  await press(query("input"), { key: "Enter" });
  expect(shown()).toBe("Search: wind");
};

/** The names of the buffers that Alt+P shows in turn, starting from the shown one. */
const walk = async (count: number): Promise<(string | null)[]> => {
  const seen = [shown()];
  for (let step = 1; step < count; step += 1) {
    await press(window, { key: "p", code: "KeyP", altKey: true });
    seen.push(shown());
  }
  return seen;
};

describe("App, the open buffers after the app opens again (SR-115 AK4)", () => {
  it("[SR-115/AK-qtv5] after the app is opened again the buffers are back behind the overview: Ctrl+P lists them in order of use, and Alt+P walks them in that order", async () => {
    await render();
    await openFour();
    // The element is used last.
    await press(window, { key: "p", ctrlKey: true });
    await press(query("input"), { key: "Enter" });
    expect(shown()).toBe("SR-000001 Title 1");

    await restart();
    // The overview shows first (SR-118 AK1); the buffers are behind it.
    expect(shown()).toBe("Overview");
    await press(window, { key: "p", ctrlKey: true });
    expect(candidates()).toEqual(["SR-000001 Title 1", "Search: wind", "All elements"]);
    await press(query("input"), { key: "Escape" });
    expect(await walk(4)).toEqual(["Overview", "SR-000001 Title 1", "Search: wind", "All elements"]);
    // The element was named by one read of the elements, and nothing was written.
    expect(invoke).toHaveBeenCalledWith("element.list", { selection: { ids: ["uuid-1"] } });
    for (const name of new Set(invoke.mock.calls.map(([called]) => called))) {
      // One file per catalog command (ADR-0002); core's index cannot load under happy-dom.
      const file = join(import.meta.dirname, `../../../../schemas/commands/${name}.json`);
      expect((JSON.parse(readFileSync(file, "utf8")) as { effect: string }).effect).toBe("read");
    }
  });

  it("[SR-115/AK-qtv5] each workspace gets its own buffers back, also after a switch to another and back", async () => {
    await render();
    await openFour();
    // Another workspace starts with the overview alone, and the first one keeps its buffers.
    await openWorkspace("Rain gauge");
    expect(shown()).toBe("Overview");
    await press(window, { key: "p", ctrlKey: true });
    expect(candidates()).toEqual([]);
    await press(query("input"), { key: "Escape" });
    await runCommand("List all elements");
    expect(shown()).toBe("All elements");
    await openWorkspace("Weather station");
    expect(shown()).toBe("Overview");
    expect(await walk(4)).toEqual(["Overview", "Search: wind", "SR-000001 Title 1", "All elements"]);
    // And after a restart the same.
    await restart();
    expect(await walk(4)).toEqual(["Overview", "All elements", "SR-000001 Title 1", "Search: wind"]);
    await openWorkspace("Rain gauge");
    expect(await walk(2)).toEqual(["Overview", "All elements"]);
  });

  it("[SR-115/AK-qtv5] the buffers come back after the name of the open workspace changed while it was open", async () => {
    await render();
    await openFour();
    // Its file is edited: the workspace is renamed while it is open.
    workspace = "Weather station (renamed)";
    await act(async () => {
      for (const listener of changed) {
        listener({ reason: "external", scope: "workspace" });
      }
      await Promise.resolve();
    });
    await flush();
    await restart();
    expect(shown()).toBe("Overview");
    expect(await walk(4)).toEqual(["Overview", "Search: wind", "SR-000001 Title 1", "All elements"]);
  });

  it("[SR-115/AK-qtv5] a name that cannot be read at the start keeps the stored buffers for the next start", async () => {
    await render();
    await openFour();
    // The next start: core answers the reads of the names with an internal error (it is restarting).
    invoke.mockImplementation((name, input = {}) =>
      Promise.resolve(
        name === "element.list" || name === "element.get"
          ? { ok: false, error: { code: "internal", message: "Core restarted" } }
          : { ok: true, output: HANDLERS[name]?.(input) },
      ),
    );
    await restart();
    expect(await walk(3)).toEqual(["Overview", "Search: wind", "All elements"]);
    // Core answers again: the element buffer is back at the start after.
    invoke.mockImplementation((name, input = {}) =>
      Promise.resolve({ ok: true, output: HANDLERS[name]?.(input) }),
    );
    await restart();
    expect(await walk(4)).toEqual(["Overview", "Search: wind", "SR-000001 Title 1", "All elements"]);
  });

  it("[SR-115/AK-qtv5] after Close all buffers only the overview comes back", async () => {
    await render();
    await openFour();
    await runCommand("Close all buffers");
    expect(shown()).toBe("Overview");
    await restart();
    expect(shown()).toBe("Overview");
    expect(await walk(2)).toEqual(["Overview", "Overview"]);
  });

  it("a page loaded again in the same window shows the buffer it showed, with its drafts kept for this workspace (#270)", async () => {
    await render();
    await openFour();
    await press(window, { key: "p", ctrlKey: true });
    await press(query("input"), { key: "Enter" });
    expect(shown()).toBe("SR-000001 Title 1");
    // The page kept a draft of the element in the window's session storage, as `useWindowDrafts` does.
    const key = sessionKey({ ok: true, output: { name: "Weather station", readOnly: true } });
    const keep = (workspace: string | undefined): void => {
      keepDrafts(() => window.sessionStorage, {
        workspace: workspace ?? "",
        shown: "element:spec:uuid-1",
        drafts: new Map([["element:spec:uuid-1", { text: "Hello!", base: "Hello" }]]),
      });
    };
    keep(key);
    // The renderer crashed and main loaded the page again: the session storage is the same.
    await restart();
    expect(shown()).toBe("SR-000001 Title 1");
    expect(query('[aria-label="Minibuffer"]').textContent).toBe(
      "The window was loaded again; the unsaved input of 1 buffer is back",
    );
    expect(query('[aria-label="Modeline"]').textContent).toContain("modified");
    // Another workspace drops them; drafts kept for another workspace do not come back.
    await openWorkspace("Rain gauge");
    expect(window.sessionStorage.getItem(DRAFTS_KEY)).toBeNull();
    keep("another");
    await restart();
    expect(shown()).toBe("Overview");
  });

  it("drafts kept by the page before come back when its first status finds the core process restarting (#270)", async () => {
    await render();
    await openFour();
    await press(window, { key: "p", ctrlKey: true });
    await press(query("input"), { key: "Enter" });
    const key = sessionKey({ ok: true, output: { name: "Weather station", readOnly: true } });
    keepDrafts(() => window.sessionStorage, {
      workspace: key ?? "",
      shown: "element:spec:uuid-1",
      drafts: new Map([
        ["element:spec:uuid-1", { text: "Hello!", base: "Hello" }],
        // The buffer of this draft does not come back: the draft is not counted and not kept.
        ["element:spec:uuid-9", { text: "gone", base: "" }],
      ]),
    });
    act(() => {
      root.unmount();
    });
    changed.clear();
    root = createRoot(container);
    // The first status of the page loaded again finds no workspace: the drafts stay in the storage.
    statusFails = true;
    await render();
    expect(window.sessionStorage.getItem(DRAFTS_KEY)).not.toBeNull();
    // The core process is there again: the buffers and the drafts come back.
    statusFails = false;
    await act(async () => {
      for (const listener of changed) {
        listener({ reason: "restarted" });
      }
      await Promise.resolve();
    });
    await flush();
    expect(shown()).toBe("SR-000001 Title 1");
    expect(query('[aria-label="Modeline"]').textContent).toContain("modified");
    // Only the draft whose buffer came back is kept.
    const kept = window.sessionStorage.getItem(DRAFTS_KEY) ?? "";
    expect(kept).toContain("element:spec:uuid-1");
    expect(kept).not.toContain("element:spec:uuid-9");
  });
});
