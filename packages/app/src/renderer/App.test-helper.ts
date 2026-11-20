// The helpers of the tests of the app (App.test.ts and App-*.test.ts): a fake bridge, a workspace of three
// elements, a React root in a happy-dom container per test, and the keys, typing and clicks of a user.
// Test code only.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import type { Mock } from "vitest";
import type {
  InvokeResult,
  ReqSeqBridge,
  SaveExpired,
  SaveReason,
  WorkspaceChange,
} from "../shared/protocol.js";
import { App } from "./App.js";
import { NO_SUMMARY } from "./package-summary-test-data.js";

/** The layer of the shown buffer of the active area: views drawn in advance stand hidden beside it (SR-212 AK5). */
export const SHOWN = '[data-area][data-active] > [data-layer="main"]';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Handler = (input: Record<string, unknown>) => unknown;

/** The fake bridge of a test, with the mocks and the events of main that the test drives. */
export interface FakeBridge {
  bridge: ReqSeqBridge;
  invoke: Mock<(name: string, input?: Record<string, unknown>) => Promise<InvokeResult>>;
  change: (reason: WorkspaceChange["reason"]) => Promise<void>;
  expire: (data?: SaveExpired) => Promise<void>;
  expired: Set<(data: SaveExpired) => void>;
  listeners: Set<(change: WorkspaceChange) => void>;
  handlers: Record<string, Handler>;
  copyText: Mock<(text: string) => Promise<boolean>>;
  pasteText: Mock<() => Promise<boolean>>;
  openFolderDialog: Mock<() => Promise<boolean>>;
  recentWorkspaces: Mock<ReqSeqBridge["recentWorkspaces"]>;
  openWorkspace: Mock<ReqSeqBridge["openWorkspace"]>;
  savers: ((request?: SaveReason) => Promise<boolean>)[];
  openDocs: Mock<ReqSeqBridge["openDocs"]>;
  help: () => Promise<void>;
}

/** A bridge that answers each command with `handlers[name](input)`; an Error is the error of the command. */
export const fakeBridge = (handlers: Record<string, Handler>): FakeBridge => {
  const listeners = new Set<(change: WorkspaceChange) => void>();
  const invoke = vi.fn((name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> => {
    const output = (handlers[name] ?? NO_SUMMARY[name])?.(input);
    // An error may name its code (`file.changed-on-disk`), as core's do.
    return Promise.resolve(
      output instanceof Error
        ? {
            ok: false,
            error: {
              code: (output as Error & { code?: string }).code ?? "x.failed",
              message: output.message,
            } as never,
          }
        : { ok: true, output },
    );
  });
  const copyText = vi.fn<(text: string) => Promise<boolean>>(() => Promise.resolve(true));
  const pasteText = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
  // The folder dialog of File > Open Workspace…, which main shows (SR-225 AK2).
  const openFolderDialog = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
  const recentWorkspaces = vi.fn<ReqSeqBridge["recentWorkspaces"]>(() => Promise.resolve([]));
  const openWorkspace = vi.fn<ReqSeqBridge["openWorkspace"]>(() => Promise.resolve({ ok: true }));
  // The window's saver, which main calls before a switch (SR-131 AK3) or before the window closes
  // (`closing`, SR-105 AK1).
  const savers: ((request?: SaveReason) => Promise<boolean>)[] = [];
  const onSave = vi.fn<ReqSeqBridge["onSave"]>((save) => {
    const saver = (request: SaveReason = { closing: false }): Promise<boolean> => save(request);
    savers.push(saver);
    return () => {
      savers.splice(savers.indexOf(saver), 1);
    };
  });
  // Main gave up waiting for the save (SR-131 AK3).
  const expired = new Set<(data: SaveExpired) => void>();
  // The documentation in the browser (SR-141): what the window asked main to open, and Help in the menu.
  const openDocs = vi.fn<ReqSeqBridge["openDocs"]>(() => Promise.resolve({ ok: true }));
  const helpListeners = new Set<() => void>();
  const bridge: ReqSeqBridge = {
    invoke,
    commands: () => Promise.resolve([]),
    listFolder: () => Promise.resolve({ name: "", entries: [] }),
    // Only the workspace's changes; `agent-activity` (SR-117) subscribes nothing here (follow-app.test.ts).
    on: (event: string, listener: (data: never) => void) => {
      if (event === "save-expired") {
        const heard = listener as (data: SaveExpired) => void;
        expired.add(heard);
        return () => expired.delete(heard);
      }
      if (event !== "workspace-changed") {
        return () => undefined;
      }
      const changed = listener as (change: WorkspaceChange) => void;
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
    copyText,
    pasteText,
    openFolderDialog,
    recentWorkspaces,
    openWorkspace,
    onSave,
    openDocs,
    onHelp: (listener) => {
      helpListeners.add(listener);
      return () => helpListeners.delete(listener);
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
  const expire = async (data: SaveExpired = {}): Promise<void> => {
    await act(async () => {
      for (const listener of expired) {
        listener(data);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return {
    bridge,
    invoke,
    change,
    expire,
    expired,
    listeners,
    handlers,
    copyText,
    pasteText,
    openFolderDialog,
    recentWorkspaces,
    openWorkspace,
    savers,
    openDocs,
    help: async (): Promise<void> => {
      await act(async () => {
        for (const listener of helpListeners) {
          listener();
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
};

/** A row of `element.list`. */
export interface Row {
  id: string;
  shortId: string;
  type: string;
  status: string;
  title: string;
  repository: string;
  file: string;
  properties: Record<string, never>;
  relations: never[];
}

export const row = (n: number, extra: object = {}): Row => ({
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

/** A relation of `kind` in `direction` to the element `row(n)`, available. */
export interface Link {
  kind: string;
  direction: "in" | "out";
  id: string;
  repository: string;
  shortId: string;
  title: string;
  accessible: boolean;
  targetState: string;
}

export const link = (kind: string, direction: "in" | "out", n: number): Link => ({
  kind,
  direction,
  id: `uuid-${String(n)}`,
  repository: "spec",
  shortId: `SR-00000${String(n)}`,
  title: `Title ${String(n)}`,
  accessible: true,
  targetState: "available",
});

export const STATUS = { name: "Weather station", readOnly: true };
export const NO_WORKSPACE = new Error(
  "No workspace is open. Press Ctrl+O to choose a folder, or Ctrl+Shift+P for Open workspace.",
);

/** The commands of a workspace with three elements. */
export const workspace = (): Record<string, Handler> => ({
  "workspace.status": () => STATUS,
  // A list of UUIDs (the recent elements of the overview, the buffers of a restart) gives those elements.
  "element.list": (input) => {
    const ids = (input["selection"] as { ids?: string[] } | undefined)?.ids;
    return ids === undefined
      ? { elements: [row(1), row(2), row(3)], total: 3 }
      : { elements: ids.map((id) => row(Number(id.replace("uuid-", "")))), total: ids.length };
  },
  "element.get": (input) => ({
    element: row(Number(String(input["ref"]).replace("uuid-", "")), {
      versionDate: "2026-10-24T10:00:00Z",
      relations: [link("derives-from", "out", 3)],
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
    relations: [],
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

export let container: HTMLElement;
export let root: Root;

beforeEach(() => {
  // The recent elements of the overview are kept in the local storage, which the tests share.
  window.localStorage.clear();
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  // A test with fake timers that fails before it switches them off fails; it must not hang the next one.
  vi.useRealTimers();
  vi.restoreAllMocks();
  act(() => {
    root.unmount();
  });
  container.remove();
});

export const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

/** Flushes until `done` holds, at most `times` tasks: for what waits for an idle window (`call-turn.ts`). */
export const flushUntil = async (done: () => boolean, times = 20): Promise<void> => {
  for (let at = 0; at < times && !done(); at += 1) {
    await flush();
  }
};

export const render = async (bridge: ReqSeqBridge): Promise<void> => {
  await act(async () => {
    root.render(createElement(App, { bridge }));
    await Promise.resolve();
  });
  await flush();
};

export const text = (label: string): string | null | undefined =>
  shownOne(`[aria-label="${label}"]`)?.textContent;

/** What the reader sees: the elements of `selector` outside the layers drawn hidden in advance (SR-212 AK5). */
export const shownAll = (selector: string): Element[] =>
  [...container.querySelectorAll(selector)].filter(
    (element) => element.closest('[data-layer="neighbour"]') === null,
  );

/** The first of them, or none. */
export const shownOne = (selector: string): HTMLElement | null =>
  (shownAll(selector)[0] as HTMLElement | undefined) ?? null;

export const query = (selector: string): HTMLElement => {
  const found = (shownAll(selector)[0] ?? null) as HTMLElement | null;
  if (found === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  return found;
};

export const keyDown = async (
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

/** Presses `key` on `target` and gives the event back, to see whether a handler took it. */
export const pressed = async (
  target: Element,
  key: string,
  init: KeyboardEventInit,
): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
    await Promise.resolve();
  });
  await flush();
  return event;
};

export const type = async (value: string): Promise<void> => {
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

export const click = async (target: Element): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  await flush();
};

/** A click on the idle command line as a person's: the press begins on it (SR-202 AK1). */
export const clickLine = async (): Promise<void> => {
  const line = query(".echo");
  await act(async () => {
    line.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await Promise.resolve();
  });
  await click(line);
};

/** In the command prompt with an empty input: a click on its last row, "All commands…" (SR-133 AK3). */
export const allCommands = async (): Promise<void> => {
  const last = [...shownAll('[role="option"]')].find(
    (option) => option.querySelector(".name")?.textContent === "All commands…",
  );
  if (last === undefined) {
    throw new Error("the command prompt has no row All commands…");
  }
  await act(async () => {
    last.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await flush();
};

/** The modifier of the shortcuts on the platform of the test: Cmd under macOS, else Ctrl. */
export const mod = (): { readonly ctrlKey: true } | { readonly metaKey: true } =>
  navigator.platform.startsWith("Mac") ? { metaKey: true } : { ctrlKey: true };

/** Opens the command prompt, types `name` and runs the first candidate. */
export const runCommand = async (name: string): Promise<void> => {
  await keyDown(window, "P", { ...mod(), shiftKey: true });
  await type(name);
  await keyDown(query("input"), "Enter");
};

/** Opens the full list: the app starts with the overview, the list only on request (SR-118 AK4). */
export const listAll = async (): Promise<void> => {
  await runCommand("List all elements");
};

export const renderList = async (bridge: ReqSeqBridge): Promise<void> => {
  await render(bridge);
  await listAll();
};

export const texts = (selector: string): string[] =>
  [...shownAll(selector)].map((element) => element.textContent);

/** The calls of `name`, without those a list makes for the verification of its rows (SR-137). */
export const calls = (invoke: ReturnType<typeof fakeBridge>["invoke"], name: string): unknown[] =>
  invoke.mock.calls
    .filter(([called]) => called === name)
    .map(([, input]) => input)
    .filter((input) => (input as { withVerification?: boolean } | undefined)?.withVerification !== true);

/** A new root in the same container, for a test that unmounted the one it had. */
export const renewRoot = (): void => {
  root = createRoot(container);
};
